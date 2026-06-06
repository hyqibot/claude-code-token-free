import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  buildExeWebauthSpawnArgs,
  buildNodeWebauthSpawnArgs,
  resolveWebauthDepsSpawnMode,
  resolveWebauthSpawnMode,
  resolveWebauthNodeBinaryForSpawn,
} from '../services/zeroTokenWebauthSpawn.js'

const isWindows = process.platform === 'win32'
const winOnly = isWindows ? test : test.skip

describe('zeroTokenWebauthSpawn', () => {
  let spawnMode: string | undefined
  let runnerBundle: string | undefined
  let appRoot: string | undefined

  beforeEach(() => {
    spawnMode = process.env.CC_HAHA_WEBAUTH_SPAWN_MODE
    runnerBundle = process.env.CC_HAHA_WEBAUTH_RUNNER_BUNDLE
    appRoot = process.env.CLAUDE_APP_ROOT
  })

  afterEach(() => {
    if (spawnMode === undefined) delete process.env.CC_HAHA_WEBAUTH_SPAWN_MODE
    else process.env.CC_HAHA_WEBAUTH_SPAWN_MODE = spawnMode
    if (runnerBundle === undefined) delete process.env.CC_HAHA_WEBAUTH_RUNNER_BUNDLE
    else process.env.CC_HAHA_WEBAUTH_RUNNER_BUNDLE = runnerBundle
    if (appRoot === undefined) delete process.env.CLAUDE_APP_ROOT
    else process.env.CLAUDE_APP_ROOT = appRoot
  })

  test('resolveWebauthSpawnMode defaults to exe', () => {
    delete process.env.CC_HAHA_WEBAUTH_SPAWN_MODE
    delete process.env.CC_HAHA_WEBAUTH_RUNNER_BUNDLE
    expect(resolveWebauthSpawnMode()).toBe('exe')
  })

  test('CC_HAHA_WEBAUTH_SPAWN_MODE=node forces node mode', () => {
    process.env.CC_HAHA_WEBAUTH_SPAWN_MODE = 'node'
    expect(resolveWebauthSpawnMode()).toBe('node')
  })

  test('CC_HAHA_WEBAUTH_RUNNER_BUNDLE forces node mode', () => {
    process.env.CC_HAHA_WEBAUTH_RUNNER_BUNDLE = 'C:\\dev\\node-runner.bundle.mjs'
    expect(resolveWebauthSpawnMode()).toBe('node')
  })

  test('buildExeWebauthSpawnArgs includes app-root cmd payload', () => {
    expect(
      buildExeWebauthSpawnArgs({
        exePath: 'C:\\bin\\zero-token-webauth-runner.exe',
        appRoot: 'C:\\app',
        cmd: 'ensure',
        payloadJson: '{"urls":["http://127.0.0.1:9222"]}',
      }),
    ).toEqual([
      'C:\\bin\\zero-token-webauth-runner.exe',
      '--app-root',
      'C:\\app',
      'ensure',
      '{"urls":["http://127.0.0.1:9222"]}',
    ])
  })

  test('buildNodeWebauthSpawnArgs matches dev bundle fallback', () => {
    expect(
      buildNodeWebauthSpawnArgs({
        nodeBin: 'node',
        bundlePath: 'C:\\dev\\node-runner.bundle.mjs',
        cmd: 'onboard',
        payloadJson: '{"mode":"deepseek-chat"}',
      }),
    ).toEqual([
      'node',
      'C:\\dev\\node-runner.bundle.mjs',
      'onboard',
      '{"mode":"deepseek-chat"}',
    ])
  })

  test('resolveWebauthDepsSpawnMode prefers exe when CLAUDE_APP_ROOT is set', () => {
    delete process.env.CC_HAHA_WEBAUTH_SPAWN_MODE
    delete process.env.CC_HAHA_WEBAUTH_RUNNER_BUNDLE
    process.env.CLAUDE_APP_ROOT = 'C:\\Claude Code Token Free'
    expect(resolveWebauthDepsSpawnMode()).toBe('exe')
  })

  test('buildExeWebauthSpawnArgs supports keepalive cmd', () => {
    expect(
      buildExeWebauthSpawnArgs({
        exePath: 'C:\\bin\\zero-token-webauth-runner.exe',
        appRoot: 'C:\\app',
        cmd: 'keepalive',
        payloadJson: '{"urls":["https://chat.deepseek.com"]}',
      }),
    ).toEqual([
      'C:\\bin\\zero-token-webauth-runner.exe',
      '--app-root',
      'C:\\app',
      'keepalive',
      '{"urls":["https://chat.deepseek.com"]}',
    ])
  })

  winOnly('resolveWebauthNodeBinaryForSpawn falls back to node.exe on Windows', () => {
    const prevAppRoot = process.env.CLAUDE_APP_ROOT
    delete process.env.CC_HAHA_WEBAUTH_NODE
    delete process.env.CLAUDE_APP_ROOT
    expect(resolveWebauthNodeBinaryForSpawn('C:\\app-without-bundled-node')).toBe('node.exe')
    if (prevAppRoot === undefined) delete process.env.CLAUDE_APP_ROOT
    else process.env.CLAUDE_APP_ROOT = prevAppRoot
  })
})
