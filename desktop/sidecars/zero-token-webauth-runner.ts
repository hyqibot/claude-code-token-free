/**
 * Zero-Token 一键授权 webauth runner（P5-3）。
 *
 *   zero-token-webauth-runner.exe --app-root <path> ensure '{"urls":[...]}'
 *   zero-token-webauth-runner.exe --app-root <path> onboard '{"mode":"deepseek-chat"}'
 */
import { parseLauncherArgs } from './launcherRouting'
import { loadWebauthRunnerBundleFromDisk, prepareSidecarRuntime } from './webauthBundleLoad'
import { applyCcHahaRootEnv } from './packagedAppRoot'

async function main() {
  const rawArgs = process.argv.slice(2)
  const { appRoot, args } = parseLauncherArgs(rawArgs, process.env.CLAUDE_APP_ROOT ?? null)
  if (appRoot && !process.env.CLAUDE_APP_ROOT?.trim()) {
    process.env.CLAUDE_APP_ROOT = appRoot
  }
  applyCcHahaRootEnv(appRoot)

  try {
    await prepareSidecarRuntime(appRoot || process.env.CC_HAHA_ROOT?.trim() || '.')
    process.argv = [process.argv[0]!, process.argv[1]!, ...args]
    await loadWebauthRunnerBundleFromDisk(appRoot || process.env.CC_HAHA_ROOT?.trim() || '.')
  } catch (err) {
    console.error('[webauth-runner]', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

await main()
