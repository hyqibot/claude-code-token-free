import { describe, expect, it } from 'bun:test'
import { ensureBridgeSessionOpen } from '../bridge-session.js'
import { WsBridge } from '../ws-bridge.js'
import { WebSocketServer } from 'ws'

describe('ensureBridgeSessionOpen', () => {
  it('waits for reconnect when session exists but socket is not open', async () => {
    const server = new WebSocketServer({ port: 0 })
    await new Promise<void>((resolve) => server.on('listening', () => resolve()))
    const port = (server.address() as { port: number }).port
    server.on('connection', () => {})

    const bridge = new WsBridge(`ws://127.0.0.1:${port}`, 'test')
    const messages: string[] = []

    expect(await ensureBridgeSessionOpen(
      bridge,
      'chat-1',
      { sessionId: 'sess-1' },
      (msg) => { messages.push(String(msg.type)) },
    )).toBe(true)
    expect(bridge.isSessionOpen('chat-1')).toBe(true)

    bridge.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
})
