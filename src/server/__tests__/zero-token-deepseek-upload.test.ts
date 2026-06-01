import { describe, expect, test } from 'bun:test'
import {
  DEEPSEEK_UPLOAD_TARGET_PATH,
  DEEPSEEK_COMPLETION_TARGET_PATH,
  buildPowResponseHeader,
  createPowChallenge,
} from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/deepseek-upload.mjs'

describe('deepseek-upload PoW paths', () => {
  test('upload and completion use different target_path', () => {
    expect(DEEPSEEK_UPLOAD_TARGET_PATH).toBe('/api/v0/file/upload_file')
    expect(DEEPSEEK_COMPLETION_TARGET_PATH).toBe('/api/v0/chat/completion')
    expect(DEEPSEEK_UPLOAD_TARGET_PATH).not.toBe(DEEPSEEK_COMPLETION_TARGET_PATH)
  })

  test('createPowChallenge posts target_path (mock fetch)', async () => {
    const calls: { url: string; body: unknown }[] = []
    const orig = globalThis.fetch
    globalThis.fetch = async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
      return new Response(
        JSON.stringify({ data: { biz_data: { challenge: { algorithm: 'sha256', challenge: 'x', salt: 's', difficulty: 1 } } } }),
        { status: 200 },
      )
    }
    try {
      const ch = await createPowChallenge({ cookie: 'c=1' }, DEEPSEEK_UPLOAD_TARGET_PATH)
      expect(ch.algorithm).toBe('sha256')
      expect(calls[0]?.body).toEqual({ target_path: DEEPSEEK_UPLOAD_TARGET_PATH })
    } finally {
      globalThis.fetch = orig
    }
  })

  test('buildPowResponseHeader returns base64 string (mock pow + sha256)', async () => {
    const orig = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ data: { biz_data: { challenge: { algorithm: 'sha256', challenge: 'aa', salt: 'bb', difficulty: 1 } } } }),
        { status: 200 },
      )
    try {
      const hdr = await buildPowResponseHeader({ cookie: 'c=1' }, DEEPSEEK_UPLOAD_TARGET_PATH)
      expect(typeof hdr).toBe('string')
      expect(hdr.length).toBeGreaterThan(8)
    } finally {
      globalThis.fetch = orig
    }
  })
})
