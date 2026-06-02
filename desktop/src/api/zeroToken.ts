import type { ZeroTokenCanonicalModelId } from '../constants/zeroTokenWebModels'
import { api, buildDesktopApiUrl, reportDesktopApiRequestFailure, ApiError } from './client'

const AUTHORIZE_STREAM_PATH = '/api/zero-token/authorize'
const AUTHORIZE_STREAM_TIMEOUT_MS = 300_000

export type ZeroTokenWebModel = { id: string; onboardMode: string }

export type ZeroTokenStatus = {
  listening: boolean
  pid: number | null
  host: string | null
  port: number | null
  raw: string
}

export type DeepseekToolMode = 'dsml' | 'xml'

export type GatewayLicenseStatus = {
  required: boolean
  verified: boolean
  activationCodeMasked: string | null
  activationCode: string | null
  endtime: string | null
  remark: string | null
  lastError: string | null
}

/** @deprecated use GatewayLicenseStatus */

export type ZeroTokenAuthorizeResult = {
  modelId: string
  ensure: { output: string; result: unknown }
  onboard: { mode: string; output: string }
}

/** 与 `/api/zero-token/authorize-stream` NDJSON 事件对齐 */
export type ZeroTokenStreamEvent =
  | { type: 'phase'; phase: 'ensure' | 'onboard' | 'keepalive' }
  | { type: 'line'; text: string }
  | { type: 'complete'; result: ZeroTokenAuthorizeResult }
  | { type: 'error'; message: string; code?: string }

/**
 * 流式一键授权：实时推送 ensure/onboard 子进程输出（与 CoPaw 控制台类似）。
 * 成功时在流末尾收到 `complete`；失败收到 `error` 或抛出。
 */
export async function streamZeroTokenAuthorize(
  modelId: ZeroTokenCanonicalModelId,
  onEvent: (e: ZeroTokenStreamEvent) => void,
  options?: { signal?: AbortSignal },
): Promise<void> {
  /** 与 JSON 授权同一路径；凭 Accept 区分流式（避免仅实现了 authorize 的旧服务端对 authorize-stream 返回 405） */
  const url = buildDesktopApiUrl(AUTHORIZE_STREAM_PATH)

  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), AUTHORIZE_STREAM_TIMEOUT_MS)
  const upstream = options?.signal
  if (upstream) {
    if (upstream.aborted) controller.abort()
    else upstream.addEventListener('abort', () => controller.abort(), { once: true })
  }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify({ modelId }),
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    clearTimeout(tid)
    reportDesktopApiRequestFailure('POST', AUTHORIZE_STREAM_PATH, err)
    throw err
  }
  clearTimeout(tid)

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const apiErr = new ApiError(res.status, body)
    reportDesktopApiRequestFailure('POST', AUTHORIZE_STREAM_PATH, apiErr)
    throw apiErr
  }

  const reader = res.body?.getReader()
  if (!reader) {
    const err = new Error('No response body')
    reportDesktopApiRequestFailure('POST', AUTHORIZE_STREAM_PATH, err)
    throw err
  }

  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let sawComplete = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const evt = JSON.parse(trimmed) as ZeroTokenStreamEvent
        onEvent(evt)
        if (evt.type === 'complete') sawComplete = true
        if (evt.type === 'error') {
          throw new Error(evt.message)
        }
      }
    }
    const tail = buffer.trim()
    if (tail) {
      const evt = JSON.parse(tail) as ZeroTokenStreamEvent
      onEvent(evt)
      if (evt.type === 'complete') sawComplete = true
      if (evt.type === 'error') {
        throw new Error(evt.message)
      }
    }
  } catch (err) {
    reportDesktopApiRequestFailure('POST', AUTHORIZE_STREAM_PATH, err)
    throw err
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }

  if (!sawComplete) {
    const err = new Error('Authorize stream ended without completion')
    reportDesktopApiRequestFailure('POST', AUTHORIZE_STREAM_PATH, err)
    throw err
  }
}

export const zeroTokenApi = {
  status: () =>
    api.get<{
      status: ZeroTokenStatus
      webModels: ZeroTokenWebModel[]
      deepseekToolMode: DeepseekToolMode
      license: GatewayLicenseStatus
    }>('/api/zero-token/status'),
  licenseStatus: () =>
    api.get<{ license: GatewayLicenseStatus }>('/api/zero-token/license-status'),
  activate: (activationCode: string) =>
    api.post<{ license: GatewayLicenseStatus }>('/api/zero-token/activate', { activationCode }),
  verifyLicense: (activationCode: string) =>
    api.post<{ license: GatewayLicenseStatus }>('/api/zero-token/activate', { activationCode }),
  logoutLicense: () =>
    api.post<{ license: GatewayLicenseStatus }>('/api/zero-token/logout-license', {}),
  setDeepseekToolMode: (mode: DeepseekToolMode) =>
    api.put<{ deepseekToolMode: DeepseekToolMode; restartRequired: boolean }>(
      '/api/zero-token/deepseek-tool-mode',
      { mode },
    ),
  cdpStatus: () =>
    api.get<{
      ok: boolean
      url: string
      status: number | null
      wsUrl: string | null
      bodyPreview: string
      error?: string
    }>('/api/zero-token/cdp-status'),
  start: (port?: number) => api.post<{ status: ZeroTokenStatus }>('/api/zero-token/start', port ? { port } : {}),
  stop: () => api.post<{ status: ZeroTokenStatus }>('/api/zero-token/stop', {}),
  stopKeepalive: () => api.post<{ ok: boolean }>('/api/zero-token/stop-keepalive', {}),
  authorize: (modelId: ZeroTokenCanonicalModelId) =>
    api.post<ZeroTokenAuthorizeResult>('/api/zero-token/authorize', { modelId }, { timeout: 300_000 }),
}
