import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildExeGatewaySpawnArgs,
  buildGatewaySpawnArgs,
  buildNodeGatewaySpawnArgs,
  playwrightMarkerExistsForGateway,
  resolveGatewaySpawnMode,
} from '../services/zeroTokenGatewaySpawn.js'

describe('zeroTokenGatewaySpawn', () => {
  let spawnMode: string | undefined
  let gatewayEntry: string | undefined

  beforeEach(() => {
    spawnMode = process.env.CC_HAHA_ZERO_TOKEN_SPAWN_MODE
    gatewayEntry = process.env.COPAW_ZERO_TOKEN_GATEWAY_ENTRY
  })

  afterEach(() => {
    if (spawnMode === undefined) delete process.env.CC_HAHA_ZERO_TOKEN_SPAWN_MODE
    else process.env.CC_HAHA_ZERO_TOKEN_SPAWN_MODE = spawnMode
    if (gatewayEntry === undefined) delete process.env.COPAW_ZERO_TOKEN_GATEWAY_ENTRY
    else process.env.COPAW_ZERO_TOKEN_GATEWAY_ENTRY = gatewayEntry
  })

  test('resolveGatewaySpawnMode defaults to exe', () => {
    delete process.env.CC_HAHA_ZERO_TOKEN_SPAWN_MODE
    delete process.env.COPAW_ZERO_TOKEN_GATEWAY_ENTRY
    expect(resolveGatewaySpawnMode()).toBe('exe')
  })

  test('COPAW_ZERO_TOKEN_GATEWAY_ENTRY forces node mode', () => {
    process.env.COPAW_ZERO_TOKEN_GATEWAY_ENTRY = 'C:\\dev\\server.mjs'
    expect(resolveGatewaySpawnMode()).toBe('node')
  })

  test('buildExeGatewaySpawnArgs includes app-root host port', () => {
    expect(
      buildExeGatewaySpawnArgs({
        exePath: 'C:\\bin\\zero-token-gateway.exe',
        appRoot: 'C:\\app',
        host: '127.0.0.1',
        port: 3002,
      }),
    ).toEqual([
      'C:\\bin\\zero-token-gateway.exe',
      '--app-root',
      'C:\\app',
      '--host',
      '127.0.0.1',
      '--port',
      '3002',
    ])
  })

  test('buildNodeGatewaySpawnArgs matches legacy buildGatewaySpawnArgs', () => {
    const params = {
      nodeBin: 'node',
      entryPath: 'C:\\path\\to\\server.mjs',
      isInsecureTls: false,
      shimPath: 'C:\\path\\to\\shim.mjs',
      shimExists: true,
    }
    expect(buildGatewaySpawnArgs(params)).toEqual(buildNodeGatewaySpawnArgs(params))
    expect(buildGatewaySpawnArgs(params)).toEqual(['node', 'C:\\path\\to\\server.mjs'])
  })

  test('playwrightMarkerExistsForGateway resolves staged runtime from CLAUDE_APP_ROOT', async () => {
    const installRoot = mkdtempSync(join(tmpdir(), 'cc-packaged-install-'))
    const marker = join(installRoot, 'zero-token-runtime', 'node_modules', 'playwright-core', 'index.mjs')
    mkdirSync(join(marker, '..'), { recursive: true })
    writeFileSync(marker, 'export default {};\n', 'utf8')

    const prevAppRoot = process.env.CLAUDE_APP_ROOT
    process.env.CLAUDE_APP_ROOT = installRoot
    try {
      expect(await playwrightMarkerExistsForGateway()).toBe(true)
    } finally {
      if (prevAppRoot === undefined) delete process.env.CLAUDE_APP_ROOT
      else process.env.CLAUDE_APP_ROOT = prevAppRoot
      rmSync(installRoot, { recursive: true, force: true })
    }
  })
})
