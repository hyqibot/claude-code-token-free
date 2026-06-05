import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dir, '../..')
const entry = path.join(
  repoRoot,
  'vendor',
  'copaw-zero-token',
  'python',
  'src',
  'copaw',
  'zero_token_gateway',
  'server.mjs',
)
const outDir = path.join(repoRoot, 'vendor', 'copaw-zero-token', 'gateway-entry')
const outfile = path.join(outDir, 'gateway.bundle.mjs')

/** 用 Bun.build API 打 gateway bundle，避免子进程 `bun build` 再次加载根 bunfig preload。 */
export async function buildZeroTokenGatewayBundle(): Promise<void> {
  await mkdir(outDir, { recursive: true })

  const result = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    format: 'esm',
    external: ['playwright-core'],
    minify: true,
  })

  if (!result.success) {
    const logs = result.logs.map((log) => log.message).join('\n')
    throw new Error(`[build-zero-token-gateway-bundle] failed:\n${logs}`)
  }

  const artifact = result.outputs[0]
  if (!artifact) {
    throw new Error('[build-zero-token-gateway-bundle] no output artifact')
  }

  await Bun.write(outfile, artifact)
  console.log(`[build-zero-token-gateway-bundle] -> ${outfile}`)
}

if (import.meta.main) {
  await buildZeroTokenGatewayBundle()
}
