import { describe, expect, test } from 'bun:test'
import {
  applyLoopbackAnthropicNetworkGuards,
  stripForwardProxyForLoopbackAnthropicBaseUrl,
} from '../utils/loopbackFetchEnv.js'
import { isLoopbackAnthropicBaseUrlEnv } from '../../utils/proxy.js'

describe('stripForwardProxyForLoopbackAnthropicBaseUrl', () => {
  test('removes proxy vars when base URL is loopback', () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:3002',
      HTTP_PROXY: 'http://proxy.invalid:8080',
      HTTPS_PROXY: 'http://proxy.invalid:8080',
    }
    stripForwardProxyForLoopbackAnthropicBaseUrl(env)
    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.HTTPS_PROXY).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:3002')
  })

  test('applyLoopbackAnthropicNetworkGuards strips proxy and merges NO_PROXY', () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:3002',
      HTTP_PROXY: 'http://proxy.invalid:8080',
      HTTPS_PROXY: 'http://proxy.invalid:8080',
    }
    applyLoopbackAnthropicNetworkGuards(env)
    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.NO_PROXY).toContain('127.0.0.1')
  })

  test('does not strip for remote Anthropic base URL', () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_BASE_URL: 'https://api.example.com',
      HTTP_PROXY: 'http://proxy.invalid:8080',
    }
    stripForwardProxyForLoopbackAnthropicBaseUrl(env)
    expect(env.HTTP_PROXY).toBe('http://proxy.invalid:8080')
  })
})

describe('isLoopbackAnthropicBaseUrlEnv', () => {
  test('detects 127.0.0.1', () => {
    expect(isLoopbackAnthropicBaseUrlEnv({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:3002' })).toBe(true)
  })

  test('detects localhost', () => {
    expect(isLoopbackAnthropicBaseUrlEnv({ ANTHROPIC_BASE_URL: 'http://localhost:3002' })).toBe(true)
  })

  test('false for remote API', () => {
    expect(isLoopbackAnthropicBaseUrlEnv({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' })).toBe(false)
  })
})
