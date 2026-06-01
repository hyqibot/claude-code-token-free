import { pathToFileURL } from 'node:url'
import { prepareSidecarRuntime } from './playwrightSidecarRuntime'
import { resolveWebauthRunnerBundlePath } from './sidecarRuntimePaths'

export async function loadWebauthRunnerBundleFromDisk(appRoot: string): Promise<void> {
  const bundlePath = resolveWebauthRunnerBundlePath(appRoot)
  if (!bundlePath) {
    throw new Error(`[sidecar] webauth-runner.bundle.mjs not found (app-root=${appRoot})`)
  }
  const spec = pathToFileURL(bundlePath).href
  await import(/* webpackIgnore: true */ spec)
}

export { prepareSidecarRuntime }
