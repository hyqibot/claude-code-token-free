import { existsSync } from 'node:fs'
import { join } from 'node:path'

const RUNTIME_DIRNAME = 'zero-token-runtime'

/** 安装包内 zero-token-runtime 根目录候选（含 legacy vendor/zero-token-gateway）。 */
export function zeroTokenRuntimeRootCandidates(appRoot: string): string[] {
  const out: string[] = []
  const push = (p: string) => {
    if (p && !out.includes(p)) out.push(p)
  }

  for (const root of [appRoot, join(appRoot, 'resources')]) {
    if (!root?.trim()) continue
    push(join(root, RUNTIME_DIRNAME))
    push(join(root, 'resources', RUNTIME_DIRNAME))
    push(join(root, 'vendor', 'zero-token-gateway'))
    push(join(root, 'resources', 'vendor', 'zero-token-gateway'))
  }

  return out
}

export function resolveStagedPlaywrightNodeModules(appRoot: string): string | null {
  for (const base of zeroTokenRuntimeRootCandidates(appRoot)) {
    const nm = join(base, 'node_modules')
    if (existsSync(join(nm, 'playwright-core', 'index.mjs'))) return nm
  }
  return null
}

export function resolveGatewayBundlePath(appRoot: string): string | null {
  const names = ['gateway.bundle.mjs', join('gateway-entry', 'gateway.bundle.mjs')]
  for (const base of zeroTokenRuntimeRootCandidates(appRoot)) {
    for (const name of names) {
      const p = join(base, name)
      if (existsSync(p)) return p
    }
  }
  return null
}

export function resolveWebauthRunnerBundlePath(appRoot: string): string | null {
  const names = ['webauth-runner.bundle.mjs', 'node-runner.bundle.mjs']
  for (const base of zeroTokenRuntimeRootCandidates(appRoot)) {
    for (const name of names) {
      const p = join(base, name)
      if (existsSync(p)) return p
    }
  }
  return null
}
