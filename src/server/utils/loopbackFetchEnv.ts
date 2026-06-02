/**
 * Bun 的 fetch 会遵循 HTTP(S)_PROXY；若不把 loopback 写入 NO_PROXY，
 * 对 Zero-Token 网关 http://127.0.0.1:3002 等上游请求可能被错误地送进代理，表现为 ECONNREFUSED / Unable to connect。
 */
const LOOPBACK_NO_PROXY_ENTRIES = ['127.0.0.1', 'localhost', '[::1]'] as const

function mergeNoProxyList(current: string | undefined): string {
  const parts = new Set(
    String(current ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  )
  for (const e of LOOPBACK_NO_PROXY_ENTRIES) parts.add(e)
  return [...parts].join(',')
}

function mergedNoProxyFromSnapshots(snapUpper?: string, snapLower?: string): string {
  const combined = [snapUpper, snapLower]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(',')
  return mergeNoProxyList(combined || undefined)
}

/**
 * 与子进程 spawn 用的 env 快照合并 loopback（规则与 {@link mergeProcessEnvNoProxyLoopback} 一致），
 * 避免 CLI 侧 fetch 走 HTTP_PROXY 却未排除 127.0.0.1。
 */
export function mergeNoProxyEnvVars(env: Record<string, string | undefined>): void {
  const merged = mergedNoProxyFromSnapshots(env.NO_PROXY, env.no_proxy)
  env.NO_PROXY = merged
  env.no_proxy = merged
}

/** 在 HTTP 服务启动早期调用一次即可作用于进程内全部 fetch。 */
export function mergeProcessEnvNoProxyLoopback(): void {
  const merged = mergedNoProxyFromSnapshots(process.env.NO_PROXY, process.env.no_proxy)
  process.env.NO_PROXY = merged
  process.env.no_proxy = merged
}

/**
 * 当 ANTHROPIC_BASE_URL 指向本机时，清除 HTTP(S)_PROXY，避免部分运行时无视 NO_PROXY 仍将请求送进系统代理。
 */
/**
 * 在 settings.env 合并进 process.env 之后调用（CLI init / applyConfigEnvironmentVariables）。
 * spawn 时清掉的 HTTP(S)_PROXY 若写在 ~/.claude/settings.json 里会被 init 重新加回来，
 * 导致 Bun/undici/axios 仍走 MITM 代理并触发证书错误。
 */
export function applyLoopbackAnthropicNetworkGuards(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): void {
  stripForwardProxyForLoopbackAnthropicBaseUrl(env)
  mergeNoProxyEnvVars(env)
}

export function stripForwardProxyForLoopbackAnthropicBaseUrl(
  env: Record<string, string | undefined>,
): void {
  const raw = env.ANTHROPIC_BASE_URL?.trim()
  if (!raw) return
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    return
  }
  const loopback =
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '[::1]' ||
    host === '::1'
  if (!loopback) return
  delete env.HTTP_PROXY
  delete env.http_proxy
  delete env.HTTPS_PROXY
  delete env.https_proxy
}
