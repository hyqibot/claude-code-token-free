import type { AdapterHttpClient } from './http-client.js'
import type { WsBridge } from './ws-bridge.js'

export type ImRuntimeDefault = {
  providerId: string | null
  modelId: string
  source?: 'draft' | 'global'
}

/** 新建 IM session 后，把服务端解析出的默认 runtime 同步到该 session。 */
export async function applyImRuntimeDefault(
  bridge: WsBridge,
  httpClient: AdapterHttpClient,
  chatId: string,
): Promise<void> {
  const runtime = await httpClient.getImRuntimeDefault()
  if (!runtime?.modelId?.trim()) return
  bridge.sendRuntimeConfig(chatId, runtime.providerId, runtime.modelId.trim())
}
