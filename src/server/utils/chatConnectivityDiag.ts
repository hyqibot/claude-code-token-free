/**
 * 聊天连通性诊断 — 仅当 CC_HAHA_DIAG_CHAT_CONNECTIVITY=1 时写入 diagnostics.jsonl。
 * 用于定位「Unable to connect」类问题时还原：runtime 选择、CLI 子进程 ANTHROPIC_*、代理上游失败等。
 * 不包含密钥原文（仅标记是否设置 proxy-managed 等）。
 */

import { diagnosticsService } from '../services/diagnosticsService.js'

export function isChatConnectivityDiagEnabled(): boolean {
  return process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY === '1'
}

export function recordChatConnectivityDiag(input: {
  phase: string
  sessionId?: string
  summary: string
  details?: Record<string, unknown>
}): void {
  if (!isChatConnectivityDiagEnabled()) return
  void diagnosticsService.recordEvent({
    type: 'chat_connectivity_diag',
    severity: 'info',
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    summary: input.summary,
    details: {
      phase: input.phase,
      ...input.details,
    },
  })
}

/** CLI 子进程合并后的关键 env（不含 token 内容） */
export function recordCliSpawnConnectivityDiag(
  sessionId: string,
  details: {
    optionsProviderId: string | null | undefined
    optionsModel: string | undefined
    anthropicBaseUrl: string | undefined
    anthropicModel: string | undefined
    providerManagedByHost: boolean
    officialEntrypoint: boolean
    strippedInheritedProviderEnv: boolean
    noProxyDefined: boolean
    serverPort: number
  },
): void {
  if (!isChatConnectivityDiagEnabled()) return
  recordChatConnectivityDiag({
    phase: 'cli_spawn_env',
    sessionId,
    summary: 'CLI child env snapshot',
    details: {
      optionsProviderId:
        details.optionsProviderId === undefined
          ? '(undefined)'
          : details.optionsProviderId === null
            ? 'null'
            : details.optionsProviderId,
      optionsModel: details.optionsModel ?? '(unset)',
      anthropicBaseUrl: details.anthropicBaseUrl ?? '(unset)',
      anthropicModel: details.anthropicModel ?? '(unset)',
      providerManagedByHost: details.providerManagedByHost,
      officialEntrypoint: details.officialEntrypoint,
      strippedInheritedProviderEnv: details.strippedInheritedProviderEnv,
      noProxyDefined: details.noProxyDefined,
      serverPort: details.serverPort,
    },
  })
}

/** POST 命中 `/proxy/` 时写入，用于区分 CLI 是否到达本机代理（先于上游 fetch）。 */
export function recordProxyRequestInDiag(input: {
  sessionId?: string
  pathname: string
  routeMatch: boolean
  providerId?: string
  activePath: boolean
}): void {
  if (!isChatConnectivityDiagEnabled()) return
  recordChatConnectivityDiag({
    phase: 'proxy_request_in',
    sessionId: input.sessionId,
    summary: input.routeMatch ? 'POST matched proxy route' : 'POST /proxy but route mismatch',
    details: {
      pathname: input.pathname,
      routeMatch: input.routeMatch,
      providerId: input.providerId ?? '(none)',
      activePath: input.activePath,
    },
  })
}

export function recordProxyUpstreamDiag(details: {
  proxyPathKind: 'scoped' | 'active'
  providerId?: string
  presetId?: string
  apiFormat?: string
  upstreamBaseUrl: string
  upstreamPath: string
  httpStatus?: number
  errorMessage: string
}): void {
  if (!isChatConnectivityDiagEnabled()) return
  recordChatConnectivityDiag({
    phase: 'proxy_upstream',
    summary: `proxy upstream failure: ${details.errorMessage.slice(0, 200)}`,
    details: {
      proxyPathKind: details.proxyPathKind,
      providerId: details.providerId ?? '(active)',
      presetId: details.presetId,
      apiFormat: details.apiFormat,
      upstreamBaseUrl: details.upstreamBaseUrl,
      upstreamPath: details.upstreamPath,
      httpStatus: details.httpStatus,
    },
  })
}
