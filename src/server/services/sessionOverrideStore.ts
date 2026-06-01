import * as fs from 'fs/promises'
import * as path from 'path'
import { homedir } from 'os'
import { readRecoverableJsonFile } from './recoverableJsonFile.js'

/**
 * 把"会话级 runtime override（用户在桌面端选的 provider/model）"持久化到
 * `~/.claude/cc-haha/session-overrides.json`，让 server 重启 / 客户端重连时不丢。
 *
 * 没这层持久化时：用户在桌面端切到 Zero-Token，重启 server 后 in-memory
 * `runtimeOverrides` 清空，桌面端如果没及时重发 `set_runtime_config` 就发了
 * `user_message`，CLI spawn 会 fallback 到 `providers.json` 的 activeId（很可能是 null
 * 即官方），ANTHROPIC_BASE_URL 不被注入，CLI 直接打 `api.anthropic.com`，在 MITM
 * 代理下报 "unknown certificate verification error"。
 *
 * 带 schemaVersion 是为了走 cc-haha 持久化升级闸门：未来字段变更可在 normalizeFile
 * 里做 forward migration。任何 IO 错误均只 warn 不抛，避免阻塞会话主路径。
 */

const CURRENT_SCHEMA_VERSION = 1

export type SessionRuntimeOverride = {
  providerId: string | null
  modelId: string
}

type SessionOverridesFile = {
  schemaVersion: number
  overrides: Record<string, SessionRuntimeOverride>
}

const DEFAULT_FILE: SessionOverridesFile = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  overrides: {},
}

function isSessionRuntimeOverride(value: unknown): value is SessionRuntimeOverride {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const providerOk = v.providerId === null || typeof v.providerId === 'string'
  const modelOk = typeof v.modelId === 'string' && v.modelId.length > 0
  return providerOk && modelOk
}

export function normalizeSessionOverridesFile(value: unknown): SessionOverridesFile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const overridesRaw = raw.overrides
  const result: Record<string, SessionRuntimeOverride> = {}
  if (overridesRaw && typeof overridesRaw === 'object' && !Array.isArray(overridesRaw)) {
    for (const [key, val] of Object.entries(overridesRaw as Record<string, unknown>)) {
      if (typeof key !== 'string' || key.length === 0) continue
      if (!isSessionRuntimeOverride(val)) continue
      result[key] = { providerId: val.providerId, modelId: val.modelId }
    }
  }
  return { schemaVersion: CURRENT_SCHEMA_VERSION, overrides: result }
}

export class SessionOverrideStore {
  private readonly filePath: string
  private cache: Record<string, SessionRuntimeOverride> = {}
  private loaded = false
  private writeChain: Promise<void> = Promise.resolve()

  constructor(baseDir?: string) {
    const dir = baseDir ?? path.join(homedir(), '.claude', 'cc-haha')
    this.filePath = path.join(dir, 'session-overrides.json')
  }

  getFilePath(): string {
    return this.filePath
  }

  /** 一次性加载持久化内容到内存。重复调用是 idempotent。 */
  async loadAll(): Promise<Record<string, SessionRuntimeOverride>> {
    if (!this.loaded) {
      const data = await readRecoverableJsonFile<SessionOverridesFile>({
        filePath: this.filePath,
        label: 'session overrides',
        defaultValue: DEFAULT_FILE,
        normalize: normalizeSessionOverridesFile,
      })
      this.cache = { ...data.overrides }
      this.loaded = true
    }
    return { ...this.cache }
  }

  /** 异步排队持久化；不阻塞调用方，IO 错误仅 warn。 */
  set(sessionId: string, override: SessionRuntimeOverride): void {
    if (!sessionId) return
    this.cache[sessionId] = { providerId: override.providerId, modelId: override.modelId }
    this.queueFlush()
  }

  delete(sessionId: string): void {
    if (!sessionId || !(sessionId in this.cache)) return
    delete this.cache[sessionId]
    this.queueFlush()
  }

  /** 等持久化队列排空，主要给测试用。 */
  async waitForPendingWrites(): Promise<void> {
    await this.writeChain.catch(() => undefined)
  }

  private queueFlush(): void {
    const snapshot: SessionOverridesFile = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      overrides: { ...this.cache },
    }
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => this.writeFile(snapshot))
  }

  private async writeFile(data: SessionOverridesFile): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      console.warn(
        `[SessionOverrideStore] failed to persist ${this.filePath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }
}

/** 默认实例（指向 `~/.claude/cc-haha/session-overrides.json`）。 */
export const sessionOverrideStore = new SessionOverrideStore()
