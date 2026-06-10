import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizeLocalPath } from './local-image-paths.js'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i

function pathCandidates(rawPath: string): string[] {
  const normalized = normalizeLocalPath(rawPath)
  const out = new Set<string>([
    normalized,
    normalized.replace(/\//g, '\\'),
    normalized.replace(/\\/g, '/'),
  ])
  return [...out]
}

async function newestMatchingFile(dir: string, suffix: string, minMtimeMs = 0): Promise<string | null> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return null
  }

  const matches = entries.filter((name) =>
    name.toLowerCase().endsWith(suffix) && IMAGE_EXT.test(name),
  )
  if (matches.length === 0) return null

  let newestPath: string | null = null
  let newestMtime = minMtimeMs
  for (const name of matches) {
    const candidate = path.join(dir, name)
    try {
      const stat = await fs.stat(candidate)
      const mtime = stat.mtimeMs
      if (mtime >= minMtimeMs && mtime >= newestMtime) {
        newestMtime = mtime
        newestPath = candidate
      }
    } catch {
      // skip unreadable entries
    }
  }
  return newestPath
}

/** Resolve a local image path to an existing file (handles slash variants + date suffix fallback). */
export async function resolveExistingImagePath(
  rawPath: string,
  opts?: { minMtimeMs?: number },
): Promise<string | null> {
  for (const candidate of pathCandidates(rawPath)) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // try next variant
    }
  }

  const normalized = normalizeLocalPath(rawPath)
  const dateMatch = normalized.match(/_(\d{8})\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i)
  const dirMatch = normalized.match(/^([A-Za-z]:[/\\].+?)[/\\][^/\\]+$/i)
  if (!dateMatch || !dirMatch) return null

  const dir = dirMatch[1]!
  const suffix = `_${dateMatch[1]}.${dateMatch[2]}`.toLowerCase()
  return newestMatchingFile(dir, suffix, opts?.minMtimeMs ?? 0)
}
