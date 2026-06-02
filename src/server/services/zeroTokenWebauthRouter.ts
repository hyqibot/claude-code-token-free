import { readWebauthBackend } from './zeroTokenWebauthBackend.js'
import {
  pythonEnsureChromeDebug,
  pythonOnboard,
  pythonSpawnKeepalive,
} from './zeroTokenWebauthPython.js'
import {
  tsEnsureChromeDebugWrapped,
  tsOnboardWrapped,
  tsSpawnKeepalive,
} from './zeroTokenWebauthTs.js'

export function getActiveWebauthBackend(): 'ts' | 'python' {
  return readWebauthBackend()
}

export async function webauthEnsureChromeDebug(
  urls: string[],
  onLine?: (line: string) => void,
): Promise<{ output: string; result: unknown }> {
  if (readWebauthBackend() === 'python') {
    return pythonEnsureChromeDebug(urls, onLine)
  }
  return tsEnsureChromeDebugWrapped(urls, onLine)
}

export async function webauthOnboard(
  mode: string,
  onLine?: (line: string) => void,
): Promise<{ mode: string; output: string; exitCode: number }> {
  if (readWebauthBackend() === 'python') {
    const r = await pythonOnboard(mode, onLine)
    return { mode: mode.trim().toLowerCase(), output: r.output, exitCode: r.exitCode }
  }
  const r = await tsOnboardWrapped(mode, onLine)
  return { mode: r.mode, output: r.output, exitCode: 0 }
}

export function webauthSpawnKeepalive(urls: string[]): number {
  if (readWebauthBackend() === 'python') {
    return pythonSpawnKeepalive(urls)
  }
  return tsSpawnKeepalive(urls)
}
