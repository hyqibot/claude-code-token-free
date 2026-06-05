import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'

export type WebauthBackend = 'ts' | 'python'

const DEFAULT_WEBAUTH_BACKEND: WebauthBackend = 'ts'

function getCcHahaSettingsPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(configDir, 'cc-haha', 'settings.json')
}

/** env（CC_HAHA_* / COPAW_*）优先，其次 ~/.claude/cc-haha/settings.json，默认 ts。 */
export function readWebauthBackend(): WebauthBackend {
  const env =
    process.env.CC_HAHA_ZERO_TOKEN_WEBAUTH_BACKEND?.trim().toLowerCase() ||
    process.env.COPAW_ZERO_TOKEN_WEBAUTH_BACKEND?.trim().toLowerCase()
  if (env === 'python') return 'python'
  if (env === 'ts') return 'ts'

  try {
    const raw = readFileSync(getCcHahaSettingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as { webauthBackend?: unknown }
    if (parsed.webauthBackend === 'python') return 'python'
    if (parsed.webauthBackend === 'ts') return 'ts'
  } catch {
    // fresh or missing settings
  }

  return DEFAULT_WEBAUTH_BACKEND
}

export { getCcHahaSettingsPath }
