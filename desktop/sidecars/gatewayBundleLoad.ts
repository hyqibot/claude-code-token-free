import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ensurePlaywrightBesideExe } from './playwrightSidecarRuntime'
import { resolveGatewayBundlePath } from './sidecarRuntimePaths'

export { prepareSidecarRuntime } from './playwrightSidecarRuntime'

export async function loadGatewayBundleFromDisk(appRoot: string): Promise<void> {
  const bundlePath = resolveGatewayBundlePath(appRoot)
  if (!bundlePath) {
    throw new Error(`[sidecar] gateway.bundle.mjs not found (app-root=${appRoot})`)
  }
  const spec = pathToFileURL(bundlePath).href
  await import(/* webpackIgnore: true */ spec)
}
