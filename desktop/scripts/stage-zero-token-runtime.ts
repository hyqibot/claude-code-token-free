import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { buildWebauthRunnerBundle } from './build-webauth-runner-bundle.ts'
import { stageBundledNode } from './stage-bundled-node.ts'

const repoRoot = path.resolve(import.meta.dir, '../..')
const gatewayDir = path.join(
  repoRoot,
  'vendor',
  'copaw-zero-token',
  'python',
  'src',
  'copaw',
  'zero_token_gateway',
)
const stagingRoot = path.join(repoRoot, 'desktop', 'build-artifacts', 'zero-token-runtime')
const stagingNm = path.join(stagingRoot, 'node_modules')
const gatewayBundleSrc = path.join(
  repoRoot,
  'vendor',
  'copaw-zero-token',
  'gateway-entry',
  'gateway.bundle.mjs',
)
const gatewayBundleDest = path.join(stagingRoot, 'gateway.bundle.mjs')

export async function stageZeroTokenRuntime(): Promise<void> {
  await mkdir(gatewayDir, { recursive: true })

  const playwrightSrc = path.join(gatewayDir, 'node_modules', 'playwright-core')
  if (!existsSync(playwrightSrc)) {
    const installCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const npmProc = Bun.spawn(
      [installCmd, 'install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel', 'error'],
      { cwd: gatewayDir, stdout: 'inherit', stderr: 'inherit', env: process.env },
    )
    const npmExit = await npmProc.exited
    if (npmExit !== 0) {
      throw new Error(
        `[stage-zero-token-runtime] npm install failed (exit ${npmExit}); install Node/npm or pre-run npm install in zero_token_gateway`,
      )
    }
  }

  if (!existsSync(playwrightSrc)) {
    throw new Error(`[stage-zero-token-runtime] missing ${playwrightSrc}`)
  }

  if (!existsSync(gatewayBundleSrc)) {
    throw new Error(
      `[stage-zero-token-runtime] missing ${gatewayBundleSrc}; run build-zero-token-gateway-bundle first`,
    )
  }

  await rm(stagingRoot, { recursive: true, force: true })
  await mkdir(stagingNm, { recursive: true })

  await cp(playwrightSrc, path.join(stagingNm, 'playwright-core'), { recursive: true })
  await cp(gatewayBundleSrc, gatewayBundleDest, { force: true })
  await buildWebauthRunnerBundle()
  await stageBundledNode(stagingRoot)

  console.log(`[stage-zero-token-runtime] -> ${stagingRoot}`)
}

if (import.meta.main) {
  await stageZeroTokenRuntime()
}
