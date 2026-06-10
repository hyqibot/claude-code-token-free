import { afterEach, describe, expect, it, mock } from 'bun:test'

describe('imRuntimeService zero-token fallback', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    mock.restore()
  })

  it('falls back to a non-zero-token provider when gateway license is unavailable', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ providers: [], activeId: null }), {
        headers: { 'Content-Type': 'application/json' },
      })),
    ) as typeof fetch

    mock.module('../services/providerService.js', () => ({
      ProviderService: class {
        async listProviders() {
          return {
            activeId: 'zero-token-id',
            providers: [
              {
                id: 'zero-token-id',
                presetId: 'zero-token-web',
                models: { main: 'deepseek-chat' },
              },
              {
                id: 'kimi-id',
                presetId: 'kimi',
                models: { main: 'kimi-k2.5' },
              },
            ],
          }
        }
        async getManagedSettings() {
          return { model: 'deepseek-chat' }
        }
        async activateOfficial() {}
      },
    }))

    mock.module('../services/settingsService.js', () => ({
      SettingsService: class {
        async getUserSettings() {
          return {}
        }
      },
    }))

    mock.module('../services/adapterService.js', () => ({
      adapterService: {
        async getRawConfig() {
          return {}
        },
      },
    }))

    mock.module('../services/gatewayLicense/gatewayLicenseService.js', () => ({
      getGatewayLicenseStatus() {
        return {
          required: true,
          verified: false,
          lastError: '无法连接网关授权服务，请检查 license.serverUrl 与网络后重试。',
        }
      },
    }))

    const { resolveImRuntimeDefault } = await import('../services/imRuntimeService.js')
    const runtime = await resolveImRuntimeDefault()
    expect(runtime.providerId).toBe('kimi-id')
    expect(runtime.modelId).toBe('kimi-k2.5')
    expect(runtime.source).toBe('global')
  })

  it('falls back when zero-token license is ok but gateway is not listening', async () => {
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/health')) {
        return Promise.reject(new Error('connection refused'))
      }
      return Promise.resolve(new Response(JSON.stringify({ providers: [], activeId: null }), {
        headers: { 'Content-Type': 'application/json' },
      }))
    }) as typeof fetch

    mock.module('../services/providerService.js', () => ({
      ProviderService: class {
        async listProviders() {
          return {
            activeId: 'zero-token-id',
            providers: [
              {
                id: 'zero-token-id',
                presetId: 'zero-token-web',
                models: { main: 'deepseek-chat' },
              },
              {
                id: 'kimi-id',
                presetId: 'kimi',
                models: { main: 'kimi-k2.5' },
              },
            ],
          }
        }
        async getManagedSettings() {
          return { model: 'deepseek-chat' }
        }
        async activateOfficial() {}
      },
    }))

    mock.module('../services/settingsService.js', () => ({
      SettingsService: class {
        async getUserSettings() {
          return {}
        }
      },
    }))

    mock.module('../services/adapterService.js', () => ({
      adapterService: {
        async getRawConfig() {
          return {}
        },
      },
    }))

    mock.module('../services/gatewayLicense/gatewayLicenseService.js', () => ({
      getGatewayLicenseStatus() {
        return {
          required: true,
          verified: true,
          lastError: null,
        }
      },
    }))

    mock.module('../services/zeroTokenService.js', () => ({
      sharedZeroTokenService: {
        async status() {
          return { listening: false, host: '127.0.0.1', port: 3002 }
        },
      },
    }))

    const { resolveImRuntimeDefault } = await import('../services/imRuntimeService.js')
    const runtime = await resolveImRuntimeDefault()
    expect(runtime.providerId).toBe('kimi-id')
    expect(runtime.modelId).toBe('kimi-k2.5')
  })
})
