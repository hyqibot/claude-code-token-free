/**
 * IM 新会话默认 runtime：优先 UI 草稿（imRuntimeDefault），否则全局 Provider 默认。
 */

import { adapterService, type AdapterFileConfig } from './adapterService.js'
import { ProviderService } from './providerService.js'
import { SettingsService } from './settingsService.js'
import { isGatewayCanonicalWebModelId } from '../config/zeroTokenWebModels.js'

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

async function resolveGlobalImRuntimeDefault(): Promise<ImRuntimeDefaultResponse> {
  const { providers, activeId } = await providerService.listProviders()
  let resolvedActiveId = activeId
  if (activeId && !providers.some((provider) => provider.id === activeId)) {
    resolvedActiveId = null
    await providerService.activateOfficial()
  }

  const userSettings = await settingsService.getUserSettings()
  const providerSettings = resolvedActiveId
    ? await providerService.getManagedSettings()
    : undefined
  const modelSettings = providerSettings ?? userSettings

  let model: string | undefined
  if (resolvedActiveId) {
    const baseModel =
      typeof modelSettings.model === 'string' && modelSettings.model.trim()
        ? modelSettings.model
        : ''
    if (baseModel) {
      model = baseModel
    } else {
      const provider = providers.find((row) => row.id === resolvedActiveId)
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
    return { providerId, modelId, source: 'draft' }
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
