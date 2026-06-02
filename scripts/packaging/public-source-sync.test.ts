import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const packagingDir = join(import.meta.dir)

describe('public source sync', () => {
  test('excludes license-server and vendor gateway tree', () => {
    const cfg = JSON.parse(
      readFileSync(join(packagingDir, 'public-source-excludes.json'), 'utf8'),
    ) as { excludeDirectories: string[]; excludeFiles: string[]; excludeDocPaths: string[] }

    expect(cfg.excludeDirectories).toContain('.github/workflows')
    expect(cfg.excludeDirectories).not.toContain('docs/reference')
    expect(cfg.excludeFiles).toContain('.github/workflows/release-desktop.yml')
    expect(cfg.excludeFiles).toContain('.github/workflows/deploy-docs.yml')
    expect(cfg.excludeFiles).toContain('.github/workflows/deploy-public-docs.yml')
    expect(cfg.excludeFiles).toContain('.github/workflows/cursor-agent.yml')
    expect(cfg.excludeDocPaths).toContain('docs/reference/claude-official-models.md')
    expect(cfg.excludeDocPaths).not.toContain('docs/reference/fixes.md')
    expect(cfg.excludeDocPaths).not.toContain('docs/reference/project-structure.md')
    expect(cfg.excludeFiles).toContain('scripts/run-license-server.ts')
    expect(cfg.excludeFiles).toContain('tmp-auth.json')
  })

  test('docs publish policy aligns vitepress exclude with public sync', () => {
    const policy = JSON.parse(
      readFileSync(join(packagingDir, 'docs-publish-policy.json'), 'utf8'),
    ) as { developerReferenceDocs: string[]; userReferenceDocs: string[] }
    const cfg = JSON.parse(
      readFileSync(join(packagingDir, 'public-source-excludes.json'), 'utf8'),
    ) as { excludeDocPaths: string[] }

    expect(policy.userReferenceDocs).toEqual([
      'docs/reference/fixes.md',
      'docs/reference/project-structure.md',
      'docs/en/reference/fixes.md',
      'docs/en/reference/project-structure.md',
    ])
    expect([...policy.developerReferenceDocs].sort()).toEqual([...cfg.excludeDocPaths].sort())
  })

  test('sync script fetches remote main before force-with-lease push', () => {
    const script = readFileSync(join(packagingDir, 'sync-public-source.ts'), 'utf8')
    expect(script).toContain("['fetch', 'origin', 'main'")
    expect(script).toContain('--force-with-lease')
  })

  test('sync workflow targets public releases repo via script', () => {
    const workflow = readFileSync('.github/workflows/sync-public-source.yml', 'utf8')
    expect(workflow).toContain('sync-public-source.ts')
    expect(workflow).toContain('PUBLIC_SOURCE_SYNC_TOKEN')
    expect(workflow).toContain("tags: ['v*.*.*']")
    expect(workflow).toContain('docs/**')
    expect(workflow).toContain('scripts/packaging/**')
    expect(workflow).toContain('scripts/packaging/bunfig.toml')
  })

  test('deploy public docs workflow pushes gh-pages from private repo', () => {
    const workflow = readFileSync('.github/workflows/deploy-public-docs.yml', 'utf8')
    expect(workflow).toContain('peaceiris/actions-gh-pages@v4')
    expect(workflow).toContain('personal_token: ${{ secrets.PUBLIC_SOURCE_SYNC_TOKEN }}')
    expect(workflow).not.toContain('github_token:')
    expect(workflow).toContain('claude-code-token-free')
    expect(workflow).toContain('publish_branch: gh-pages')
    expect(workflow).toContain('Sync Public Source')
  })

  test('github-repos.json defines public releases target', () => {
    const repos = JSON.parse(readFileSync('github-repos.json', 'utf8')) as {
      releases: { owner: string; repo: string }
    }
    expect(repos.releases.owner).toBe('hyqibot')
    expect(repos.releases.repo).toBe('claude-code-token-free')
  })

  test('public vendor dir is placeholder readme only', () => {
    const vendorReadme = readFileSync(join(packagingDir, 'public-source-vendor-readme.md'), 'utf8')
    expect(vendorReadme).toContain('不包含')
    expect(vendorReadme).toContain('Releases')
  })

  test('desktop installation guide uses Free Token branding', () => {
    const install = readFileSync('docs/desktop/04-installation.md', 'utf8')
    expect(install).toContain('Claude Code Free Token')
    expect(install).not.toMatch(/haha/i)
  })

  test('readme uses desktop intro section without preview screenshots', () => {
    const readme = readFileSync('README.md', 'utf8')
    expect(readme).toContain('## 桌面端简介')
    expect(readme).not.toContain('## 桌面端预览')
    expect(readme).not.toContain('docs/images/desktop_ui/01_full_ui.png')
  })

  test('public readme overlay defines run-from-source section', () => {
    const overlay = readFileSync(join(packagingDir, 'public-readme-overlay.ts'), 'utf8')
    expect(overlay).toContain('#### 从源码运行')
    expect(overlay).toContain("PUBLIC_REPO = 'hyqibot/claude-code-token-free'")
    expect(overlay).toContain('injectZhRunFromSource')
  })
})
