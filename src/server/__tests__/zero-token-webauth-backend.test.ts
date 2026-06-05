import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readWebauthBackend } from '../services/zeroTokenWebauthBackend.js'

describe('readWebauthBackend', () => {
  let originalCc: string | undefined
  let originalCopaw: string | undefined

  beforeEach(() => {
    originalCc = process.env.CC_HAHA_ZERO_TOKEN_WEBAUTH_BACKEND
    originalCopaw = process.env.COPAW_ZERO_TOKEN_WEBAUTH_BACKEND
    delete process.env.CC_HAHA_ZERO_TOKEN_WEBAUTH_BACKEND
    delete process.env.COPAW_ZERO_TOKEN_WEBAUTH_BACKEND
  })

  afterEach(() => {
    if (originalCc === undefined) delete process.env.CC_HAHA_ZERO_TOKEN_WEBAUTH_BACKEND
    else process.env.CC_HAHA_ZERO_TOKEN_WEBAUTH_BACKEND = originalCc
    if (originalCopaw === undefined) delete process.env.COPAW_ZERO_TOKEN_WEBAUTH_BACKEND
    else process.env.COPAW_ZERO_TOKEN_WEBAUTH_BACKEND = originalCopaw
  })

  test('defaults to ts when unset', () => {
    expect(readWebauthBackend()).toBe('ts')
  })

  test('CC_HAHA env overrides settings default', () => {
    process.env.CC_HAHA_ZERO_TOKEN_WEBAUTH_BACKEND = 'python'
    expect(readWebauthBackend()).toBe('python')
  })

  test('COPAW env alias works', () => {
    process.env.COPAW_ZERO_TOKEN_WEBAUTH_BACKEND = 'python'
    expect(readWebauthBackend()).toBe('python')
  })

  test('CC_HAHA env wins over COPAW', () => {
    process.env.CC_HAHA_ZERO_TOKEN_WEBAUTH_BACKEND = 'ts'
    process.env.COPAW_ZERO_TOKEN_WEBAUTH_BACKEND = 'python'
    expect(readWebauthBackend()).toBe('ts')
  })
})
