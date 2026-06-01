import { cp, mkdir, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveStagedPlaywrightNodeModules } from './sidecarRuntimePaths'

function playwrightReady(nodeModulesDir: string): boolean {
  return existsSync(join(nodeModulesDir, 'playwright-core', 'index.mjs'))
}

export { resolveStagedPlaywrightNodeModules } from './sidecarRuntimePaths'

async function placePlaywrightBesideExe(stagedSrc: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  if (existsSync(dest)) return

  try {
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    await symlink(stagedSrc, dest, linkType)
    return
  } catch {
    // junction/symlink 失败时回退复制（兼容无权限创建链接的环境）
  }

  await cp(stagedSrc, dest, { recursive: true, force: true })
}

/**
 * Bun compile 的外部包只认 exe 同级的 node_modules，不认 NODE_PATH / resources。
 * 优先 junction 到 zero-token-runtime，避免整包复制一份 playwright-core。
 */
export async function ensurePlaywrightBesideExe(appRoot: string): Promise<string> {
  const exeNm = join(dirname(process.execPath), 'node_modules')
  if (playwrightReady(exeNm)) return exeNm

  const stagedNm = resolveStagedPlaywrightNodeModules(appRoot)
  if (!stagedNm) {
    throw new Error(
      `[sidecar] missing playwright-core beside ${exeNm} and in zero-token-runtime (app-root=${appRoot})`,
    )
  }

  const src = join(stagedNm, 'playwright-core')
  const dest = join(exeNm, 'playwright-core')
  await mkdir(exeNm, { recursive: true })
  await placePlaywrightBesideExe(src, dest)
  return exeNm
}

export async function prepareSidecarRuntime(appRoot: string): Promise<void> {
  await ensurePlaywrightBesideExe(appRoot)
  try {
    process.chdir(dirname(process.execPath))
  } catch {
    // ignore
  }
}
