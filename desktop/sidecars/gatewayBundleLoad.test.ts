import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveGatewayBundlePath } from './sidecarRuntimePaths'

const tmpRoot = join(process.cwd(), '.tmp-gateway-bundle-load-test')

describe('sidecarRuntimePaths gateway bundle', () => {
  beforeEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
    await mkdir(tmpRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('finds gateway.bundle under app-root/resources/zero-token-runtime', async () => {
    const bundlePath = join(tmpRoot, 'resources', 'zero-token-runtime', 'gateway.bundle.mjs')
    await mkdir(join(bundlePath, '..'), { recursive: true })
    await writeFile(bundlePath, 'export {};\n', 'utf8')

    expect(resolveGatewayBundlePath(tmpRoot)).toBe(bundlePath)
  })
})
