import { afterEach, describe, expect, it } from 'bun:test'
import {
  buildClientVersion,
  computeWechatEncryptedSize,
  encryptWechatAesEcb,
  extractWechatText,
  getWechatUploadUrl,
  sendWechatImage,
  sendWechatText,
  sendWechatTyping,
  uploadWechatCdn,
} from '../protocol.js'
import { collectWechatMediaCandidates } from '../media.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('WeChat protocol helpers', () => {
  it('encodes iLink client versions like the OpenClaw Weixin plugin', () => {
    expect(buildClientVersion('2.1.7')).toBe((2 << 16) | (1 << 8) | 7)
    expect(buildClientVersion('1.0.11')).toBe(65547)
  })

  it('extracts plain text from WeChat message items', () => {
    expect(extractWechatText([
      { type: 1, text_item: { text: 'hello' } },
    ])).toBe('hello')
  })

  it('extracts voice transcription when text items are absent', () => {
    expect(extractWechatText([
      { type: 3, voice_item: { text: 'voice text' } },
    ])).toBe('voice text')
  })

  it('preserves quoted text context', () => {
    expect(extractWechatText([
      {
        type: 1,
        text_item: { text: 'reply' },
        ref_msg: {
          title: 'quote title',
          message_item: { type: 1, text_item: { text: 'quoted body' } },
        },
      },
    ])).toBe('[引用: quote title | quoted body]\nreply')
  })

  it('collects image and file media candidates from message items', () => {
    expect(collectWechatMediaCandidates([
      {
        type: 2,
        msg_id: 'img-1',
        image_item: {
          aeskey: '00112233445566778899aabbccddeeff',
          media: {
            full_url: 'https://cdn.example.com/image',
            encrypt_query_param: 'enc=1',
          },
        },
      },
      {
        type: 4,
        msg_id: 'file-1',
        file_item: {
          file_name: 'report.pdf',
          media: {
            full_url: 'https://cdn.example.com/file',
            aes_key: Buffer.from('00112233445566778899aabbccddeeff').toString('base64'),
          },
        },
      },
    ])).toMatchObject([
      {
        kind: 'image',
        name: 'wechat-image-img-1.jpg',
        url: 'https://cdn.example.com/image',
      },
      {
        kind: 'file',
        name: 'report.pdf',
        url: 'https://cdn.example.com/file',
        mimeType: 'application/pdf',
      },
    ])
  })

  it('throws when sendmessage returns a non-zero WeChat ret code', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ ret: 40001, errmsg: 'bad context_token' }), { status: 200 })) as unknown as typeof fetch

    await expect(sendWechatText({
      baseUrl: 'https://api.example.com',
      token: 'token',
      to: 'user',
      text: 'hello',
      contextToken: 'stale-context',
    })).rejects.toThrow('wechatSendMessage returned 40001: bad context_token')
  })

  it('allows successful sendmessage responses', async () => {
    const requests: string[] = []
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requests.push(String(init?.body ?? ''))
      return new Response(JSON.stringify({ ret: 0 }), { status: 200 })
    }) as unknown as typeof fetch

    await sendWechatText({
      baseUrl: 'https://api.example.com',
      token: 'token',
      to: 'user',
      text: 'hello',
      contextToken: 'ctx',
    })

    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]!).msg.context_token).toBe('ctx')
  })

  it('throws when sendtyping returns a non-zero WeChat ret code', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ ret: 42001, errmsg: 'typing ticket expired' }), { status: 200 })) as unknown as typeof fetch

    await expect(sendWechatTyping({
      baseUrl: 'https://api.example.com',
      token: 'token',
      ilinkUserId: 'user',
      typingTicket: 'ticket',
      status: 'typing',
    })).rejects.toThrow('wechatSendTyping returned 42001: typing ticket expired')
  })

  it('computes AES-ECB padded ciphertext size', () => {
    expect(computeWechatEncryptedSize(248731)).toBe(248736)
    expect(computeWechatEncryptedSize(16)).toBe(32)
  })

  it('uploads encrypted image bytes and sends image message', async () => {
    const aesKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
    const raw = Buffer.from('fake-png-bytes')
    const encrypted = encryptWechatAesEcb(raw, aesKey)
    const requests: Array<{ url: string; body?: string; headers?: Headers }> = []

    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const target = String(url)
      requests.push({
        url: target,
        body: typeof init?.body === 'string' ? init.body : undefined,
        headers: init?.headers instanceof Headers ? init.headers : undefined,
      })
      if (target.includes('getuploadurl')) {
        return new Response(JSON.stringify({ ret: 0, upload_param: 'UPLOAD_PARAM' }), { status: 200 })
      }
      if (target.includes('novac2c.cdn.weixin.qq.com')) {
        return new Response('', { status: 200, headers: { 'x-encrypted-param': 'CDN_PARAM' } })
      }
      return new Response(JSON.stringify({ ret: 0 }), { status: 200 })
    }) as unknown as typeof fetch

    const upload = await getWechatUploadUrl({
      baseUrl: 'https://api.example.com',
      token: 'token',
      toUserId: 'user@im.wechat',
      rawBuffer: raw,
      aesKey,
    })
    expect(upload.uploadUrl).toContain('UPLOAD_PARAM')

    const cdnParam = await uploadWechatCdn({
      uploadUrl: upload.uploadUrl,
      encrypted,
    })
    expect(cdnParam).toBe('CDN_PARAM')

    await sendWechatImage({
      baseUrl: 'https://api.example.com',
      token: 'token',
      to: 'user@im.wechat',
      contextToken: 'ctx',
      encryptQueryParam: cdnParam,
      aesKeyField: upload.aesKeyField,
      encryptedSize: upload.encryptedSize,
    })

    const sendBody = requests.find((r) => r.url.includes('sendmessage'))?.body
    expect(sendBody).toBeTruthy()
    const parsed = JSON.parse(sendBody!) as { msg: { item_list: Array<{ type: number; image_item?: unknown }> } }
    expect(parsed.msg.item_list[0]?.type).toBe(2)
    expect(parsed.msg.item_list[0]?.image_item).toBeTruthy()
  })

  it('accepts upload_full_url from getuploadurl response', async () => {
    const aesKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex')
    const raw = Buffer.from('fake-png-bytes')
    const encrypted = encryptWechatAesEcb(raw, aesKey)
    const fullUrl = 'https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=FULL'

    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]) => {
      const target = String(url)
      if (target.includes('getuploadurl')) {
        return new Response(JSON.stringify({ ret: 0, upload_full_url: fullUrl }), { status: 200 })
      }
      if (target === fullUrl) {
        return new Response('', { status: 200, headers: { 'x-encrypted-param': 'CDN_FULL' } })
      }
      return new Response(JSON.stringify({ ret: 0 }), { status: 200 })
    }) as unknown as typeof fetch

    const upload = await getWechatUploadUrl({
      baseUrl: 'https://api.example.com',
      token: 'token',
      toUserId: 'user@im.wechat',
      rawBuffer: raw,
      aesKey,
    })
    expect(upload.uploadUrl).toBe(fullUrl)

    const cdnParam = await uploadWechatCdn({ uploadUrl: upload.uploadUrl, encrypted })
    expect(cdnParam).toBe('CDN_FULL')
  })
})
