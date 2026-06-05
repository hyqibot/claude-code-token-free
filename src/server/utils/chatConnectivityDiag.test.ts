import { afterEach, describe, expect, test } from 'bun:test'
import { diagnosticsService } from '../services/diagnosticsService.js'
import { recordProxyRequestInDiag } from './chatConnectivityDiag.js'

describe('chatConnectivityDiag — proxy_request_in', () => {
  const origRecord = diagnosticsService.recordEvent.bind(diagnosticsService)

  afterEach(() => {
    diagnosticsService.recordEvent = origRecord
    delete process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY
  })

  test('CC_HAHA_DIAG_CHAT_CONNECTIVITY=1 时 recordProxyRequestInDiag 会调用 recordEvent 且 phase 为 proxy_request_in', () => {
    process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY = '1'
    const captured: Parameters<typeof diagnosticsService.recordEvent>[0][] = []
    diagnosticsService.recordEvent = async (input) => {
      captured.push(input)
    }

    recordProxyRequestInDiag({
      pathname: '/proxy/providers/p-test/v1/messages',
      routeMatch: true,
      providerId: 'p-test',
      activePath: false,
    })

    expect(captured.length).toBe(1)
    expect(captured[0]?.type).toBe('chat_connectivity_diag')
    expect((captured[0]?.details as { phase?: string }).phase).toBe('proxy_request_in')
    expect((captured[0]?.details as { pathname?: string }).pathname).toBe(
      '/proxy/providers/p-test/v1/messages',
    )
    expect((captured[0]?.details as { routeMatch?: boolean }).routeMatch).toBe(true)
  })

  test('未开启诊断时不调用 recordEvent', () => {
    delete process.env.CC_HAHA_DIAG_CHAT_CONNECTIVITY
    const captured: unknown[] = []
    diagnosticsService.recordEvent = async (input) => {
      captured.push(input)
    }

    recordProxyRequestInDiag({
      pathname: '/proxy/providers/p-test/v1/messages',
      routeMatch: true,
      providerId: 'p-test',
      activePath: false,
    })

    expect(captured.length).toBe(0)
  })
})
