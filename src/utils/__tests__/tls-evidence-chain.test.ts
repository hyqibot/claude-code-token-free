import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildDefaultProbeTargets,
  buildHeuristicNotes,
  collectTlsEnvSnapshot,
  runTlsEvidenceChain,
  serializeTlsErrorChain,
  type TlsEvidenceReport,
} from '../tlsEvidenceChain.js'

describe('tlsEvidenceChain', () => {
  const saved = { ...process.env }

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in saved)) delete process.env[k]
    }
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  test('serializeTlsErrorChain follows Error.cause', () => {
    const root = new Error('root')
    const inner = new Error('inner') as Error & { code?: string }
    inner.code = 'CERT_HAS_EXPIRED'
    root.cause = inner
    const chain = serializeTlsErrorChain(root, 5)
    expect(chain.length).toBe(2)
    expect(chain[0]?.message).toContain('root')
    expect(chain[1]?.message).toContain('inner')
    expect(chain[1]?.code).toBe('CERT_HAS_EXPIRED')
  })

  test('collectTlsEnvSnapshot does not leak API key value', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-secret-abc'
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:3002'
    const s = collectTlsEnvSnapshot(process.env)
    expect(s.ANTHROPIC_API_KEY).toBe('(set)')
    expect(s.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:3002')
  })

  test('buildDefaultProbeTargets includes origin, /health, and canary', () => {
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:3002'
    const t = buildDefaultProbeTargets(process.env)
    expect(t.some(x => x.probe_id === 'anthropic_base_origin')).toBe(true)
    expect(t.some(x => x.url.includes('/health'))).toBe(true)
    expect(t.some(x => x.probe_id === 'public_https_example_com')).toBe(true)
  })

  test('buildHeuristicNotes mentions http base URL semantics', () => {
    const report: TlsEvidenceReport = {
      schema: 'cc-haha.tls_evidence/v1',
      iso_timestamp: 't',
      runtime: { node_version: 'v22', platform: 'test', os_hostname: 'x' },
      env_snapshot: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:3002' },
      probes: [],
      heuristic_notes: [],
    }
    const notes = buildHeuristicNotes(report)
    expect(notes.some(n => n.includes('http'))).toBe(true)
  })

  test('connection refused yields error_chain on global_fetch probe', async () => {
    const report = await runTlsEvidenceChain({
      includePublicHttpsCanary: false,
      timeoutMs: 3000,
      targets: [{ probe_id: 'closed_port', url: 'http://127.0.0.1:9/' }],
    })
    const row = report.probes.find(
      p => p.probe_id === 'closed_port' && p.transport === 'global_fetch',
    )
    expect(row).toBeDefined()
    expect(row?.ok).toBe(false)
    expect(row?.error_chain?.length).toBeGreaterThan(0)
  })
})
