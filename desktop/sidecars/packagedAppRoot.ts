import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const VENDOR_ZT_CLI_SEGMENTS = ['vendor', 'copaw-zero-token', 'python', 'copaw_zt_cli.py'] as const

export function hasCcHahaVendorTree(root: string): boolean {
  return existsSync(join(root, ...VENDOR_ZT_CLI_SEGMENTS))
}

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

/** sidecar 启动时根据 --app-root 注入 CC_HAHA_ROOT（安装包无 vendor 时可不设）。 */
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
