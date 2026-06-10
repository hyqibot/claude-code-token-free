import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('zero-token gateway sidecar entry', () => {
  test('does not import ../../src (must bundle for installed exe)', () => {
    const entry = readFileSync('desktop/sidecars/zero-token-gateway.ts', 'utf8')
    expect(entry).not.toContain('../../src/')
    expect(entry).toContain('./gatewayTlsBootstrap.ts')
    expect(entry).toContain('./packagedAppRoot')
  })

  test('sidecar runtime paths stay local to desktop/sidecars', () => {
    const paths = readFileSync('desktop/sidecars/sidecarRuntimePaths.ts', 'utf8')
    expect(paths).not.toContain('../../src/')
  })
})
