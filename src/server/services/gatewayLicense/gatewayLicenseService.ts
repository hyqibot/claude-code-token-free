import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ApiError } from '../../middleware/errorHandler.js'
import { getCcHahaSettingsPath } from '../zeroTokenWebauthBackend.js'
import { readGatewayLicenseClientConfig } from './config.js'
import { getGatewayDeviceId } from './deviceId.js'
import {
  remoteActivate,
  remoteLogout,
  remoteSessionStatus,
} from './remoteClient.js'
import {
  buildGatewayLicenseSpawnEnv,
  clearGatewayLicenseSeal,
  readGatewayLicenseSeal,
} from './gatewaySeal.js'

export type GatewayLicenseStatus = {
  required: boolean
  verified: boolean
  activationCodeMasked: string | null
  /** 本地保存的完整激活码（用户本机），用于设置页自动回填与静默重激活 */
  activationCode: string | null
  endtime: string | null
  remark: string | null
  lastError: string | null
}

type PersistedClientSession = {
  sessionToken: string
  endtime: string
  activationCodeMasked: string
  /** 完整激活码，便于 license-server 重启后自动重激活 */
  activationCode?: string
  remark: string | null
  verifiedAt: number
}

let active: PersistedClientSession | null = null
let lastError: string | null = null
let onLicenseInvalidated: ((reason: string) => Promise<void>) | null = null

function sessionPath(): string {
  return join(dirname(getCcHahaSettingsPath()), 'gateway-license-session.json')
}

function loadPersisted(): PersistedClientSession | null {
  const paths = [
    sessionPath(),
    join(dirname(getCcHahaSettingsPath()), 'ruike-license-session.json'),
  ]
  for (const path of paths) {
    try {
      const raw = readFileSync(path, 'utf8')
      const parsed = JSON.parse(raw) as PersistedClientSession & {
        cardKeyMasked?: string
      }
      if (!parsed.sessionToken) continue
      if (!parsed.activationCodeMasked && parsed.cardKeyMasked) {
        parsed.activationCodeMasked = parsed.cardKeyMasked
      }
      return parsed
    } catch {
      // try next path
    }
  }
  return null
}

function savePersisted(session: PersistedClientSession | null): void {
  const path = sessionPath()
  if (!session) {
    try {
      unlinkSync(path)
    } catch {
      // ignore
    }
    clearGatewayLicenseSeal()
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(session, null, 2), 'utf8')
}

function buildLicenseStatus(): GatewayLicenseStatus {
  const configured = readGatewayLicenseClientConfig() !== null
  const persisted = loadPersisted()
  const session = active ?? persisted
  if (!configured) {
    return {
      required: true,
      verified: false,
      activationCodeMasked: null,
      activationCode: null,
      endtime: null,
      remark: null,
      lastError: lastError ?? '未配置 license.serverUrl',
    }
  }
  return {
    required: true,
    verified: active !== null,
    activationCodeMasked: active?.activationCodeMasked ?? persisted?.activationCodeMasked ?? null,
    activationCode: session?.activationCode?.trim() || null,
    endtime: active?.endtime ?? persisted?.endtime ?? null,
    remark: active?.remark ?? persisted?.remark ?? null,
    lastError,
  }
}

export function registerGatewayLicenseInvalidatedHandler(
  handler: (reason: string) => Promise<void>,
): void {
  onLicenseInvalidated = handler
}

export function getGatewayLicenseStatus(): GatewayLicenseStatus {
  return buildLicenseStatus()
}

async function invalidate(reason: string, clearSavedCode = true): Promise<void> {
  lastError = reason
  active = null
  if (clearSavedCode) {
    savePersisted(null)
  }
  if (onLicenseInvalidated) {
    try {
      await onLicenseInvalidated(reason)
    } catch (err) {
      console.error('[GatewayLicense] invalidation handler failed:', err)
    }
  }
}

type RemoteSessionCheck = 'valid' | 'invalid' | 'unreachable'

async function checkRemoteSession(session: PersistedClientSession): Promise<RemoteSessionCheck> {
  const cfg = readGatewayLicenseClientConfig()
  if (!cfg) return 'invalid'
  const remote = await remoteSessionStatus(cfg, session.sessionToken)
  if (remote.networkError) {
    return 'unreachable'
  }
  if (!remote.valid) {
    return 'invalid'
  }
  return 'valid'
}

async function establishFromActivate(activationCode: string): Promise<PersistedClientSession> {
  const cfg = readGatewayLicenseClientConfig()
  if (!cfg) {
    throw new ApiError(
      400,
      '未配置网关授权服务：请在 ~/.claude/cc-haha/settings.json 设置 license.serverUrl',
      'LICENSE_NOT_CONFIGURED',
    )
  }

  const trimmed = activationCode.trim()
  const deviceId = await getGatewayDeviceId()
  const result = await remoteActivate(cfg, trimmed, deviceId)

  const session: PersistedClientSession = {
    sessionToken: result.sessionToken,
    endtime: result.endtime,
    activationCodeMasked: result.activationCodeMasked,
    activationCode: trimmed,
    remark: result.remark,
    verifiedAt: Date.now(),
  }
  active = session
  savePersisted(session)
  lastError = null
  return session
}

/** license-server 内存会话丢失或过期时，用本地保存的激活码静默重激活 */
async function reactivateWithSavedCode(session: PersistedClientSession): Promise<boolean> {
  const code = session.activationCode?.trim()
  if (!code) return false
  try {
    await establishFromActivate(code)
    console.log('[GatewayLicense] reactivated with saved activation code')
    return true
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    console.warn('[GatewayLicense] reactivate failed:', lastError)
    return false
  }
}

type EnsureLicenseResult = 'ok' | 'missing' | 'invalid' | 'unreachable'

/**
 * 启动网关前必须经 license-server 在线校验。
 * - 远程有效 → ok
 * - 远程不可达 → unreachable（禁止启动，不信任本地会话）
 * - 远程无效 → 用本地激活码重激活（须能连上 license-server）；失败 → invalid
 */
async function ensureGatewayLicenseForStart(): Promise<EnsureLicenseResult> {
  if (!readGatewayLicenseClientConfig()) return 'missing'

  const session = active ?? loadPersisted()
  if (!session) return 'missing'

  active = session
  const check = await checkRemoteSession(session)
  if (check === 'valid') return 'ok'

  if (check === 'unreachable') {
    active = null
    lastError = '无法连接网关授权服务，请检查 license.serverUrl 与网络后重试。'
    return 'unreachable'
  }

  if (await reactivateWithSavedCode(session)) {
    return 'ok'
  }

  await invalidate('授权会话无效，且无法使用已保存激活码重新激活', false)
  return 'invalid'
}

export async function activateGatewayLicense(activationCode: string): Promise<GatewayLicenseStatus> {
  const trimmed = activationCode.trim()
  if (!trimmed) {
    throw ApiError.badRequest('激活码不能为空')
  }

  if (active) {
    const cfg = readGatewayLicenseClientConfig()
    if (cfg) {
      await remoteLogout(cfg, active.sessionToken).catch(() => undefined)
    }
  }

  await establishFromActivate(trimmed)
  return getGatewayLicenseStatus()
}

export async function logoutGatewayLicense(): Promise<GatewayLicenseStatus> {
  if (active) {
    const cfg = readGatewayLicenseClientConfig()
    if (cfg) await remoteLogout(cfg, active.sessionToken).catch(() => undefined)
  }
  active = null
  savePersisted(null)
  lastError = null
  return getGatewayLicenseStatus()
}

export async function assertGatewayLicenseForGateway(): Promise<void> {
  if (!readGatewayLicenseClientConfig()) {
    throw new ApiError(
      403,
      'Zero-Token 网关需要配置 license.serverUrl。请在 ~/.claude/cc-haha/settings.json 中设置授权服务地址。',
      'LICENSE_SERVER_REQUIRED',
    )
  }

  const result = await ensureGatewayLicenseForStart()
  if (result === 'ok') return

  if (result === 'unreachable') {
    throw new ApiError(
      503,
      '无法连接网关授权服务，请检查 license.serverUrl 与网络后重试。',
      'LICENSE_SERVER_UNREACHABLE',
    )
  }

  throw new ApiError(
    403,
    '启动 Zero-Token 网关前需完成激活。请在设置 → 服务商 → Zero-Token 网关中输入激活码并点击「激活」。',
    'LICENSE_REQUIRED',
  )
}

export function getActiveGatewayLicenseSessionToken(): string | null {
  return active?.sessionToken ?? readGatewayLicenseSeal()?.sessionToken ?? null
}

export function getGatewayLicenseSpawnEnv(): Record<string, string> {
  const token = getActiveGatewayLicenseSessionToken()
  if (!token) return { CC_HAHA_REQUIRE_GATEWAY_LICENSE: '1' }
  return buildGatewayLicenseSpawnEnv(token)
}

export async function resumeGatewayLicenseIfConfigured(): Promise<void> {
  try {
    if (!readGatewayLicenseClientConfig() || active) return
    const persisted = loadPersisted()
    if (!persisted) return
    active = persisted

    const check = await checkRemoteSession(persisted)
    if (check === 'valid') {
      console.log('[GatewayLicense] resumed client session')
      return
    }
    if (check === 'unreachable') {
      active = null
      lastError = '无法连接网关授权服务，请检查 license.serverUrl 与网络后重试。'
      console.warn('[GatewayLicense] license server unreachable; gateway start blocked until online')
      return
    }

    if (await reactivateWithSavedCode(persisted)) {
      console.log('[GatewayLicense] resumed via saved activation code')
      return
    }

    active = null
    lastError = '授权会话无效，请重新激活'
  } catch (error) {
    active = null
    console.error(
      '[GatewayLicense] resume failed:',
      error instanceof Error ? error.message : error,
    )
  }
}
