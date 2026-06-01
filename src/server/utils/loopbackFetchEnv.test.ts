import { afterEach, describe, expect, test } from 'bun:test'
import { mergeNoProxyEnvVars, mergeProcessEnvNoProxyLoopback } from './loopbackFetchEnv.js'

describe('mergeProcessEnvNoProxyLoopback', () => {
  const snapshot = { NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy }

  afterEach(() => {
    process.env.NO_PROXY = snapshot.NO_PROXY
    process.env.no_proxy = snapshot.no_proxy
  })

  test('preserves existing entries and ensures loopback hosts', () => {
    delete process.env.no_proxy
    process.env.NO_PROXY = 'example.test'
    mergeProcessEnvNoProxyLoopback()
    expect(process.env.NO_PROXY).toContain('127.0.0.1')
    expect(process.env.NO_PROXY).toContain('example.test')
    expect(process.env.no_proxy).toContain('localhost')
    expect(process.env.no_proxy).toContain('[::1]')
  })

  test('mergeNoProxyEnvVars updates a detached env object', () => {
    const env: Record<string, string | undefined> = {
      NO_PROXY: 'foo.bar',
      OTHER: 'x',
    }
    mergeNoProxyEnvVars(env)
    expect(env.NO_PROXY).toContain('127.0.0.1')
    expect(env.NO_PROXY).toContain('foo.bar')
    expect(env.no_proxy).toContain('localhost')
  })
})
