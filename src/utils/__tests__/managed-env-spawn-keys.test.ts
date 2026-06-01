import { afterEach, describe, expect, test } from 'bun:test'
import { applySafeConfigEnvironmentVariables } from '../managedEnv.js'

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

describe('applySafeConfigEnvironmentVariables spawn env protection', () => {
  test('keeps host-managed ANTHROPIC_BASE_URL after applySafe', () => {
    setEnv({
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:3002',
      ANTHROPIC_AUTH_TOKEN: 'zero-token-local',
      CLAUDE_CODE_ENTRYPOINT: undefined,
    })

    applySafeConfigEnvironmentVariables()

    expect(process.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:3002')
    expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe('zero-token-local')
  })
})
