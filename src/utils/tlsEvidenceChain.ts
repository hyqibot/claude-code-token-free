/**
 * TLS / 出网证据链：一次性采集多传输路径与环境快照，用于定位「证书校验失败」类问题。
 * 运行：`bun run scripts/tls-evidence-chain.ts` 或 `import { runTlsEvidenceChain } from './tlsEvidenceChain.js'`
 */

import * as https from 'node:https'
import { hostname as osHostname, platform } from 'node:os'

export type TlsErrorFrame = {
  kind: string
  name?: string
  message?: string
  code?: string
  errno?: string
  syscall?: string
  hostname?: string
  address?: string
  port?: number
  depth: number
}

export type TlsProbeTransport =
  | 'global_fetch'
  | 'undici_fetch'
  | 'node_https_get'

export type TlsProbeRow = {
  probe_id: string
  url: string
  transport: TlsProbeTransport
  ok: boolean
  status_code?: number
  duration_ms: number
  skipped?: boolean
  skip_reason?: string
  error_chain?: TlsErrorFrame[]
}

export type TlsEvidenceReport = {
  schema: 'cc-haha.tls_evidence/v1'
  iso_timestamp: string
  runtime: {
    bun_version?: string
    node_version?: string
    platform: string
    os_hostname: string
  }
  env_snapshot: Record<string, string | undefined>
  probes: TlsProbeRow[]
  heuristic_notes: string[]
}

const DEFAULT_TIMEOUT_MS = 10_000
const MAX_CHAIN_DEPTH = 10
const MAX_MESSAGE_LEN = 2048

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return `${s.slice(0, n)}…(truncated)`
}

/**  walking Error.cause 与非 Error 对象，尽量保留 TLS 相关字段 */
export function serializeTlsErrorChain(
  err: unknown,
  maxDepth = MAX_CHAIN_DEPTH,
): TlsErrorFrame[] {
  const out: TlsErrorFrame[] = []
  let cur: unknown = err
  let depth = 0

  while (cur != null && depth < maxDepth) {
    if (cur instanceof Error) {
      const any = cur as Error & Record<string, unknown>
      const msg = typeof cur.message === 'string' ? cur.message : String(cur)
      out.push({
        kind: 'Error',
        name: cur.name,
        message: truncate(msg, MAX_MESSAGE_LEN),
        code: typeof any.code === 'string' ? any.code : undefined,
        errno:
          typeof any.errno === 'number' || typeof any.errno === 'string'
            ? String(any.errno)
            : undefined,
        syscall: typeof any.syscall === 'string' ? any.syscall : undefined,
        hostname: typeof any.hostname === 'string' ? any.hostname : undefined,
        address: typeof any.address === 'string' ? any.address : undefined,
        port: typeof any.port === 'number' ? any.port : undefined,
        depth,
      })
      cur = cur.cause
    } else if (typeof cur === 'object') {
      const o = cur as Record<string, unknown>
      const msg =
        typeof o.message === 'string' ? o.message : JSON.stringify(o)
      out.push({
        kind: 'non_error_object',
        message: truncate(msg, MAX_MESSAGE_LEN),
        code: typeof o.code === 'string' ? o.code : undefined,
        depth,
      })
      cur = o.cause
    } else {
      out.push({
        kind: typeof cur,
        message: truncate(String(cur), MAX_MESSAGE_LEN),
        depth,
      })
      break
    }
    depth++
  }
  return out
}

function safeBasename(p: string | undefined): string | undefined {
  if (!p) return undefined
  const norm = p.replace(/\\/g, '/')
  const parts = norm.split('/')
  return parts[parts.length - 1] || p
}

/**
 * 采集与 TLS 相关的环境（不含密钥内容；API key 只标是否设置）。
 */
export function collectTlsEnvSnapshot(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  const pick = (k: string) => env[k]
  return {
    NODE_TLS_REJECT_UNAUTHORIZED: pick('NODE_TLS_REJECT_UNAUTHORIZED'),
    COPAW_INSECURE_TLS: pick('COPAW_INSECURE_TLS'),
    SSL_CERT_FILE: pick('SSL_CERT_FILE'),
    SSL_CERT_DIR: pick('SSL_CERT_DIR'),
    NODE_EXTRA_CA_CERTS: safeBasename(pick('NODE_EXTRA_CA_CERTS')),
    HTTPS_PROXY: pick('HTTPS_PROXY') ? '(set)' : undefined,
    HTTP_PROXY: pick('HTTP_PROXY') ? '(set)' : undefined,
    ALL_PROXY: pick('ALL_PROXY') ? '(set)' : undefined,
    NO_PROXY: pick('NO_PROXY'),
    no_proxy: pick('no_proxy'),
    ANTHROPIC_BASE_URL: pick('ANTHROPIC_BASE_URL'),
    ANTHROPIC_API_KEY: pick('ANTHROPIC_API_KEY') ? '(set)' : undefined,
    ANTHROPIC_AUTH_TOKEN: pick('ANTHROPIC_AUTH_TOKEN') ? '(set)' : undefined,
    ZERO_TOKEN_GATEWAY_URL: pick('ZERO_TOKEN_GATEWAY_URL'),
  }
}

export function buildDefaultProbeTargets(
  env: NodeJS.ProcessEnv = process.env,
  opts?: { includePublicHttpsCanary?: boolean },
): { probe_id: string; url: string }[] {
  const includeCanary = opts?.includePublicHttpsCanary !== false
  const out: { probe_id: string; url: string }[] = []
  const base = env.ANTHROPIC_BASE_URL?.trim()
  if (base) {
    try {
      const u = new URL(base)
      out.push({ probe_id: 'anthropic_base_origin', url: u.origin + '/' })
      out.push({
        probe_id: 'anthropic_gateway_health',
        url: new URL('/health', u.origin).href,
      })
    } catch {
      out.push({
        probe_id: 'anthropic_base_invalid',
        url: 'about:invalid-anthropic-base-url',
      })
    }
  }
  if (includeCanary) {
    out.push({ probe_id: 'public_https_example_com', url: 'https://example.com/' })
  }
  return out
}

async function probeGlobalFetch(
  probe_id: string,
  url: string,
  timeoutMs: number,
): Promise<TlsProbeRow> {
  const t0 = Date.now()
  if (url.startsWith('about:')) {
    return {
      probe_id,
      url,
      transport: 'global_fetch',
      ok: false,
      duration_ms: Date.now() - t0,
      skipped: true,
      skip_reason: 'invalid_placeholder_url',
    }
  }
  const ac = new AbortController()
  const tid = setTimeout(
    () => ac.abort(new Error(`timeout_after_${timeoutMs}ms`)),
    timeoutMs,
  )
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      redirect: 'manual',
      headers: { 'user-agent': 'cc-haha-tls-evidence/1' },
    })
    return {
      probe_id,
      url,
      transport: 'global_fetch',
      ok: true,
      status_code: r.status,
      duration_ms: Date.now() - t0,
    }
  } catch (e) {
    return {
      probe_id,
      url,
      transport: 'global_fetch',
      ok: false,
      duration_ms: Date.now() - t0,
      error_chain: serializeTlsErrorChain(e),
    }
  } finally {
    clearTimeout(tid)
  }
}

async function probeUndiciFetch(
  probe_id: string,
  url: string,
  timeoutMs: number,
): Promise<TlsProbeRow> {
  const t0 = Date.now()
  if (url.startsWith('about:')) {
    return {
      probe_id,
      url,
      transport: 'undici_fetch',
      ok: false,
      duration_ms: Date.now() - t0,
      skipped: true,
      skip_reason: 'invalid_placeholder_url',
    }
  }
  let tid: ReturnType<typeof setTimeout> | undefined
  try {
    const undici = await import('undici')
    const ac = new AbortController()
    tid = setTimeout(
      () => ac.abort(new Error(`timeout_after_${timeoutMs}ms`)),
      timeoutMs,
    )
    const r = await undici.fetch(url, {
      signal: ac.signal,
      redirect: 'manual',
      headers: { 'user-agent': 'cc-haha-tls-evidence/1' },
    })
    return {
      probe_id,
      url,
      transport: 'undici_fetch',
      ok: true,
      status_code: r.status,
      duration_ms: Date.now() - t0,
    }
  } catch (e) {
    return {
      probe_id,
      url,
      transport: 'undici_fetch',
      ok: false,
      duration_ms: Date.now() - t0,
      error_chain: serializeTlsErrorChain(e),
    }
  } finally {
    if (tid !== undefined) clearTimeout(tid)
  }
}

function probeNodeHttpsGet(
  probe_id: string,
  url: string,
  timeoutMs: number,
): Promise<TlsProbeRow> {
  const t0 = Date.now()
  if (url.startsWith('about:')) {
    return Promise.resolve({
      probe_id,
      url,
      transport: 'node_https_get',
      ok: false,
      duration_ms: Date.now() - t0,
      skipped: true,
      skip_reason: 'invalid_placeholder_url',
    })
  }
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return Promise.resolve({
      probe_id,
      url,
      transport: 'node_https_get',
      ok: false,
      duration_ms: Date.now() - t0,
      skipped: true,
      skip_reason: 'url_parse_error',
    })
  }
  if (u.protocol !== 'https:') {
    return Promise.resolve({
      probe_id,
      url,
      transport: 'node_https_get',
      ok: false,
      duration_ms: Date.now() - t0,
      skipped: true,
      skip_reason: 'not_https_scheme',
    })
  }

  return new Promise(resolve => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        timeout: timeoutMs,
        headers: { 'user-agent': 'cc-haha-tls-evidence/1' },
        rejectUnauthorized: true,
      },
      res => {
        res.resume()
        resolve({
          probe_id,
          url,
          transport: 'node_https_get',
          ok: true,
          status_code: res.statusCode,
          duration_ms: Date.now() - t0,
        })
      },
    )
    req.on('error', err => {
      resolve({
        probe_id,
        url,
        transport: 'node_https_get',
        ok: false,
        duration_ms: Date.now() - t0,
        error_chain: serializeTlsErrorChain(err),
      })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve({
        probe_id,
        url,
        transport: 'node_https_get',
        ok: false,
        duration_ms: Date.now() - t0,
        error_chain: serializeTlsErrorChain(new Error('node_https_timeout')),
      })
    })
    req.end()
  })
}

function chainLooksLikeTls(chain: TlsErrorFrame[] | undefined): boolean {
  if (!chain?.length) return false
  const blob = chain.map(f => `${f.name ?? ''} ${f.message ?? ''} ${f.code ?? ''}`).join(' ')
  return /cert|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|unknown certificate|EPROTO|UNSAFE_|hostname/i.test(
    blob,
  )
}

/**
 * 基于探测结果生成可读线索（非最终根因，供对照 runtime-errors）。
 */
export function buildHeuristicNotes(report: TlsEvidenceReport): string[] {
  const notes: string[] = []
  const baseUrl = report.env_snapshot.ANTHROPIC_BASE_URL
  let anthScheme: string | undefined
  if (baseUrl) {
    try {
      anthScheme = new URL(baseUrl).protocol
    } catch {
      anthScheme = 'invalid'
    }
  }

  if (anthScheme === 'http:' || anthScheme === 'http') {
    notes.push(
      'ANTHROPIC_BASE_URL 为 http：到网关的这条链路通常不做 HTTPS 证书校验；若 UI 仍报证书错误，优先怀疑其它 HTTPS（代理 CONNECT、Statsig、OAuth、网关上联等）。',
    )
  }
  if (anthScheme === 'https:') {
    notes.push('ANTHROPIC_BASE_URL 为 https：请重点对比 global_fetch / undici_fetch / node_https_get 三条探测是否仅某一条失败。')
  }

  const proxySet =
    report.env_snapshot.HTTPS_PROXY === '(set)' ||
    report.env_snapshot.HTTP_PROXY === '(set)'
  if (proxySet) {
    notes.push(
      '检测到 HTTP(S)_PROXY：CONNECT/Tunnel TLS 可能在代理处失败；对比 NO_PROXY 是否包含 127.0.0.1 / localhost。',
    )
  }

  const pubTlsFail = report.probes.filter(
    p =>
      p.probe_id.startsWith('public_https_example_com') &&
      !p.skipped &&
      !p.ok &&
      chainLooksLikeTls(p.error_chain),
  )
  if (pubTlsFail.length > 0) {
    notes.push(
      '公网 https://example.com 探测出现 TLS/证书类错误：多为主机系统信任库、公司解密代理或 TLS 拦截导致（与 Zero-Token 网关无直接关系）。',
    )
  }

  const byUrl = new Map<string, TlsProbeRow[]>()
  for (const p of report.probes) {
    if (p.skipped) continue
    const list = byUrl.get(p.url) ?? []
    list.push(p)
    byUrl.set(p.url, list)
  }
  for (const rows of byUrl.values()) {
    const gf = rows.find(r => r.transport === 'global_fetch')
    const uf = rows.find(r => r.transport === 'undici_fetch')
    if (
      gf?.ok === true &&
      uf &&
      !uf.ok &&
      chainLooksLikeTls(uf.error_chain)
    ) {
      notes.push(
        '同一 URL 上 global_fetch 成功而 undici_fetch 出现 TLS/证书类失败：典型为 undici 全局 Dispatcher/代理与 Bun 内置 fetch 行为不一致。',
      )
      break
    }
  }

  const insecure =
    report.env_snapshot.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
    report.env_snapshot.COPAW_INSECURE_TLS === '1'
  if (!insecure && pubTlsFail.length > 0) {
    notes.push(
      '当前快照未显示 NODE_TLS_REJECT_UNAUTHORIZED=0 / COPAW_INSECURE_TLS=1；若你在桌面开启 insecureTls，请在**触发错误的同一进程**里重新跑本报告（CLI 子进程与 Server 进程环境可能不同）。',
    )
  }

  if (notes.length === 0) {
    notes.push(
      '未匹配到强启发式：请把本 JSON 与 runtime-errors.log 同时间戳条目一起对照，并在失败瞬间查看 zero-token-gateway 控制台输出。',
    )
  }
  return notes
}

export type RunTlsEvidenceChainOptions = {
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  targets?: { probe_id: string; url: string }[]
  includePublicHttpsCanary?: boolean
}

export async function runTlsEvidenceChain(
  options: RunTlsEvidenceChainOptions = {},
): Promise<TlsEvidenceReport> {
  const env = options.env ?? process.env
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const targets =
    options.targets ??
    buildDefaultProbeTargets(env, {
      includePublicHttpsCanary: options.includePublicHttpsCanary !== false,
    })

  const env_snapshot = collectTlsEnvSnapshot(env)
  const probes: TlsProbeRow[] = []

  for (const t of targets) {
    probes.push(await probeGlobalFetch(t.probe_id, t.url, timeoutMs))
    probes.push(await probeUndiciFetch(`${t.probe_id}__undici`, t.url, timeoutMs))
    probes.push(await probeNodeHttpsGet(`${t.probe_id}__node_https`, t.url, timeoutMs))
  }

  const report: TlsEvidenceReport = {
    schema: 'cc-haha.tls_evidence/v1',
    iso_timestamp: new Date().toISOString(),
    runtime: {
      ...(typeof Bun !== 'undefined' && Bun.version
        ? { bun_version: Bun.version }
        : {}),
      node_version: process.version,
      platform,
      os_hostname: osHostname(),
    },
    env_snapshot,
    probes,
    heuristic_notes: [],
  }
  report.heuristic_notes = buildHeuristicNotes(report)
  return report
}
