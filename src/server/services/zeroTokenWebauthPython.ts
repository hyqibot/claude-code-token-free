import { dirname, join } from 'path'
import { access, constants as fsConstants } from 'fs/promises'
import { getCcHahaRepoRoot } from './zeroTokenRepoRoot.js'

const VENDOR_ZT_CLI_SEGMENTS = ['vendor', 'copaw-zero-token', 'python', 'copaw_zt_cli.py'] as const

const COPAW_ENSURE_CHROME_DEBUG_SCRIPT = `import json,os,sys
try:
    from copaw.zero_token.webauth import ensure_chrome_debug
    raw=os.environ.get("COPAW_ENSURE_URLS_JSON","[]")
    urls=json.loads(raw)
    r=ensure_chrome_debug(urls=urls)
    print(json.dumps({"ok":True,"result":r}))
except Exception as e:
    print(json.dumps({"ok":False,"error":str(e)}))
    sys.exit(1)
`

const COPAW_KEEPALIVE_SCRIPT = `import json,os,sys,threading
from copaw.zero_token.webauth import start_chrome_debug_keepalive
urls=json.loads(os.environ.get("COPAW_KEEPALIVE_URLS_JSON","[]"))
start_chrome_debug_keepalive(urls=urls, interval_sec=20.0)
threading.Event().wait()
`

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function pythonPathWithVendor(): string {
  const root = getCcHahaRepoRoot()
  const vendorSrc = join(root, 'vendor', 'copaw-zero-token', 'python', 'src')
  const prev = process.env.PYTHONPATH?.trim()
  const sep = process.platform === 'win32' ? ';' : ':'
  return prev ? `${vendorSrc}${sep}${prev}` : vendorSrc
}

export function buildPythonEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env = { ...process.env }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) env[k] = v
    }
  }
  env.PYTHONPATH = pythonPathWithVendor()
  if (!env.PYTHONIOENCODING?.trim()) env.PYTHONIOENCODING = 'utf-8'
  if (!env.PYTHONUTF8?.trim()) env.PYTHONUTF8 = '1'
  if (!env.COPAW_CDP_CONNECT_TIMEOUT_MS?.trim() && !env.COPAW_ZERO_TOKEN_CDP_CONNECT_MS?.trim()) {
    env.COPAW_CDP_CONNECT_TIMEOUT_MS = '60000'
  }
  return env
}

/** Zero-Token 一键授权 / onboard 使用的 Python（避免 PATH 里其它 venv 的 `python` 抢先）。 */
export async function resolvePythonExe(): Promise<string> {
  const explicit = process.env.COPAW_ZERO_TOKEN_PYTHON?.trim()
  if (explicit) return explicit

  const externalCopaw = process.env.COPAW_ZERO_TOKEN_CLI?.trim()
  if (externalCopaw) {
    const scriptsDir = dirname(externalCopaw)
    const low = scriptsDir.toLowerCase()
    const root = join(scriptsDir, '..')
    if (low.endsWith('\\scripts') || low.endsWith('/scripts')) {
      const winPy = join(root, 'python.exe')
      if (await pathExists(winPy)) return winPy
      const u3 = join(root, 'bin', 'python3')
      if (await pathExists(u3)) return u3
      const u = join(root, 'bin', 'python')
      if (await pathExists(u)) return u
    }
  }

  const condaPrefix = process.env.CONDA_PREFIX?.trim()
  if (condaPrefix) {
    if (process.platform === 'win32') {
      const winPy = join(condaPrefix, 'python.exe')
      if (await pathExists(winPy)) return winPy
    } else {
      const u3 = join(condaPrefix, 'bin', 'python3')
      if (await pathExists(u3)) return u3
      const u = join(condaPrefix, 'bin', 'python')
      if (await pathExists(u)) return u
    }
  }

  return process.platform === 'win32' ? 'python' : 'python3'
}

function zeroTokenPlaywrightInstallHint(pythonExe: string): string {
  const root = getCcHahaRepoRoot()
  const req = join(root, 'vendor', 'copaw-zero-token', 'python', 'requirements.txt')
  return (
    `\n\nZero-Token 需要 Python Playwright（步骤 1 ensure_chrome_debug）。当前解释器：${pythonExe}\n` +
    `请执行：\n  "${pythonExe}" -m pip install -r "${req}"\n  "${pythonExe}" -m playwright install chromium\n` +
    `若已激活 conda 环境仍失败，可显式设置 COPAW_ZERO_TOKEN_PYTHON 指向该环境的 python.exe，并重启 cc-haha server。`
  )
}

function parseEnsureChromeDebugJsonOutput(output: string): { ok: boolean; result?: unknown; error?: string } {
  const t = output.trim()
  for (const line of t.split(/\r?\n/).reverse()) {
    const s = line.trim()
    if (s.startsWith('{') && s.endsWith('}')) {
      try {
        return JSON.parse(s) as { ok: boolean; result?: unknown; error?: string }
      } catch {
        // continue
      }
    }
  }
  const end = t.lastIndexOf('}')
  const start = t.lastIndexOf('{', end)
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1)) as { ok: boolean; result?: unknown; error?: string }
    } catch {
      // fall through
    }
  }
  throw new Error('ensure_chrome_debug: no JSON in subprocess output')
}

async function drainReadableLines(
  stream: ReadableStream<Uint8Array> | undefined,
  onLine: (line: string) => void,
  accumulate: (chunk: string) => void,
): Promise<void> {
  if (!stream) return
  const reader = stream.getReader()
  const dec = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true })
  let pending = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      pending += dec.decode(value, { stream: true })
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        accumulate(`${line}\n`)
        onLine(line)
      }
    }
    if (pending.length > 0) {
      accumulate(`${pending}\n`)
      onLine(pending)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }
}

async function drainSpawnPipeBothWithLines(
  proc: {
    stdout: ReadableStream<Uint8Array> | undefined
    stderr: ReadableStream<Uint8Array> | undefined
    exited: Promise<number | null>
  },
  onLine: (line: string) => void,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdoutAcc = ''
  let stderrAcc = ''
  await Promise.all([
    drainReadableLines(proc.stdout, onLine, (c) => {
      stdoutAcc += c
    }),
    drainReadableLines(proc.stderr, onLine, (c) => {
      stderrAcc += c
    }),
  ])
  const exitCode = (await proc.exited) ?? 0
  return { stdout: stdoutAcc, stderr: stderrAcc, exitCode }
}

const DEFAULT_ENSURE_CHROME_DEBUG_MS = 90_000
const DEFAULT_ONBOARD_TIMEOUT_MS = 180_000

async function runZeroTokenCommand(
  args: string[],
  timeoutMs: number = DEFAULT_ONBOARD_TIMEOUT_MS,
  onLine?: (line: string) => void,
): Promise<{ exitCode: number; output: string }> {
  const externalCopaw = process.env.COPAW_ZERO_TOKEN_CLI?.trim()
  const command = externalCopaw
    ? [externalCopaw, 'zero-token', ...args]
    : [await resolvePythonExe(), join(getCcHahaRepoRoot(), ...VENDOR_ZT_CLI_SEGMENTS), ...args]
  const proc = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
    env: buildPythonEnv(),
  })

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      try {
        proc.kill()
      } catch {
        // ignore
      }
    }, timeoutMs)
  }

  const lineCb = onLine ?? (() => {})
  try {
    const { stdout, stderr, exitCode } = await drainSpawnPipeBothWithLines(proc, lineCb)
    return { exitCode, output: `${stdout}\n${stderr}`.trim() }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export async function pythonEnsureChromeDebug(
  urls: string[],
  onLine?: (line: string) => void,
): Promise<{ output: string; result: unknown }> {
  const py = await resolvePythonExe()
  const proc = Bun.spawn([py, '-c', COPAW_ENSURE_CHROME_DEBUG_SCRIPT], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: buildPythonEnv({ COPAW_ENSURE_URLS_JSON: JSON.stringify(urls) }),
  })

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  timeoutId = setTimeout(() => {
    try {
      proc.kill()
    } catch {
      // ignore
    }
  }, DEFAULT_ENSURE_CHROME_DEBUG_MS)

  const lineCb = onLine ?? (() => {})
  let stdoutText = ''
  let stderrText = ''
  let exitCode = 0
  try {
    const drained = await drainSpawnPipeBothWithLines(proc, lineCb)
    stdoutText = drained.stdout
    stderrText = drained.stderr
    exitCode = drained.exitCode
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }

  const output = `${stdoutText}\n${stderrText}`.trim()
  let parsed: { ok: boolean; result?: unknown; error?: string }
  try {
    parsed = parseEnsureChromeDebugJsonOutput(output)
  } catch {
    throw new Error(
      `ensure_chrome_debug failed to parse output (exit ${exitCode}). Install deps: pip install -r vendor/copaw-zero-token/python/requirements.txt && python -m playwright install chromium. Raw:\n${output}`,
    )
  }
  if (!parsed.ok) {
    const err = String(parsed.error || output || 'ensure_chrome_debug failed')
    const hint = /no module named ['"]playwright['"]/i.test(err) ? zeroTokenPlaywrightInstallHint(py) : ''
    throw new Error(err + hint)
  }
  return { output, result: parsed.result ?? {} }
}

export async function pythonOnboard(
  mode: string,
  onLine?: (line: string) => void,
): Promise<{ output: string; exitCode: number }> {
  const result = await runZeroTokenCommand(['onboard', mode.trim().toLowerCase()], DEFAULT_ONBOARD_TIMEOUT_MS, onLine)
  return { output: result.output, exitCode: result.exitCode }
}

export async function pythonSpawnKeepalive(urls: string[]): Promise<number> {
  const py = await resolvePythonExe()
  const child = Bun.spawn([py, '-c', COPAW_KEEPALIVE_SCRIPT], {
    env: buildPythonEnv({ COPAW_KEEPALIVE_URLS_JSON: JSON.stringify(urls) }),
    stdout: 'ignore',
    stderr: 'ignore',
    stdin: 'ignore',
  })
  return child.pid
}

export { COPAW_ENSURE_CHROME_DEBUG_SCRIPT, COPAW_KEEPALIVE_SCRIPT, VENDOR_ZT_CLI_SEGMENTS }
