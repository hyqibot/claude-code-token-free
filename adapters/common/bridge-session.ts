import type { WsBridge } from './ws-bridge.js'
import type { ServerMessage } from './ws-bridge.js'

/** 确保 chatId 对应的 WebSocket 已 OPEN；未连接时按 stored session 重连。 */
export async function ensureBridgeSessionOpen(
  bridge: WsBridge,
  chatId: string,
  stored: { sessionId: string } | null,
  onServerMessage: (msg: ServerMessage) => void | Promise<void>,
): Promise<boolean> {
  if (!stored) return false
  if (bridge.isSessionOpen(chatId)) return true

  if (!bridge.hasSession(chatId)) {
    bridge.connectSession(chatId, stored.sessionId)
  }
  bridge.onServerMessage(chatId, onServerMessage)
  return bridge.waitForOpen(chatId)
}
