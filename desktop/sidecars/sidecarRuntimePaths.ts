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
    // 源码联调：build:sidecars 产物与 vendor bundle（§zero-token-gateway-exe-run-and-release.md）
    push(join(root, 'desktop', 'build-artifacts', RUNTIME_DIRNAME))
    push(join(root, 'vendor', 'copaw-zero-token', 'gateway-entry'))
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
  return resolveWebauthNodeBundlePath(appRoot)
}

/** Node 目标 bundle（Playwright CDP 必须在 Node 子进程跑，Bun 内会挂起）。 */
export function resolveWebauthNodeBundlePath(appRoot: string): string | null {
  const names = [
    'webauth-runner.node.bundle.mjs',
    'webauth-runner.bundle.mjs',
    'node-runner.bundle.mjs',
  ]
  for (const base of zeroTokenRuntimeRootCandidates(appRoot)) {
    for (const name of names) {
      const p = join(base, name)
      if (existsSync(p)) return p
    }
  }
  return null
}

/** 安装包内置 Node（zero-token-runtime/node/node.exe），免用户单独安装。 */
export function resolveBundledNodeBinary(appRoot: string): string | null {
  const binName = process.platform === 'win32' ? 'node.exe' : 'node'
  for (const base of zeroTokenRuntimeRootCandidates(appRoot)) {
    const p = join(base, 'node', binName)
    if (existsSync(p)) return p
  }
  return null
}

export function resolveWebauthNodeBinary(appRoot: string): string {
  const explicit = process.env.CC_HAHA_WEBAUTH_NODE?.trim()
  if (explicit) return explicit

  const bundled = resolveBundledNodeBinary(appRoot)
  if (bundled) return bundled

  return process.platform === 'win32' ? 'node.exe' : 'node'
}
