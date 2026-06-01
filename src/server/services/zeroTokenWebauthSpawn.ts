import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { access, constants as fsConstants } from 'fs/promises'
import { getCcHahaRepoRoot, getZeroTokenRuntimeDir, getZeroTokenWebauthTsDir, resolvePackagedAppRoot } from './zeroTokenRepoRoot.js'

export type ZeroTokenWebauthSpawnMode = 'exe' | 'node'

const ZERO_TOKEN_WEBAUTH_RUNNER_EXE_BASENAME = 'zero-token-webauth-runner'

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function detectTargetTriple(): string {
  const fromEnv =
    process.env.TAURI_ENV_TARGET_TRIPLE?.trim() ||
    process.env.CARGO_BUILD_TARGET?.trim()
  if (fromEnv) return fromEnv

  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  }
  return process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu'
}

function webauthRunnerExeCandidates(): string[] {
  const triple = detectTargetTriple()
  const ext = process.platform === 'win32' ? '.exe' : ''
  const names = [
    `${ZERO_TOKEN_WEBAUTH_RUNNER_EXE_BASENAME}-${triple}${ext}`,
    `${ZERO_TOKEN_WEBAUTH_RUNNER_EXE_BASENAME}${ext}`,
  ]

  const roots = new Set<string>()
  const pushRoot = (value?: string | null) => {
    const trimmed = value?.trim()
    if (trimmed) roots.add(trimmed)
  }

  pushRoot(process.env.CC_HAHA_ROOT)
  pushRoot(process.env.CLAUDE_APP_ROOT)
  pushRoot(dirname(process.execPath))

  try {
    const root = getCcHahaRepoRoot()
    pushRoot(root)
    pushRoot(join(root, 'desktop', 'src-tauri', 'binaries'))
  } catch {
    // dev without vendor marker
  }

  const paths: string[] = []
  for (const root of roots) {
    for (const name of names) {
      paths.push(join(root, name))
    }
    paths.push(join(root, 'binaries', `${ZERO_TOKEN_WEBAUTH_RUNNER_EXE_BASENAME}-${triple}${ext}`))
    paths.push(join(root, 'binaries', `${ZERO_TOKEN_WEBAUTH_RUNNER_EXE_BASENAME}${ext}`))
  }

  const explicit = process.env.CC_HAHA_WEBAUTH_RUNNER_EXE?.trim()
  if (explicit) paths.unshift(explicit)

  return [...new Set(paths)]
}

export function resolveWebauthSpawnMode(): ZeroTokenWebauthSpawnMode {
  const forced = process.env.CC_HAHA_WEBAUTH_SPAWN_MODE?.trim().toLowerCase()
  if (forced === 'node') return 'node'
  if (forced === 'exe') return 'exe'
  if (process.env.CC_HAHA_WEBAUTH_RUNNER_BUNDLE?.trim()) return 'node'
  return 'exe'
}

export async function resolveZeroTokenWebauthRunnerExecutable(): Promise<string | null> {
  for (const candidate of webauthRunnerExeCandidates()) {
    if (await pathExists(candidate)) return candidate
  }
  return null
}

export async function resolveWebauthNodeRunnerBundlePath(): Promise<string | null> {
  const preferred = process.env.CC_HAHA_WEBAUTH_RUNNER_BUNDLE?.trim()
  if (preferred && (await pathExists(preferred))) return preferred

  for (const name of ['webauth-runner.bundle.mjs', 'node-runner.bundle.mjs']) {
    const runtimeBundle = join(getZeroTokenRuntimeDir(), name)
    if (await pathExists(runtimeBundle)) return runtimeBundle
  }

  const devBundled = join(getZeroTokenWebauthTsDir(), 'node-runner.bundle.mjs')
  if (await pathExists(devBundled)) return devBundled
  return null
}

export function buildExeWebauthSpawnArgs(params: {
  exePath: string
  appRoot: string
  cmd: 'ensure' | 'onboard'
  payloadJson: string
}): string[] {
  return [
    params.exePath,
    '--app-root',
    params.appRoot,
    params.cmd,
    params.payloadJson,
  ]
}

export function buildNodeWebauthSpawnArgs(params: {
  nodeBin: string
  bundlePath: string
  cmd: 'ensure' | 'onboard'
  payloadJson: string
}): string[] {
  return [params.nodeBin, params.bundlePath, params.cmd, params.payloadJson]
}

export type WebauthSpawnPlan = {
  mode: ZeroTokenWebauthSpawnMode
  argv: string[]
  cwd: string
  appRoot: string
}

export async function resolveWebauthSpawnPlan(params: {
  cmd: 'ensure' | 'onboard'
  payload: Record<string, unknown>
  nodeBin?: string
}): Promise<WebauthSpawnPlan> {
  const forced = process.env.CC_HAHA_WEBAUTH_SPAWN_MODE?.trim().toLowerCase()
  const preferExe = resolveWebauthSpawnMode() === 'exe'
  const payloadJson = JSON.stringify(params.payload)
  const appRoot = resolvePackagedAppRoot(dirname(process.execPath))

  if (preferExe) {
    const exePath = await resolveZeroTokenWebauthRunnerExecutable()
    if (exePath) {
      return {
        mode: 'exe',
        argv: buildExeWebauthSpawnArgs({
          exePath,
          appRoot,
          cmd: params.cmd,
          payloadJson,
        }),
        cwd: dirname(exePath),
        appRoot,
      }
    }
    if (forced === 'exe') {
      throw new Error(
        '未找到 zero-token-webauth-runner 可执行文件。请先 bun run build:sidecars，或设置 CC_HAHA_WEBAUTH_RUNNER_EXE。',
      )
    }
  }

  const bundlePath = await resolveWebauthNodeRunnerBundlePath()
  if (!bundlePath) {
    throw new Error(
      '缺少 webauth Node bundle。设置 CC_HAHA_WEBAUTH_RUNNER_BUNDLE 或先构建 node-runner.bundle.mjs。',
    )
  }

  const nodeBin =
    params.nodeBin?.trim() ||
    process.env.CC_HAHA_WEBAUTH_NODE?.trim() ||
    (process.platform === 'win32' ? 'node.exe' : 'node')

  return {
    mode: 'node',
    argv: buildNodeWebauthSpawnArgs({
      nodeBin,
      bundlePath,
      cmd: params.cmd,
      payloadJson,
    }),
    cwd: dirname(bundlePath),
    appRoot,
  }
}

export function playwrightMarkerExistsForWebauth(): boolean {
  const runtime = join(getZeroTokenRuntimeDir(), 'node_modules', 'playwright-core')
  if (existsSync(runtime)) return true
  const besideExe = join(dirname(process.execPath), 'node_modules', 'playwright-core')
  if (existsSync(besideExe)) return true
  try {
    const dev = join(
      getCcHahaRepoRoot(),
      'vendor',
      'copaw-zero-token',
      'python',
      'src',
      'copaw',
      'zero_token_gateway',
      'node_modules',
      'playwright-core',
    )
    return existsSync(dev)
  } catch {
    return false
  }
}
