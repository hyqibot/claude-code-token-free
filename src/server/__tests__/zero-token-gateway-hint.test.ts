import { describe, expect, test, afterEach } from 'bun:test'
import * as net from 'node:net'
import {
  ZERO_TOKEN_GATEWAY_PORT,
  parseLoopbackZeroTokenGateway,
  probeTcpListening,
  getZeroTokenGatewayHintForChatError,
} from '../utils/zeroTokenGatewayHint.js'

describe('parseLoopbackZeroTokenGateway', () => {
  test('returns null when baseUrl is missing or malformed', () => {
    expect(parseLoopbackZeroTokenGateway(undefined)).toBeNull()
    expect(parseLoopbackZeroTokenGateway('')).toBeNull()
    expect(parseLoopbackZeroTokenGateway('not-a-url')).toBeNull()
  })

  test('returns null when host is not loopback', () => {
    expect(parseLoopbackZeroTokenGateway('http://10.0.0.5:3002')).toBeNull()
    expect(parseLoopbackZeroTokenGateway('http://example.com:3002')).toBeNull()
  })

  test('returns null when port does not match the gateway port', () => {
    expect(parseLoopbackZeroTokenGateway('http://127.0.0.1:3456')).toBeNull()
    expect(parseLoopbackZeroTokenGateway('http://localhost:8080')).toBeNull()
  })

  test('returns host/port for loopback addresses on the gateway port', () => {
    expect(parseLoopbackZeroTokenGateway('http://127.0.0.1:3002')).toEqual({
      host: '127.0.0.1',
      port: ZERO_TOKEN_GATEWAY_PORT,
    })
    expect(parseLoopbackZeroTokenGateway('http://localhost:3002')).toEqual({
      host: 'localhost',
      port: ZERO_TOKEN_GATEWAY_PORT,
    })
  })
})

describe('probeTcpListening', () => {
  let openServers: net.Server[] = []

  afterEach(async () => {
    await Promise.all(
      openServers.map(
        (s) =>
          new Promise<void>((resolve) => {
            s.close(() => resolve())
          }),
      ),
    )
    openServers = []
  })

  test('returns true when a listener exists on the port', async () => {
    const server = net.createServer()
    openServers.push(server)
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (typeof addr === 'object' && addr) resolve(addr.port)
        else reject(new Error('no address'))
      })
    })
    expect(await probeTcpListening('127.0.0.1', port, 500)).toBe(true)
  })

  test('returns false within the timeout when no listener exists', async () => {
    // Pick a free port by opening + immediately closing a server.
    const tmp = net.createServer()
    const port = await new Promise<number>((resolve, reject) => {
      tmp.once('error', reject)
      tmp.listen(0, '127.0.0.1', () => {
        const addr = tmp.address()
        if (typeof addr === 'object' && addr) resolve(addr.port)
        else reject(new Error('no address'))
      })
    })
    await new Promise<void>((resolve) => tmp.close(() => resolve()))

    const start = Date.now()
    expect(await probeTcpListening('127.0.0.1', port, 300)).toBe(false)
    expect(Date.now() - start).toBeLessThan(1500)
  })
})

describe('getZeroTokenGatewayHintForChatError', () => {
  test('returns null for non-zero-token base URLs', async () => {
    expect(await getZeroTokenGatewayHintForChatError(undefined)).toBeNull()
    expect(
      await getZeroTokenGatewayHintForChatError('https://api.anthropic.com'),
    ).toBeNull()
    expect(
      await getZeroTokenGatewayHintForChatError('http://127.0.0.1:3456'),
    ).toBeNull()
  })

  test('cert error hint mentions CLI OAuth, not only upstream gateway TLS', async () => {
    let server: net.Server | undefined
    const alreadyListening = await probeTcpListening(
      '127.0.0.1',
      ZERO_TOKEN_GATEWAY_PORT,
    )
    if (!alreadyListening) {
      server = net.createServer()
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject)
        server!.listen(ZERO_TOKEN_GATEWAY_PORT, '127.0.0.1', () => resolve())
      })
    }
    try {
      const hint = await getZeroTokenGatewayHintForChatError(
        'http://127.0.0.1:3002',
        'API Error: unknown certificate verification error',
      )
      expect(hint).toContain('信任所有证书')
      expect(hint).not.toMatch(/7897|Clash|系统代理/)
    } finally {
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()))
      }
    }
  })

  test('connect error does not append hint when gateway port is already listening', async () => {
    let server: net.Server | undefined
    const alreadyListening = await probeTcpListening(
      '127.0.0.1',
      ZERO_TOKEN_GATEWAY_PORT,
    )
    if (!alreadyListening) {
      server = net.createServer()
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject)
        server!.listen(ZERO_TOKEN_GATEWAY_PORT, '127.0.0.1', () => resolve())
      })
    }
    try {
      const hint = await getZeroTokenGatewayHintForChatError(
        'http://127.0.0.1:3002',
        'API Error: Unable to connect. Is the computer able to access the url?',
      )
      expect(hint).toBeNull()
    } finally {
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()))
      }
    }
  })
})
