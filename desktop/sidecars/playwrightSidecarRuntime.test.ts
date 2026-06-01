import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ensurePlaywrightBesideExe,
  resolveStagedPlaywrightNodeModules,
} from './playwrightSidecarRuntime'

const tmpRoot = join(process.cwd(), '.tmp-playwright-sidecar-test')

async function writePlaywrightMarker(nodeModulesDir: string) {
  const pkgDir = join(nodeModulesDir, 'playwright-core')
  await mkdir(pkgDir, { recursive: true })
  await writeFile(join(pkgDir, 'index.mjs'), 'export const chromium = {};\n', 'utf8')
}

describe('playwrightSidecarRuntime', () => {
  beforeEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
    await mkdir(tmpRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('finds staged playwright under app-root/resources/zero-token-runtime', async () => {
    const stagedNm = join(tmpRoot, 'resources', 'zero-token-runtime', 'node_modules')
    await writePlaywrightMarker(stagedNm)

    const hit = resolveStagedPlaywrightNodeModules(tmpRoot)
    expect(hit).toBe(stagedNm)
  })

  it('copies staged playwright beside exe on first ensure', async () => {
    const stagedNm = join(tmpRoot, 'resources', 'zero-token-runtime', 'node_modules')
    await writePlaywrightMarker(stagedNm)

    const exeDir = join(tmpRoot, 'bin')
    await mkdir(exeDir, { recursive: true })
    const originalExecPath = process.execPath
    Object.defineProperty(process, 'execPath', { value: join(exeDir, 'zero-token-gateway.exe') })

    try {
      const nm = await ensurePlaywrightBesideExe(tmpRoot)
      expect(nm).toBe(join(exeDir, 'node_modules'))
    } finally {
      Object.defineProperty(process, 'execPath', { value: originalExecPath })
    }
  }, 15_000)
})
