import path from 'node:path'
import { AttachmentStore } from '../common/attachment/attachment-store.js'
import type { LocalAttachment } from '../common/attachment/attachment-types.js'
import type { DingTalkAttachmentCandidate } from './helpers.js'

const DINGTALK_API = 'https://api.dingtalk.com'
const DINGTALK_OAPI = 'https://oapi.dingtalk.com'

export class DingTalkMediaService {
  constructor(private readonly store: AttachmentStore) {}

  async downloadCandidate(
    candidate: DingTalkAttachmentCandidate,
    sessionId: string,
    opts: { clientId: string; accessToken: string },
  ): Promise<LocalAttachment> {
    const downloadUrl = candidate.url || await this.resolveDownloadUrl(candidate.downloadCode, opts)
    if (!downloadUrl) throw new Error('DingTalk media item is missing a download URL')

    const resp = await fetch(downloadUrl)
    if (!resp.ok) {
      throw new Error(`DingTalk media download failed: ${resp.status} ${resp.statusText}`)
    }
    const buffer = Buffer.from(await resp.arrayBuffer())
    const contentType = resp.headers.get('content-type') || inferMime(candidate.fileName, candidate.kind)
    const name = candidate.fileName || buildImageName(contentType)
    const target = this.store.resolvePath('dingtalk', sessionId, name)
    const savedPath = await this.store.write(target, buffer)

    return {
      kind: candidate.kind,
      name,
      path: savedPath,
      buffer,
      size: buffer.length,
      mimeType: contentType,
    }
  }

  private async resolveDownloadUrl(
    downloadCode: string | undefined,
    opts: { clientId: string; accessToken: string },
  ): Promise<string | null> {
    if (!downloadCode) return null
    const resp = await fetch(`${DINGTALK_API}/v1.0/robot/messageFiles/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': opts.accessToken,
      },
      body: JSON.stringify({
        downloadCode,
        robotCode: opts.clientId,
      }),
    })
    const body = await resp.json().catch(() => null) as { downloadUrl?: string; message?: string } | null
    if (!resp.ok || !body?.downloadUrl) {
      throw new Error(body?.message || `DingTalk downloadCode exchange failed: ${resp.status}`)
    }
    return body.downloadUrl
  }

  async uploadImage(buffer: Buffer, fileName: string, accessToken: string): Promise<string> {
    const form = new FormData()
    form.append('type', 'image')
    form.append('media', new Blob([buffer]), fileName)

    const url = `${DINGTALK_OAPI}/media/upload?access_token=${encodeURIComponent(accessToken)}&type=image`
    const resp = await fetch(url, { method: 'POST', body: form })
    const body = await resp.json().catch(() => null) as {
      errcode?: number
      errmsg?: string
      media_id?: string
    } | null
    if (!resp.ok || body?.errcode !== 0 || !body.media_id) {
      throw new Error(body?.errmsg || `DingTalk media upload failed: ${resp.status}`)
    }
    return body.media_id
  }

  async sendImageMessage(
    sessionWebhook: string,
    accessToken: string,
    mediaId: string,
    fileName: string,
  ): Promise<void> {
    // Stream 机器人 sessionWebhook 不支持 msgtype=image，需用 markdown 嵌入 mediaId。
    const resp = await fetch(sessionWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-acs-dingtalk-access-token': accessToken,
      },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: {
          title: 'Claude Code',
          text: `![${fileName}](${mediaId})`,
        },
      }),
    })
    const body = await resp.json().catch(() => null) as { errcode?: number; errmsg?: string } | null
    if (!resp.ok || (body?.errcode != null && body.errcode !== 0)) {
      throw new Error(body?.errmsg || `DingTalk image send failed: ${resp.status}`)
    }
  }
}

function buildImageName(mime?: string): string {
  const ext = mime?.includes('png')
    ? '.png'
    : mime?.includes('gif')
      ? '.gif'
      : mime?.includes('webp')
        ? '.webp'
        : '.jpg'
  return `dingtalk-image-${Date.now()}${ext}`
}

function inferMime(fileName: string | undefined, kind: 'image' | 'file'): string {
  if (kind === 'image') return 'image/jpeg'
  const ext = path.extname(fileName || '').toLowerCase()
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.txt') return 'text/plain'
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webp') return 'image/webp'
  return 'application/octet-stream'
}
