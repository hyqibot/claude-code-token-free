import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  buildExeGatewaySpawnArgs,
  buildGatewaySpawnArgs,
  buildNodeGatewaySpawnArgs,
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
})
