import { ApiError } from '../middleware/errorHandler.js'
import {
  ensureUrlsForCanonicalModelId,
  getZeroTokenWebModels,
  onboardModeForCanonicalModelId,
} from '../config/zeroTokenWebModels.js'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { access, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { createConnection } from 'net'
import { fileURLToPath } from 'node:url'
import { SettingsService } from './settingsService.js'
import { mergeNoProxyEnvVars } from '../utils/loopbackFetchEnv.js'
import { getCcHahaRepoRoot, getZeroTokenGatewayDir } from './zeroTokenRepoRoot.js'
import { ensureZeroTokenGatewayNpmDeps } from './zeroTokenGatewayDeps.js'
import {
  buildGatewaySpawnInsecureTlsEnv,
  resolveGatewaySpawnPlan,
} from './zeroTokenGatewaySpawn.js'
import {
  webauthEnsureChromeDebug,
  webauthOnboard,
  webauthSpawnKeepalive,
} from './zeroTokenWebauthRouter.js'
import {
  assertGatewayLicenseForGateway,
  getGatewayLicenseSpawnEnv,
  registerGatewayLicenseInvalidatedHandler,
} from './gatewayLicense/gatewayLicenseService.js'
export { resolvePythonExe } from './zeroTokenWebauthPython.js'
export { readWebauthBackend } from './zeroTokenWebauthBackend.js'

/**
 * Node 内置 fetch (undici) 不读 NODE_TLS_REJECT_UNAUTHORIZED，必须 setGlobalDispatcher。
 * cc-haha spawn gateway 时若用户启用 insecureTls，就通过 `--import` 注入这段 shim，
 * 让 gateway 全部 fetch 走 `rejectUnauthorized: false` 的 dispatcher。
 */
const ZERO_TOKEN_TLS_SHIM_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'zeroTokenGatewayTlsShim.mjs',
)

export type ZeroTokenGatewayStatus = {
  listening: boolean
  pid: number | null
  host: string | null
  port: number | null
  raw: string
}

/** DeepSeek 工具链：dsml（默认，StreamSieve + DSML prompt）| xml（Doubao 式 <tool_call>）。 */
export type DeepseekToolMode = 'dsml' | 'xml'

const DEFAULT_DEEPSEEK_TOOL_MODE: DeepseekToolMode = 'xml'

const STATUS_REGEX = /listening=(true|false)\s+pid=(-?\d+)\s+([0-9a-zA-Z\.\-]+):(\d+)/
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 3002
const START_WAIT_MS = 30_000
const START_POLL_INTERVAL_MS = 200

const SUPPORTED_ONBOARD_MODES = [
  'webauth',
  'doubao',
  'claude',
  'qwen',
  'qwen-cn',
  'kimi',
  'chatgpt',
  'gemini',
  'glm',
  'glm-intl',
  'chrome-debug',
] as const

type ZeroTokenMode = (typeof SUPPORTED_ONBOARD_MODES)[number]

/**
 * 与 `vendor/copaw-zero-token/.../zero_token_gateway/config.mjs` 一致：
 * `COPAW_ZERO_TOKEN_*` 优先，其次 `ICLAW_ZERO_TOKEN_*`（上游别名）。
 * 仅设置 ICLAW 而 cc-haha 只读 COPAW 时，CLI 仍会连默认 3002，网关却在其它端口 → 「Unable to connect」。
 */
function pickZeroTokenEnv(primary: string, fallback: string): string | undefined {
  const a = process.env[primary]?.trim()
  if (a) return a
  const b = process.env[fallback]?.trim()
  return b || undefined
}

function getGatewayHost(): string {
  return pickZeroTokenEnv('COPAW_ZERO_TOKEN_HOST', 'ICLAW_ZERO_TOKEN_HOST') || DEFAULT_HOST
}

function getGatewayPort(): number {
  const raw = pickZeroTokenEnv('COPAW_ZERO_TOKEN_PORT', 'ICLAW_ZERO_TOKEN_PORT')
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return DEFAULT_PORT
}

/** 与 Node 网关监听地址一致；Zero-Token 预设下行 CLI 应使用此 URL，避免 providers.json 里陈旧 baseUrl 与端口漂移。 */
export function getZeroTokenGatewayHttpBase(): string {
  const base = `http://${getGatewayHost()}:${getGatewayPort()}`
  return base.replace(/\/+$/, '')
}

function getPidFilePath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(configDir, 'cc-haha', 'zero-token-gateway.pid')
}

function getCcHahaSettingsPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(configDir, 'cc-haha', 'settings.json')
}

export function readDeepseekToolMode(): DeepseekToolMode {
  try {
    const raw = readFileSync(getCcHahaSettingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as { deepseekToolMode?: unknown }
    return parsed.deepseekToolMode === 'dsml' ? 'dsml' : 'xml'
  } catch {
    return DEFAULT_DEEPSEEK_TOOL_MODE
  }
}

export async function setDeepseekToolMode(mode: DeepseekToolMode): Promise<void> {
  const path = getCcHahaSettingsPath()
  await mkdir(dirname(path), { recursive: true })
  let current: Record<string, unknown> = {}
  try {
    current = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    // fresh file
  }
  const next = { ...current, deepseekToolMode: mode }
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

function getKeepalivePidFilePath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(configDir, 'cc-haha', 'zero-token-keepalive.pid')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function readPidFromFile(): Promise<number | null> {
  try {
    const raw = (await readFile(getPidFilePath(), 'utf8')).trim()
    const pid = Number.parseInt(raw, 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

async function writePidFile(pid: number): Promise<void> {
  const file = getPidFilePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${pid}\n`, 'utf8')
}

async function removePidFile(): Promise<void> {
  await rm(getPidFilePath(), { force: true }).catch(() => undefined)
}

async function isPortListening(host: string, port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host, port })
    let settled = false
    const done = (value: boolean) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        // ignore socket destroy failure
      }
      resolve(value)
    }
    socket.setTimeout(500)
    socket.on('connect', () => done(true))
    socket.on('timeout', () => done(false))
    socket.on('error', () => done(false))
  })
}

/** TCP 已开但 HTTP 未就绪时 CLI 会报 Unable to connect；等 /health 200 再返回。 */
async function isGatewayHttpReady(host: string, port: number): Promise<boolean> {
  if (!(await isPortListening(host, port))) return false
  try {
    const res = await fetch(`http://${host}:${port}/health`, {
      signal: AbortSignal.timeout(2500),
    })
    return res.ok
  } catch {
    return false
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export function parseZeroTokenStatus(output: string): ZeroTokenGatewayStatus {
  const match = output.match(STATUS_REGEX)
  if (!match) {
    return {
      listening: false,
      pid: null,
      host: null,
      port: null,
      raw: output.trim(),
    }
  }

  const listening = match[1] === 'true'
  const pidNum = Number.parseInt(match[2], 10)
  const portNum = Number.parseInt(match[4], 10)

  return {
    listening,
    pid: Number.isFinite(pidNum) && pidNum > 0 ? pidNum : null,
    host: match[3] || null,
    port: Number.isFinite(portNum) ? portNum : null,
    raw: output.trim(),
  }
}

function isCdpConnectTimeout(output: string): boolean {
  const s = (output || '').toLowerCase()
  return (
    s.includes('connect_over_cdp') &&
    (s.includes('timeout') || s.includes('timeouterror') || s.includes('exceeded'))
  )
}

function withCopawAlignedHint(rawMessage: string, mode: string): string {
  const base = (rawMessage || '').trim()
  const normalized = (mode || '').trim().toLowerCase()

  if (normalized !== 'chrome-debug' && isCdpConnectTimeout(base)) {
    return [
      base,
      '',
      '提示：该错误通常表示 9222 上的 Chrome CDP 与当前 Playwright 不兼容，或调试实例尚未就绪（已与 ws 建立连接但仍握手超时）。',
      '请关闭占用 9222 的旧浏览器进程后重试；或在终端执行 `copaw zero-token onboard chrome-debug` 单独拉起调试实例，再点一键授权。',
      '若混用多套 Chrome/Chromium，请保证 `ensure_chrome_debug` 拉起的与 Playwright 内置 Chromium 版本匹配（参见 CoPaw 文档）。',
      '握手仍超时可在启动 cc-haha 的终端加大 `COPAW_CDP_CONNECT_TIMEOUT_MS`（或 `COPAW_ZERO_TOKEN_CDP_CONNECT_MS`，上限 180000）。',
    ].join('\n')
  }

  return base
}

function isCopawZeroTokenOnboardSuccess(exitCode: number, output: string): boolean {
  if (exitCode === 0) return true
  const o = (output || '').trim()
  if (!o) return false
  if (o.toLowerCase().includes('traceback')) return false
  if (exitCode !== 1) return false
  return o.includes('授权完成') || o.includes('已启动浏览器调试模式')
}

async function readKeepalivePid(): Promise<number | null> {
  try {
    const raw = (await readFile(getKeepalivePidFilePath(), 'utf8')).trim()
    const pid = Number.parseInt(raw, 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

async function writeKeepalivePid(pid: number): Promise<void> {
  const file = getKeepalivePidFilePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${pid}\n`, 'utf8')
}

async function removeKeepalivePidFile(): Promise<void> {
  await rm(getKeepalivePidFilePath(), { force: true }).catch(() => undefined)
}

async function killPreviousKeepalive(): Promise<void> {
  const pid = await readKeepalivePid()
  if (!pid) return
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // ignore
  }
  await removeKeepalivePidFile()
}

async function resolveGatewayEntryPath(): Promise<string | null> {
  const { resolveGatewayEntryPath: resolveEntry } = await import('./zeroTokenGatewaySpawn.js')
  return resolveEntry()
}

/**
 * 当用户启用 insecureTls 时，spawn gateway 子进程要附带的 env：
 * - `NODE_TLS_REJECT_UNAUTHORIZED=0`：让 `https.request` / 旧 `http(s).Agent` 路径跳校验
 * - `COPAW_INSECURE_TLS=1`：让 TLS shim 在 `--import` 时识别开关
 *
 * 注意：Node 内置 fetch (undici) 不读上述任一 env，必须配合 spawn args 里的 --import shim
 * 才能让 fetch 跳校验。这里只负责 env，args 由 buildGatewaySpawnArgs 单独决定。
 */
/** 本机配置了常见代理环境变量时，网关访问上游网页 API 常因 MITM 自签 CA 触发证书错误。 */
function shouldUseInsecureTlsForGateway(): boolean {
  if (new SettingsService().isInsecureTlsEnabled()) return true
  const keys = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'] as const
  return keys.some((k) => {
    const v = process.env[k]?.trim()
    return Boolean(v)
  })
}

export { buildGatewaySpawnInsecureTlsEnv, buildGatewaySpawnArgs } from './zeroTokenGatewaySpawn.js'

/** 并发 `start()` 时只跑一条 spawn，避免双进程抢 3002。 */
let zeroTokenGatewayStartPromise: Promise<ZeroTokenGatewayStatus> | null = null

async function startGatewayDirect(port?: number): Promise<ZeroTokenGatewayStatus> {
  await assertGatewayLicenseForGateway()

  const host = getGatewayHost()
  const finalPort = typeof port === 'number' && Number.isFinite(port) ? Math.trunc(port) : getGatewayPort()
  if (await isGatewayHttpReady(host, finalPort)) {
    const pid = await readPidFromFile()
    return {
      listening: true,
      pid,
      host,
      port: finalPort,
      raw: `direct: already listening pid=${pid ?? 'unknown'} ${host}:${finalPort}`,
    }
  }

  if (zeroTokenGatewayStartPromise) {
    return zeroTokenGatewayStartPromise
  }

  zeroTokenGatewayStartPromise = startGatewayDirectBody(host, finalPort).finally(() => {
    zeroTokenGatewayStartPromise = null
  })
  return zeroTokenGatewayStartPromise
}

async function startGatewayDirectBody(
  host: string,
  finalPort: number,
): Promise<ZeroTokenGatewayStatus> {
  if (await isGatewayHttpReady(host, finalPort)) {
    const pid = await readPidFromFile()
    return {
      listening: true,
      pid,
      host,
      port: finalPort,
      raw: `direct: already listening (serialized) pid=${pid ?? 'unknown'} ${host}:${finalPort}`,
    }
  }

  const isInsecureTls = shouldUseInsecureTlsForGateway()
  const insecureTlsEnv = buildGatewaySpawnInsecureTlsEnv(isInsecureTls)

  const spawnPlan = await resolveGatewaySpawnPlan({
    host,
    port: finalPort,
    isInsecureTls,
    shimPath: ZERO_TOKEN_TLS_SHIM_PATH,
    shimExists: existsSync(ZERO_TOKEN_TLS_SHIM_PATH),
  })

  await ensureZeroTokenGatewayNpmDeps(spawnPlan.gatewayDir, spawnPlan.mode)

  const spawnArgs = spawnPlan.args
  const gatewayDir = spawnPlan.cwd
  const spawnHint = `${spawnPlan.mode}: ${spawnArgs.join(' ')}`
  let stderrTail = ''

  console.log(
    `[ZeroTokenService] spawn gateway (${spawnPlan.mode}): ${spawnArgs.join(' ')} ` +
      `(NODE_TLS_REJECT_UNAUTHORIZED=${insecureTlsEnv.NODE_TLS_REJECT_UNAUTHORIZED ?? '(unset)'}, ` +
      `COPAW_INSECURE_TLS=${insecureTlsEnv.COPAW_INSECURE_TLS ?? '(unset)'})`,
  )

  const child = Bun.spawn(spawnArgs, {
    cwd: gatewayDir,
    env: {
      ...process.env,
      COPAW_ZERO_TOKEN_HOST: host,
      COPAW_ZERO_TOKEN_PORT: String(finalPort),
      ICLAW_ZERO_TOKEN_HOST: host,
      ICLAW_ZERO_TOKEN_PORT: String(finalPort),
      ...(process.env.COPAW_ZT_STREAM_DBG === '1' ? { COPAW_ZERO_TOKEN_STREAM_DEBUG: '1' } : {}),
      COPAW_ZT_DEEPSEEK_TOOL_MODE: readDeepseekToolMode(),
      ...insecureTlsEnv,
      ...(() => {
        const e = {} as Record<string, string>
        mergeNoProxyEnvVars(e)
        return e
      })(),
      ...getGatewayLicenseSpawnEnv(),
    },
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  })

  /**
   * 把 gateway 的 stderr 实时按行带前缀转发到 server stderr，便于排查 gateway 内部
   * console.warn / TLS / fetch 错误（之前 stderr 只在启动失败时输出，成功后被丢弃）。
   * 同时仍保留最近 12KB 的 tail 用作启动失败时的错误附加。
   */
  let stderrLineBuf = ''
  if (child.stderr) {
    void (async () => {
      const reader = child.stderr.getReader()
      const dec = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = dec.decode(value, { stream: true })
          stderrTail += chunk
          if (stderrTail.length > 12_000) stderrTail = stderrTail.slice(-12_000)
          stderrLineBuf += chunk
          let idx: number
          while ((idx = stderrLineBuf.indexOf('\n')) >= 0) {
            const line = stderrLineBuf.slice(0, idx).replace(/\r$/, '')
            stderrLineBuf = stderrLineBuf.slice(idx + 1)
            if (line.length > 0) {
              try {
                process.stderr.write(`[zero-token-gateway] ${line}\n`)
              } catch {
                // ignore forward errors
              }
            }
          }
        }
      } catch {
        // ignore drain errors
      }
    })()
  }

  const exitBox = { code: null as number | null, settled: false }
  void child.exited
    .then((c) => {
      exitBox.code = c ?? 0
      exitBox.settled = true
    })
    .catch(() => {
      exitBox.code = -1
      exitBox.settled = true
    })

  await writePidFile(child.pid)
  const deadline = Date.now() + START_WAIT_MS
  while (Date.now() < deadline) {
    if (await isGatewayHttpReady(host, finalPort)) {
      return {
        listening: true,
        pid: child.pid,
        host,
        port: finalPort,
        raw: `direct: started pid=${child.pid} ${host}:${finalPort}`,
      }
    }
    if (exitBox.settled && !(await isGatewayHttpReady(host, finalPort))) {
      await sleep(120)
      const errTail = stderrTail.trim().slice(-2500)
      await removePidFile().catch(() => undefined)
      throw ApiError.internal(
        `Zero-Token gateway process exited before listening on ${host}:${finalPort} (exit=${exitBox.code}). ` +
          `${spawnHint}. ` +
          (errTail ? `stderr:\n${errTail}` : '(no stderr)'),
      )
    }
    await sleep(START_POLL_INTERVAL_MS)
  }

  try {
    child.kill()
  } catch {
    // ignore kill failures after timeout
  }
  await removePidFile()
  await sleep(150)
  const errTail = stderrTail.trim().slice(-2500)
  throw ApiError.internal(
    `Zero-Token gateway failed to listen on ${host}:${finalPort} within ${START_WAIT_MS}ms. ` +
      `${spawnHint}. ` +
      (errTail
        ? `stderr:\n${errTail}`
        : `无 stderr。可手动执行: ${spawnHint}`),
  )
}

async function statusGatewayDirect(): Promise<ZeroTokenGatewayStatus> {
  const host = getGatewayHost()
  const port = getGatewayPort()
  const listening = await isGatewayHttpReady(host, port)
  const pid = await readPidFromFile()
  return {
    listening,
    pid,
    host,
    port,
    raw: `direct: listening=${listening} pid=${pid ?? 'unknown'} ${host}:${port}`,
  }
}

async function stopGatewayDirect(): Promise<ZeroTokenGatewayStatus> {
  const host = getGatewayHost()
  const port = getGatewayPort()
  const pid = await readPidFromFile()
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // process might have already exited
    }
  }
  await removePidFile()

  const deadline = Date.now() + 2_500
  while (Date.now() < deadline) {
    if (!(await isPortListening(host, port))) {
      return {
        listening: false,
        pid: null,
        host,
        port,
        raw: `direct: stopped ${host}:${port}`,
      }
    }
    await sleep(100)
  }

  return {
    listening: await isPortListening(host, port),
    pid: null,
    host,
    port,
    raw: `direct: stop requested ${host}:${port}`,
  }
}

export type ZeroTokenAuthorizeStreamEvent =
  | { type: 'phase'; phase: 'ensure' | 'onboard' | 'keepalive' }
  | { type: 'line'; text: string }
  | {
      type: 'complete'
      result: {
        modelId: string
        ensure: { output: string; result: unknown }
        onboard: { mode: string; output: string }
      }
    }

export class ZeroTokenService {
  getWebModels(): readonly { id: string; onboardMode: string }[] {
    return getZeroTokenWebModels()
  }

  /**
   * CoPaw `ensure_chrome_debug`：检测/拉起 9222 CDP，并按 urls 打开对应站点标签页（与 CoPaw HTTP 一键授权前置一致）。
   */
  async ensureChromeDebug(
    urls: string[],
    onLine?: (line: string) => void,
  ): Promise<{ output: string; result: unknown }> {
    if (!urls.length) {
      throw ApiError.badRequest('ensure_chrome_debug requires at least one URL')
    }
    try {
      return await webauthEnsureChromeDebug(urls, onLine)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error ?? 'ensure_chrome_debug failed')
      throw ApiError.internal(msg)
    }
  }

  /** onboard <mode>（抓凭证写入）；mode 与 canonical model id 的映射见 `zeroTokenWebModels`。 */
  async onboard(
    mode: string,
    onLine?: (line: string) => void,
  ): Promise<{ mode: ZeroTokenMode; output: string }> {
    const normalized = mode.trim().toLowerCase()
    if (!SUPPORTED_ONBOARD_MODES.includes(normalized as ZeroTokenMode)) {
      throw ApiError.badRequest(`Unsupported zero-token onboard mode: ${mode}`)
    }
    const result = await webauthOnboard(normalized, onLine)
    if (!isCopawZeroTokenOnboardSuccess(result.exitCode, result.output)) {
      throw ApiError.internal(withCopawAlignedHint(result.output, normalized))
    }
    return { mode: normalized as ZeroTokenMode, output: result.output }
  }

  /**
   * 与 CoPaw `zero_token.py` 各 `/…/webauth/start` 一致：先 `ensure_chrome_debug(urls)`，再 CLI `onboard(mode)`。
   * 成功后后台启动 `start_chrome_debug_keepalive`（可用 COPAW_ZERO_TOKEN_KEEPALIVE=0 关闭）。
   */
  async authorizeWebModel(modelId: string): Promise<{
    modelId: string
    ensure: { output: string; result: unknown }
    onboard: { mode: string; output: string }
  }> {
    const urls = ensureUrlsForCanonicalModelId(modelId)
    const mode = onboardModeForCanonicalModelId(modelId)
    if (!urls?.length || !mode) {
      throw ApiError.badRequest(`Unknown zero-token web model id: ${modelId}`)
    }
    const ensure = await this.ensureChromeDebug(urls)
    const onboardResult = await this.onboard(mode)
    await this.spawnKeepaliveDetached(urls)
    return {
      modelId,
      ensure,
      onboard: { mode: onboardResult.mode, output: onboardResult.output },
    }
  }

  /** 与 `authorizeWebModel` 相同步骤，但通过回调推送行级日志（供 NDJSON 流式 API） */
  async authorizeWebModelStreaming(
    modelId: string,
    emit: (e: ZeroTokenAuthorizeStreamEvent) => void,
  ): Promise<void> {
    const urls = ensureUrlsForCanonicalModelId(modelId)
    const mode = onboardModeForCanonicalModelId(modelId)
    if (!urls?.length || !mode) {
      throw ApiError.badRequest(`Unknown zero-token web model id: ${modelId}`)
    }

    emit({ type: 'phase', phase: 'ensure' })
    const ensure = await this.ensureChromeDebug(urls, (line) => emit({ type: 'line', text: line }))

    emit({ type: 'phase', phase: 'onboard' })
    const onboardResult = await this.onboard(mode, (line) => emit({ type: 'line', text: line }))

    emit({ type: 'phase', phase: 'keepalive' })
    emit({ type: 'line', text: '正在启动 Chrome CDP 后台保活…' })
    const keepaliveOutcome = await this.spawnKeepaliveDetached(urls)
    if (keepaliveOutcome === 'started') {
      emit({ type: 'line', text: '后台保活进程已启动（与 CoPaw 控制台行为一致）。' })
    } else if (process.env.COPAW_ZERO_TOKEN_KEEPALIVE === '0') {
      emit({ type: 'line', text: '已跳过后台保活（环境变量 COPAW_ZERO_TOKEN_KEEPALIVE=0）。' })
    } else {
      emit({ type: 'line', text: '已跳过后台保活（无可用 URL）。' })
    }

    emit({
      type: 'complete',
      result: {
        modelId,
        ensure,
        onboard: { mode: onboardResult.mode, output: onboardResult.output },
      },
    })
  }

  /** 后台保活（CoPaw `start_chrome_debug_keepalive`）；新开会先尝试结束上一实例 */
  async spawnKeepaliveDetached(urls: string[]): Promise<'skipped' | 'started'> {
    if (process.env.COPAW_ZERO_TOKEN_KEEPALIVE === '0' || !urls.length) return 'skipped'
    await killPreviousKeepalive()
    try {
      const pid = webauthSpawnKeepalive(urls)
      await writeKeepalivePid(pid)
      return 'started'
    } catch (error) {
      throw ApiError.internal(
        error instanceof Error ? error.message : String(error ?? 'keepalive spawn failed'),
      )
    }
  }

  async checkCdp(): Promise<{
    ok: boolean
    url: string
    status: number | null
    wsUrl: string | null
    bodyPreview: string
    error?: string
  }> {
    const url = 'http://127.0.0.1:9222/json/version'
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 2_500)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
      const text = await res.text()
      const preview = text.slice(0, 800)
      let wsUrl: string | null = null
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>
        if (typeof parsed.webSocketDebuggerUrl === 'string') wsUrl = parsed.webSocketDebuggerUrl
      } catch {
        wsUrl = null
      }
      return {
        ok: res.ok,
        url,
        status: res.status,
        wsUrl,
        bodyPreview: preview,
      }
    } catch (error) {
      return {
        ok: false,
        url,
        status: null,
        wsUrl: null,
        bodyPreview: '',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async status(): Promise<ZeroTokenGatewayStatus> {
    return statusGatewayDirect()
  }

  getDeepseekToolMode(): DeepseekToolMode {
    return readDeepseekToolMode()
  }

  async setDeepseekToolMode(mode: DeepseekToolMode): Promise<void> {
    if (mode !== 'dsml' && mode !== 'xml') {
      throw ApiError.badRequest('deepseekToolMode must be "dsml" or "xml"')
    }
    await setDeepseekToolMode(mode)
  }

  /** 仅通过 `POST /api/zero-token/start`（设置页）等显式入口调用；勿在 WebSocket 聊天或 ConversationService spawn 路径兜底调用。 */
  async start(port?: number): Promise<ZeroTokenGatewayStatus> {
    return startGatewayDirect(port)
  }

  async stop(): Promise<ZeroTokenGatewayStatus> {
    await this.stopKeepalive()
    return stopGatewayDirect()
  }

  async stopKeepalive(): Promise<void> {
    await killPreviousKeepalive()
  }
}

/** 与 `/api/zero-token`、代理转发共用同一实例（网关 PID、npm 安装状态一致）。 */
export const sharedZeroTokenService = new ZeroTokenService()

registerGatewayLicenseInvalidatedHandler(async (reason) => {
  console.warn(`[ZeroTokenService] stopping gateway: ${reason}`)
  await stopGatewayDirect()
})
