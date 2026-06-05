/**
 * Zero-Token 网关独立 sidecar（B1）。
 *
 *   zero-token-gateway.exe --app-root <path> [--host 127.0.0.1] [--port 3002]
 *
 * playwright-core 链接/复制到 exe 同级 node_modules；gateway.bundle.mjs 从安装目录运行时加载
 * （禁止字面量 import bundle 或 ../../src，否则 Bun compile 会在启动前解析开发机路径）。
 */
import './gatewayTlsBootstrap.ts'
import { parseLauncherArgs } from './launcherRouting'
import { loadGatewayBundleFromDisk, prepareSidecarRuntime } from './gatewayBundleLoad'
import { applyCcHahaRootEnv } from './packagedAppRoot'

async function main() {
  const rawArgs = process.argv.slice(2)
  const { appRoot, args } = parseLauncherArgs(rawArgs, process.env.CLAUDE_APP_ROOT ?? null)
  if (appRoot && !process.env.CLAUDE_APP_ROOT?.trim()) {
    process.env.CLAUDE_APP_ROOT = appRoot
  }
  applyCcHahaRootEnv(appRoot)
  applyHostPortArgs(args)

  try {
    await prepareSidecarRuntime(appRoot)
    await loadGatewayBundleFromDisk(appRoot)
  } catch (err) {
    console.error('[zero-token-gateway]', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

function applyHostPortArgs(args: string[]) {
  let host = process.env.COPAW_ZERO_TOKEN_HOST?.trim() || '127.0.0.1'
  let port = process.env.COPAW_ZERO_TOKEN_PORT?.trim() || '3002'

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--host' && args[i + 1]) {
      host = args[++i]!.trim()
      continue
    }
    if (arg === '--port' && args[i + 1]) {
      port = args[++i]!.trim()
      continue
    }
  }

  process.env.COPAW_ZERO_TOKEN_HOST = host
  process.env.COPAW_ZERO_TOKEN_PORT = port
  process.env.ICLAW_ZERO_TOKEN_HOST = host
  process.env.ICLAW_ZERO_TOKEN_PORT = port
}

await main()
