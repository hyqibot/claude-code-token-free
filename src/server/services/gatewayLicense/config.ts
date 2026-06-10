import { readFileSync } from 'node:fs'
import { getCcHahaSettingsPath } from '../zeroTokenWebauthBackend.js'

export type GatewayLicenseClientConfig = {
  serverUrl: string
  apiSecret: string
}

export function readGatewayLicenseClientConfig(): GatewayLicenseClientConfig | null {
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(readFileSync(getCcHahaSettingsPath(), 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }

  const raw = parsed.license
  if (!raw || typeof raw !== 'object') return null
  const cfg = raw as Record<string, unknown>

  const serverUrl = typeof cfg.serverUrl === 'string' ? cfg.serverUrl.trim().replace(/\/+$/, '') : ''
  if (!serverUrl) return null

  const apiSecret =
    typeof cfg.apiSecret === 'string'
      ? cfg.apiSecret.trim()
      : process.env.CC_HAHA_LICENSE_API_SECRET?.trim() ?? ''

  return { serverUrl, apiSecret }
}

/** Zero-Token 网关始终需要授权服务（无跳过开关）。 */
export function isGatewayLicenseRequired(): boolean {
  return true
}
