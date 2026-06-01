import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  buildGatewaySpawnArgs,
  buildGatewaySpawnInsecureTlsEnv,
  getZeroTokenGatewayHttpBase,
  parseZeroTokenStatus,
  resolvePythonExe,
} from '../services/zeroTokenService.js'

function copawOnboardSuccessLike(exitCode: number, output: string): boolean {
  if (exitCode === 0) return true
  const o = (output || '').trim()
  if (!o) return false
  if (o.toLowerCase().includes('traceback')) return false
  if (exitCode !== 1) return false
  return o.includes('授权完成') || o.includes('已启动浏览器调试模式')
}

describe('zero token status parser', () => {
  test('parses canonical status output', () => {
    const parsed = parseZeroTokenStatus('zero-token: listening=true pid=12345 127.0.0.1:3002')
    expect(parsed.listening).toBe(true)
    expect(parsed.pid).toBe(12345)
    expect(parsed.host).toBe('127.0.0.1')
    expect(parsed.port).toBe(3002)
  })

  test('returns fallback when output is not parseable', () => {
    const parsed = parseZeroTokenStatus('command not found')
    expect(parsed.listening).toBe(false)
    expect(parsed.pid).toBeNull()
    expect(parsed.host).toBeNull()
    expect(parsed.port).toBeNull()
    expect(parsed.raw).toBe('command not found')
  })
})

describe('getZeroTokenGatewayHttpBase', () => {
  let originalHost: string | undefined
  let originalPort: string | undefined
  let originalIclawHost: string | undefined
  let originalIclawPort: string | undefined

  beforeEach(() => {
    originalHost = process.env.COPAW_ZERO_TOKEN_HOST
    originalPort = process.env.COPAW_ZERO_TOKEN_PORT
    originalIclawHost = process.env.ICLAW_ZERO_TOKEN_HOST
    originalIclawPort = process.env.ICLAW_ZERO_TOKEN_PORT
  })

  afterEach(() => {
    if (originalHost === undefined) delete process.env.COPAW_ZERO_TOKEN_HOST
    else process.env.COPAW_ZERO_TOKEN_HOST = originalHost
    if (originalPort === undefined) delete process.env.COPAW_ZERO_TOKEN_PORT
    else process.env.COPAW_ZERO_TOKEN_PORT = originalPort
    if (originalIclawHost === undefined) delete process.env.ICLAW_ZERO_TOKEN_HOST
    else process.env.ICLAW_ZERO_TOKEN_HOST = originalIclawHost
    if (originalIclawPort === undefined) delete process.env.ICLAW_ZERO_TOKEN_PORT
    else process.env.ICLAW_ZERO_TOKEN_PORT = originalIclawPort
  })

  test('defaults to 127.0.0.1:3002', () => {
    delete process.env.COPAW_ZERO_TOKEN_HOST
    delete process.env.COPAW_ZERO_TOKEN_PORT
    delete process.env.ICLAW_ZERO_TOKEN_HOST
    delete process.env.ICLAW_ZERO_TOKEN_PORT
    expect(getZeroTokenGatewayHttpBase()).toBe('http://127.0.0.1:3002')
  })

  test('respects COPAW_ZERO_TOKEN_HOST / PORT', () => {
    delete process.env.ICLAW_ZERO_TOKEN_HOST
    delete process.env.ICLAW_ZERO_TOKEN_PORT
    process.env.COPAW_ZERO_TOKEN_HOST = '127.0.0.1'
    process.env.COPAW_ZERO_TOKEN_PORT = '4002'
    expect(getZeroTokenGatewayHttpBase()).toBe('http://127.0.0.1:4002')
  })

  test('falls back to ICLAW_ZERO_TOKEN_HOST / PORT when COPAW unset', () => {
    delete process.env.COPAW_ZERO_TOKEN_HOST
    delete process.env.COPAW_ZERO_TOKEN_PORT
    process.env.ICLAW_ZERO_TOKEN_HOST = '127.0.0.1'
    process.env.ICLAW_ZERO_TOKEN_PORT = '4003'
    expect(getZeroTokenGatewayHttpBase()).toBe('http://127.0.0.1:4003')
  })

  test('COPAW overrides ICLAW when both set', () => {
    process.env.COPAW_ZERO_TOKEN_HOST = '127.0.0.1'
    process.env.COPAW_ZERO_TOKEN_PORT = '3002'
    process.env.ICLAW_ZERO_TOKEN_HOST = '127.0.0.1'
    process.env.ICLAW_ZERO_TOKEN_PORT = '9999'
    expect(getZeroTokenGatewayHttpBase()).toBe('http://127.0.0.1:3002')
  })
})

describe('copaw onboard exit code heuristic', () => {
  test('treats exit 1 + 授权完成 as success (CoPaw raise SystemExit)', () => {
    expect(copawOnboardSuccessLike(1, 'DeepSeek Web 授权完成：cookie=ok bearer=ok')).toBe(true)
  })

  test('treats traceback as failure', () => {
    expect(copawOnboardSuccessLike(1, 'Traceback...')).toBe(false)
  })
})

describe('buildGatewaySpawnInsecureTlsEnv', () => {
  test('returns empty when insecureTls is off (default safe TLS verify)', () => {
    expect(buildGatewaySpawnInsecureTlsEnv(false)).toEqual({})
  })

  test('returns NODE_TLS_REJECT_UNAUTHORIZED=0 + COPAW_INSECURE_TLS=1 when on', () => {
    expect(buildGatewaySpawnInsecureTlsEnv(true)).toEqual({
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
      COPAW_INSECURE_TLS: '1',
    })
  })
})

describe('buildGatewaySpawnArgs', () => {
  const baseArgs = {
    nodeBin: 'node',
    entryPath: 'C:\\path\\to\\server.mjs',
    shimPath: 'C:\\path\\to\\shim.mjs',
  }

  test('plain spawn when insecureTls is off (no --import)', () => {
    expect(
      buildGatewaySpawnArgs({ ...baseArgs, isInsecureTls: false, shimExists: true }),
    ).toEqual(['node', 'C:\\path\\to\\server.mjs'])
  })

  test('plain spawn when shim file is missing (degrade gracefully)', () => {
    expect(
      buildGatewaySpawnArgs({ ...baseArgs, isInsecureTls: true, shimExists: false }),
    ).toEqual(['node', 'C:\\path\\to\\server.mjs'])
  })

  test('injects --import file:// shim when insecureTls and shim both available', () => {
    const args = buildGatewaySpawnArgs({
      ...baseArgs,
      isInsecureTls: true,
      shimExists: true,
    })
    expect(args[0]).toBe('node')
    expect(args[1]).toBe('--import')
    expect(args[2]).toBe(pathToFileURL('C:\\path\\to\\shim.mjs').href)
    expect(args[3]).toBe('C:\\path\\to\\server.mjs')
  })

  test('shim file actually exists in repo (regression: do not break the relative resolve)', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const shimPath = join(here, '..', 'services', 'zeroTokenGatewayTlsShim.mjs')
    expect(existsSync(shimPath)).toBe(true)
  })
})

describe('resolvePythonExe', () => {
  let originalExplicit: string | undefined
  let originalConda: string | undefined
  let originalCli: string | undefined

  beforeEach(() => {
    originalExplicit = process.env.COPAW_ZERO_TOKEN_PYTHON
    originalConda = process.env.CONDA_PREFIX
    originalCli = process.env.COPAW_ZERO_TOKEN_CLI
    delete process.env.COPAW_ZERO_TOKEN_PYTHON
    delete process.env.COPAW_ZERO_TOKEN_CLI
  })

  afterEach(() => {
    if (originalExplicit === undefined) delete process.env.COPAW_ZERO_TOKEN_PYTHON
    else process.env.COPAW_ZERO_TOKEN_PYTHON = originalExplicit
    if (originalConda === undefined) delete process.env.CONDA_PREFIX
    else process.env.CONDA_PREFIX = originalConda
    if (originalCli === undefined) delete process.env.COPAW_ZERO_TOKEN_CLI
    else process.env.COPAW_ZERO_TOKEN_CLI = originalCli
  })

  test('prefers CONDA_PREFIX python.exe over bare python on Windows', async () => {
    if (process.platform !== 'win32') return
    const prefix = process.env.CONDA_PREFIX?.trim()
    if (!prefix) return
    const expected = join(prefix, 'python.exe')
    if (!existsSync(expected)) return
    const resolved = await resolvePythonExe()
    expect(resolved.toLowerCase()).toBe(expected.toLowerCase())
  })
})

