import { describe, expect, test } from 'bun:test'
import { shouldRunWebauthInNodeSubprocess } from '../services/zeroTokenWebauthNodeRunner.js'

describe('zeroTokenWebauthNodeRunner', () => {
  test('uses Node subprocess when running under Bun by default', () => {
    const prev = process.env.CC_HAHA_WEBAUTH_FORCE_NODE
    delete process.env.CC_HAHA_WEBAUTH_FORCE_NODE
    if (process.versions.bun) {
      expect(shouldRunWebauthInNodeSubprocess()).toBe(true)
    }
    if (prev === undefined) delete process.env.CC_HAHA_WEBAUTH_FORCE_NODE
    else process.env.CC_HAHA_WEBAUTH_FORCE_NODE = prev
  })

  test('CC_HAHA_WEBAUTH_FORCE_NODE=0 disables Node subprocess', () => {
    const prev = process.env.CC_HAHA_WEBAUTH_FORCE_NODE
    process.env.CC_HAHA_WEBAUTH_FORCE_NODE = '0'
    expect(shouldRunWebauthInNodeSubprocess()).toBe(false)
    if (prev === undefined) delete process.env.CC_HAHA_WEBAUTH_FORCE_NODE
    else process.env.CC_HAHA_WEBAUTH_FORCE_NODE = prev
  })
})
