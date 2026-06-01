import { ApiError, errorResponse } from '../middleware/errorHandler.js'
import { ensureUrlsForCanonicalModelId } from '../config/zeroTokenWebModels.js'
import { sharedZeroTokenService as zeroTokenService } from '../services/zeroTokenService.js'
import { diagnosticsService } from '../services/diagnosticsService.js'
import {
  activateGatewayLicense,
  getGatewayLicenseStatus,
  logoutGatewayLicense,
} from '../services/gatewayLicense/gatewayLicenseService.js'

/** 从 pathname 解析子路径；兼容单层子路由（含 `authorize-stream` 等多段连字符），避免正则遗漏 */
export function resolveZeroTokenSubPath(url: URL, segments: string[]): string {
  const p = url.pathname.replace(/\/+$/, '') || '/'
  const leaf = p.match(/\/zero-token\/([^/]+)$/)
  if (leaf?.[1]?.trim()) return leaf[1].trim().toLowerCase()
  if (/\/zero-token$/i.test(p)) return 'status'
  const seg = segments[2]?.trim()
  if (seg && seg.length > 0) return seg.toLowerCase()
  return 'status'
}

function createAuthorizeNdjsonStream(modelIdRaw: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
      }
      try {
        await zeroTokenService.authorizeWebModelStreaming(modelIdRaw, (e) => {
          send(e as unknown as Record<string, unknown>)
        })
        void diagnosticsService.recordEvent({
          type: 'zero_token_authorize',
          severity: 'info',
          summary: `zero-token authorize ok (stream): ${modelIdRaw}`,
          details: { modelId: modelIdRaw, stream: true },
        })
      } catch (error) {
        const cdp = await zeroTokenService.checkCdp().catch(() => null)
        const message = error instanceof Error ? error.message : String(error)
        send({
          type: 'error',
          message,
          code: error instanceof ApiError ? error.code : undefined,
        })
        void diagnosticsService.recordEvent({
          type: 'zero_token_authorize_failed',
          severity: 'warn',
          summary: message,
          details: {
            modelId: modelIdRaw,
            cdp,
            errorName: error instanceof Error ? error.name : typeof error,
            stream: true,
          },
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export async function handleZeroTokenApi(
  req: Request,
  url: URL,
  segments: string[],
): Promise<Response> {
  try {
    const method = req.method.toUpperCase()
    const sub = resolveZeroTokenSubPath(url, segments)

    if (method === 'GET' && sub === 'status') {
      return Response.json({
        status: await zeroTokenService.status(),
        webModels: zeroTokenService.getWebModels(),
        deepseekToolMode: zeroTokenService.getDeepseekToolMode(),
        license: getGatewayLicenseStatus(),
      })
    }

    if (method === 'GET' && sub === 'license-status') {
      return Response.json({ license: getGatewayLicenseStatus() })
    }

    if (method === 'POST' && (sub === 'activate' || sub === 'verify-license')) {
      const body = await parseJsonBody(req)
      const activationCode =
        typeof body.activationCode === 'string'
          ? body.activationCode
          : typeof body.cardKey === 'string'
            ? body.cardKey
            : ''
      const license = await activateGatewayLicense(activationCode)
      return Response.json({ license })
    }

    if (method === 'POST' && sub === 'logout-license') {
      const license = await logoutGatewayLicense()
      return Response.json({ license })
    }

    if (method === 'PUT' && sub === 'deepseek-tool-mode') {
      const body = await parseJsonBody(req)
      const raw = typeof body.mode === 'string' ? body.mode.trim().toLowerCase() : ''
      if (raw !== 'dsml' && raw !== 'xml') {
        throw ApiError.badRequest('mode must be "dsml" or "xml"')
      }
      await zeroTokenService.setDeepseekToolMode(raw)
      return Response.json({
        deepseekToolMode: raw,
        restartRequired: true,
      })
    }

    if (method === 'GET' && sub === 'cdp-status') {
      const result = await zeroTokenService.checkCdp()
      return Response.json(result)
    }

    if (method === 'POST' && sub === 'start') {
      const body = await parseJsonBody(req)
      const rawPort = body.port
      const port =
        typeof rawPort === 'number' && Number.isFinite(rawPort) ? Math.trunc(rawPort) : undefined
      const status = await zeroTokenService.start(port)
      return Response.json({ status })
    }

    if (method === 'POST' && sub === 'stop') {
      const status = await zeroTokenService.stop()
      return Response.json({ status })
    }

    if (method === 'POST' && sub === 'stop-keepalive') {
      await zeroTokenService.stopKeepalive()
      return Response.json({ ok: true })
    }

    /** NDJSON 流式一键授权（独立路径，兼容旧桌面）；与 POST authorize + Accept: ndjson 等价 */
    if (method === 'POST' && sub === 'authorize-stream') {
      const body = await parseJsonBody(req)
      const modelIdRaw = typeof body.modelId === 'string' ? body.modelId.trim() : ''
      if (!modelIdRaw) {
        throw ApiError.badRequest('modelId is required')
      }
      return createAuthorizeNdjsonStream(modelIdRaw)
    }

    /** 与 CoPaw 控制台一致：ensure_chrome_debug → onboard（凭证写入）→ 后台 keepalive */
    if (method === 'POST' && sub === 'authorize') {
      const body = await parseJsonBody(req)
      const modelIdRaw = typeof body.modelId === 'string' ? body.modelId.trim() : ''
      if (!modelIdRaw) {
        throw ApiError.badRequest('modelId is required')
      }

      const accept = req.headers.get('accept') ?? ''
      if (accept.includes('application/x-ndjson')) {
        return createAuthorizeNdjsonStream(modelIdRaw)
      }

      try {
        const result = await zeroTokenService.authorizeWebModel(modelIdRaw)
        void diagnosticsService.recordEvent({
          type: 'zero_token_authorize',
          severity: 'info',
          summary: `zero-token authorize ok: ${modelIdRaw}`,
          details: { modelId: modelIdRaw, onboardMode: result.onboard.mode },
        })
        return Response.json(result)
      } catch (error) {
        const cdp = await zeroTokenService.checkCdp().catch(() => null)
        void diagnosticsService.recordEvent({
          type: 'zero_token_authorize_failed',
          severity: 'warn',
          summary: error instanceof Error ? error.message : String(error),
          details: {
            modelId: modelIdRaw,
            cdp,
            errorName: error instanceof Error ? error.name : typeof error,
          },
        })
        throw error
      }
    }

    /** 仅调试用：单独执行 ensure_chrome_debug */
    if (method === 'POST' && sub === 'ensure-chrome-debug') {
      const body = await parseJsonBody(req)
      const modelIdRaw = typeof body.modelId === 'string' ? body.modelId.trim() : ''
      const rawUrls = body.urls

      let urls: string[] | null = null
      if (Array.isArray(rawUrls) && rawUrls.length > 0) {
        urls = rawUrls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      } else if (modelIdRaw.length > 0) {
        urls = ensureUrlsForCanonicalModelId(modelIdRaw)
      }

      if (!urls?.length) {
        throw ApiError.badRequest(
          'Provide modelId (canonical web model) or non-empty urls[] for ensure_chrome_debug',
        )
      }

      try {
        const result = await zeroTokenService.ensureChromeDebug(urls)
        void diagnosticsService.recordEvent({
          type: 'zero_token_ensure_chrome_debug',
          severity: 'info',
          summary: `ensure_chrome_debug ok: ${modelIdRaw || urls.join(',')}`,
          details: { modelId: modelIdRaw || undefined, urls },
        })
        return Response.json({
          modelId: modelIdRaw || undefined,
          urls,
          output: result.output,
          result: result.result,
        })
      } catch (error) {
        const cdp = await zeroTokenService.checkCdp().catch(() => null)
        void diagnosticsService.recordEvent({
          type: 'zero_token_ensure_chrome_debug_failed',
          severity: 'warn',
          summary: error instanceof Error ? error.message : String(error),
          details: {
            modelId: modelIdRaw || undefined,
            urls,
            cdp,
            errorName: error instanceof Error ? error.name : typeof error,
          },
        })
        throw error
      }
    }

    throw new ApiError(405, `Method ${method} not allowed on /api/zero-token/${sub}`, 'METHOD_NOT_ALLOWED')
  } catch (error) {
    return errorResponse(error)
  }
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get('content-type') && !req.headers.get('content-length')) {
    return {}
  }
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    throw ApiError.badRequest('Invalid JSON body')
  }
}
