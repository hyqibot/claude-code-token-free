import type { AdapterHttpClient } from './http-client.js'
import type { WsBridge } from './ws-bridge.js'

export type ImRuntimeDefault = {
  providerId: string | null
  modelId: string
  source?: 'draft' | 'global'
}

const RUNTIME_CONFIG_SETTLE_MS = 500
/** chatId → sessionId，避免每条 IM 消息都触发 runtime 同步（服务端繁忙时会超时 Abort）。 */
const runtimeSyncedSession = new Map<string, string>()

export function clearImRuntimeSync(chatId: string): void {
  runtimeSyncedSession.delete(chatId)
}

/** 新建 IM session 后，把服务端解析出的默认 runtime 同步到该 session。 */
export async function applyImRuntimeDefault(
  bridge: WsBridge,
  httpClient: AdapterHttpClient,
  chatId: string,
): Promise<void> {
  let runtime: ImRuntimeDefault | null
  try {
    runtime = await httpClient.getImRuntimeDefault()
  } catch (err) {
    console.warn('[IM] getImRuntimeDefault failed (continuing):', err instanceof Error ? err.message : err)
    return
  }
  if (!runtime?.modelId?.trim()) return

  const providerId = runtime.providerId
  const modelId = runtime.modelId.trim()
  const sent = bridge.sendRuntimeConfig(chatId, providerId, modelId)
    || (await bridge.waitForOpen(chatId, 10_000)
      && bridge.sendRuntimeConfig(chatId, providerId, modelId))
  if (!sent) return

  // 给服务端串行队列一点时间处理 set_runtime_config（含 CLI 重启）
  await new Promise((resolve) => setTimeout(resolve, RUNTIME_CONFIG_SETTLE_MS))
}

/** 复用或新建 IM session 后，把桌面端默认 provider/model 同步到该 WS 会话（每个 session 仅一次）。 */
export async function syncImRuntimeOnBridgeReady(
  bridge: WsBridge,
  httpClient: AdapterHttpClient,
  chatId: string,
  sessionId?: string,
): Promise<void> {
  if (sessionId && runtimeSyncedSession.get(chatId) === sessionId) return
  await applyImRuntimeDefault(bridge, httpClient, chatId)
  if (sessionId) runtimeSyncedSession.set(chatId, sessionId)
}
