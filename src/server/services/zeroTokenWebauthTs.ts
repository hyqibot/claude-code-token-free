import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { getZeroTokenWebauthTsDir } from './zeroTokenRepoRoot.js'
import { ensureZeroTokenGatewayNpmDeps } from './zeroTokenGatewayDeps.js'
import { ensureChromeDebug as tsEnsureChromeDebug } from '../../../vendor/copaw-zero-token/webauth-ts/ensure-chrome-debug.js'
import { runOnboard } from '../../../vendor/copaw-zero-token/webauth-ts/onboard.js'
import {
  nodeEnsureChromeDebug,
  nodeOnboard,
  shouldRunWebauthInNodeSubprocess,
} from './zeroTokenWebauthNodeRunner.js'
import {
  buildExeWebauthSpawnArgs,
  findWebauthRunnerExeSync,
  resolveWebauthDepsSpawnMode,
} from './zeroTokenWebauthSpawn.js'
import { resolvePackagedAppRoot } from './zeroTokenRepoRoot.js'

async function ensureWebauthDeps(): Promise<void> {
  await ensureZeroTokenGatewayNpmDeps(undefined, resolveWebauthDepsSpawnMode())
}

export async function tsEnsureChromeDebugWrapped(
  urls: string[],
  onLine?: (line: string) => void,
): Promise<{ output: string; result: unknown }> {
  onLine?.('正在检查 Zero-Token 依赖（playwright-core）…')
  await ensureWebauthDeps()
  onLine?.('Zero-Token 依赖就绪。')

  if (shouldRunWebauthInNodeSubprocess()) {
    const r = await nodeEnsureChromeDebug(urls, onLine)
    if (r.spawnMode === 'exe') {
      onLine?.('使用 webauth-runner.exe 执行 CDP…')
    } else {
      onLine?.('使用 Node 子进程执行 CDP（Bun 内 Playwright 连 CDP 会超时）…')
    }
    return { output: r.output, result: r.result }
  }

  const lines: string[] = []
  const progress = (msg: string) => {
    lines.push(msg)
    onLine?.(msg)
  }
  const result = await tsEnsureChromeDebug({ urls, progress })
  return { output: lines.join('\n'), result }
}

export async function tsOnboardWrapped(
  mode: string,
  onLine?: (line: string) => void,
): Promise<{ mode: string; output: string }> {
  await ensureWebauthDeps()

  if (shouldRunWebauthInNodeSubprocess()) {
    const r = await nodeOnboard(mode, onLine)
    if (r.spawnMode === 'exe') {
      onLine?.('使用 webauth-runner.exe 执行 onboard…')
    } else {
      onLine?.('使用 Node 子进程执行 onboard…')
    }
    return { mode: r.mode, output: r.output }
  }

  const { mode: normalized, output } = await runOnboard(mode, onLine ?? (() => {}))
  return { mode: normalized, output }
}

export function tsSpawnKeepalive(urls: string[]): number {
  const exe = findWebauthRunnerExeSync()
  if (exe) {
    const appRoot = resolvePackagedAppRoot(dirname(process.execPath))
    const child = Bun.spawn(
      buildExeWebauthSpawnArgs({
        exePath: exe,
        appRoot,
        cmd: 'keepalive',
        payloadJson: JSON.stringify({ urls }),
      }),
      {
        env: process.env,
        stdout: 'ignore',
        stderr: 'ignore',
        stdin: 'ignore',
      },
    )
    return child.pid
  }

  let entry: string
  try {
    entry = join(getZeroTokenWebauthTsDir(), 'keepalive-entry.mjs')
    if (!existsSync(entry)) {
      throw new Error('missing keepalive-entry.mjs')
    }
  } catch {
    throw new Error(
      '未找到 zero-token-webauth-runner 可执行文件，且开发目录缺少 keepalive-entry.mjs。请重新安装桌面应用或运行 build:sidecars。',
    )
  }

  const bunBin = process.execPath?.includes('bun') ? process.execPath : 'bun'
  const child = Bun.spawn([bunBin, entry], {
    env: {
      ...process.env,
      COPAW_KEEPALIVE_URLS_JSON: JSON.stringify(urls),
      COPAW_KEEPALIVE_INTERVAL_SEC: '20',
    },
    stdout: 'ignore',
    stderr: 'ignore',
    stdin: 'ignore',
  })
  return child.pid
}
