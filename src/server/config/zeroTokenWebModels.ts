/**
 * Align CoPaw-main：10 个网关 canonical model id，每项对应 CLI `copaw zero-token onboard <mode>` 的一个 mode。
 * （Python 实现里是各通道 `*_webauth` 函数；CLI 参数名由 CoPaw 约定，如下拉选项只在界面展示模型名，不展示 mode 字符串。）
 */
export type ZeroTokenWebModelRow = {
  id: string
  onboardMode: string
}

/** 与 CoPaw `zero_token.py` 各通道 `ensure_chrome_debug(..., urls=[…])` 一致 */
export const ZERO_TOKEN_ENSURE_URLS: Readonly<Record<string, readonly string[]>> = {
  'deepseek-chat': ['https://chat.deepseek.com/'],
  'doubao-web': ['https://www.doubao.com/chat/'],
  'claude-web': ['https://claude.ai/'],
  'qwen-web': ['https://chat.qwen.ai/'],
  'qwen-cn-web': ['https://www.qianwen.com/'],
  'kimi-web': ['https://www.kimi.com/'],
  'chatgpt-web': ['https://chatgpt.com/'],
  'gemini-web': ['https://gemini.google.com/app'],
  'glm-web': ['https://chatglm.cn'],
  'glm-intl-web': ['https://chat.z.ai/'],
}

export function ensureUrlsForCanonicalModelId(modelId: string): string[] | null {
  const u = ZERO_TOKEN_ENSURE_URLS[modelId]
  if (!u?.length) return null
  return [...u]
}

export const ZERO_TOKEN_WEB_MODELS: readonly ZeroTokenWebModelRow[] = [
  { id: 'deepseek-chat', onboardMode: 'webauth' },
  { id: 'doubao-web', onboardMode: 'doubao' },
  { id: 'claude-web', onboardMode: 'claude' },
  { id: 'qwen-web', onboardMode: 'qwen' },
  { id: 'qwen-cn-web', onboardMode: 'qwen-cn' },
  { id: 'kimi-web', onboardMode: 'kimi' },
  { id: 'chatgpt-web', onboardMode: 'chatgpt' },
  { id: 'gemini-web', onboardMode: 'gemini' },
  { id: 'glm-web', onboardMode: 'glm' },
  { id: 'glm-intl-web', onboardMode: 'glm-intl' },
] as const

const BY_ID = new Map(ZERO_TOKEN_WEB_MODELS.map((r) => [r.id, r] as const))

export function onboardModeForCanonicalModelId(modelId: string): string | null {
  return BY_ID.get(modelId)?.onboardMode ?? null
}

export function getZeroTokenWebModels(): readonly ZeroTokenWebModelRow[] {
  return ZERO_TOKEN_WEB_MODELS
}

/** 与 CoPaw `zero_token_gateway/server.mjs` 的 `WEB_ONLY` 一致（仅这 10 个 id 可走网关）。 */
export const ZERO_TOKEN_GATEWAY_MODEL_IDS = new Set(ZERO_TOKEN_WEB_MODELS.map((r) => r.id))

/**
 * `model` 可能含 Claude Code 的 `:modelContext` 后缀；只校验第一个 `:` 前的 base id。
 */
export function isGatewayCanonicalWebModelId(modelId: string): boolean {
  const base = modelId.split(':')[0]?.trim() ?? ''
  return ZERO_TOKEN_GATEWAY_MODEL_IDS.has(base)
}
