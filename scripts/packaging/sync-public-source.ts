/**
 * 方案 A：将过滤后的源码单向同步到公开仓 main（不影响私有仓全量内容）。
 *
 * 用法（须用 packaging/bunfig.toml，避免根 bunfig preload 加载 CLI 依赖）:
 *   bun run packaging:sync-public-source:dry
 *   bun run packaging:sync-public-source
 *   bun --config=scripts/packaging/bunfig.toml scripts/packaging/sync-public-source.ts --dry-run
 *
 * 环境变量:
 *   GH_TOKEN / PUBLIC_SOURCE_SYNC_TOKEN — 推送到公开仓的 PAT（contents:write；不同步 workflow 文件）
 *   PUBLIC_SYNC_FORCE=1 — 允许在非 CI 下执行 push（本地慎用）
 */
import { applyPublicReadmeOverlay } from './public-readme-overlay.ts'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '../..')
const excludesPath = join(import.meta.dir, 'public-source-excludes.json')
const vendorReadmeTemplate = join(import.meta.dir, 'public-source-vendor-readme.md')
const reposConfigPath = join(repoRoot, 'github-repos.json')
const userPolicyPath = join(import.meta.dir, 'user-distribution-policy.json')

type ExcludesConfig = {
  excludeDirectoryNamesEverywhere: string[]
  excludeDirectories: string[]
  excludeFiles: string[]
  excludeDocPaths: string[]
  contentScanSkipRelPaths?: string[]
}

type ReposConfig = {
  releases: { owner: string; repo: string; url: string }
}

function parseArgs(): { dryRun: boolean; push: boolean } {
  const argv = process.argv.slice(2)
  return {
    dryRun: argv.includes('--dry-run'),
    push: !argv.includes('--dry-run') && !argv.includes('--no-push'),
  }
}

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\.\//, '')
}

function isExcluded(relPath: string, cfg: ExcludesConfig): boolean {
  const rel = normalizeRel(relPath)
  const parts = rel.split('/')

  for (const name of cfg.excludeDirectoryNamesEverywhere) {
    if (parts.includes(name)) return true
  }

  for (const dir of cfg.excludeDirectories) {
    const d = normalizeRel(dir)
    if (rel === d || rel.startsWith(`${d}/`)) return true
  }

  for (const file of cfg.excludeFiles) {
    if (rel === normalizeRel(file)) return true
  }

  for (const doc of cfg.excludeDocPaths) {
    if (rel === normalizeRel(doc)) return true
  }

  return false
}

async function assertNoGithubWorkflowsInExport(exportRoot: string): Promise<void> {
  const workflowsDir = join(exportRoot, '.github', 'workflows')
  if (!existsSync(workflowsDir)) return
  const names = await readdir(workflowsDir)
  const yml = names.filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))
  if (yml.length === 0) return
  throw new Error(
    `[sync-public-source] 导出树仍含 workflow 文件（需 workflow scope 才能 push）：${yml.map((n) => `.github/workflows/${n}`).join(', ')}`,
  )
}

async function copyFiltered(srcRoot: string, destRoot: string, cfg: ExcludesConfig): Promise<number> {
  let copied = 0

  async function walk(currentSrc: string): Promise<void> {
    const rel = normalizeRel(relative(srcRoot, currentSrc))
    if (rel && isExcluded(rel, cfg)) return

    const st = await stat(currentSrc)
    if (st.isDirectory()) {
      const entries = await readdir(currentSrc)
      for (const name of entries) {
        const childRel = rel ? `${rel}/${name}` : name
        if (isExcluded(childRel, cfg)) continue
        await walk(join(currentSrc, name))
      }
      return
    }

    if (!st.isFile()) return

    const destFile = join(destRoot, rel)
    await mkdir(join(destFile, '..'), { recursive: true })
    await cp(currentSrc, destFile)
    copied++
  }

  await walk(srcRoot)
  return copied
}

async function scanTreeForPolicy(
  root: string,
  forbiddenSegments: string[],
  forbiddenSubstrings: string[],
  skipRelPaths: Set<string>,
): Promise<string[]> {
  const errors: string[] = []

  async function walk(dir: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      const rel = normalizeRel(relative(root, full))
      for (const seg of forbiddenSegments) {
        if (rel.includes(normalizeRel(seg))) {
          errors.push(`禁止路径 "${seg}" 仍在公开树: ${rel}`)
        }
      }
      const st = await stat(full)
      if (st.isDirectory()) {
        if (name === 'node_modules') continue
        await walk(full)
        continue
      }
      if (!st.isFile() || st.size > 8 * 1024 * 1024) continue
      if (skipRelPaths.has(rel)) continue
      const buf = await readFile(full)
      const text = buf.toString('latin1')
      for (const needle of forbiddenSubstrings) {
        if (text.includes(needle)) {
          errors.push(`禁止内容 "${needle}" 仍在: ${rel}`)
        }
      }
    }
  }

  await walk(root)
  return errors
}

async function writePublicMarkers(exportRoot: string): Promise<void> {
  const vendorDir = join(exportRoot, 'vendor', 'copaw-zero-token')
  await mkdir(vendorDir, { recursive: true })
  const readme = await readFile(vendorReadmeTemplate, 'utf8')
  await writeFile(join(vendorDir, 'README.md'), readme, 'utf8')

  const note = `# 公开源码同步说明

本 tree 由私有仓 \`hyqibot/claude-code-private\` 经 \`scripts/packaging/sync-public-source.ts\` 自动生成。
请勿直接在本仓库向私有仓提 PR；Issue 与 Release 以本公开仓为准。

最后同步命令: \`bun run packaging:sync-public-source\`
`
  await writeFile(join(exportRoot, 'PUBLIC_SOURCE.md'), note, 'utf8')
}

async function gitPushExport(exportRoot: string, owner: string, repo: string, token: string): Promise<void> {
  const remoteUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`

  const run = async (args: string[], cwd: string, opts?: { allowFail?: boolean }): Promise<number> => {
    const proc = Bun.spawn(['git', ...args], {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const code = await proc.exited
    if (stdout.trim()) process.stdout.write(stdout)
    if (stderr.trim()) process.stderr.write(stderr)
    if (code !== 0 && !opts?.allowFail) {
      const combined = `${stdout}\n${stderr}`
      if (combined.includes('without `workflow` scope')) {
        throw new Error(
          'git push 被拒：PAT 缺少 workflow scope。请更新 scripts/packaging/public-source-excludes.json 排除 .github/workflows，或换带 workflow 权限的 PAT。',
        )
      }
      throw new Error(`git ${args.join(' ')} failed (exit ${code})`)
    }
    return code
  }

  await run(['init'], exportRoot)
  await run(['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'], exportRoot)
  await run(['config', 'user.name', 'github-actions[bot]'], exportRoot)
  await run(['remote', 'add', 'origin', remoteUrl], exportRoot)
  await run(['checkout', '-B', 'main'], exportRoot)
  await run(['add', '-A'], exportRoot)

  const statusProc = Bun.spawn(['git', 'status', '--porcelain'], {
    cwd: exportRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const statusOut = await new Response(statusProc.stdout).text()
  await statusProc.exited

  if (!statusOut.trim()) {
    console.log('[sync-public-source] 无变更，跳过 push')
    return
  }

  await run(['commit', '-m', 'chore: sync public source from private repo'], exportRoot)

  // 须先 fetch，否则 fresh init 下 --force-with-lease 会因无 origin/main 报 stale info
  const fetchedMain = (await run(['fetch', 'origin', 'main', '--depth=1'], exportRoot, { allowFail: true })) === 0
  if (fetchedMain) {
    await run(['push', '--force-with-lease', 'origin', 'main'], exportRoot)
  } else {
    console.log('[sync-public-source] 远程尚无 main，使用 --force 首次推送')
    await run(['push', '--force', 'origin', 'main'], exportRoot)
  }
}

async function main(): Promise<void> {
  const { dryRun, push } = parseArgs()
  const cfg = JSON.parse(await readFile(excludesPath, 'utf8')) as ExcludesConfig
  const repos = JSON.parse(await readFile(reposConfigPath, 'utf8')) as ReposConfig
  const userPolicy = JSON.parse(await readFile(userPolicyPath, 'utf8')) as {
    forbiddenPathSegments: string[]
    forbiddenContentSubstrings: string[]
  }

  const exportRoot = await mkdtemp(join(tmpdir(), 'cc-haha-public-sync-'))
  console.log(`[sync-public-source] export -> ${exportRoot}`)

  const copied = await copyFiltered(repoRoot, exportRoot, cfg)
  await writePublicMarkers(exportRoot)
  await applyPublicReadmeOverlay(exportRoot)

  const scanErrors = await scanTreeForPolicy(
    exportRoot,
    userPolicy.forbiddenPathSegments,
    userPolicy.forbiddenContentSubstrings,
    new Set((cfg.contentScanSkipRelPaths ?? []).map(normalizeRel)),
  )
  if (scanErrors.length > 0) {
    console.error('[sync-public-source] 公开树校验失败:\n' + scanErrors.map((e) => `  - ${e}`).join('\n'))
    if (!dryRun) await rm(exportRoot, { recursive: true, force: true })
    process.exit(1)
  }

  console.log(`[sync-public-source] OK — 复制 ${copied} 个文件；已排除 license-server / vendor 网关 / 开发者 reference 备忘`)

  await assertNoGithubWorkflowsInExport(exportRoot)

  if (dryRun) {
    console.log(`[sync-public-source] dry-run：保留导出目录 ${exportRoot}`)
    return
  }

  if (!push) {
    console.log('[sync-public-source] --no-push：跳过 git push')
    return
  }

  const token =
    process.env.PUBLIC_SOURCE_SYNC_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim()

  if (!token) {
    console.error('[sync-public-source] 缺少 PUBLIC_SOURCE_SYNC_TOKEN / GH_TOKEN')
    process.exit(1)
  }

  if (process.env.CI !== 'true' && process.env.PUBLIC_SYNC_FORCE !== '1') {
    console.error(
      '[sync-public-source] 本地 push 已禁用；请设 PUBLIC_SYNC_FORCE=1 或在 CI 中运行',
    )
    process.exit(1)
  }

  const { owner, repo } = repos.releases
  console.log(`[sync-public-source] pushing to ${owner}/${repo} main ...`)
  await gitPushExport(exportRoot, owner, repo, token)
  await rm(exportRoot, { recursive: true, force: true })
  console.log(`[sync-public-source] done — https://github.com/${owner}/${repo}`)
}

main().catch((err) => {
  console.error('[sync-public-source] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
