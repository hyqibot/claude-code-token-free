import { afterEach, describe, expect, test } from 'bun:test'
import {
  hasForwardProxyEnv,
  shouldInstallInsecureTls,
  shouldUseScopedDeepSeekTls,
} from '../services/zeroTokenGatewayTlsShim.mjs'

describe('zeroTokenGatewayTlsShim', () => {
  const saved: Record<string, string | undefined> = {}

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  function snap(keys: string[]) {
    for (const k of keys) saved[k] = process.env[k]
  }

  test('shouldInstallInsecureTls follows env flags', () => {
    snap(['NODE_TLS_REJECT_UNAUTHORIZED', 'COPAW_INSECURE_TLS'])
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    delete process.env.COPAW_INSECURE_TLS
    expect(shouldInstallInsecureTls()).toBe(false)

    process.env.COPAW_INSECURE_TLS = '1'
    expect(shouldInstallInsecureTls()).toBe(true)

    delete process.env.COPAW_INSECURE_TLS
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    expect(shouldInstallInsecureTls()).toBe(true)
  })

  test('hasForwardProxyEnv detects common proxy variables', () => {
    snap(['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy'])
    delete process.env.HTTPS_PROXY
    delete process.env.HTTP_PROXY
    delete process.env.https_proxy
    delete process.env.http_proxy
    expect(hasForwardProxyEnv()).toBe(false)

    process.env.HTTPS_PROXY = 'http://127.0.0.1:7890'
    expect(hasForwardProxyEnv()).toBe(true)
  })

  test('shouldUseScopedDeepSeekTls defaults true unless COPAW_DEEPSEEK_SCOPED_TLS=0', () => {
    snap(['COPAW_DEEPSEEK_SCOPED_TLS'])
    delete process.env.COPAW_DEEPSEEK_SCOPED_TLS
    expect(shouldUseScopedDeepSeekTls()).toBe(true)
    process.env.COPAW_DEEPSEEK_SCOPED_TLS = '0'
    expect(shouldUseScopedDeepSeekTls()).toBe(false)
  })
})
