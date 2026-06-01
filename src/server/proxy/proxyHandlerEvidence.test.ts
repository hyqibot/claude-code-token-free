/**
 * 用受控 mock 证明：只要 POST 进入 handleProxyRequest，就会在诊断开启时产生 proxy_request_in；
 * 上游可用时不会产生 proxy_upstream。用于对照真实环境里「有 cli_spawn_env 却无 proxy_request_in」等现象。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { diagnosticsService } from '../services/diagnosticsService.js'
import { ProviderService } from '../services/providerService.js'
import { handleProxyRequest } from './handler.js'

const captured: Parameters<typeof diagnosticsService.recordEvent>[0][] = []
const origRecord = diagnosticsService.recordEvent.bind(diagnosticsService)
const origConfigDir = process.env.CLAUDE_CONFIG_DIR

let upstream: ReturnType<typeof Bun.serve>
let upstreamPort: number
let tmpConfigDir: string
let providerId: string

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

  tmpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-evidence-'))
  process.env.CLAUDE_CONFIG_DIR = tmpConfigDir

  const provider = await new ProviderService().addProvider({
    presetId: 'custom',
    name: 'Evidence Provider',
    apiKey: 'evidence-key',
    baseUrl: `http://127.0.0.1:${upstreamPort}`,
    apiFormat: 'openai_chat',
    models: {
      main: 'evidence-model',
      haiku: 'evidence-model',
      sonnet: 'evidence-model',
      opus: 'evidence-model',
    },
  })
  providerId = provider.id
})

beforeEach(() => {
  captured.length = 0
  diagnosticsService.recordEvent = async (input) => {
    captured.push(input)
  }
  process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY = '1'
})

afterAll(async () => {
  upstream.stop()
  diagnosticsService.recordEvent = origRecord
  delete process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY
  if (origConfigDir) {
    process.env.CLAUDE_CONFIG_DIR = origConfigDir
  } else {
    delete process.env.CLAUDE_CONFIG_DIR
  }
  await fs.rm(tmpConfigDir, { recursive: true, force: true }).catch(() => {})
})

function phasesFromCaptured(): string[] {
  return captured
    .map((e) => (e.details as { phase?: string } | undefined)?.phase)
    .filter((p): p is string => typeof p === 'string')
}

describe('handleProxyRequest — diagnostics evidence', () => {
  test('POST 命中 /proxy/providers/:id/v1/messages 时先记录 proxy_request_in，上游成功时不记录 proxy_upstream', async () => {
    const url = new URL(`http://127.0.0.1/proxy/providers/${providerId}/v1/messages`)
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
