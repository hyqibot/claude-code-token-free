/**
 * Filesystem browser & search API — supports directory browsing and file search
 * for the DirectoryPicker component and @-triggered file search popup.
 */

import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { conversationService } from '../services/conversationService.js'
import { sessionService } from '../services/sessionService.js'
import { adapterService } from '../services/adapterService.js'

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
}

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const target = normalizeComparablePath(targetPath)
  const root = normalizeComparablePath(rootPath)
  return target === root || target.startsWith(`${root}${path.sep}`)
}

function normalizeComparablePath(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isAllowedInHomeOrTmp(resolvedPath: string): boolean {
  const homeDir = path.resolve(os.homedir())

  if (isWithinRoot(resolvedPath, homeDir) || isWithinRoot(resolvedPath, '/tmp')) {
    return true
  }

  // macOS reports /tmp as /private/tmp via native folder pickers and realpath().
  if (process.platform === 'darwin' && isWithinRoot(resolvedPath, '/private/tmp')) {
    return true
  }

  return false
}

const PERSISTED_WORKDIR_TTL_MS = 30_000
let persistedWorkDirCache: { roots: string[]; timestamp: number } | null = null
const sessionReferencedRootsCache = new Map<string, { roots: string[]; timestamp: number }>()
const SESSION_REFERENCED_ROOTS_TTL_MS = 10_000

const INLINE_ABS_PATH_RE =
  /(?:^|[\s`"'(>])(\/?(?:[A-Za-z]:[\\/]|~\/|~\\|\/)[^\s`"')<>]+)/gim

function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string') {
          return (block as { text: string }).text
        }
        return JSON.stringify(block)
      })
      .join('\n')
  }
  if (content && typeof content === 'object') return JSON.stringify(content)
  return ''
}

function normalizePathForCompare(filePath: string): string {
  return normalizeComparablePath(path.resolve(filePath.replace(/\//g, path.sep)))
}

function pathVariants(filePath: string): string[] {
  const resolved = path.resolve(filePath)
  const variants = new Set<string>([
    normalizePathForCompare(resolved),
    normalizePathForCompare(resolved.replace(/\//g, '\\')),
    normalizePathForCompare(resolved.replace(/\\/g, '/')),
  ])
  return Array.from(variants)
}

function addReferencedPathRoots(roots: Set<string>, rawPath: string): void {
  const cleaned = rawPath.trim().replace(/^["'`(]+|["'`)]+$/g, '')
  if (!cleaned || /^https?:\/\//i.test(cleaned)) return
  try {
    const resolved = path.resolve(cleaned)
    roots.add(path.dirname(resolved))
  } catch {
    // ignore malformed paths in transcript
  }
}

function collectAbsolutePathsFromText(text: string): string[] {
  const paths: string[] = []
  INLINE_ABS_PATH_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INLINE_ABS_PATH_RE.exec(text)) !== null) {
    paths.push(match[1]!)
  }
  return paths
}

async function collectPersistedWorkDirRoots(): Promise<string[]> {
  const now = Date.now()
  if (persistedWorkDirCache && now - persistedWorkDirCache.timestamp < PERSISTED_WORKDIR_TTL_MS) {
    return persistedWorkDirCache.roots
  }

  const roots = new Set<string>()
  try {
    const { sessions } = await sessionService.listSessions({ limit: 500 })
    for (const session of sessions) {
      if (session.workDir?.trim()) roots.add(path.resolve(session.workDir))
    }
  } catch {
    // best-effort
  }

  const list = Array.from(roots)
  persistedWorkDirCache = { roots: list, timestamp: now }
  return list
}

async function collectAdapterWorkDirRoots(): Promise<string[]> {
  const roots = new Set<string>()
  try {
    const config = await adapterService.getRawConfig()
    if (config.defaultProjectDir?.trim()) roots.add(path.resolve(config.defaultProjectDir))
    for (const key of ['telegram', 'feishu', 'wechat', 'dingtalk'] as const) {
      const workDir = config[key]?.defaultWorkDir
      if (typeof workDir === 'string' && workDir.trim()) {
        roots.add(path.resolve(workDir))
      }
    }
  } catch {
    // best-effort
  }
  return Array.from(roots)
}

async function collectSessionReferencedPathRoots(sessionId: string): Promise<string[]> {
  const now = Date.now()
  const cached = sessionReferencedRootsCache.get(sessionId)
  if (cached && now - cached.timestamp < SESSION_REFERENCED_ROOTS_TTL_MS) {
    return cached.roots
  }

  const roots = new Set<string>()
  try {
    const messages = await sessionService.getSessionMessages(sessionId)
    const blob = messages.map((message) => extractMessageText(message.content)).join('\n')
    for (const rawPath of collectAbsolutePathsFromText(blob)) {
      addReferencedPathRoots(roots, rawPath)
    }
  } catch {
    // session may not exist yet
  }

  const list = Array.from(roots)
  sessionReferencedRootsCache.set(sessionId, { roots: list, timestamp: now })
  return list
}

async function isPathReferencedInSession(sessionId: string, resolvedPath: string): Promise<boolean> {
  try {
    const messages = await sessionService.getSessionMessages(sessionId)
    const blob = messages.map((message) => extractMessageText(message.content)).join('\n').toLowerCase()
    const targetVariants = pathVariants(resolvedPath)
    for (const rawPath of collectAbsolutePathsFromText(blob)) {
      const cleaned = rawPath.trim().replace(/^["'`(]+|["'`)]+$/g, '')
      if (!cleaned) continue
      const candidateVariants = pathVariants(cleaned)
      if (candidateVariants.some((candidate) => targetVariants.includes(candidate))) {
        return true
      }
      if (blob.includes(cleaned.toLowerCase())) {
        const normalizedTarget = normalizePathForCompare(resolvedPath)
        const normalizedCandidate = normalizePathForCompare(cleaned)
        if (normalizedTarget === normalizedCandidate) return true
      }
    }
  } catch {
    return false
  }
  return false
}

async function collectSessionWorkDirRoots(sessionId?: string | null): Promise<string[]> {
  const roots = new Set<string>()

  const addRoot = (workDir: string | null | undefined) => {
    if (!workDir?.trim()) return
    roots.add(path.resolve(workDir))
  }

  if (sessionId) {
    addRoot(conversationService.getSessionWorkDir(sessionId))
    addRoot(await sessionService.getSessionWorkDir(sessionId))
  }

  for (const sid of conversationService.getActiveSessions()) {
    addRoot(conversationService.getSessionWorkDir(sid))
  }

  return Array.from(roots)
}

export async function isAllowedFilesystemPath(
  targetPath: string,
  sessionId?: string | null,
): Promise<boolean> {
  const resolvedPath = path.resolve(targetPath)
  if (isAllowedInHomeOrTmp(resolvedPath)) return true

  const roots = [
    ...(await collectSessionWorkDirRoots(sessionId)),
    ...(await collectPersistedWorkDirRoots()),
    ...(await collectAdapterWorkDirRoots()),
  ]
  if (sessionId) {
    roots.push(...await collectSessionReferencedPathRoots(sessionId))
  }

  for (const root of roots) {
    if (isWithinRoot(resolvedPath, root)) return true
  }

  if (sessionId && await isPathReferencedInSession(sessionId, resolvedPath)) {
    return true
  }

  return false
}

export async function handleFilesystemRoute(pathname: string, url: URL): Promise<Response> {
  if (pathname === '/api/filesystem/browse') {
    return handleBrowse(url)
  }

  if (pathname === '/api/filesystem/file') {
    return handleServeFile(url)
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
}

async function handleServeFile(url: URL): Promise<Response> {
  const filePath = url.searchParams.get('path')
  if (!filePath) {
    return json({ error: 'Missing path parameter' }, 400)
  }

  const resolvedPath = path.resolve(filePath)
  const sessionId = url.searchParams.get('sessionId')

  if (!(await isAllowedFilesystemPath(resolvedPath, sessionId))) {
    return json({ error: 'Access denied: path outside allowed directory' }, 403)
  }

  const ext = path.extname(resolvedPath).toLowerCase()
  const mimeType = IMAGE_MIME_TYPES[ext]

  if (!mimeType) {
    return json({ error: 'Unsupported file type' }, 400)
  }

  try {
    const stat = fs.statSync(resolvedPath)
    if (!stat.isFile()) {
      return json({ error: 'Not a file' }, 400)
    }
    // Limit to 50MB
    if (stat.size > 50 * 1024 * 1024) {
      return json({ error: 'File too large' }, 400)
    }

    const data = fs.readFileSync(resolvedPath)
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(stat.size),
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch {
    return json({ error: 'File not found' }, 404)
  }
}

async function handleBrowse(url: URL): Promise<Response> {
  const targetPath = url.searchParams.get('path') || os.homedir() || '/'
  const resolvedPath = path.resolve(targetPath)
  const sessionId = url.searchParams.get('sessionId')

  if (!(await isAllowedFilesystemPath(resolvedPath, sessionId))) {
    return json({ error: 'Access denied: path outside allowed directory' }, 403)
  }

  const searchQuery = url.searchParams.get('search') || ''
  const includeFiles = url.searchParams.get('includeFiles') === 'true'
  const maxResults = Math.min(parseInt(url.searchParams.get('maxResults') || '200', 10), 200)

  try {
    const stat = fs.statSync(resolvedPath)
    if (!stat.isDirectory()) {
      return json({ error: 'Not a directory', path: resolvedPath }, 400)
    }

    const entries = fs.readdirSync(resolvedPath, { withFileTypes: true })

    if (searchQuery) {
      // Search mode: filter by filename, include both dirs and files
      const query = searchQuery.toLowerCase()
      const results = entries
        .filter((e) => {
          if (e.name.startsWith('.')) return false
          if (e.isDirectory()) return e.name.toLowerCase().includes(query)
          if (!includeFiles) return false
          return e.name.toLowerCase().includes(query)
        })
        .slice(0, maxResults)
        .map((e) => ({
          name: e.name,
          path: path.join(resolvedPath, e.name),
          isDirectory: e.isDirectory(),
        }))
        .sort((a, b) => {
          // Directories first, then alphabetically
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })

      return json({
        currentPath: resolvedPath,
        parentPath: path.dirname(resolvedPath),
        entries: results,
        query: searchQuery,
      })
    }

    // Browse mode: show all directories (and optionally files)
    const filtered = entries.filter((e) => {
      if (e.name.startsWith('.')) return false
      if (e.isDirectory()) return true
      return includeFiles
    })

    const entries_list = filtered
      .map((e) => ({
        name: e.name,
        path: path.join(resolvedPath, e.name),
        isDirectory: e.isDirectory(),
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })

    return json({
      currentPath: resolvedPath,
      parentPath: path.dirname(resolvedPath),
      entries: entries_list,
    })
  } catch (err) {
    return json({ error: `Cannot read directory: ${err}`, path: resolvedPath }, 500)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
