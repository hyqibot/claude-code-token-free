import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'node:url'

const VENDOR_ZT_CLI_SEGMENTS = ['vendor', 'copaw-zero-token', 'python', 'copaw_zt_cli.py'] as const
const VENDOR_WEBAUTH_TS_SEGMENTS = ['vendor', 'copaw-zero-token', 'webauth-ts', 'onboard.ts'] as const

let cachedRepoRoot: string | null = null

export function ccHahaVendorMarkerPath(root: string): string {
  return join(root, ...VENDOR_ZT_CLI_SEGMENTS)
}

export function hasCcHahaVendorTree(root: string): boolean {
  if (existsSync(ccHahaVendorMarkerPath(root))) return true
  return existsSync(join(root, ...VENDOR_WEBAUTH_TS_SEGMENTS))
}

/** 从桌面安装目录或 Tauri resources 向上查找含 vendor/copaw-zero-token 的根。 */
export function resolveCcHahaRepoRootFromAppRoot(appRoot: string): string | null {
  const start = appRoot.trim()
  if (!start) return null

  let dir = start
  for (let i = 0; i < 12; i++) {
    if (hasCcHahaVendorTree(dir)) return dir
    const resourcesRoot = join(dir, 'resources')
    if (hasCcHahaVendorTree(resourcesRoot)) return resourcesRoot
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** sidecar 启动时根据 --app-root 自动注入 CC_HAHA_ROOT（编译二进制无法靠 import.meta.url 定位 vendor）。 */
export function applyCcHahaRootEnv(appRoot?: string): void {
  if (process.env.CC_HAHA_ROOT?.trim()) return

  const candidates = [appRoot?.trim(), process.env.CLAUDE_APP_ROOT?.trim()].filter(
    Boolean,
  ) as string[]

  for (const candidate of candidates) {
    const resolved = resolveCcHahaRepoRootFromAppRoot(candidate)
    if (resolved) {
      process.env.CC_HAHA_ROOT = resolved
      return
    }
  }
}

export function resolvePackagedAppRoot(fallbackExecDir?: string): string {
  return (
    process.env.CC_HAHA_ROOT?.trim() ||
    process.env.CLAUDE_APP_ROOT?.trim() ||
    fallbackExecDir?.trim() ||
    dirname(process.execPath)
  )
}

function findCcHahaRepoRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 16; i++) {
    if (hasCcHahaVendorTree(dir)) return dir
    const resourcesRoot = join(dir, 'resources')
    if (hasCcHahaVendorTree(resourcesRoot)) return resourcesRoot
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    '未找到 cc-haha 仓库根目录下的 vendor/copaw-zero-token。可设置环境变量 CC_HAHA_ROOT 指向仓库根路径。',
  )
}

function envCandidateRoots(): string[] {
  const out: string[] = []
  const push = (value?: string | null) => {
    const trimmed = value?.trim()
    if (!trimmed || out.includes(trimmed)) return
    out.push(trimmed)
  }

  push(process.env.CC_HAHA_ROOT)
  push(process.env.CLAUDE_APP_ROOT)

  const appRoot = process.env.CLAUDE_APP_ROOT?.trim()
  if (appRoot) {
    let dir = appRoot
    for (let i = 0; i < 12; i++) {
      push(dir)
      push(join(dir, 'resources'))
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }

  return out
}

export function getCcHahaRepoRoot(): string {
  if (cachedRepoRoot) return cachedRepoRoot

  for (const root of envCandidateRoots()) {
    if (hasCcHahaVendorTree(root)) {
      cachedRepoRoot = root
      return cachedRepoRoot
    }
  }

  const here = dirname(fileURLToPath(import.meta.url))
  cachedRepoRoot = findCcHahaRepoRoot(here)
  return cachedRepoRoot
}

export function getZeroTokenGatewayDir(): string {
  return join(
    getCcHahaRepoRoot(),
    'vendor',
    'copaw-zero-token',
    'python',
    'src',
    'copaw',
    'zero_token_gateway',
  )
}

export function getZeroTokenWebauthTsDir(): string {
  return join(getCcHahaRepoRoot(), 'vendor', 'copaw-zero-token', 'webauth-ts')
}

/** 桌面安装包旁路：resources/zero-token-runtime（仅 minified bundle + playwright，无 TS 源码） */
export function getZeroTokenRuntimeDir(): string {
  const roots = envCandidateRoots()
  for (const root of roots) {
    for (const rel of [
      join('zero-token-runtime'),
      join('resources', 'zero-token-runtime'),
      join('vendor', 'zero-token-gateway'),
      join('resources', 'vendor', 'zero-token-gateway'),
    ]) {
      const staged = join(root, rel)
      if (existsSync(join(staged, 'node_modules', 'playwright-core'))) return staged
    }
  }

  const appRoot = process.env.CLAUDE_APP_ROOT?.trim() || process.env.CC_HAHA_ROOT?.trim()
  if (appRoot) {
    return join(appRoot, 'zero-token-runtime')
  }

  try {
    return join(getCcHahaRepoRoot(), 'desktop', 'build-artifacts', 'zero-token-runtime')
  } catch {
    throw new Error(
      '未找到 zero-token-runtime。请确认桌面安装包完整（含 zero-token-runtime），或设置 CLAUDE_APP_ROOT。',
    )
  }
}

/** @deprecated 使用 getZeroTokenRuntimeDir */
export function getZeroTokenGatewayResourcesDir(): string {
  return getZeroTokenRuntimeDir()
}
