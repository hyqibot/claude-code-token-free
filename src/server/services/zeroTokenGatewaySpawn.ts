import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { pathToFileURL } from 'node:url'
import { access, constants as fsConstants } from 'fs/promises'
import {
  getCcHahaRepoRoot,
  getZeroTokenGatewayDir,
  getZeroTokenRuntimeDir,
  resolvePackagedAppRoot,
} from './zeroTokenRepoRoot.js'

export type ZeroTokenGatewaySpawnMode = 'exe' | 'node'

const ZERO_TOKEN_GATEWAY_EXE_BASENAME = 'zero-token-gateway'

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

function gatewayExeCandidates(): string[] {
  const triple = detectTargetTriple()
  const ext = process.platform === 'win32' ? '.exe' : ''
  const names = [
    `${ZERO_TOKEN_GATEWAY_EXE_BASENAME}-${triple}${ext}`,
    `${ZERO_TOKEN_GATEWAY_EXE_BASENAME}${ext}`,
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
    paths.push(join(root, 'binaries', `${ZERO_TOKEN_GATEWAY_EXE_BASENAME}-${triple}${ext}`))
    paths.push(join(root, 'binaries', `${ZERO_TOKEN_GATEWAY_EXE_BASENAME}${ext}`))
  }

  const explicit = process.env.CC_HAHA_ZERO_TOKEN_GATEWAY_EXE?.trim()
  if (explicit) paths.unshift(explicit)

  return [...new Set(paths)]
}

export function resolveGatewaySpawnMode(): ZeroTokenGatewaySpawnMode {
  const forced = process.env.CC_HAHA_ZERO_TOKEN_SPAWN_MODE?.trim().toLowerCase()
  if (forced === 'node') return 'node'
  if (forced === 'exe') return 'exe'
  if (process.env.COPAW_ZERO_TOKEN_GATEWAY_ENTRY?.trim()) return 'node'
  return 'exe'
}

export async function resolveZeroTokenGatewayExecutable(): Promise<string | null> {
  for (const candidate of gatewayExeCandidates()) {
    if (await pathExists(candidate)) return candidate
  }
  return null
}

export async function resolveGatewayEntryPath(): Promise<string | null> {
  const preferred = process.env.COPAW_ZERO_TOKEN_GATEWAY_ENTRY?.trim()
  if (preferred && (await pathExists(preferred))) return preferred

  const bundled = join(getZeroTokenGatewayDir(), 'server.mjs')
  if (await pathExists(bundled)) return bundled
  return null
}

export function buildGatewaySpawnInsecureTlsEnv(
  isInsecureTls: boolean,
): Record<string, string> {
  return isInsecureTls
    ? { NODE_TLS_REJECT_UNAUTHORIZED: '0', COPAW_INSECURE_TLS: '1' }
    : {}
}

/** node 模式：`node [--import shim] server.mjs` */
export function buildNodeGatewaySpawnArgs(params: {
  nodeBin: string
  entryPath: string
  isInsecureTls: boolean
  shimPath: string
  shimExists: boolean
}): string[] {
  const args = [params.nodeBin]
  if (params.isInsecureTls && params.shimExists) {
    args.push('--import', pathToFileURL(params.shimPath).href)
  }
  args.push(params.entryPath)
  return args
}

/** exe 模式：`zero-token-gateway.exe --app-root <root>` */
export function buildExeGatewaySpawnArgs(params: {
  exePath: string
  appRoot: string
  host: string
  port: number
}): string[] {
  return [
    params.exePath,
    '--app-root',
    params.appRoot,
    '--host',
    params.host,
    '--port',
    String(params.port),
  ]
}

export type GatewaySpawnPlan = {
  mode: ZeroTokenGatewaySpawnMode
  args: string[]
  cwd: string
  gatewayDir: string
  appRoot: string
}

export async function resolveGatewaySpawnPlan(params: {
  host: string
  port: number
  isInsecureTls: boolean
  shimPath: string
  shimExists: boolean
  nodeBin?: string
}): Promise<GatewaySpawnPlan> {
  const forced = process.env.CC_HAHA_ZERO_TOKEN_SPAWN_MODE?.trim().toLowerCase()
  const preferExe = resolveGatewaySpawnMode() === 'exe'
  const appRoot = resolvePackagedAppRoot()

  if (preferExe) {
    const exePath = await resolveZeroTokenGatewayExecutable()
    if (exePath) {
      return {
        mode: 'exe',
        args: buildExeGatewaySpawnArgs({
          exePath,
          appRoot,
          host: params.host,
          port: params.port,
        }),
        cwd: dirname(exePath),
        gatewayDir: getZeroTokenRuntimeDir(),
        appRoot,
      }
    }
    if (forced === 'exe') {
      throw new Error(
        '未找到 zero-token-gateway 可执行文件。请先 bun run build:sidecars，或设置 CC_HAHA_ZERO_TOKEN_GATEWAY_EXE。',
      )
    }
  }

  const entryPath = await resolveGatewayEntryPath()
  if (!entryPath) {
    throw new Error(
      'Zero-Token gateway entry not found. Set COPAW_ZERO_TOKEN_GATEWAY_ENTRY to server.mjs path.',
    )
  }

  const gatewayDir = dirname(entryPath)
  const nodeBin = params.nodeBin?.trim() || process.env.COPAW_ZERO_TOKEN_NODE?.trim() || 'node'

  return {
    mode: 'node',
    args: buildNodeGatewaySpawnArgs({
      nodeBin,
      entryPath,
      isInsecureTls: params.isInsecureTls,
      shimPath: params.shimPath,
      shimExists: params.shimExists,
    }),
    cwd: gatewayDir,
    gatewayDir,
    appRoot,
  }
}

export function isPackagedGatewayExeMode(): boolean {
  return resolveGatewaySpawnMode() === 'exe'
}

export async function playwrightMarkerExistsForGateway(): Promise<boolean> {
  const besideExe = join(dirname(process.execPath), 'node_modules', 'playwright-core')
  if (existsSync(besideExe)) return true

  try {
    const staged = join(getZeroTokenRuntimeDir(), 'node_modules', 'playwright-core')
    if (existsSync(staged)) return true
  } catch {
    // packaged sidecar without vendor tree
  }

  try {
    const dev = join(getZeroTokenGatewayDir(), 'node_modules', 'playwright-core')
    return existsSync(dev)
  } catch {
    return false
  }
}

/** @deprecated 兼容旧测试 — 等价于 buildNodeGatewaySpawnArgs */
export function buildGatewaySpawnArgs(params: {
  nodeBin: string
  entryPath: string
  isInsecureTls: boolean
  shimPath: string
  shimExists: boolean
}): string[] {
  return buildNodeGatewaySpawnArgs(params)
}
