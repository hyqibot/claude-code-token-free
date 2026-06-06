/**
 * 聊天报错时的精准提示：当 CLI 子进程的 ANTHROPIC_BASE_URL 指向本机 Zero-Token 网关
 * 而该端口未监听时，给错误消息追加一行人类可读的根因提示。
 *
 * 不主动启动网关；只把"网关没起来"这件事在错误里讲清楚，避免用户面对无信息量的
 * "Unable to connect" / "unknown certificate verification error"。
 */

import * as net from 'node:net'

export const ZERO_TOKEN_GATEWAY_PORT = 3002

const LOOPBACK_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
  '[::1]',
])

/** 仅当 baseUrl 指向本机 Zero-Token 网关默认端口（3002）时返回 host/port，否则返回 null。 */
export function parseLoopbackZeroTokenGateway(
  baseUrl: string | undefined,
  expectedPort = ZERO_TOKEN_GATEWAY_PORT,
): { host: string; port: number } | null {
  if (!baseUrl) return null
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase()
  if (!LOOPBACK_HOSTS.has(host)) return null
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
  if (port !== expectedPort) return null
  return { host, port }
}

/** 200ms 内能 TCP 连上即视为监听中。任何错误一律视为未监听。 */
export function probeTcpListening(host: string, port: number, timeoutMs = 200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (listening: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(listening)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    try {
      socket.connect(port, host)
    } catch {
      finish(false)
    }
  })
}

/**
 * 仅当 baseUrl 是本机 Zero-Token 网关地址且端口当前**未**监听时返回一行提示，否则返回 null。
 * 端口在监听时返回 null：避免误把其它根因（鉴权失败 / 模型不存在等）也都怪到网关。
 */
export async function getZeroTokenGatewayHintForChatError(
  baseUrl: string | undefined,
  errorText?: string,
): Promise<string | null> {
  const target = parseLoopbackZeroTokenGateway(baseUrl)
  if (!target) return null
  const listening = await probeTcpListening(target.host, target.port)
  if (!listening) {
    return `Zero-Token 网关 ${target.host}:${target.port} 未监听。请到 设置 → Zero-Token 启动网关，或确认网关进程是否还活着。`
  }
  if (
    errorText &&
    /unknown certificate verification error/i.test(errorText)
  ) {
    return (
      `证书校验失败（与 Zero-Token 网关本身通常无关）。可在 设置→通用 开启「信任所有证书」后重启并新建会话。`
    )
  }
  return null
}
