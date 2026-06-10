import type { PendingUpload } from './attachment-types.js'
import { ImageBlockWatcher } from './image-block-watcher.js'
import { extractLocalImagePaths } from './local-image-paths.js'

function pathFingerprint(path: string): string {
  let h = 5381
  for (let i = 0; i < path.length; i++) {
    h = ((h << 5) + h) ^ path.charCodeAt(i)
  }
  return (h >>> 0).toString(16)
}

export function toolResultContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((block) => {
      if (typeof block === 'string') return block
      if (block && typeof block === 'object') {
        const rec = block as Record<string, unknown>
        if (typeof rec.text === 'string') return rec.text
      }
      return ''
    }).filter(Boolean).join('\n')
  }
  if (content == null) return ''
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

/** 用户追问「把图发过来 / 展示图片」等。 */
export function userRequestsImageResend(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /(?:发|发送|展示|显示|看看).{0,12}(?:图|图片)|(?:图|图片).{0,12}(?:发|发送|展示|显示|看)/iu.test(t)
}

export class OutboundImageTracker {
  private sessionPaths = new Map<string, string[]>()

  notePaths(chatId: string, paths: string[]): void {
    if (!paths.length) return
    const list = this.sessionPaths.get(chatId) ?? []
    const seen = new Set(list.map((p) => p.replace(/\\/g, '/').toLowerCase()))
    for (const path of paths) {
      const key = path.replace(/\\/g, '/').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      list.push(path)
    }
    this.sessionPaths.set(chatId, list)
  }

  clear(chatId: string): void {
    this.sessionPaths.delete(chatId)
  }

  pendingFromSession(chatId: string): PendingUpload[] {
    return (this.sessionPaths.get(chatId) ?? []).map((path) => ({
      id: pathFingerprint(`path:${path}`),
      source: { kind: 'path' as const, path },
    }))
  }
}

export function feedOutboundImageText(
  chatId: string,
  text: string,
  watcher: ImageBlockWatcher,
  tracker: OutboundImageTracker,
  dispatch: (chatId: string, pending: PendingUpload) => void,
  opts?: { complete?: boolean },
): void {
  if (!text) return
  for (const pending of watcher.feed(text)) {
    if (pending.source.kind === 'path') continue
    dispatch(chatId, pending)
  }
  if (opts?.complete) {
    tracker.notePaths(chatId, extractLocalImagePaths(text))
    for (const pending of watcher.reconcile()) {
      if (pending.source.kind === 'path') tracker.notePaths(chatId, [pending.source.path])
      dispatch(chatId, pending)
    }
  }
}

export function flushOutboundImages(
  chatId: string,
  watcher: ImageBlockWatcher,
  tracker: OutboundImageTracker,
  dispatch: (chatId: string, pending: PendingUpload) => void,
): void {
  tracker.notePaths(chatId, extractLocalImagePaths(watcher.getStreamText()))
  for (const pending of watcher.reconcile()) {
    if (pending.source.kind === 'path') tracker.notePaths(chatId, [pending.source.path])
    dispatch(chatId, pending)
  }
  for (const pending of tracker.pendingFromSession(chatId)) {
    dispatch(chatId, pending)
  }
}
