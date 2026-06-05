/**
 * cc-haha 启动 Zero-Token gateway（`node --import`）时注入。
 *
 * 默认 **scoped TLS**（`COPAW_DEEPSEEK_SCOPED_TLS` 未设或为 1）：
 * 不 patch 全局 fetch；仅 `deepseek-web-client.mjs` 对 chat.deepseek.com 使用 undici Agent
 * （keep-alive + 可选 COPAW_DEEPSEEK_CA_FILE / insecureTls）。
 *
 * `COPAW_DEEPSEEK_SCOPED_TLS=0` 时恢复旧行为：全局 fetch patch（兼容非 DeepSeek 上游也需跳 TLS 的场景）。
 */
import {
  Agent,
  EnvHttpProxyAgent,
  getGlobalDispatcher,
  setGlobalDispatcher,
} from 'undici'

const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
]

let dispatcherInstalled = false
let fetchPatched = false

export function shouldInstallInsecureTls() {
  return (
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
    process.env.COPAW_INSECURE_TLS === '1'
  )
}

/** Default true: TLS relax only on chat.deepseek.com via deepseek-web-client. */
export function shouldUseScopedDeepSeekTls() {
  const v = process.env.COPAW_DEEPSEEK_SCOPED_TLS
  if (v === '0' || v === 'false') return false
  return true
}

export function hasForwardProxyEnv() {
  return PROXY_ENV_KEYS.some((k) => Boolean(process.env[k]?.trim()))
}

/** @returns {boolean} whether dispatcher was installed */
export function installInsecureTlsDispatcher() {
  if (!shouldInstallInsecureTls()) return false
  if (dispatcherInstalled) return true
  const tlsConnect = { rejectUnauthorized: false }
  try {
    if (hasForwardProxyEnv()) {
      setGlobalDispatcher(
        new EnvHttpProxyAgent({
          requestTls: tlsConnect,
          proxyTls: tlsConnect,
        }),
      )
      console.warn(
        '[copaw-zero-token-shim] TLS verification disabled (EnvHttpProxyAgent; forward proxy env detected)',
      )
    } else {
      setGlobalDispatcher(new Agent({ connect: tlsConnect }))
      console.warn(
        '[copaw-zero-token-shim] TLS verification disabled via undici setGlobalDispatcher',
      )
    }
    dispatcherInstalled = true
    return true
  } catch (err) {
    console.warn(
      '[copaw-zero-token-shim] failed to disable TLS verify:',
      (err && err.message) || err,
    )
    return false
  }
}

/** Patch global fetch so Node native fetch always uses the insecure dispatcher. */
export function patchGlobalFetchForInsecureTls() {
  if (!shouldInstallInsecureTls() || fetchPatched) return false
  if (!installInsecureTlsDispatcher()) return false
  try {
    const dispatcher = getGlobalDispatcher()
    const originalFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = function patchedInsecureFetch(input, init) {
      const next = init ? { ...init } : {}
      if (next.dispatcher === undefined) {
        next.dispatcher = dispatcher
      }
      return originalFetch(input, next)
    }
    fetchPatched = true
    console.warn(
      '[copaw-zero-token-shim] global fetch patched to use insecure TLS dispatcher',
    )
    return true
  } catch (err) {
    console.warn(
      '[copaw-zero-token-shim] failed to patch global fetch:',
      (err && err.message) || err,
    )
    return false
  }
}

if (shouldInstallInsecureTls()) {
  if (shouldUseScopedDeepSeekTls()) {
    console.warn(
      '[copaw-zero-token-shim] scoped DeepSeek TLS enabled (chat.deepseek.com only); global fetch not patched. Set COPAW_DEEPSEEK_SCOPED_TLS=0 for legacy global patch.',
    )
  } else {
    patchGlobalFetchForInsecureTls()
  }
}
