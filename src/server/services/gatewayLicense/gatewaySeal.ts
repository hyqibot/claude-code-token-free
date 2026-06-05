import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { getCcHahaSettingsPath } from '../zeroTokenWebauthBackend.js'

const SEAL_TTL_MS = 24 * 60 * 60 * 1000

function sealPath(): string {
  return join(dirname(getCcHahaSettingsPath()), 'gateway-license-seal.json')
}

export type GatewayLicenseSeal = {
  seal: string
  expiresAt: number
  sessionToken: string
}

export function writeGatewayLicenseSeal(sessionToken: string): string {
  const seal = randomBytes(32).toString('hex')
  const payload: GatewayLicenseSeal = {
    seal,
    expiresAt: Date.now() + SEAL_TTL_MS,
    sessionToken,
  }
  const path = sealPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(payload), 'utf8')
  return path
}

export function clearGatewayLicenseSeal(): void {
  try {
    unlinkSync(sealPath())
  } catch {
    // ignore
  }
}

export function readGatewayLicenseSeal(): GatewayLicenseSeal | null {
  try {
    const raw = readFileSync(sealPath(), 'utf8')
    const parsed = JSON.parse(raw) as GatewayLicenseSeal
    if (!parsed.seal || !parsed.sessionToken || typeof parsed.expiresAt !== 'number') {
      return null
    }
    if (Date.now() > parsed.expiresAt) return null
    return parsed
  } catch {
    return null
  }
}

export function buildGatewayLicenseSpawnEnv(sessionToken: string): Record<string, string> {
  const sealFile = writeGatewayLicenseSeal(sessionToken)
  return {
    CC_HAHA_REQUIRE_GATEWAY_LICENSE: '1',
    CC_HAHA_GATEWAY_LICENSE_SEAL_FILE: sealFile,
  }
}
