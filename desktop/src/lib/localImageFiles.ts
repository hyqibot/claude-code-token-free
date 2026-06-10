import { getBaseUrl } from '../api/client'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i

export function normalizeLocalPath(raw: string): string {
  let path = raw.trim().replace(/^["'`(]+|["'`)]+$/g, '')

  if (path.startsWith('file:///')) {
    path = decodeURIComponent(path.slice(8))
  } else if (path.startsWith('file://')) {
    path = decodeURIComponent(path.slice(7))
  }

  if (path.startsWith('~/')) {
    return path
  }

  return path
}

export function isAbsoluteLocalPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('~/') || path.startsWith('~\\')
}

export function isLocalImagePath(src: string): boolean {
  const path = normalizeLocalPath(src)
  if (!path || /^https?:\/\//i.test(path) || /^data:/i.test(path)) return false
  if (path.includes('/api/filesystem/file')) return false
  return IMAGE_EXT.test(path) && isAbsoluteLocalPath(path)
}

export function localFileImageUrl(filePath: string, sessionId?: string | null): string {
  const params = new URLSearchParams({ path: normalizeLocalPath(filePath) })
  if (sessionId) params.set('sessionId', sessionId)
  return `${getBaseUrl()}/api/filesystem/file?${params.toString()}`
}

export function pathBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.split('/').pop() || filePath
}

export function extractImagePaths(text: string): string[] {
  const paths: string[] = []
  const seen = new Set<string>()

  const add = (raw: string) => {
    const path = normalizeLocalPath(raw)
    if (!path || !IMAGE_EXT.test(path) || !isLocalImagePath(path)) return
    const key = path.replace(/\\/g, '/').toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    paths.push(path)
  }

  const markdownRegex = /!\[[^\]]*]\(([^)\s]+(?:\([^)]*\))?[^)\s]*)\)/gi
  let match: RegExpExecArray | null
  while ((match = markdownRegex.exec(text)) !== null) {
    add(match[1]!)
  }

  const inlineRegex = /(?:^|[\s`"'(])(\/?(?:[A-Za-z]:[\\/]|~\/|~\\|\/)[^\s`"')<>]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico))/gim
  while ((match = inlineRegex.exec(text)) !== null) {
    add(match[1]!)
  }

  return paths
}

export function rewriteLocalImageSrc(
  src: string | null | undefined,
  sessionId?: string | null,
): string | null | undefined {
  if (!src || !isLocalImagePath(src)) return src
  return localFileImageUrl(src, sessionId)
}
