const ENV_BASE_URL =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env?.VITE_DESKTOP_SERVER_URL === 'string' &&
  import.meta.env.VITE_DESKTOP_SERVER_URL.length > 0
    ? import.meta.env.VITE_DESKTOP_SERVER_URL
    : undefined

const DEFAULT_BASE_URL = ENV_BASE_URL || 'http://127.0.0.1:3456'

let baseUrl = DEFAULT_BASE_URL
const DIAGNOSTICS_PATH = '/api/diagnostics/events'

/** 与 CoPaw `getApiUrl` 类似：`baseUrl` + 以 `/` 开头的 path，避免双斜杠/漏斜杠。仅用于桌面 → cc-haha 服务端（3456），不涉及 Zero-Token 网关 3002。 */
export function buildDesktopApiUrl(path: string): string {
  const base = baseUrl.replace(/\/$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

function getErrorMessage(status: number, body: unknown) {
  if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
    return body.message
  }

  if (typeof body === 'string' && body.trim().length > 0) {
    return body
  }

  return `API error ${status}`
}

export function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/$/, '')
}

export function getBaseUrl() {
  return baseUrl
}

export function getDefaultBaseUrl() {
  return DEFAULT_BASE_URL
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(getErrorMessage(status, body))
    this.name = 'ApiError'
  }
}

async function request<T>(method: string, path: string, body?: unknown, options?: { timeout?: number }): Promise<T> {
  const url = buildDesktopApiUrl(path)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const controller = new AbortController()
  const timeoutMs = options?.timeout ?? 30_000
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeout)

    if (!res.ok) {
      const errorBody = await res.json().catch(() => res.text())
      throw new ApiError(res.status, errorBody)
    }

    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  } catch (err) {
    clearTimeout(timeout)
    if (controller.signal.aborted) {
      const timeoutError = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
      reportDesktopApiRequestFailure(method, path, timeoutError)
      throw timeoutError
    }
    reportDesktopApiRequestFailure(method, path, err)
    throw err
  }
}

/** 供 `streamZeroTokenAuthorize` 等非 `api.*` 路径复用，与 CoPaw `request()` 集中处理失败同一思路 */
export function reportDesktopApiRequestFailure(method: string, path: string, error: unknown) {
  if (path.startsWith('/api/diagnostics')) return

  const details: Record<string, unknown> = {
    method,
    path,
    errorName: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  }

  if (error instanceof ApiError) {
    details.status = error.status
    details.response = error.body
  }

  void rawRecordDiagnosticEvent({
    type: 'client_api_request_failed',
    severity: 'warn',
    summary: `${method} ${path} failed: ${details.message}`,
    details,
  })
}

export function rawRecordDiagnosticEvent(event: {
  type: string
  severity?: 'debug' | 'info' | 'warn' | 'error'
  summary: string
  sessionId?: string
  details?: unknown
}) {
  return fetch(buildDesktopApiUrl(DIAGNOSTICS_PATH), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  }).catch(() => undefined)
}

export const api = {
  get: <T>(path: string, options?: { timeout?: number }) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: { timeout?: number }) => request<T>('POST', path, body, options),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
