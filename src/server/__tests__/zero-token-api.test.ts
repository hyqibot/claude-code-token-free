import { describe, expect, test } from 'bun:test'
import { resolveZeroTokenSubPath } from '../api/zero-token.js'

describe('resolveZeroTokenSubPath', () => {
  test('authorize', () => {
    const url = new URL('http://127.0.0.1/api/zero-token/authorize')
    expect(resolveZeroTokenSubPath(url, ['api', 'zero-token', 'authorize'])).toBe('authorize')
  })

  test('case-insensitive segment', () => {
    const url = new URL('http://127.0.0.1/api/zero-token/Authorize')
    expect(resolveZeroTokenSubPath(url, ['api', 'zero-token', 'Authorize'])).toBe('authorize')
  })

  test('defaults to status when only /api/zero-token', () => {
    const url = new URL('http://127.0.0.1/api/zero-token')
    expect(resolveZeroTokenSubPath(url, ['api', 'zero-token'])).toBe('status')
  })

  test('ensure-chrome-debug hyphen preserved', () => {
    const url = new URL('http://127.0.0.1/api/zero-token/ensure-chrome-debug')
    expect(resolveZeroTokenSubPath(url, ['api', 'zero-token', 'ensure-chrome-debug'])).toBe(
      'ensure-chrome-debug',
    )
  })

  test('deepseek-tool-mode subpath', () => {
    const url = new URL('http://127.0.0.1/api/zero-token/deepseek-tool-mode')
    expect(resolveZeroTokenSubPath(url, ['api', 'zero-token', 'deepseek-tool-mode'])).toBe(
      'deepseek-tool-mode',
    )
  })

  test('authorize-stream subpath', () => {
    const url = new URL('http://127.0.0.1/api/zero-token/authorize-stream')
    expect(resolveZeroTokenSubPath(url, ['api', 'zero-token', 'authorize-stream'])).toBe('authorize-stream')
  })
})
