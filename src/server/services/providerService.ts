/**
 * Provider Service — preset-based provider configuration
 *
 * Storage: ~/.claude/cc-haha/providers.json (lightweight index)
 * Active provider env vars written to ~/.claude/cc-haha/settings.json
 * (isolated from the original Claude Code's ~/.claude/settings.json)
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ApiError } from '../middleware/errorHandler.js'
import { normalizeJsonObject, readRecoverableJsonFile } from './recoverableJsonFile.js'
import { anthropicToOpenaiChat } from '../proxy/transform/anthropicToOpenaiChat.js'
import { anthropicToOpenaiResponses } from '../proxy/transform/anthropicToOpenaiResponses.js'
import { openaiChatToAnthropic } from '../proxy/transform/openaiChatToAnthropic.js'
import { openaiResponsesToAnthropic } from '../proxy/transform/openaiResponsesToAnthropic.js'
import type { AnthropicRequest, AnthropicResponse } from '../proxy/transform/types.js'
import { PROVIDER_PRESETS } from '../config/providerPresets.js'
import { getZeroTokenGatewayHttpBase } from './zeroTokenService.js'
import { MODEL_CONTEXT_WINDOWS_ENV_KEY } from '../../utils/model/modelContextWindows.js'
import {
  CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
  ensurePersistentStorageUpgraded,
} from './persistentStorageMigrations.js'
import type {
  SavedProvider,
  ProvidersIndex,
  CreateProviderInput,
  UpdateProviderInput,
  TestProviderInput,
  ProviderTestResult,
  ProviderTestStepResult,
  ProviderSlotTestResult,
  ModelMapping,
  ApiFormat,
  ProviderAuthStrategy,
} from '../types/provider.js'

const MANAGED_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  MODEL_CONTEXT_WINDOWS_ENV_KEY,
] as const

const CUSTOM_PROVIDER_MODEL_CAPABILITIES = 'thinking,effort,adaptive_thinking,max_effort'

const DEFAULT_INDEX: ProvidersIndex = {
  schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
  activeId: null,
  providers: [],
}
const AUTH_ENV_KEYS = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isProviderModels(value: unknown): value is SavedProvider['models'] {
  return (
    isRecord(value) &&
    typeof value.main === 'string' &&
    typeof value.haiku === 'string' &&
    typeof value.sonnet === 'string' &&
    typeof value.opus === 'string'
  )
}

function isSavedProvider(value: unknown): value is SavedProvider {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.presetId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.apiKey === 'string' &&
    typeof value.baseUrl === 'string' &&
    isProviderModels(value.models)
  )
}

function normalizeProvidersIndex(value: unknown): ProvidersIndex | null {
  if (!isRecord(value) || !Array.isArray(value.providers)) {
    return null
  }

  const { activeProviderId: _legacyActiveProviderId, ...rest } = value
  const providers = value.providers.filter(isSavedProvider)
  const rawActiveId =
    typeof value.activeId === 'string'
      ? value.activeId
      : typeof _legacyActiveProviderId === 'string'
        ? _legacyActiveProviderId
        : null
  const activeId = rawActiveId && providers.some((provider) => provider.id === rawActiveId)
    ? rawActiveId
    : null

  return {
    ...rest,
    schemaVersion: CURRENT_PROVIDER_INDEX_SCHEMA_VERSION,
    activeId,
    providers,
  }
}

function getPresetDefaultEnv(presetId: string): Record<string, string> {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.defaultEnv ?? {}
}

function omitAuthEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !AUTH_ENV_KEYS.has(key.toUpperCase())),
  )
}

function getPresetAuthStrategy(presetId: string): ProviderAuthStrategy {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.authStrategy ?? 'auth_token'
}

function getPresetModelContextWindows(presetId: string): Record<string, number> {
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId)?.modelContextWindows ?? {}
}

/** CoPaw zero-token 网关提供 Anthropic `/v1/messages`；该预设固定 anthropic，CLI 直连网关，不经 3456 翻译代理。 */
function normalizeApiFormatForPreset(presetId: string, fmt: ApiFormat): ApiFormat {
  if (presetId === 'zero-token-web') return 'anthropic'
  return fmt
}

function effectiveApiFormat(provider: SavedProvider): ApiFormat {
  return normalizeApiFormatForPreset(provider.presetId, provider.apiFormat ?? 'anthropic')
}

/** 是否与 cc-haha-main 一致地走 `127.0.0.1:<port>/proxy` 翻译层（apiFormat 未设置则不走）。Zero-Token 永远直连网关。 */
function managedProviderNeedsCcHahaProxy(provider: SavedProvider): boolean {
  if (provider.presetId === 'zero-token-web') return false
  return provider.apiFormat != null && provider.apiFormat !== 'anthropic'
}

/** 列表/详情 API 返回与 effective 一致的 apiFormat（例如旧库里的 zero-token + openai_chat）。 */
function withEffectiveApiFormat(provider: SavedProvider): SavedProvider {
  const f = effectiveApiFormat(provider)
  return f === provider.apiFormat ? provider : { ...provider, apiFormat: f }
}

/** CoPaw `/v1/messages` 常为 SSE；连通性测试不解析整段流，只辨认 Anthropic 事件形态。 */
function validateAnthropicSseConnectivity(bodyText: string): { ok: true } | { ok: false; error: string } {
  const t = bodyText.trim()
  if (!t) return { ok: false, error: 'Empty streaming response' }
  if (t.includes('"type":"error"') || t.includes('invalid_request_error')) {
    return { ok: false, error: 'Upstream error in SSE stream' }
  }
  if (t.includes('message_start') || t.includes('"type":"message_start"')) {
    return { ok: true }
  }
  return { ok: false, error: 'Not a valid Anthropic SSE stream' }
}

function buildProviderAuthEnv(
  provider: SavedProvider,
  presetDefaultEnv: Record<string, string>,
  needsProxy: boolean,
): Record<string, string> {
  if (needsProxy) {
    return { ANTHROPIC_API_KEY: 'proxy-managed' }
  }

  const strategy = provider.authStrategy ?? getPresetAuthStrategy(provider.presetId)
  const key = provider.apiKey || presetDefaultEnv.ANTHROPIC_AUTH_TOKEN || presetDefaultEnv.ANTHROPIC_API_KEY || ''

  switch (strategy) {
    case 'api_key':
      return key ? { ANTHROPIC_API_KEY: key } : {}
    case 'auth_token':
      return {
        ANTHROPIC_API_KEY: '',
        ...(key ? { ANTHROPIC_AUTH_TOKEN: key } : {}),
      }
    case 'auth_token_empty_api_key':
      return {
        ANTHROPIC_API_KEY: '',
        ...(key ? { ANTHROPIC_AUTH_TOKEN: key } : {}),
      }
    case 'dual_same_token':
      return key ? { ANTHROPIC_API_KEY: key, ANTHROPIC_AUTH_TOKEN: key } : {}
    case 'dual_dummy':
      return { ANTHROPIC_API_KEY: 'dummy', ANTHROPIC_AUTH_TOKEN: 'dummy' }
  }
}

function getManagedEnvKeys(): string[] {
  const keys = new Set<string>(MANAGED_ENV_KEYS)
  for (const preset of PROVIDER_PRESETS) {
    for (const key of Object.keys(preset.defaultEnv ?? {})) {
      keys.add(key)
    }
  }
  return [...keys]
}

export class ProviderService {
  private static serverPort = 3456

  static setServerPort(port: number): void {
    ProviderService.serverPort = port
  }

  static getServerPort(): number {
    return ProviderService.serverPort
  }
  private getConfigDir(): string {
    return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  }

  private getCcHahaDir(): string {
    return path.join(this.getConfigDir(), 'cc-haha')
  }

  private getIndexPath(): string {
    return path.join(this.getCcHahaDir(), 'providers.json')
  }

  private getSettingsPath(): string {
    return path.join(this.getCcHahaDir(), 'settings.json')
  }

  /** Zero-Token 与官方类似：内置唯一一行，禁止「添加服务商」重复创建；合并历史重复项。 */
  private async normalizeBuiltInZeroTokenProviders(index: ProvidersIndex): Promise<ProvidersIndex> {
    let mutated = false
    let providers = [...index.providers]
    let activeId = index.activeId

    const ztIndices = providers
      .map((p, i) => (p.presetId === 'zero-token-web' ? i : -1))
      .filter((i) => i >= 0)

    if (ztIndices.length > 1) {
      const keepId = providers[ztIndices[0]].id
      const dropIds = new Set(ztIndices.slice(1).map((i) => providers[i].id))
      providers = providers.filter((p) => !dropIds.has(p.id))
      if (activeId && dropIds.has(activeId)) {
        activeId = keepId
      }
      mutated = true
    }

    if (!providers.some((p) => p.presetId === 'zero-token-web')) {
      const preset = PROVIDER_PRESETS.find((p) => p.id === 'zero-token-web')
      if (preset) {
        const authStrategy = preset.authStrategy ?? getPresetAuthStrategy('zero-token-web')
        const token = preset.defaultEnv?.ANTHROPIC_AUTH_TOKEN ?? 'zero-token-local'
        providers.push({
          id: crypto.randomUUID(),
          presetId: 'zero-token-web',
          name: preset.name,
          apiKey: token,
          authStrategy,
          baseUrl: preset.baseUrl,
          apiFormat: normalizeApiFormatForPreset('zero-token-web', preset.apiFormat ?? 'anthropic'),
          models: { ...preset.defaultModels },
        })
        mutated = true
      }
    }

    if (!mutated) return index
    const next: ProvidersIndex = { ...index, providers, activeId }
    await this.writeIndex(next)
    return next
  }

  private async readIndex(): Promise<ProvidersIndex> {
    await ensurePersistentStorageUpgraded()
    const index = await readRecoverableJsonFile({
      filePath: this.getIndexPath(),
      label: 'providers index',
      defaultValue: DEFAULT_INDEX,
      normalize: normalizeProvidersIndex,
    })
    return this.normalizeBuiltInZeroTokenProviders(index)
  }

  private async writeIndex(index: ProvidersIndex): Promise<void> {
    const filePath = this.getIndexPath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const tmpFile = `${filePath}.tmp.${Date.now()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(index, null, 2) + '\n', 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write providers index: ${err}`)
    }
  }

  private async readSettings(): Promise<Record<string, unknown>> {
    await ensurePersistentStorageUpgraded()
    return readRecoverableJsonFile({
      filePath: this.getSettingsPath(),
      label: 'cc-haha managed settings',
      defaultValue: {},
      normalize: normalizeJsonObject,
    })
  }

  private async writeSettings(settings: Record<string, unknown>): Promise<void> {
    const filePath = this.getSettingsPath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })

    const tmpFile = `${filePath}.tmp.${Date.now()}`
    try {
      await fs.writeFile(tmpFile, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
      await fs.rename(tmpFile, filePath)
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {})
      throw ApiError.internal(`Failed to write settings.json: ${err}`)
    }
  }

  async getManagedSettings(): Promise<Record<string, unknown>> {
    return this.readSettings()
  }

  async updateManagedSettings(settings: Record<string, unknown>): Promise<void> {
    const current = await this.readSettings()
    await this.writeSettings(Object.assign({}, current, settings))
  }

  // --- CRUD ---

  async listProviders(): Promise<{ providers: SavedProvider[]; activeId: string | null }> {
    const index = await this.readIndex()
    return { providers: index.providers.map(withEffectiveApiFormat), activeId: index.activeId }
  }

  async getProvider(id: string): Promise<SavedProvider> {
    const index = await this.readIndex()
    const provider = index.providers.find((p) => p.id === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)
    return withEffectiveApiFormat(provider)
  }

  async addProvider(input: CreateProviderInput): Promise<SavedProvider> {
    if (input.presetId === 'zero-token-web') {
      throw ApiError.badRequest(
        'Zero-Token is built in under Settings → Providers (single row). Use the Zero-Token Gateway card and chat model picker; do not add it again here.',
      )
    }

    const index = await this.readIndex()

    const provider: SavedProvider = {
      id: crypto.randomUUID(),
      presetId: input.presetId,
      name: input.name,
      apiKey: input.apiKey,
      ...(input.authStrategy !== undefined && { authStrategy: input.authStrategy }),
      baseUrl: input.baseUrl,
      apiFormat: normalizeApiFormatForPreset(input.presetId, input.apiFormat ?? 'anthropic'),
      models: input.models,
      ...(input.autoCompactWindow !== undefined && { autoCompactWindow: input.autoCompactWindow }),
      ...(input.modelContextWindows !== undefined && { modelContextWindows: input.modelContextWindows }),
      ...(input.notes !== undefined && { notes: input.notes }),
    }

    index.providers.push(provider)
    await this.writeIndex(index)
    return provider
  }

  async updateProvider(id: string, input: UpdateProviderInput): Promise<SavedProvider> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    const existing = index.providers[idx]
    const updated: SavedProvider = {
      ...existing,
      ...(input.name !== undefined && { name: input.name }),
      ...(input.apiKey !== undefined && { apiKey: input.apiKey }),
      ...(input.authStrategy !== undefined && { authStrategy: input.authStrategy }),
      ...(input.baseUrl !== undefined && { baseUrl: input.baseUrl }),
      ...(input.apiFormat !== undefined && { apiFormat: input.apiFormat }),
      ...(input.models !== undefined && { models: input.models }),
      ...(typeof input.autoCompactWindow === 'number' && { autoCompactWindow: input.autoCompactWindow }),
      ...(input.modelContextWindows !== undefined && input.modelContextWindows !== null && { modelContextWindows: input.modelContextWindows }),
      ...(input.notes !== undefined && { notes: input.notes }),
    }
    if (input.autoCompactWindow === null) {
      delete updated.autoCompactWindow
    }
    if (input.modelContextWindows === null) {
      delete updated.modelContextWindows
    }

    updated.apiFormat = normalizeApiFormatForPreset(updated.presetId, updated.apiFormat ?? 'anthropic')

    index.providers[idx] = updated
    await this.writeIndex(index)

    if (index.activeId === id) {
      await this.syncToSettings(updated)
    }

    return updated
  }

  async deleteProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const idx = index.providers.findIndex((p) => p.id === id)
    if (idx === -1) throw ApiError.notFound(`Provider not found: ${id}`)

    if (index.providers[idx].presetId === 'zero-token-web') {
      throw ApiError.badRequest('Built-in Zero-Token provider cannot be deleted.')
    }

    if (index.activeId === id) {
      throw ApiError.conflict('Cannot delete the active provider. Switch to another provider first.')
    }

    index.providers.splice(idx, 1)
    await this.writeIndex(index)
  }

  // --- Activation ---

  async activateProvider(id: string): Promise<void> {
    const index = await this.readIndex()
    const provider = index.providers.find((p) => p.id === id)
    if (!provider) throw ApiError.notFound(`Provider not found: ${id}`)

    index.activeId = id
    await this.writeIndex(index)

    if (provider.presetId === 'official') {
      await this.clearProviderFromSettings()
    } else {
      await this.syncToSettings(provider)
    }
  }

  async activateOfficial(): Promise<void> {
    const index = await this.readIndex()
    index.activeId = null
    await this.writeIndex(index)
    await this.clearProviderFromSettings()
  }

  // --- Settings sync ---

  private buildManagedEnv(
    provider: SavedProvider,
    options?: { proxyPath?: string },
  ): Record<string, string> {
    // 与 cc-haha-main 一致：`apiFormat` 未设置时不走 3456 翻译代理（直连 baseUrl）。
    // Zero-Token 固定 Anthropic 兼容 + 直连 CoPaw 网关端口；库内若曾有错误格式，也不走代理。
    const needsProxy = managedProviderNeedsCcHahaProxy(provider)
    const proxyPath = options?.proxyPath ?? '/proxy'
    const baseUrl = needsProxy
      ? `http://127.0.0.1:${ProviderService.serverPort}${proxyPath}`
      : provider.presetId === 'zero-token-web'
        ? getZeroTokenGatewayHttpBase()
        : provider.baseUrl

    const modelContextWindows = {
      ...getPresetModelContextWindows(provider.presetId),
      ...(provider.modelContextWindows ?? {}),
    }

    const presetDefaultEnv = getPresetDefaultEnv(provider.presetId)
    const customProviderCapabilityEnv =
      provider.presetId === 'custom'
        ? {
            ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: CUSTOM_PROVIDER_MODEL_CAPABILITIES,
            ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: CUSTOM_PROVIDER_MODEL_CAPABILITIES,
            ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: CUSTOM_PROVIDER_MODEL_CAPABILITIES,
          }
        : {}

    return {
      ...omitAuthEnv(presetDefaultEnv),
      ...customProviderCapabilityEnv,
      ...(provider.autoCompactWindow !== undefined && {
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(provider.autoCompactWindow),
      }),
      ...(Object.keys(modelContextWindows).length > 0 && {
        [MODEL_CONTEXT_WINDOWS_ENV_KEY]: JSON.stringify(modelContextWindows),
      }),
      ANTHROPIC_BASE_URL: baseUrl,
      ...buildProviderAuthEnv(provider, presetDefaultEnv, needsProxy),
      ANTHROPIC_MODEL: provider.models.main,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.models.haiku,
      ANTHROPIC_DEFAULT_SONNET_MODEL: provider.models.sonnet,
      ANTHROPIC_DEFAULT_OPUS_MODEL: provider.models.opus,
    }
  }

  async getProviderRuntimeEnv(id: string): Promise<Record<string, string>> {
    const provider = await this.getProvider(id)
    return this.buildManagedEnv(provider, {
      proxyPath: `/proxy/providers/${provider.id}`,
    })
  }

  private async syncToSettings(provider: SavedProvider): Promise<void> {
    const settings = await this.readSettings()
    const existingEnv = (settings.env as Record<string, string>) || {}
    const cleanedEnv = { ...existingEnv }

    for (const key of getManagedEnvKeys()) {
      delete cleanedEnv[key]
    }

    settings.env = {
      ...cleanedEnv,
      ...this.buildManagedEnv(provider),
    }

    await this.writeSettings(settings)
  }

  private async clearProviderFromSettings(): Promise<void> {
    const settings = await this.readSettings()
    const env = (settings.env as Record<string, string>) || {}

    for (const key of getManagedEnvKeys()) {
      delete env[key]
    }

    settings.env = env
    if (Object.keys(env).length === 0) {
      delete settings.env
    }

    await this.writeSettings(settings)
  }

  // --- Auth status ---

  /**
   * Check whether any usable auth exists:
   *  1. A cc-haha provider is active → has auth
   *  2. Original ~/.claude/settings.json has ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY → has auth
   *  3. process.env already has ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN → has auth
   *  4. None of the above → needs setup
   */
  async checkAuthStatus(): Promise<{
    hasAuth: boolean
    source: 'cc-haha-provider' | 'original-settings' | 'env' | 'none'
    activeProvider?: string
  }> {
    // 1. Check cc-haha active provider
    const index = await this.readIndex()
    if (index.activeId) {
      const provider = index.providers.find(p => p.id === index.activeId)
      if (provider) {
        const presetDefaultEnv = getPresetDefaultEnv(provider.presetId)
        const needsProxy = managedProviderNeedsCcHahaProxy(provider)
        const authEnv = buildProviderAuthEnv(provider, presetDefaultEnv, needsProxy)
        if (Object.values(authEnv).some(value => value.length > 0)) {
          return { hasAuth: true, source: 'cc-haha-provider', activeProvider: provider.name }
        }
      }
    }

    // 2. Check process.env (covers .env file + inherited env)
    if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
      return { hasAuth: true, source: 'env' }
    }

    // 3. Check original ~/.claude/settings.json
    try {
      const originalPath = path.join(this.getConfigDir(), 'settings.json')
      const raw = await fs.readFile(originalPath, 'utf-8')
      const settings = JSON.parse(raw) as { env?: Record<string, string> }
      const env = settings.env ?? {}
      if (env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY) {
        return { hasAuth: true, source: 'original-settings' }
      }
    } catch {
      // File doesn't exist or invalid
    }

    return { hasAuth: false, source: 'none' }
  }

  // --- Proxy support ---

  async getProviderForProxy(providerId?: string): Promise<{
    baseUrl: string
    apiKey: string
    apiFormat: ApiFormat
    presetId: string
  } | null> {
    if (providerId) {
      const provider = await this.getProvider(providerId)
      return {
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        apiFormat: effectiveApiFormat(provider),
        presetId: provider.presetId,
      }
    }

    const index = await this.readIndex()
    if (!index.activeId) return null
    const provider = index.providers.find((p) => p.id === index.activeId)
    if (!provider) return null
    return {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      apiFormat: effectiveApiFormat(provider),
      presetId: provider.presetId,
    }
  }

  async getActiveProviderForProxy(): Promise<{
    baseUrl: string
    apiKey: string
    apiFormat: ApiFormat
    presetId: string
  } | null> {
    return this.getProviderForProxy()
  }

  // --- Test ---

  async testProvider(
    id: string,
    overrides?: {
      baseUrl?: string
      modelId?: string
      models?: ModelMapping
      apiFormat?: ApiFormat
      authStrategy?: ProviderAuthStrategy
    },
  ): Promise<ProviderTestResult> {
    const provider = await this.getProvider(id)
    const baseUrl = overrides?.baseUrl || provider.baseUrl
    const apiFormat =
      overrides?.apiFormat ?? effectiveApiFormat(provider)
    const authStrategy = overrides?.authStrategy ?? provider.authStrategy ?? getPresetAuthStrategy(provider.presetId)
    const presetDefaultEnv = getPresetDefaultEnv(provider.presetId)
    const apiKey = provider.apiKey
      || presetDefaultEnv.ANTHROPIC_AUTH_TOKEN
      || presetDefaultEnv.ANTHROPIC_API_KEY
      || (authStrategy === 'dual_dummy' ? 'dummy' : '')

    if (!baseUrl || !apiKey) {
      return { connectivity: { success: false, latencyMs: 0, error: 'Missing baseUrl or apiKey' } }
    }

    /** 仅显式传 `modelId`、未传 `models` 时走单槽位（兼容旧客户端）。 */
    if (
      typeof overrides?.modelId === 'string'
      && overrides.modelId.trim()
      && overrides.models == null
    ) {
      return this.testSingleProviderModel({
        baseUrl,
        apiKey,
        modelId: overrides.modelId.trim(),
        authStrategy,
        apiFormat,
      })
    }

    const models = overrides?.models ?? provider.models
    return this.testProviderModelSlots({
      baseUrl,
      apiKey,
      models,
      authStrategy,
      apiFormat,
    })
  }

  async testProviderConfig(input: TestProviderInput): Promise<ProviderTestResult> {
    if (input.models != null) {
      return this.testProviderModelSlots({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        models: input.models,
        authStrategy: input.authStrategy ?? 'api_key',
        apiFormat: input.apiFormat ?? 'anthropic',
      })
    }
    const modelId = String(input.modelId ?? '').trim()
    if (!modelId) {
      return { connectivity: { success: false, latencyMs: 0, error: 'Missing modelId' } }
    }
    return this.testSingleProviderModel({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      modelId,
      authStrategy: input.authStrategy ?? 'api_key',
      apiFormat: input.apiFormat ?? 'anthropic',
    })
  }

  /** 对 main / Haiku / Sonnet / Opus 中非空模型 id 各测一轮连通性（及 OpenAI 格式下的代理管线）。 */
  private async testProviderModelSlots(args: {
    baseUrl: string
    apiKey: string
    models: ModelMapping
    authStrategy: ProviderAuthStrategy
    apiFormat: ApiFormat
  }): Promise<ProviderTestResult> {
    const order = ['main', 'haiku', 'sonnet', 'opus'] as const
    const slots: Array<{ slot: ProviderSlotTestResult['slot']; modelId: string }> = []
    for (const slot of order) {
      const modelId = args.models[slot].trim()
      if (modelId) slots.push({ slot, modelId })
    }
    if (slots.length === 0) {
      return { connectivity: { success: false, latencyMs: 0, error: 'No model IDs configured' } }
    }

    const slotResults: ProviderSlotTestResult[] = []
    for (const { slot, modelId } of slots) {
      const single = await this.testSingleProviderModel({
        baseUrl: args.baseUrl,
        apiKey: args.apiKey,
        modelId,
        authStrategy: args.authStrategy,
        apiFormat: args.apiFormat,
      })
      slotResults.push({
        slot,
        modelId,
        connectivity: single.connectivity,
        proxy: single.proxy,
      })
    }

    const allConnOk = slotResults.every((r) => r.connectivity.success)
    const firstConnFail = slotResults.find((r) => !r.connectivity.success)
    const connLatency = slotResults.reduce((s, r) => s + r.connectivity.latencyMs, 0)
    const aggConnectivity: ProviderTestStepResult = allConnOk
      ? {
          success: true,
          latencyMs: connLatency,
          modelUsed: slotResults.map((r) => `${r.slot}:${r.modelId}`).join(', '),
          httpStatus: slotResults[slotResults.length - 1]?.connectivity.httpStatus,
        }
      : {
          success: false,
          latencyMs: connLatency,
          error: firstConnFail
            ? `[${firstConnFail.slot}] ${firstConnFail.connectivity.error ?? 'failed'}`
            : undefined,
          modelUsed: firstConnFail?.modelId,
          httpStatus: firstConnFail?.connectivity.httpStatus,
        }

    const anyProxy = slotResults.some((r) => r.proxy != null)
    let aggProxy: ProviderTestStepResult | undefined
    if (anyProxy) {
      const allProxyOk = slotResults.every((r) => r.proxy == null || r.proxy.success)
      const firstProxyFail = slotResults.find((r) => r.proxy && !r.proxy.success)
      const proxyLatency = slotResults.reduce((s, r) => s + (r.proxy?.latencyMs ?? 0), 0)
      aggProxy = allProxyOk
        ? {
            success: true,
            latencyMs: proxyLatency,
            modelUsed: slotResults.filter((r) => r.proxy).map((r) => `${r.slot}:${r.modelId}`).join(', '),
          }
        : {
            success: false,
            latencyMs: proxyLatency,
            error: firstProxyFail?.proxy?.error,
            modelUsed: firstProxyFail?.modelId,
            httpStatus: firstProxyFail?.proxy?.httpStatus,
          }
    }

    return {
      connectivity: aggConnectivity,
      proxy: aggProxy,
      slotResults,
    }
  }

  private async testSingleProviderModel(input: {
    baseUrl: string
    apiKey: string
    modelId: string
    authStrategy: ProviderAuthStrategy
    apiFormat: ApiFormat
  }): Promise<ProviderTestResult> {
    const format: ApiFormat = input.apiFormat ?? 'anthropic'
    const authStrategy = input.authStrategy ?? 'api_key'
    const base = input.baseUrl.replace(/\/+$/, '')

    const step1 = await this.testConnectivity(base, input.apiKey, input.modelId, format, authStrategy)

    if (!step1.success) {
      return { connectivity: step1 }
    }

    if (format === 'anthropic') {
      return { connectivity: step1 }
    }

    const step2 = await this.testProxyPipeline(base, input.apiKey, input.modelId, format)

    return { connectivity: step1, proxy: step2 }
  }

  /** Step 1: Direct upstream call to verify connectivity, auth, and model. */
  private async testConnectivity(
    base: string,
    apiKey: string,
    modelId: string,
    format: ApiFormat,
    authStrategy: ProviderAuthStrategy,
  ): Promise<ProviderTestStepResult> {
    const start = Date.now()
    try {
      const { url, headers, body } = buildDirectTestRequest(base, apiKey, modelId, format, authStrategy)
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })

      const ct = response.headers.get('content-type') || ''
      if (format === 'anthropic' && ct.includes('text/event-stream')) {
        const text = await response.text()
        const latencyMs = Date.now() - start
        if (!response.ok) {
          return {
            success: false,
            latencyMs,
            error: `HTTP ${response.status}`,
            modelUsed: modelId,
            httpStatus: response.status,
          }
        }
        const sseValid = validateAnthropicSseConnectivity(text)
        if (!sseValid.ok) {
          return {
            success: false,
            latencyMs,
            error: sseValid.error,
            modelUsed: modelId,
            httpStatus: response.status,
          }
        }
        return { success: true, latencyMs, modelUsed: modelId, httpStatus: response.status }
      }

      const resBody = await response.json().catch(() => null) as Record<string, unknown> | null
      const latencyMs = Date.now() - start

      if (!response.ok) {
        let error = `HTTP ${response.status}`
        if (resBody?.error && typeof resBody.error === 'object') {
          error = ((resBody.error as Record<string, unknown>).message as string) || error
        }
        return { success: false, latencyMs, error, modelUsed: modelId, httpStatus: response.status }
      }

      // Validate response structure
      const valid = validateResponseBody(resBody, format)
      if (!valid.ok) {
        return { success: false, latencyMs, error: valid.error, modelUsed: modelId, httpStatus: response.status }
      }

      return { success: true, latencyMs, modelUsed: valid.model || modelId, httpStatus: response.status }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return { success: false, latencyMs, error: 'Request timed out (30s)', modelUsed: modelId }
      }
      return { success: false, latencyMs, error: err instanceof Error ? err.message : String(err), modelUsed: modelId }
    }
  }

  /** Step 2: Full proxy pipeline — Anthropic → transform → upstream → transform back → validate. */
  private async testProxyPipeline(
    base: string,
    apiKey: string,
    modelId: string,
    format: 'openai_chat' | 'openai_responses',
  ): Promise<ProviderTestStepResult> {
    const start = Date.now()
    try {
      // Build an Anthropic Messages API request (same shape as what CLI sends)
      const anthropicReq: AnthropicRequest = {
        model: modelId,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      }

      // Transform to OpenAI format
      let upstreamUrl: string
      let transformedBody: unknown
      if (format === 'openai_chat') {
        transformedBody = anthropicToOpenaiChat(anthropicReq)
        upstreamUrl = `${base}/v1/chat/completions`
      } else {
        transformedBody = anthropicToOpenaiResponses(anthropicReq)
        upstreamUrl = `${base}/v1/responses`
      }

      // Call upstream with transformed request
      const response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(transformedBody),
        signal: AbortSignal.timeout(30000),
      })

      if (!response.ok) {
        const latencyMs = Date.now() - start
        const errText = await response.text().catch(() => '')
        return { success: false, latencyMs, modelUsed: modelId, httpStatus: response.status,
          error: `Upstream HTTP ${response.status}: ${errText.slice(0, 200)}` }
      }

      // Transform response back to Anthropic format
      const responseBody = await response.json()
      const anthropicRes = format === 'openai_chat'
        ? openaiChatToAnthropic(responseBody, modelId)
        : openaiResponsesToAnthropic(responseBody, modelId)

      const latencyMs = Date.now() - start

      // Validate the final Anthropic response
      if (anthropicRes.type !== 'message' || !Array.isArray(anthropicRes.content)) {
        return { success: false, latencyMs, modelUsed: modelId,
          error: 'Proxy transform produced invalid Anthropic response' }
      }

      return { success: true, latencyMs, modelUsed: anthropicRes.model || modelId, httpStatus: response.status }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        return { success: false, latencyMs, error: 'Proxy pipeline timed out (30s)', modelUsed: modelId }
      }
      return { success: false, latencyMs, error: err instanceof Error ? err.message : String(err), modelUsed: modelId }
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────

function buildDirectTestRequest(
  base: string,
  apiKey: string,
  modelId: string,
  format: ApiFormat,
  authStrategy: ProviderAuthStrategy,
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  const prompt = 'Say "ok" and nothing else.'

  if (format === 'openai_chat') {
    return {
      url: `${base}/v1/chat/completions`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model: modelId, max_tokens: 16, messages: [{ role: 'user', content: prompt }] },
    }
  }
  if (format === 'openai_responses') {
    return {
      url: `${base}/v1/responses`,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: { model: modelId, max_output_tokens: 16, input: [{ type: 'message', role: 'user', content: prompt }] },
    }
  }
  // anthropic
  return {
    url: `${base}/v1/messages`,
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...buildAnthropicAuthHeaders(apiKey, authStrategy),
    },
    body: { model: modelId, max_tokens: 16, messages: [{ role: 'user', content: prompt }] },
  }
}

function buildAnthropicAuthHeaders(apiKey: string, authStrategy: ProviderAuthStrategy): Record<string, string> {
  switch (authStrategy) {
    case 'api_key':
      return { 'x-api-key': apiKey }
    case 'auth_token':
    case 'auth_token_empty_api_key':
      return { Authorization: `Bearer ${apiKey}` }
    case 'dual_same_token':
      return { 'x-api-key': apiKey, Authorization: `Bearer ${apiKey}` }
    case 'dual_dummy':
      return { 'x-api-key': 'dummy', Authorization: 'Bearer dummy' }
  }
}

function validateResponseBody(
  body: Record<string, unknown> | null,
  format: ApiFormat,
): { ok: true; model?: string } | { ok: false; error: string } {
  if (!body) return { ok: false, error: 'Empty response — not a valid API endpoint' }
  if (body.error && typeof body.error === 'object') {
    return { ok: false, error: ((body.error as Record<string, unknown>).message as string) || 'Error in response body' }
  }

  if (format === 'openai_chat') {
    if (!Array.isArray(body.choices) || body.choices.length === 0) {
      return { ok: false, error: 'Response missing choices — not a valid Chat Completions endpoint' }
    }
    return { ok: true, model: (body.model as string) || undefined }
  }
  if (format === 'openai_responses') {
    if (!Array.isArray(body.output)) {
      return { ok: false, error: 'Response missing output — not a valid Responses API endpoint' }
    }
    return { ok: true, model: (body.model as string) || undefined }
  }
  // anthropic
  if (body.type !== 'message' || !Array.isArray(body.content)) {
    return { ok: false, error: 'Not a valid Anthropic Messages endpoint' }
  }
  return { ok: true, model: (body.model as string) || undefined }
}
