/**
 * Zero-Token 一键授权 webauth runner（P5-3）。
 *
 * Bun 编译的 exe 仅作启动器：准备 playwright 旁路后转 Node 子进程执行 bundle
 * （Bun 内 Playwright connectOverCDP 会挂起，见 zeroTokenWebauthNodeRunner）。
 *
 *   zero-token-webauth-runner.exe --app-root <path> ensure '{"urls":[...]}'
 *   zero-token-webauth-runner.exe --app-root <path> onboard '{"mode":"webauth"}'
 *   zero-token-webauth-runner.exe --app-root <path> keepalive '{"urls":[...]}'
 */
import { parseLauncherArgs } from './launcherRouting'
import { runWebauthViaNode } from './runWebauthViaNode'
import { applyCcHahaRootEnv } from './packagedAppRoot'

async function main() {
  const rawArgs = process.argv.slice(2)
  const { appRoot, args } = parseLauncherArgs(rawArgs, process.env.CLAUDE_APP_ROOT ?? null)
  if (appRoot && !process.env.CLAUDE_APP_ROOT?.trim()) {
    process.env.CLAUDE_APP_ROOT = appRoot
  }
  applyCcHahaRootEnv(appRoot)

  try {
    const code = await runWebauthViaNode({
      appRoot: appRoot || process.env.CC_HAHA_ROOT?.trim() || '.',
      args,
    })
    process.exit(code)
  } catch (err) {
    console.error('[webauth-runner]', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

await main()
