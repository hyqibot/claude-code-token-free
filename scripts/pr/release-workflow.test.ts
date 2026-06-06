import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('release desktop workflow', () => {
  test('build job runs directly without quality preflight dependency', () => {
    const workflow = readFileSync('.github/workflows/release-desktop.yml', 'utf8')

    expect(workflow).not.toContain('quality-preflight:')
    expect(workflow).not.toContain('run: bun run quality:gate --mode pr')
    expect(workflow).not.toContain('needs: quality-preflight')
    expect(workflow).toContain('name: Build (${{ matrix.label }})')
  })

  test('publishes release assets to public releases repo', () => {
    const workflow = readFileSync('.github/workflows/release-desktop.yml', 'utf8')

    expect(workflow).toContain('PUBLIC_RELEASE_OWNER: hyqibot')
    expect(workflow).toContain('PUBLIC_RELEASE_REPO: claude-code-token-free')
    expect(workflow).toContain('secrets.PUBLIC_RELEASES_TOKEN')
    expect(workflow).toContain('owner: ${{ env.PUBLIC_RELEASE_OWNER }}')
    expect(workflow).toContain('repo: ${{ env.PUBLIC_RELEASE_REPO }}')
    expect(workflow).toContain('ensure-public-release-tag')
    expect(workflow).toContain('Sync release tag to public main')
    expect(workflow).toContain('git/refs/tags/${TAG}')
    expect(workflow).toContain('force=true')
    expect(workflow).toContain('releaseCommitish: main')
    expect(workflow).toContain('Claude Code Free Token v[version]')
    expect(workflow).not.toContain('Claude-Code-Haha_')
    expect(workflow).toContain('prepare-public-release')
    expect(workflow).toContain('Clear public release assets')
    expect(workflow).toContain('retryAttempts: 5')
    expect(workflow).toContain('--config=src-tauri/tauri.release-ci.json')
    expect(workflow).toContain('cancel-in-progress: false')
    expect(workflow).toContain('release-gate')
  })
})
