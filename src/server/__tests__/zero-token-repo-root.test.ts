import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  applyCcHahaRootEnv,
  ccHahaVendorMarkerPath,
  resolveCcHahaRepoRootFromAppRoot,
} from '../services/zeroTokenRepoRoot.js'

function writeVendorMarker(root: string): void {
  const marker = ccHahaVendorMarkerPath(root)
  mkdirSync(join(marker, '..'), { recursive: true })
  writeFileSync(marker, '# stub\n', 'utf8')
}

describe('zeroTokenRepoRoot', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    delete process.env.CC_HAHA_ROOT
    delete process.env.CLAUDE_APP_ROOT
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves vendor from Tauri resources layout', () => {
    const installRoot = mkdtempSync(join(tmpdir(), 'cc-haha-install-'))
    tempDirs.push(installRoot)
    writeVendorMarker(join(installRoot, 'resources'))

    const resolved = resolveCcHahaRepoRootFromAppRoot(installRoot)
    expect(resolved).toBe(join(installRoot, 'resources'))
  })

  it('applyCcHahaRootEnv sets CC_HAHA_ROOT from CLAUDE_APP_ROOT', () => {
    const installRoot = mkdtempSync(join(tmpdir(), 'cc-haha-app-'))
    tempDirs.push(installRoot)
    writeVendorMarker(installRoot)

    process.env.CLAUDE_APP_ROOT = installRoot
    applyCcHahaRootEnv(installRoot)

    expect(process.env.CC_HAHA_ROOT).toBe(installRoot)
  })
})
