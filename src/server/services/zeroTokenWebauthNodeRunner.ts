import { spawn } from 'node:child_process'
import { access, constants as fsConstants } from 'node:fs/promises'
import { join } from 'node:path'
import { getZeroTokenWebauthTsDir } from './zeroTokenRepoRoot.js'
import { resolveWebauthSpawnPlan } from './zeroTokenWebauthSpawn.js'

type RunnerEvent =
  | { type: 'line'; text: string }
  | { type: 'complete'; result?: unknown; output?: string; mode?: string }
  | { type: 'error'; message: string }

let bundleBuildPromise: Promise<string> | null = null

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

async function resolveWebauthNodeRunnerBundle(): Promise<string> {
  const dir = getZeroTokenWebauthTsDir()
  const bundle = join(dir, 'node-runner.bundle.mjs')
  if (await pathExists(bundle)) return bundle

  if (!bundleBuildPromise) {
    bundleBuildPromise = (async () => {
      const entry = join(dir, 'node-runner-entry.ts')
      if (!(await pathExists(entry))) {
        throw new Error(`缺少 webauth Node 入口: ${entry}`)
      }
      const proc = Bun.spawn(
        [
          'bun',
          'build',
          entry,
          '--outfile',
          bundle,
          '--target=node',
          '--format=esm',
          '--minify',
        ],
        { cwd: dir, stdout: 'pipe', stderr: 'pipe' },
      )
      const stderr = proc.stderr ? await new Response(proc.stderr).text() : ''
      const code = (await proc.exited) ?? 1
      if (code !== 0 || !(await pathExists(bundle))) {
        throw new Error(`构建 webauth Node bundle 失败: ${stderr}`)
      }
      return bundle
    })().finally(() => {
      bundleBuildPromise = null
    })
  }
  return bundleBuildPromise
}

/** Playwright CDP 在 Bun 内会超时；webauth 经 exe 或 Node 子进程跑。 */
export function shouldRunWebauthInNodeSubprocess(): boolean {
  if (process.env.CC_HAHA_WEBAUTH_FORCE_NODE?.trim() === '0') return false
  if (process.env.CC_HAHA_WEBAUTH_FORCE_NODE?.trim() === '1') return true
  return Boolean(process.versions.bun)
}

async function runWebauthNodeRunner(
  cmd: 'ensure' | 'onboard',
  payload: Record<string, unknown>,
  onLine?: (line: string) => void,
): Promise<{ result?: unknown; output: string; mode?: string; spawnMode?: 'exe' | 'node' }> {
  const { resolveWebauthSpawnMode, resolveZeroTokenWebauthRunnerExecutable } =
    await import('./zeroTokenWebauthSpawn.js')

  const preferExe = resolveWebauthSpawnMode() === 'exe'
  const exePath = preferExe ? await resolveZeroTokenWebauthRunnerExecutable() : null

  if (!exePath) {
    if (process.env.CC_HAHA_WEBAUTH_SPAWN_MODE?.trim().toLowerCase() === 'exe') {
      throw new Error(
        '未找到 zero-token-webauth-runner 可执行文件。请先 bun run build:sidecars，或设置 CC_HAHA_WEBAUTH_RUNNER_EXE。',
      )
    }
    await resolveWebauthNodeRunnerBundle()
  }

  const plan = await resolveWebauthSpawnPlan({ cmd, payload })
  const { argv, cwd, mode: spawnMode } = plan
  const executable = argv[0]!
  const spawnArgs = argv.slice(1)

  return await new Promise((resolve, reject) => {
    const child = spawn(executable, spawnArgs, {
      env: process.env,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stderr = ''
    let buffer = ''
    let complete: Extract<RunnerEvent, { type: 'complete' }> | null = null
    const outputLines: string[] = []

    const handleLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return
      let evt: RunnerEvent
      try {
        evt = JSON.parse(trimmed) as RunnerEvent
      } catch {
        outputLines.push(trimmed)
        onLine?.(trimmed)
        return
      }
      if (evt.type === 'line') {
        outputLines.push(evt.text)
        onLine?.(evt.text)
      } else if (evt.type === 'complete') {
        complete = evt
      } else if (evt.type === 'error') {
        reject(new Error(evt.message))
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''
      for (const line of parts) handleLine(line)
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (err) => {
      reject(
        new Error(
          `无法启动 webauth ${spawnMode} 子进程 (${executable}): ${err.message}`,
        ),
      )
    })

    child.on('close', (code) => {
      if (buffer.trim()) handleLine(buffer)
      if (complete) {
        resolve({
          result: complete.result,
          output: complete.output ?? outputLines.join('\n'),
          mode: complete.mode,
          spawnMode,
        })
        return
      }
      const detail = stderr.trim() || outputLines.join('\n')
      reject(
        new Error(
          `webauth ${cmd} (${spawnMode}) 失败 (exit ${code ?? '?'}): ${detail || 'no output'}`,
        ),
      )
    })
  })
}

export async function nodeEnsureChromeDebug(
  urls: string[],
  onLine?: (line: string) => void,
): Promise<{ output: string; result: unknown; spawnMode?: 'exe' | 'node' }> {
  const { result, output, spawnMode } = await runWebauthNodeRunner('ensure', { urls }, onLine)
  return { output, result: result ?? {}, spawnMode }
}

export async function nodeOnboard(
  mode: string,
  onLine?: (line: string) => void,
): Promise<{ mode: string; output: string; spawnMode?: 'exe' | 'node' }> {
  const { mode: normalized, output, spawnMode } = await runWebauthNodeRunner(
    'onboard',
    { mode },
    onLine,
  )
  return { mode: normalized ?? mode.trim().toLowerCase(), output: output ?? '', spawnMode }
}
