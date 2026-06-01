import { afterEach, describe, expect, test } from 'bun:test'
import { shouldSkipOAuthTokenRefresh } from '../auth.js'

const saved: Record<string, string | undefined> = {}

function setEnv(overrides: Record<string, string | undefined>) {
  for (const key of Object.keys(overrides)) {
    if (!(key in saved)) {
      saved[key] = process.env[key]
    }
    const value = overrides[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
    delete saved[key]
  }
})

describe('shouldSkipOAuthTokenRefresh', () => {
  test('skips when host manages provider (Zero-Token preset)', () => {
    setEnv({
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:3002',
      ANTHROPIC_AUTH_TOKEN: 'zero-token-local',
    })
    expect(shouldSkipOAuthTokenRefresh()).toBe(true)
  })

  test('skips when ANTHROPIC_BASE_URL is loopback gateway', () => {
    setEnv({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:3002',
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: undefined,
    })
    expect(shouldSkipOAuthTokenRefresh()).toBe(true)
  })

  test('skips when external auth token disables Anthropic OAuth', () => {
    setEnv({
      ANTHROPIC_AUTH_TOKEN: 'zero-token-local',
      ANTHROPIC_BASE_URL: undefined,
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: undefined,
    })
    expect(shouldSkipOAuthTokenRefresh()).toBe(true)
  })
})
