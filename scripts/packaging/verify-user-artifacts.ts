/**
 * 校验用户分发产物未夹带 license-server（供应商凭据仅运维部署）。
 *
 * 用法:
 *   bun run scripts/packaging/verify-user-artifacts.ts
 *   bun run scripts/packaging/verify-user-artifacts.ts --sidecar path/to/claude-sidecar-...
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '../..')
const policy = JSON.parse(
  readFileSync(join(import.meta.dir, 'user-distribution-policy.json'), 'utf8'),
) as {
  forbiddenPathSegments: string[]
  forbiddenContentSubstrings: string[]
}

function parseArgs(): { sidecarPaths: string[]; scanDirs: string[] } {
  const sidecarPaths: string[] = []
  const scanDirs: string[] = []
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--sidecar' && argv[i + 1]) {
      sidecarPaths.push(resolve(argv[++i]!))
      continue
    }
    if (arg === '--dir' && argv[i + 1]) {
      scanDirs.push(resolve(argv[++i]!))
      continue
    }
  }
  return { sidecarPaths, scanDirs }
}

function defaultSidecarPaths(): string[] {
  const binariesDir = join(repoRoot, 'desktop', 'src-tauri', 'binaries')
  if (!existsSync(binariesDir)) return []
  return readdirSync(binariesDir)
    .filter(
      (name) =>
        name.startsWith('claude-sidecar') ||
        name.startsWith('zero-token-gateway') ||
        name.startsWith('zero-token-webauth-runner'),
    )
    .map((name) => join(binariesDir, name))
}

function scanFileContent(filePath: string, errors: string[]): void {
  let buf: Buffer
  try {
    const st = statSync(filePath)
    if (!st.isFile() || st.size > 120 * 1024 * 1024) return
    buf = readFileSync(filePath)
  } catch {
    return
  }

  const text = buf.toString('latin1')
  for (const needle of policy.forbiddenContentSubstrings) {
    if (text.includes(needle)) {
      errors.push(`禁止内容 "${needle}" 出现在文件: ${filePath}`)
    }
  }
}

function scanTree(dir: string, errors: string[]): void {
  if (!existsSync(dir)) return
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      continue
    }
    for (const name of entries) {
      const full = join(current, name)
      const rel = full.slice(repoRoot.length + 1).replace(/\\/g, '/')
      for (const seg of policy.forbiddenPathSegments) {
        if (rel.includes(seg.replace(/\\/g, '/'))) {
          errors.push(`禁止路径片段 "${seg}" 出现在: ${full}`)
        }
      }
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '.git') continue
        stack.push(full)
      } else if (st.isFile()) {
        scanFileContent(full, errors)
      }
    }
  }
}

export function verifyUserArtifacts(): void {
  const { sidecarPaths: argSidecars, scanDirs } = parseArgs()
  const sidecarPaths = argSidecars.length > 0 ? argSidecars : defaultSidecarPaths()
  const errors: string[] = []

  for (const sidecar of sidecarPaths) {
    if (!existsSync(sidecar)) {
      errors.push(`sidecar 不存在: ${sidecar}`)
      continue
    }
    scanFileContent(sidecar, errors)
  }

  const dirsToScan =
    scanDirs.length > 0
      ? scanDirs
      : [
          join(repoRoot, 'desktop', 'dist'),
          join(repoRoot, 'desktop', 'build-artifacts', 'zero-token-runtime'),
        ].filter((d) => existsSync(d))

  for (const dir of dirsToScan) {
    scanTree(dir, errors)
  }

  if (errors.length > 0) {
    throw new Error(
      '[packaging] 用户产物校验失败:\n' + errors.map((e) => `  - ${e}`).join('\n'),
    )
  }

  const checked = [
    ...sidecarPaths.map((p) => `sidecar:${p}`),
    ...dirsToScan.map((d) => `dir:${d}`),
  ]
  console.log(`[packaging] OK — 未检测到 license-server 夹带 (${checked.join(', ') || 'no inputs'})`)
}

if (import.meta.main) {
  try {
    verifyUserArtifacts()
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
