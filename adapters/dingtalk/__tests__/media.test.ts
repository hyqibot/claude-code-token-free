import { afterEach, describe, expect, it } from 'bun:test'
import { AttachmentStore } from '../../common/attachment/attachment-store.js'
import { DingTalkMediaService } from '../media.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('DingTalkMediaService outbound', () => {
  it('uploads image and sends via session webhook', async () => {
    const calls: Array<{ url: string; body?: string }> = []
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const target = String(url)
      calls.push({ url: target, body: typeof init?.body === 'string' ? init.body : undefined })
      if (target.includes('/media/upload')) {
        return new Response(JSON.stringify({ errcode: 0, media_id: '@MEDIA123' }), { status: 200 })
      }
      return new Response(JSON.stringify({ errcode: 0 }), { status: 200 })
    }) as unknown as typeof fetch

    const store = new AttachmentStore()
    const media = new DingTalkMediaService(store)
    const mediaId = await media.uploadImage(Buffer.from('png'), 'chart.png', 'token')
    expect(mediaId).toBe('@MEDIA123')

    await media.sendImageMessage('https://oapi.dingtalk.com/robot/sendBySession?session=x', 'token', mediaId, 'chart.png')

    expect(calls.some((c) => c.url.includes('/media/upload'))).toBe(true)
    const sendCall = calls.find((c) => c.url.includes('sendBySession'))
    expect(sendCall?.body).toContain('"msgtype":"markdown"')
    expect(sendCall?.body).toContain('![chart.png](@MEDIA123)')
  })
})
