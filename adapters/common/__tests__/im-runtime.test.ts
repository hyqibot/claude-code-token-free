import { describe, it, expect, mock, afterEach } from 'bun:test'
import { applyImRuntimeDefault } from '../im-runtime.js'
import type { WsBridge } from '../ws-bridge.js'

describe('applyImRuntimeDefault', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('sends set_runtime_config when server returns a runtime default', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({
        providerId: 'kimi-provider',
        modelId: 'kimi-k2.6',
        source: 'draft',
      }), { headers: { 'Content-Type': 'application/json' } })),
    ) as typeof fetch

    const sent: Record<string, unknown>[] = []
    const bridge = {
      sendRuntimeConfig: (chatId: string, providerId: string | null, modelId: string) => {
        sent.push({ chatId, providerId, modelId })
        return true
      },
    } as unknown as WsBridge

    const httpClient = new (await import('../http-client.js')).AdapterHttpClient('ws://127.0.0.1:3456')
    await applyImRuntimeDefault(bridge, httpClient, 'chat-1')

    expect(sent).toEqual([{
      chatId: 'chat-1',
      providerId: 'kimi-provider',
      modelId: 'kimi-k2.6',
    }])
  })

  it('skips ws send when runtime default is missing', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ providerId: null, modelId: '   ' }), {
        headers: { 'Content-Type': 'application/json' },
      })),
    ) as typeof fetch

    let calls = 0
    const bridge = {
      sendRuntimeConfig: () => {
        calls += 1
        return true
      },
    } as unknown as WsBridge

    const httpClient = new (await import('../http-client.js')).AdapterHttpClient('ws://127.0.0.1:3456')
    await applyImRuntimeDefault(bridge, httpClient, 'chat-2')
    expect(calls).toBe(0)
  })
})
