/**
 * 用受控 mock 证明：只要 POST 进入 handleProxyRequest，就会在诊断开启时产生 proxy_request_in；
 * 上游可用时不会产生 proxy_upstream。用于对照真实环境里「有 cli_spawn_env 却无 proxy_request_in」等现象。
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { diagnosticsService } from '../services/diagnosticsService.js'

const captured: Parameters<typeof diagnosticsService.recordEvent>[0][] = []
const origRecord = diagnosticsService.recordEvent.bind(diagnosticsService)

let upstream: ReturnType<typeof Bun.serve>
let upstreamPort: number
let handleProxyRequest: (req: Request, url: URL) => Promise<Response>

beforeAll(async () => {
  upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const u = new URL(req.url)
      if (u.pathname === '/v1/chat/completions' && req.method === 'POST') {
        return Response.json({
          id: 'chatcmpl-evidence',
          object: 'chat.completion',
          created: 1,
          model: 'evidence-model',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
          ],
        })
      }
      return new Response('nf', { status: 404 })
    },
  })
  upstreamPort = upstream.port

  mock.module('../services/providerService.js', () => ({
    ProviderService: class MockProviderService {
      async getProviderForProxy(_providerId?: string) {
        return {
          baseUrl: `http://127.0.0.1:${upstreamPort}`,
          apiKey: 'evidence-key',
          apiFormat: 'openai_chat' as const,
          presetId: 'evidence-preset',
        }
      }
    },
  }))

  diagnosticsService.recordEvent = async (input) => {
    captured.push(input)
  }
  process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY = '1'

  const mod = await import('./handler.js')
  handleProxyRequest = mod.handleProxyRequest
})

afterAll(() => {
  upstream.stop()
  diagnosticsService.recordEvent = origRecord
  delete process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY
  mock.restore()
})

function phasesFromCaptured(): string[] {
  return captured
    .map((e) => (e.details as { phase?: string } | undefined)?.phase)
    .filter((p): p is string => typeof p === 'string')
}

describe('handleProxyRequest — diagnostics evidence', () => {
  test('POST 命中 /proxy/providers/:id/v1/messages 时先记录 proxy_request_in，上游成功时不记录 proxy_upstream', async () => {
    captured.length = 0
    const pid = '11111111-1111-1111-1111-111111111111'
    const url = new URL(`http://127.0.0.1/proxy/providers/${pid}/v1/messages`)
    const req = new Request(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 16,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })

    const res = await handleProxyRequest(req, url)
    expect(res.status).toBe(200)

    const phases = phasesFromCaptured()
    expect(phases).toContain('proxy_request_in')
    expect(phases.some((p) => p === 'proxy_upstream')).toBe(false)
  })

  test('POST /proxy/ 但路径不匹配时仍记录 proxy_request_in 且 routeMatch 为 false', async () => {
    captured.length = 0
    const url = new URL('http://127.0.0.1/proxy/providers/x/not-messages')
    const req = new Request(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    const res = await handleProxyRequest(req, url)
    expect(res.status).toBe(404)

    const proxyIn = captured.find(
      (e) => (e.details as { phase?: string }).phase === 'proxy_request_in',
    )
    expect(proxyIn).toBeDefined()
    expect((proxyIn?.details as { routeMatch?: boolean }).routeMatch).toBe(false)
  })
})
