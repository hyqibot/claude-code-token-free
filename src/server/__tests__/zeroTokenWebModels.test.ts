import { describe, expect, test } from 'bun:test'
import {
  ensureUrlsForCanonicalModelId,
  getZeroTokenWebModels,
  isGatewayCanonicalWebModelId,
  onboardModeForCanonicalModelId,
  ZERO_TOKEN_WEB_MODELS,
} from '../config/zeroTokenWebModels.js'

describe('zero token web models (CoPaw parity)', () => {
  test('has 10 canonical gateway models', () => {
    expect(ZERO_TOKEN_WEB_MODELS.length).toBe(10)
    expect(getZeroTokenWebModels().length).toBe(10)
  })

  test('deepseek-chat onboard mode is webauth (CoPaw CLI name for that channel)', () => {
    expect(onboardModeForCanonicalModelId('deepseek-chat')).toBe('webauth')
  })

  test('doubao-web maps to doubao', () => {
    expect(onboardModeForCanonicalModelId('doubao-web')).toBe('doubao')
  })

  test('ensure urls for deepseek-chat', () => {
    expect(ensureUrlsForCanonicalModelId('deepseek-chat')).toEqual(['https://chat.deepseek.com/'])
  })

  test('unknown id returns null for onboard mode', () => {
    expect(onboardModeForCanonicalModelId('not-a-model')).toBeNull()
  })

  test('isGatewayCanonicalWebModelId matches WEB_ONLY ids and strips :suffix', () => {
    expect(isGatewayCanonicalWebModelId('deepseek-chat')).toBe(true)
    expect(isGatewayCanonicalWebModelId('glm-intl-web')).toBe(true)
    expect(isGatewayCanonicalWebModelId('deepseek-chat:opus')).toBe(true)
    expect(isGatewayCanonicalWebModelId('claude-sonnet-4-6')).toBe(false)
  })
})
