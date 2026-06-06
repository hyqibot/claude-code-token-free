import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dir, '../..')
const entry = path.join(repoRoot, 'vendor', 'copaw-zero-token', 'webauth-ts', 'node-runner-entry.ts')
const outDir = path.join(repoRoot, 'desktop', 'build-artifacts', 'zero-token-runtime')
const outfile = path.join(outDir, 'webauth-runner.node.bundle.mjs')

export async function buildWebauthRunnerBundle(): Promise<void> {
  await mkdir(outDir, { recursive: true })

  const result = await Bun.build({
    entrypoints: [entry],
    target: 'node',
    format: 'esm',
    external: ['playwright-core'],
    minify: true,
  })

  if (!result.success) {
    const logs = result.logs.map((log) => log.message).join('\n')
    throw new Error(`[build-webauth-runner-bundle] failed:\n${logs}`)
  }

  const artifact = result.outputs[0]
  if (!artifact) {
    throw new Error('[build-webauth-runner-bundle] no output artifact')
  }

  await Bun.write(outfile, artifact)
  console.log(`[build-webauth-runner-bundle] -> ${outfile}`)
}

if (import.meta.main) {
  await buildWebauthRunnerBundle()
}
