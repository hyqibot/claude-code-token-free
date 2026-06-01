/**
 * Gateway canonical model ids — align `src/server/config/zeroTokenWebModels.ts`
 * and CoPaw-main `canonical_models._ZERO_ORDERED` / `zero_token_gateway/server.mjs` MODELS.
 */
export const ZERO_TOKEN_CANONICAL_MODEL_IDS = [
  'deepseek-chat',
  'doubao-web',
  'claude-web',
  'qwen-web',
  'qwen-cn-web',
  'kimi-web',
  'chatgpt-web',
  'gemini-web',
  'glm-web',
  'glm-intl-web',
] as const

export type ZeroTokenCanonicalModelId = (typeof ZERO_TOKEN_CANONICAL_MODEL_IDS)[number]
