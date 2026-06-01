/**
 * Sidecar 内嵌 TLS shim（须 static import 进 Bun compile，禁止 runtime 读 ../../src）。
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

export function shouldUseScopedDeepSeekTls() {
  const v = process.env.COPAW_DEEPSEEK_SCOPED_TLS
  if (v === '0' || v === 'false') return false
  return true
}

export function hasForwardProxyEnv() {
  return PROXY_ENV_KEYS.some((k) => Boolean(process.env[k]?.trim()))
}

export function installInsecureTlsDispatcher(): boolean {
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
    } else {
      setGlobalDispatcher(new Agent({ connect: tlsConnect }))
    }
    dispatcherInstalled = true
    return true
  } catch {
    return false
  }
}

export function patchGlobalFetchForInsecureTls(): boolean {
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
    return true
  } catch {
    return false
  }
}

export function bootstrapGatewayTlsShim(): void {
  if (!shouldInstallInsecureTls()) return
  if (shouldUseScopedDeepSeekTls()) return
  patchGlobalFetchForInsecureTls()
}

bootstrapGatewayTlsShim()
