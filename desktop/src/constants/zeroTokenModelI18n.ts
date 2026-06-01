import type { TranslationKey } from '../i18n/locales/en'

/** 网关 canonical model id → i18n（设置页与模型选择器共用） */
export const ZERO_TOKEN_MODEL_LABEL_KEY: Record<string, TranslationKey> = {
  'deepseek-chat': 'settings.providers.zeroTokenWebModelDeepseekChat',
  'doubao-web': 'settings.providers.zeroTokenWebModelDoubaoWeb',
  'claude-web': 'settings.providers.zeroTokenWebModelClaudeWeb',
  'qwen-web': 'settings.providers.zeroTokenWebModelQwenWeb',
  'qwen-cn-web': 'settings.providers.zeroTokenWebModelQwenCnWeb',
  'kimi-web': 'settings.providers.zeroTokenWebModelKimiWeb',
  'chatgpt-web': 'settings.providers.zeroTokenWebModelChatgptWeb',
  'gemini-web': 'settings.providers.zeroTokenWebModelGeminiWeb',
  'glm-web': 'settings.providers.zeroTokenWebModelGlmWeb',
  'glm-intl-web': 'settings.providers.zeroTokenWebModelGlmIntlWeb',
}
