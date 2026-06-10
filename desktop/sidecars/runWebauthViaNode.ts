import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { prepareSidecarRuntime } from './playwrightSidecarRuntime'
import {
  resolveWebauthNodeBinary,
  resolveWebauthNodeBundlePath,
} from './sidecarRuntimePaths'

/** Playwright connectOverCDP 在 Bun 内会挂起；webauth-runner.exe 统一转 Node 子进程。 */
export { resolveWebauthNodeBinary } from './sidecarRuntimePaths'

export async function runWebauthViaNode(params: {
  appRoot: string
  args: string[]
}): Promise<number> {
  await prepareSidecarRuntime(params.appRoot)

  const bundlePath = resolveWebauthNodeBundlePath(params.appRoot)
  if (!bundlePath) {
    throw new Error(
      `[webauth-runner] 未找到 Node bundle（webauth-runner.node.bundle.mjs）。app-root=${params.appRoot}`,
    )
  }

  const nodeBin = resolveWebauthNodeBinary(params.appRoot)
  const cwd = dirname(process.execPath)
  const env = {
    ...process.env,
    CLAUDE_APP_ROOT: params.appRoot,
    CC_HAHA_ROOT: process.env.CC_HAHA_ROOT?.trim() || params.appRoot,
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(nodeBin, [bundlePath, ...params.args], {
      env,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk)
    })

    child.on('error', (err) => {
      reject(
        new Error(
          `无法启动 Node webauth 子进程 (${nodeBin}): ${err.message}。请重新安装应用（含 zero-token-runtime/node）或设置 CC_HAHA_WEBAUTH_NODE。`,
        ),
      )
    })

    child.on('close', (code) => {
      resolve(code ?? 1)
    })
  })
}
