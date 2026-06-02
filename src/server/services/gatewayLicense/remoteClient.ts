import type { GatewayLicenseClientConfig } from './config.js'

export type ActivateResponse = {
  sessionToken: string
  endtime: string
  activationCodeMasked: string
  remark: string | null
}

export type SessionResponse = {
  valid: boolean
  activationCodeMasked: string | null
  endtime: string | null
  remark: string | null
  /** fetch 失败（连不上 license-server），与「会话无效」不同 */
  networkError?: boolean
}

function buildHeaders(cfg: GatewayLicenseClientConfig, sessionToken?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cfg.apiSecret) {
    headers.Authorization = `Bearer ${cfg.apiSecret}`
  }
  if (sessionToken) {
    headers['X-Session-Token'] = sessionToken
  }
  return headers
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string }
    return body.message || `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

export async function remoteActivate(
  cfg: GatewayLicenseClientConfig,
  activationCode: string,
  deviceId: string,
): Promise<ActivateResponse> {
  const res = await fetch(`${cfg.serverUrl}/v1/activate`, {
    method: 'POST',
    headers: buildHeaders(cfg),
    body: JSON.stringify({ activationCode, deviceId }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return (await res.json()) as ActivateResponse
}

export async function remoteSessionStatus(
  cfg: GatewayLicenseClientConfig,
  sessionToken: string,
): Promise<SessionResponse> {
  const empty = {
    valid: false,
    activationCodeMasked: null,
    endtime: null,
    remark: null,
  } satisfies SessionResponse

  try {
    const res = await fetch(`${cfg.serverUrl}/v1/session`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      return empty
    }
    return (await res.json()) as SessionResponse
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.warn(`[GatewayLicense] remoteSessionStatus failed: ${msg}`)
    return { ...empty, networkError: true }
  }
}

export async function remoteLogout(cfg: GatewayLicenseClientConfig, sessionToken: string): Promise<void> {
  await fetch(`${cfg.serverUrl}/v1/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {})
}
