import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('cursor agent workflow', () => {
  test('uses restricted autonomy and CURSOR_API_KEY', () => {
    const workflow = readFileSync('.github/workflows/cursor-agent.yml', 'utf8')
    const cli = JSON.parse(readFileSync('.cursor/cli.json', 'utf8')) as {
      permissions: { deny: string[] }
    }

    expect(workflow).toContain('CURSOR_API_KEY')
    expect(workflow).toContain('workflow_dispatch')
    expect(workflow).toContain('不要执行 git')
    expect(workflow).toContain('bun run verify')
    expect(workflow).toContain('bun run check:docs')
    expect(cli.permissions.deny).toContain('Shell(git)')
    expect(cli.permissions.deny).toContain('Shell(gh)')
    expect(cli.permissions.deny).toContain('Write(.github/**/*)')
  })

  test('cursor workflow is excluded from public source sync', () => {
    const cfg = JSON.parse(
      readFileSync('scripts/packaging/public-source-excludes.json', 'utf8'),
    ) as { excludeFiles: string[] }

    expect(cfg.excludeFiles).toContain('.github/workflows/cursor-agent.yml')
  })
})
