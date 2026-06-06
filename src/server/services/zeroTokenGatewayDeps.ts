import { join } from 'path'
import { access, constants as fsConstants } from 'fs/promises'
import { ApiError } from '../middleware/errorHandler.js'
import {
  getZeroTokenGatewayDir,
  getZeroTokenGatewayResourcesDir,
} from './zeroTokenRepoRoot.js'
import type { ZeroTokenGatewaySpawnMode } from './zeroTokenGatewaySpawn.js'
import { playwrightMarkerExistsForGateway } from './zeroTokenGatewaySpawn.js'

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

let gatewayNpmInstallPromise: Promise<void> | null = null

/** 懒安装：gateway 目录的 playwright-core（webauth-ts 与网关 node 模式共用）。exe 模式只校验旁路目录。 */
export async function ensureZeroTokenGatewayNpmDeps(
  gatewayDir?: string,
  spawnMode: ZeroTokenGatewaySpawnMode = 'node',
): Promise<void> {
  if (spawnMode === 'exe') {
    if (await playwrightMarkerExistsForGateway()) return
    throw ApiError.internal(
      `Zero-Token 旁路缺少 playwright-core。请重新安装桌面应用或运行 build:sidecars 生成 resources。`,
    )
  }

  const dir = gatewayDir ?? getZeroTokenGatewayDir()
  const marker = join(dir, 'node_modules', 'playwright-core')
  if (await pathExists(marker)) return

  const staged = join(getZeroTokenGatewayResourcesDir(), 'node_modules', 'playwright-core')
  if (await pathExists(staged)) return

  if (process.env.CC_HAHA_ZERO_TOKEN_AUTO_NPM?.trim() === '0') {
    throw ApiError.internal(
      `Zero-Token 缺少 playwright-core（未找到 ${marker}）。请在该目录执行 npm install，或删除 CC_HAHA_ZERO_TOKEN_AUTO_NPM=0。`,
    )
  }

  if (!gatewayNpmInstallPromise) {
    gatewayNpmInstallPromise = (async () => {
      try {
        const proc = Bun.spawn(['npm', 'install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel', 'error'], {
          cwd: dir,
          stdout: 'pipe',
          stderr: 'pipe',
          env: process.env,
        })
        const stderrText = proc.stderr ? await new Response(proc.stderr).text() : ''
        const stdoutText = proc.stdout ? await new Response(proc.stdout).text() : ''
        const exitCode = (await proc.exited) ?? 1
        if (exitCode !== 0) {
          throw ApiError.internal(
            `Zero-Token 自动 npm install 失败（exit ${exitCode}）。可手动：npm install --prefix "${dir}"\n${stderrText}\n${stdoutText}`,
          )
        }
        if (!(await pathExists(marker))) {
          throw ApiError.internal(`npm install 完成但未找到 playwright-core：${marker}`)
        }
      } catch (err) {
        gatewayNpmInstallPromise = null
        throw err
      }
      gatewayNpmInstallPromise = null
    })()
  }

  await gatewayNpmInstallPromise
}
