/**
 * IM 新会话默认 runtime：优先 UI 草稿（imRuntimeDefault），否则全局 Provider 默认。
 */

import { adapterService, type AdapterFileConfig } from './adapterService.js'
import { ProviderService } from './providerService.js'
import { SettingsService } from './settingsService.js'
import { isGatewayCanonicalWebModelId } from '../config/zeroTokenWebModels.js'
import { getGatewayLicenseStatus } from './gatewayLicense/gatewayLicenseService.js'

const settingsService = new SettingsService()
const providerService = new ProviderService()

export type ImRuntimeDefault = {
  providerId: string | null
  modelId: string
}

export type ImRuntimeDefaultResponse = ImRuntimeDefault & {
  source: 'draft' | 'global'
}

function isValidDraft(value: unknown): value is ImRuntimeDefault {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  const providerOk = row.providerId === null || typeof row.providerId === 'string'
  const modelOk = typeof row.modelId === 'string' && row.modelId.trim().length > 0
  return providerOk && modelOk
}

async function isKnownProvider(providerId: string): Promise<boolean> {
  const { providers } = await providerService.listProviders()
  return providers.some((provider) => provider.id === providerId)
}

async function isZeroTokenGatewayUsable(): Promise<boolean> {
  try {
    const { sharedZeroTokenService } = await import('./zeroTokenService.js')
    const status = await sharedZeroTokenService.status()
    if (!status.listening) return false
    const host = status.host ?? '127.0.0.1'
    const port = status.port ?? 3002
    const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

async function pickImProviderWhenZeroTokenUnavailable(
  providers: Awaited<ReturnType<ProviderService['listProviders']>>['providers'],
  activeId: string | null,
): Promise<string | null> {
  if (!activeId) return activeId
  const activeProvider = providers.find((provider) => provider.id === activeId)
  if (activeProvider?.presetId !== 'zero-token-web') return activeId

  const license = getGatewayLicenseStatus()
  const gatewayUsable = await isZeroTokenGatewayUsable()
  if (license.verified && !license.lastError && gatewayUsable) return activeId

  const fallback = providers.find(
    (provider) => provider.presetId !== 'zero-token-web' && provider.models.main?.trim(),
  )
  return fallback?.id ?? activeId
}

async function resolveDraftWithZeroTokenFallback(
  draft: ImRuntimeDefault,
): Promise<ImRuntimeDefaultResponse> {
  const providerId = draft.providerId ?? null
  const modelId = draft.modelId.trim()
  if (!providerId) {
    return { providerId, modelId, source: 'draft' }
  }

  const { providers } = await providerService.listProviders()
  const provider = providers.find((row) => row.id === providerId)
  if (provider?.presetId !== 'zero-token-web') {
    return { providerId, modelId, source: 'draft' }
  }

  const resolvedId = await pickImProviderWhenZeroTokenUnavailable(providers, providerId)
  if (resolvedId === providerId) {
    return { providerId, modelId, source: 'draft' }
  }

  const fallbackProvider = providers.find((row) => row.id === resolvedId)
  const fallbackModel = fallbackProvider?.models.main?.trim() || modelId
  return {
    providerId: resolvedId,
    modelId: fallbackModel,
    source: 'draft',
  }
}

async function resolveGlobalImRuntimeDefault(): Promise<ImRuntimeDefaultResponse> {
  const { providers, activeId } = await providerService.listProviders()
  let resolvedActiveId = activeId
  if (activeId && !providers.some((provider) => provider.id === activeId)) {
    resolvedActiveId = null
    await providerService.activateOfficial()
  }

  resolvedActiveId = await pickImProviderWhenZeroTokenUnavailable(providers, resolvedActiveId)

  const userSettings = await settingsService.getUserSettings()
  const providerSettings = resolvedActiveId
    ? await providerService.getManagedSettings()
    : undefined
  const modelSettings = providerSettings ?? userSettings

  let model: string | undefined
  if (resolvedActiveId) {
    const provider = providers.find((row) => row.id === resolvedActiveId)
    const useManagedModel = resolvedActiveId === activeId
    const baseModel = useManagedModel &&
      typeof modelSettings.model === 'string' && modelSettings.model.trim()
      ? modelSettings.model
      : ''
    if (baseModel) {
      model = baseModel
    } else {
      model = provider?.models.main?.trim() || undefined
    }
  } else {
    model =
      typeof userSettings.model === 'string' && userSettings.model.trim()
        ? userSettings.model
        : undefined
  }

  if (resolvedActiveId) {
    const provider = providers.find((row) => row.id === resolvedActiveId)
    if (provider?.presetId === 'zero-token-web') {
      const fallback = (provider.models.main || 'deepseek-chat').trim() || 'deepseek-chat'
      const raw = model?.trim() ?? ''
      const colonIdx = raw.indexOf(':')
      const baseId = colonIdx >= 0 ? raw.slice(0, colonIdx).trim() : raw
      if (!baseId || !isGatewayCanonicalWebModelId(baseId)) {
        model = fallback
      }
    }
  }

  const raw = model?.trim() ?? ''
  const colonIdx = raw.indexOf(':')
  const modelId = (colonIdx >= 0 ? raw.slice(0, colonIdx).trim() : raw) || 'deepseek-chat'

  return {
    providerId: resolvedActiveId ?? null,
    modelId,
    source: 'global',
  }
}

export async function resolveImRuntimeDefault(): Promise<ImRuntimeDefaultResponse> {
  const raw = await adapterService.getRawConfig()
  const draft = raw.imRuntimeDefault
  if (isValidDraft(draft)) {
    const providerId = draft.providerId ?? null
    const modelId = draft.modelId.trim()
    if (providerId && !(await isKnownProvider(providerId))) {
      return resolveGlobalImRuntimeDefault()
    }
    return resolveDraftWithZeroTokenFallback({ providerId, modelId })
  }
  return resolveGlobalImRuntimeDefault()
}

export async function setImRuntimeDefault(value: ImRuntimeDefault | null): Promise<void> {
  if (!value?.modelId?.trim()) {
    await adapterService.clearImRuntimeDefault()
    return
  }
  const patch: Partial<AdapterFileConfig> = {
    imRuntimeDefault: {
      providerId: value.providerId ?? null,
      modelId: value.modelId.trim(),
      updatedAt: Date.now(),
    },
  }
  await adapterService.updateConfig(patch)
}
