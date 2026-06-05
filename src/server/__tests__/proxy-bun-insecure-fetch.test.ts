import { afterEach, describe, expect, test } from 'bun:test'
import {
  getProxyFetchOptions,
  isLikelyFetchConnectivityError,
  isLikelyFetchConnectivityErrorMessage,
  mergeBunInsecureFetchInit,
  shouldApplyBunInsecureTlsFetchOptions,
} from '../../utils/proxy.js'

describe('getProxyFetchOptions + Bun insecure TLS mirror', () => {
  const saved = {
    NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
    COPAW_INSECURE_TLS: process.env.COPAW_INSECURE_TLS,
    HTTP_PROXY: process.env.HTTP_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
    ANTHROPIC_UNIX_SOCKET: process.env.ANTHROPIC_UNIX_SOCKET,
  }

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k as keyof typeof saved]
      } else {
        process.env[k as keyof typeof saved] = v
      }
    }
  })

  test('shouldApplyBunInsecureTlsFetchOptions follows NODE_TLS_REJECT_UNAUTHORIZED and COPAW_INSECURE_TLS', () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    delete process.env.COPAW_INSECURE_TLS
    expect(shouldApplyBunInsecureTlsFetchOptions()).toBe(false)

    if (typeof Bun === 'undefined') {
      return
    }

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    expect(shouldApplyBunInsecureTlsFetchOptions()).toBe(true)

    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    process.env.COPAW_INSECURE_TLS = '1'
    expect(shouldApplyBunInsecureTlsFetchOptions()).toBe(true)
  })

  test('Bun + insecure env adds tls.rejectUnauthorized false to fetch options', () => {
    if (typeof Bun === 'undefined') {
      return
    }

    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.ANTHROPIC_UNIX_SOCKET
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:3002'
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    delete process.env.COPAW_INSECURE_TLS

    const o = getProxyFetchOptions({ forAnthropicAPI: true })
    expect(o.tls?.rejectUnauthorized).toBe(false)
    // @ts-expect-error Bun proxy option — 无 HTTP_PROXY 时也要显式关系统代理
    expect(o.proxy).toBe('')
  })

  test('isLikelyFetchConnectivityError matches message and nested causes', () => {
    expect(isLikelyFetchConnectivityErrorMessage('Unable to connect')).toBe(true)
    expect(isLikelyFetchConnectivityErrorMessage('ok')).toBe(false)

    const inner = new Error('ECONNREFUSED')
    const mid = new Error('fetch failed') as Error & { cause?: unknown }
    mid.cause = inner
    const outer = new Error('wrapper') as Error & { cause?: unknown }
    outer.cause = mid
    expect(isLikelyFetchConnectivityError(outer)).toBe(true)

    const benign = new Error('404 not found') as Error & { cause?: unknown }
    benign.cause = new Error('nested')
    expect(isLikelyFetchConnectivityError(benign)).toBe(false)
  })

  test('mergeBunInsecureFetchInit disables proxy for loopback and TLS for https', () => {
    if (typeof Bun === 'undefined') {
      return
    }

    const loopback = mergeBunInsecureFetchInit('http://127.0.0.1:3002/v1/messages', {})
    // @ts-expect-error Bun proxy option
    expect(loopback.proxy).toBe('')

    const remote = mergeBunInsecureFetchInit('https://api.anthropic.com/v1/messages', {})
    // @ts-expect-error Bun TLS option
    expect(remote.tls?.rejectUnauthorized).toBe(false)
  })
})
