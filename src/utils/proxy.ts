// @aws-sdk/credential-provider-node and @smithy/node-http-handler are imported
// dynamically in getAWSClientProxyConfig() to defer ~929KB of AWS SDK.
// undici is lazy-required inside getProxyAgent/configureGlobalAgents to defer
// ~1.5MB when no HTTPS_PROXY/mTLS env vars are set (the common case).
import axios, { type AxiosInstance } from 'axios'
import type { LookupOptions } from 'dns'
import type { Agent } from 'http'
import { HttpsProxyAgent, type HttpsProxyAgentOptions } from 'https-proxy-agent'
import memoize from 'lodash-es/memoize.js'
import type * as undici from 'undici'
import { applyLoopbackAnthropicNetworkGuards } from '../server/utils/loopbackFetchEnv.js'
import { getCACertificates } from './caCerts.js'
import { logForDebugging } from './debug.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getMTLSAgent,
  getMTLSConfig,
  getTLSFetchOptions,
  type TLSConfig,
} from './mtls.js'

// Disable fetch keep-alive after a stale-pool ECONNRESET so retries open a
// fresh TCP connection instead of reusing the dead pooled socket. Sticky for
// the process lifetime — once the pool is known-bad, don't trust it again.
// Works under Bun (native fetch respects keepalive:false for pooling).
// Under Node/undici, keepalive is a no-op for pooling, but undici
// naturally evicts dead sockets from the pool on ECONNRESET.
let keepAliveDisabled = false

export function disableKeepAlive(): void {
  keepAliveDisabled = true
}

export function _resetKeepAliveForTesting(): void {
  keepAliveDisabled = false
}

/**
 * Convert dns.LookupOptions.family to a numeric address family value
 * Handles: 0 | 4 | 6 | 'IPv4' | 'IPv6' | undefined
 */
export function getAddressFamily(options: LookupOptions): 0 | 4 | 6 {
  switch (options.family) {
    case 0:
    case 4:
    case 6:
      return options.family
    case 'IPv6':
      return 6
    case 'IPv4':
    case undefined:
      return 4
    default:
      throw new Error(`Unsupported address family: ${options.family}`)
  }
}

type EnvLike = Record<string, string | undefined>

/**
 * Get the active proxy URL if one is configured
 * Prefers lowercase variants over uppercase (https_proxy > HTTPS_PROXY > http_proxy > HTTP_PROXY)
 * @param env Environment variables to check (defaults to process.env for production use)
 */
export function getProxyUrl(env: EnvLike = process.env): string | undefined {
  return env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY
}

/**
 * Get the NO_PROXY environment variable value
 * Prefers lowercase over uppercase (no_proxy > NO_PROXY)
 * @param env Environment variables to check (defaults to process.env for production use)
 */
export function getNoProxy(env: EnvLike = process.env): string | undefined {
  return env.no_proxy || env.NO_PROXY
}

/**
 * Check if a URL should bypass the proxy based on NO_PROXY environment variable
 * Supports:
 * - Exact hostname matches (e.g., "localhost")
 * - Domain suffix matches with leading dot (e.g., ".example.com")
 * - Wildcard "*" to bypass all
 * - Port-specific matches (e.g., "example.com:8080")
 * - IP addresses (e.g., "127.0.0.1")
 * @param urlString URL to check
 * @param noProxy NO_PROXY value (defaults to getNoProxy() for production use)
 */
/** Anthropic API 指向本机网关（Zero-Token 等）时的 hostname 判定。 */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1'
}

export function isLoopbackHttpUrl(urlString: string): boolean {
  try {
    const u = new URL(urlString)
    return isLoopbackHost(u.hostname)
  } catch {
    return false
  }
}

export function isLoopbackAnthropicBaseUrlEnv(env: EnvLike = process.env): boolean {
  const raw = env.ANTHROPIC_BASE_URL?.trim()
  if (!raw) return false
  try {
    return isLoopbackHost(new URL(raw).hostname)
  } catch {
    return false
  }
}

export function shouldBypassProxy(
  urlString: string,
  noProxy: string | undefined = getNoProxy(),
): boolean {
  if (!noProxy) return false

  // Handle wildcard
  if (noProxy === '*') return true

  try {
    const url = new URL(urlString)
    const hostname = url.hostname.toLowerCase()
    const port = url.port || (url.protocol === 'https:' ? '443' : '80')
    const hostWithPort = `${hostname}:${port}`

    // Split by comma or space and trim each entry
    const noProxyList = noProxy.split(/[,\s]+/).filter(Boolean)

    return noProxyList.some(pattern => {
      pattern = pattern.toLowerCase().trim()

      // Check for port-specific match
      if (pattern.includes(':')) {
        return hostWithPort === pattern
      }

      // Check for domain suffix match (with or without leading dot)
      if (pattern.startsWith('.')) {
        // Pattern ".example.com" should match "sub.example.com" and "example.com"
        // but NOT "notexample.com"
        const suffix = pattern
        return hostname === pattern.substring(1) || hostname.endsWith(suffix)
      }

      // Check for exact hostname match or IP address
      return hostname === pattern
    })
  } catch {
    // If URL parsing fails, don't bypass proxy
    return false
  }
}

/**
 * Create an HttpsProxyAgent with optional mTLS configuration
 * Skips local DNS resolution to let the proxy handle it
 */
function createHttpsProxyAgent(
  proxyUrl: string,
  extra: HttpsProxyAgentOptions<string> = {},
): HttpsProxyAgent<string> {
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  const agentOptions: HttpsProxyAgentOptions<string> = {
    ...(mtlsConfig && {
      cert: mtlsConfig.cert,
      key: mtlsConfig.key,
      passphrase: mtlsConfig.passphrase,
    }),
    ...(caCerts && { ca: caCerts }),
    ...(shouldApplyBunInsecureTlsFetchOptions() && {
      rejectUnauthorized: false,
    }),
  }

  if (isEnvTruthy(process.env.CLAUDE_CODE_PROXY_RESOLVES_HOSTS)) {
    // Skip local DNS resolution - let the proxy resolve hostnames
    // This is needed for environments where DNS is not configured locally
    // and instead handled by the proxy (as in sandboxes)
    agentOptions.lookup = (hostname, options, callback) => {
      callback(null, hostname, getAddressFamily(options))
    }
  }

  return new HttpsProxyAgent(proxyUrl, { ...agentOptions, ...extra })
}

/**
 * Axios instance with its own proxy agent. Same NO_PROXY/mTLS/CA
 * resolution as the global interceptor, but agent options stay
 * scoped to this instance.
 */
export function createAxiosInstance(
  extra: HttpsProxyAgentOptions<string> = {},
): AxiosInstance {
  const proxyUrl = getProxyUrl()
  const mtlsAgent = getMTLSAgent()
  const instance = axios.create({ proxy: false })

  if (!proxyUrl) {
    if (mtlsAgent) instance.defaults.httpsAgent = mtlsAgent
    return instance
  }

  const proxyAgent = createHttpsProxyAgent(proxyUrl, extra)
  instance.interceptors.request.use(config => {
    if (config.url && shouldBypassProxy(config.url)) {
      config.httpsAgent = mtlsAgent
      config.httpAgent = mtlsAgent
    } else {
      config.httpsAgent = proxyAgent
      config.httpAgent = proxyAgent
    }
    return config
  })
  return instance
}

/**
 * Get or create a memoized proxy agent for the given URI
 * Now respects NO_PROXY environment variable
 */
export const getProxyAgent = memoize((uri: string): undici.Dispatcher => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undiciMod = require('undici') as typeof undici
  const mtlsConfig = getMTLSConfig()
  const caCerts = getCACertificates()

  // Use EnvHttpProxyAgent to respect NO_PROXY
  // This agent automatically checks NO_PROXY for each request
  const proxyOptions: undici.EnvHttpProxyAgent.Options & {
    requestTls?: {
      cert?: string | Buffer
      key?: string | Buffer
      passphrase?: string
      ca?: string | string[] | Buffer
    }
  } = {
    // Override both HTTP and HTTPS proxy with the provided URI
    httpProxy: uri,
    httpsProxy: uri,
    noProxy: process.env.NO_PROXY || process.env.no_proxy,
  }

  // Set both connect and requestTls so TLS options apply to both paths:
  // - requestTls: used by ProxyAgent for the TLS connection through CONNECT tunnels
  // - connect: used by Agent for direct (no-proxy) connections
  if (mtlsConfig || caCerts || shouldApplyBunInsecureTlsFetchOptions()) {
    const tlsOpts = {
      ...(mtlsConfig && {
        cert: mtlsConfig.cert,
        key: mtlsConfig.key,
        passphrase: mtlsConfig.passphrase,
      }),
      ...(caCerts && { ca: caCerts }),
      ...(shouldApplyBunInsecureTlsFetchOptions() && {
        rejectUnauthorized: false,
      }),
    }
    proxyOptions.connect = tlsOpts
    proxyOptions.requestTls = tlsOpts
  }

  return new undiciMod.EnvHttpProxyAgent(proxyOptions)
})

/**
 * Get an HTTP agent configured for WebSocket proxy support
 * Returns undefined if no proxy is configured or URL should bypass proxy
 */
export function getWebSocketProxyAgent(url: string): Agent | undefined {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return undefined
  }

  // Check if URL should bypass proxy
  if (shouldBypassProxy(url)) {
    return undefined
  }

  return createHttpsProxyAgent(proxyUrl)
}

/**
 * Get the proxy URL for WebSocket connections under Bun.
 * Bun's native WebSocket supports a `proxy` string option instead of Node's `agent`.
 * Returns undefined if no proxy is configured or URL should bypass proxy.
 */
export function getWebSocketProxyUrl(url: string): string | undefined {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return undefined
  }

  if (shouldBypassProxy(url)) {
    return undefined
  }

  return proxyUrl
}

/**
 * Whether to add `tls.rejectUnauthorized: false` on Bun for Anthropic SDK `fetch`
 * when `NODE_TLS_REJECT_UNAUTHORIZED=0` or `COPAW_INSECURE_TLS=1` (matches desktop spawn).
 * Exported for unit tests.
 */
export function shouldApplyBunInsecureTlsFetchOptions(): boolean {
  return (
    typeof Bun !== 'undefined' &&
    (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
      process.env.COPAW_INSECURE_TLS === '1')
  )
}

function finalizeProxyFetchOptionsForBun(result: {
  tls?: TLSConfig
  dispatcher?: undici.Dispatcher
  proxy?: string
  unix?: string
  keepalive?: false
}): {
  tls?: TLSConfig
  dispatcher?: undici.Dispatcher
  proxy?: string
  unix?: string
  keepalive?: false
} {
  if (!shouldApplyBunInsecureTlsFetchOptions()) {
    return result
  }
  return {
    ...result,
    tls: {
      ...(result.tls ?? {}),
      rejectUnauthorized: false,
    },
  }
}

/**
 * Get fetch options for the Anthropic SDK with proxy and mTLS configuration
 * Returns fetch options with appropriate dispatcher for proxy and/or mTLS
 *
 * Under Bun, when insecure TLS is enabled (`NODE_TLS_REJECT_UNAUTHORIZED=0` or
 * `COPAW_INSECURE_TLS=1`), merges `tls.rejectUnauthorized: false` into options so
 * `fetch` matches the setting (avoids `unknown certificate verification error`
 * on proxy/MITM paths where the global env alone is insufficient).
 *
 * @param opts.forAnthropicAPI - Enables ANTHROPIC_UNIX_SOCKET tunneling. This
 *   env var is set by `claude ssh` on the remote CLI to route API calls through
 *   an ssh -R forwarded unix socket to a local auth proxy. It MUST NOT leak
 *   into non-Anthropic-API fetch paths (MCP HTTP/SSE transports, etc.) or those
 *   requests get misrouted to api.anthropic.com. Only the Anthropic API
 *   client should pass `true` here.
 */
export function getProxyFetchOptions(opts?: { forAnthropicAPI?: boolean }): {
  tls?: TLSConfig
  dispatcher?: undici.Dispatcher
  proxy?: string
  unix?: string
  keepalive?: false
} {
  const base = keepAliveDisabled ? ({ keepalive: false } as const) : {}

  // ANTHROPIC_UNIX_SOCKET tunnels through the `claude ssh` auth proxy, which
  // hardcodes the upstream to the Anthropic API. Scope to the Anthropic API
  // client so MCP/SSE/other callers don't get their requests misrouted.
  if (opts?.forAnthropicAPI) {
    const unixSocket = process.env.ANTHROPIC_UNIX_SOCKET
    if (unixSocket && typeof Bun !== 'undefined') {
      return finalizeProxyFetchOptionsForBun({ ...base, unix: unixSocket })
    }
  }

  const proxyUrl = getProxyUrl()

  // Bun + Zero-Token：即使未设置 HTTP_PROXY，Windows 仍可能走「系统代理」(Clash 关闭后
  // 127.0.0.1:7897 无监听 → APIConnectionError / Unable to connect)。在 fetchOptions 层
  // 显式 proxy:'' 禁用代理（与 mergeBunInsecureFetchInit 一致）。
  if (
    typeof Bun !== 'undefined' &&
    opts?.forAnthropicAPI &&
    isLoopbackAnthropicBaseUrlEnv()
  ) {
    return finalizeProxyFetchOptionsForBun({
      ...base,
      ...getTLSFetchOptions(),
      // @ts-expect-error Bun-specific fetch proxy option
      proxy: '',
    })
  }

  // If we have a proxy, use the proxy agent (which includes mTLS config)
  if (proxyUrl) {
    if (typeof Bun !== 'undefined') {
      return finalizeProxyFetchOptionsForBun({
        ...base,
        proxy: proxyUrl,
        ...getTLSFetchOptions(),
      })
    }
    return { ...base, dispatcher: getProxyAgent(proxyUrl) }
  }

  // Otherwise, use TLS options directly if available
  return finalizeProxyFetchOptionsForBun({ ...base, ...getTLSFetchOptions() })
}

/**
 * Configure global HTTP agents for both axios and undici
 * This ensures all HTTP requests use the proxy and/or mTLS if configured
 */
let proxyInterceptorId: number | undefined

export function configureGlobalAgents(): void {
  // settings.json env may re-inject HTTP(S)_PROXY after spawn stripped it
  applyLoopbackAnthropicNetworkGuards(
    process.env as Record<string, string | undefined>,
  )

  const proxyUrl = getProxyUrl()
  const mtlsAgent = getMTLSAgent()

  if (shouldApplyBunInsecureTlsFetchOptions()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('node:https') as typeof import('node:https')
    const insecureAgent = new https.Agent({ rejectUnauthorized: false })
    axios.defaults.httpsAgent = insecureAgent
    axios.defaults.httpAgent = insecureAgent
  }

  // Eject previous interceptor to avoid stacking on repeated calls
  if (proxyInterceptorId !== undefined) {
    axios.interceptors.request.eject(proxyInterceptorId)
    proxyInterceptorId = undefined
  }

  // Reset proxy-related defaults so reconfiguration is clean
  axios.defaults.proxy = undefined
  axios.defaults.httpAgent = undefined
  axios.defaults.httpsAgent = undefined

  if (proxyUrl) {
    // workaround for https://github.com/axios/axios/issues/4531
    axios.defaults.proxy = false

    // Create proxy agent with mTLS options if available
    const proxyAgent = createHttpsProxyAgent(proxyUrl)

    // Add axios request interceptor to handle NO_PROXY
    proxyInterceptorId = axios.interceptors.request.use(config => {
      // Check if URL should bypass proxy based on NO_PROXY
      if (config.url && shouldBypassProxy(config.url)) {
        // Bypass proxy - use mTLS agent if configured, otherwise undefined
        if (mtlsAgent) {
          config.httpsAgent = mtlsAgent
          config.httpAgent = mtlsAgent
        } else {
          // Remove any proxy agents to use direct connection
          delete config.httpsAgent
          delete config.httpAgent
        }
      } else {
        // Use proxy agent
        config.httpsAgent = proxyAgent
        config.httpAgent = proxyAgent
      }
      return config
    })

    // Set global dispatcher that now respects NO_PROXY via EnvHttpProxyAgent
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ;(require('undici') as typeof undici).setGlobalDispatcher(
      getProxyAgent(proxyUrl),
    )
  } else if (mtlsAgent) {
    // No proxy but mTLS is configured
    axios.defaults.httpsAgent = mtlsAgent

    // Set undici global dispatcher with mTLS
    const mtlsOptions = getTLSFetchOptions()
    if (mtlsOptions.dispatcher) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ;(require('undici') as typeof undici).setGlobalDispatcher(
        mtlsOptions.dispatcher,
      )
    }
  }

  // Apply global fetch shim for Bun if needed
  applyGlobalBunFetchShim()
}

/**
 * For Bun, we need to explicitly pass `tls: { rejectUnauthorized: false }` to `fetch`.
 * Since we can't always control the `fetch` calls from 3rd party libraries,
 * we shim `globalThis.fetch` to inject this option when insecure TLS is enabled.
 */
let isBunFetchShimmed = false

function resolveFetchUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** 供单测：判断是否为常见的传输层失败文案（含 Anthropic SDK 包装）。 */
export function isLikelyFetchConnectivityErrorMessage(message: string): boolean {
  const m = message.toLowerCase()
  return (
    /unable to connect/.test(m) ||
    /not able to access/.test(m) ||
    /fetch failed/i.test(m) ||
    /econnrefused/i.test(m) ||
    /enotfound/i.test(m) ||
    /etimedout/i.test(m) ||
    /network.*unreachable/i.test(m)
  )
}

export function isLikelyFetchConnectivityError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (isLikelyFetchConnectivityErrorMessage(err.message)) return true
  let c: unknown = (err as Error & { cause?: unknown }).cause
  const seen = new Set<unknown>()
  while (c !== undefined && c !== null && !seen.has(c)) {
    seen.add(c)
    if (c instanceof Error) {
      if (isLikelyFetchConnectivityErrorMessage(c.message)) return true
      c = (c as Error & { cause?: unknown }).cause
    } else if (typeof c === 'string') {
      return isLikelyFetchConnectivityErrorMessage(c)
    } else {
      break
    }
  }
  return false
}

function summarizeProxyEnvForLog(): string {
  const keys = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'NO_PROXY',
    'no_proxy',
  ] as const
  const parts: string[] = []
  for (const k of keys) {
    const v = process.env[k]
    if (v) parts.push(`${k}=${v}`)
  }
  return parts.length ? parts.join(' ') : '(no proxy env)'
}

function formatErrorCauseChain(err: unknown): string {
  let out = ''
  try {
    let c: unknown =
      err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined
    const seen = new Set<unknown>()
    let depth = 0
    while (c !== undefined && c !== null && !seen.has(c) && depth < 6) {
      seen.add(c)
      depth += 1
      if (c instanceof Error) {
        out += ` | cause: ${c.name}: ${c.message}`
        c = (c as Error & { cause?: unknown }).cause
      } else {
        out += ` | cause: ${String(c)}`
        break
      }
    }
  } catch {
    // ignore
  }
  return out
}

/**
 * 在 Anthropic SDK / Bun shim 的 fetch 失败时打出可诊断的一行（stderr），便于区分
 * 「连错 URL / 仍走代理」与「网关已监听但别处在连外网」。
 */
export function logFetchConnectivityDiagnostics(
  url: string,
  err: unknown,
  channel: string,
): void {
  if (!isLikelyFetchConnectivityError(err)) return
  const msg = err instanceof Error ? err.message : String(err)
  const line = `[cc-haha] API fetch connect error channel=${channel} url=${url} ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL ?? '(unset)'} ${summarizeProxyEnvForLog()} err=${msg}${formatErrorCauseChain(err)}`
  // biome-ignore lint/suspicious/noConsole:: intentional diagnostics for Zero-Token / Bun fetch failures
  console.error(line)
  logForDebugging(line, { level: 'error' })
}

/** Bun fetch：对本机 URL 禁用系统/环境代理；对 HTTPS 强制跳过证书校验。 */
export function mergeBunInsecureFetchInit(
  url: string,
  init?: RequestInit,
): RequestInit {
  const newInit: RequestInit = { ...init }
  try {
    const parsed = new URL(url)
    if (isLoopbackHost(parsed.hostname)) {
      // Bun：空字符串显式禁用代理（避免 Windows 系统代理把 127.0.0.1 送进 MITM）
      // @ts-expect-error Bun-specific fetch proxy option
      newInit.proxy = ''
    }
    if (parsed.protocol === 'https:') {
      // @ts-expect-error Bun-specific TLS option — always override, never honor rejectUnauthorized: true
      newInit.tls = { rejectUnauthorized: false }
    }
  } catch {
    // ignore invalid URL
  }
  return newInit
}

export function applyGlobalBunFetchShim(): void {
  if (
    typeof Bun === 'undefined' ||
    isBunFetchShimmed ||
    !shouldApplyBunInsecureTlsFetchOptions()
  ) {
    return
  }

  const originalFetch = globalThis.fetch
  // @ts-expect-error - Overwriting global fetch is intentional
  globalThis.fetch = async function (
    input: string | URL | Request,
    init?: RequestInit,
  ) {
    const url = resolveFetchUrl(input)
    const newInit = mergeBunInsecureFetchInit(url, init)
    const run = () => {
      if (typeof Request !== 'undefined' && input instanceof Request) {
        return originalFetch(new Request(input, newInit))
      }
      return originalFetch(input, newInit)
    }
    return run().catch((err: unknown) => {
      if (
        err instanceof Error &&
        /certificate verification/i.test(err.message)
      ) {
        console.error(
          `[cc-haha] fetch TLS error url=${url} ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL ?? '(unset)'}`,
        )
      }
      logFetchConnectivityDiagnostics(url, err, 'bun-global-fetch-shim')
      throw err
    })
  }

  isBunFetchShimmed = true
  console.warn(
    '[cc-haha] Bun global fetch shimmed (loopback proxy off, HTTPS rejectUnauthorized=false)',
  )
  logForDebugging(
    '[proxy] Bun global fetch shimmed to skip TLS verification (rejectUnauthorized: false)',
  )
}

/**
 * Get AWS SDK client configuration with proxy support
 * Returns configuration object that can be spread into AWS service client constructors
 */
export async function getAWSClientProxyConfig(): Promise<object> {
  const proxyUrl = getProxyUrl()

  if (!proxyUrl) {
    return {}
  }

  const [{ NodeHttpHandler }, { defaultProvider }] = await Promise.all([
    import('@smithy/node-http-handler'),
    import('@aws-sdk/credential-provider-node'),
  ])

  const agent = createHttpsProxyAgent(proxyUrl)
  const requestHandler = new NodeHttpHandler({
    httpAgent: agent,
    httpsAgent: agent,
  })

  return {
    requestHandler,
    credentials: defaultProvider({
      clientConfig: { requestHandler },
    }),
  }
}

/**
 * Clear proxy agent cache.
 */
export function clearProxyCache(): void {
  getProxyAgent.cache.clear?.()
  logForDebugging('Cleared proxy agent cache')
}
