import { afterEach, describe, expect, test } from 'bun:test'
import {
  isChatConnectivityDiagEnabled,
  recordChatConnectivityDiag,
} from '../utils/chatConnectivityDiag.js'

describe('chatConnectivityDiag', () => {
  const prev = process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY

  afterEach(() => {
    if (prev === undefined) delete process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY
    else process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY = prev
  })

  test('isChatConnectivityDiagEnabled is true only when env is 1', () => {
    delete process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY
    expect(isChatConnectivityDiagEnabled()).toBe(false)
    process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY = '0'
    expect(isChatConnectivityDiagEnabled()).toBe(false)
    process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY = '1'
    expect(isChatConnectivityDiagEnabled()).toBe(true)
  })

  test('recordChatConnectivityDiag does not throw when disabled', () => {
    delete process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY
    expect(() =>
      recordChatConnectivityDiag({
        phase: 'test',
        summary: 'noop',
        details: { x: 1 },
      }),
    ).not.toThrow()
  })
})
