const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i

export function normalizeLocalPath(raw: string): string {
  let path = raw.trim().replace(/^["'`(]+|["'`)]+$/g, '')

  if (path.startsWith('file:///')) {
    path = decodeURIComponent(path.slice(8))
  } else if (path.startsWith('file://')) {
    path = decodeURIComponent(path.slice(7))
  }

  return path
}

export function isAbsoluteLocalPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('~/') || path.startsWith('~\\')
}

export function isLocalImagePath(src: string): boolean {
  const path = normalizeLocalPath(src)
  if (!path || /^https?:\/\//i.test(path) || /^data:/i.test(path)) return false
  return IMAGE_EXT.test(path) && isAbsoluteLocalPath(path)
}

/** Extract absolute local image paths from markdown refs and inline text. */
export function extractLocalImagePaths(text: string): string[] {
  const paths: string[] = []
  const seen = new Set<string>()

  const add = (raw: string) => {
    const path = normalizeLocalPath(raw)
    if (!path || !isLocalImagePath(path)) return
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

  // Windows 盘符路径（单字母盘符，避免把 https:// 误识别为路径）
  const winPathRegex = /(?<![A-Za-z])([A-Za-z]:[/\\][^\s`"')<>\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico))/gi
  while ((match = winPathRegex.exec(text)) !== null) {
    add(match[1]!)
  }

  return paths
}
