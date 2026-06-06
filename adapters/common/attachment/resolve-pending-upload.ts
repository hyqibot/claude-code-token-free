import fs from 'node:fs/promises'
import type { PendingUpload } from './attachment-types.js'
import { resolveExistingImagePath } from './resolve-image-path.js'

function pathFingerprint(raw: string): string {
  let h = 5381
  for (let i = 0; i < raw.length; i++) {
    h = ((h << 5) + h) ^ raw.charCodeAt(i)
  }
  return (h >>> 0).toString(16)
}

/** 用解析后的真实路径做去重，避免乱码/正确路径各发一次。 */
export async function resolvePendingDedupeId(
  pending: PendingUpload,
  opts?: { minMtimeMs?: number },
): Promise<string> {
  if (pending.source.kind === 'path') {
    const resolved = await resolveExistingImagePath(pending.source.path, opts)
    if (resolved) return pathFingerprint(`path:${resolved}`)
  }
  return pending.id
}

const PATH_LOOKS_CORRUPT = /[\uFFFD]|�/

/** 日志用：优先显示磁盘上解析到的真实路径，避免流式 UTF-8 乱码。 */
export async function formatOutboundImageLogLabel(
  pending: PendingUpload,
  opts?: { minMtimeMs?: number },
): Promise<string> {
  if (pending.source.kind === 'path') {
    const resolved = await resolveExistingImagePath(pending.source.path, opts)
    if (resolved) return resolved
    const base = pending.source.path.split(/[/\\]/).pop() ?? pending.source.path
    if (PATH_LOOKS_CORRUPT.test(base)) {
      const suffix = base.match(/(_\d{8}\.[a-z0-9]+)$/i)?.[1]
      if (suffix) {
        const dir = pending.source.path.replace(/[/\\][^/\\]+$/, '')
        return `${dir}/*${suffix}`
      }
    }
    return pending.source.path
  }
  if (pending.source.kind === 'url') return pending.source.url
  return `(base64 ${pending.source.mime})`
}

export async function resolvePendingUploadBuffer(
  pending: PendingUpload,
  opts?: { minMtimeMs?: number },
): Promise<{ buffer: Buffer; mime: string; resolvedPath?: string }> {
  switch (pending.source.kind) {
    case 'base64': {
      return {
        buffer: Buffer.from(pending.source.data, 'base64'),
        mime: pending.source.mime,
      }
    }
    case 'path': {
      const resolved = await resolveExistingImagePath(pending.source.path, opts)
      if (!resolved) {
        throw new Error(`local image not found: ${pending.source.path}`)
      }
      const buffer = await fs.readFile(resolved)
      return {
        buffer,
        mime: pending.source.mime ?? inferMimeFromPath(resolved),
        resolvedPath: resolved,
      }
    }
    case 'url': {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30_000)
      try {
        const resp = await fetch(pending.source.url, { signal: controller.signal })
        if (!resp.ok) throw new Error(`fetch ${pending.source.url} -> ${resp.status}`)
        const buffer = Buffer.from(await resp.arrayBuffer())
        return {
          buffer,
          mime: pending.source.mime ?? resp.headers.get('content-type') ?? 'image/png',
        }
      } finally {
        clearTimeout(timer)
      }
    }
  }
}

function inferMimeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'bmp') return 'image/bmp'
  return 'image/png'
}
