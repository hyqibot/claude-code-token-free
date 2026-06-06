import { cp, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { verifyUserArtifacts } from '../../scripts/packaging/verify-user-artifacts.ts'
import { buildZeroTokenGatewayBundle } from './build-zero-token-gateway-bundle.ts'
import { scanMissingImports } from './scan-missing-imports.ts'
import { stageZeroTokenRuntime } from './stage-zero-token-runtime.ts'

const desktopRoot = path.resolve(import.meta.dir, '..')
const repoRoot = path.resolve(desktopRoot, '..')
const binariesDir = path.join(desktopRoot, 'src-tauri', 'binaries')
const sidecarBunfig = path.join(desktopRoot, 'scripts/bunfig.toml')

const targetTriple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.CARGO_BUILD_TARGET ||
  (await detectHostTriple())

const bunTarget = mapTargetTripleToBun(targetTriple)

const SIDEcar_EXTERNAL = [
  '@opentelemetry/exporter-trace-otlp-grpc',
  '@opentelemetry/exporter-trace-otlp-http',
  '@opentelemetry/exporter-trace-otlp-proto',
  '@opentelemetry/exporter-logs-otlp-grpc',
  '@opentelemetry/exporter-logs-otlp-http',
  '@opentelemetry/exporter-logs-otlp-proto',
  '@opentelemetry/exporter-metrics-otlp-grpc',
  '@opentelemetry/exporter-metrics-otlp-http',
  '@opentelemetry/exporter-metrics-otlp-proto',
  '@opentelemetry/exporter-prometheus',
  '@aws-sdk/client-bedrock',
  '@aws-sdk/client-sts',
  '@anthropic-ai/bedrock-sdk',
  '@anthropic-ai/foundry-sdk',
  '@anthropic-ai/vertex-sdk',
  '@azure/identity',
  '@anthropic-ai/mcpb',
  'fflate',
  'sharp',
  'react-devtools-core',
  'audio-capture-napi',
  'image-processor-napi',
  'url-handler-napi',
] as const

console.log('[build-sidecars] building zero-token gateway bundle...')
await buildZeroTokenGatewayBundle()

console.log('[build-sidecars] staging zero-token runtime...')
await stageZeroTokenRuntime()

console.log('[build-sidecars] scanning for missing imports...')
await scanMissingImports()

await mkdir(binariesDir, { recursive: true })

await compileExecutable({
  entrypoint: path.join(desktopRoot, 'sidecars/claude-sidecar.ts'),
  outfileBase: path.join(binariesDir, `claude-sidecar-${targetTriple}`),
  productName: 'Claude Code Sidecar',
  bunTarget,
  targetTriple,
  external: [...SIDEcar_EXTERNAL],
})

await compileExecutable({
  entrypoint: path.join(desktopRoot, 'sidecars/zero-token-gateway.ts'),
  outfileBase: path.join(binariesDir, `zero-token-gateway-${targetTriple}`),
  productName: 'Zero-Token Gateway',
  bunTarget,
  targetTriple,
  external: [...SIDEcar_EXTERNAL],
})

await compileExecutable({
  entrypoint: path.join(desktopRoot, 'sidecars/zero-token-webauth-runner.ts'),
  outfileBase: path.join(binariesDir, `zero-token-webauth-runner-${targetTriple}`),
  productName: 'Zero-Token Webauth Runner',
  bunTarget,
  targetTriple,
  external: [...SIDEcar_EXTERNAL],
})

console.log(`[build-sidecars] Built desktop sidecars for ${targetTriple} (${bunTarget})`)

assertTauriExternalBinsExist(binariesDir, targetTriple)

await copyPlaywrightBesideSidecars(binariesDir)

verifyUserArtifacts()

async function detectHostTriple() {
  const proc = Bun.spawn(['rustc', '-vV'], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    throw new Error(`[build-sidecars] rustc -vV failed: ${stderr || stdout}`)
  }

  const hostLine = stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('host: '))

  if (!hostLine) {
    throw new Error('[build-sidecars] Could not detect Rust host triple')
  }

  return hostLine.replace('host: ', '')
}

function mapTargetTripleToBun(triple: string) {
  switch (triple) {
    case 'aarch64-apple-darwin':
      return 'bun-darwin-arm64'
    case 'x86_64-apple-darwin':
      return 'bun-darwin-x64'
    case 'x86_64-pc-windows-msvc':
      return 'bun-windows-x64'
    case 'aarch64-pc-windows-msvc':
      return 'bun-windows-arm64'
    case 'x86_64-unknown-linux-gnu':
      return 'bun-linux-x64-baseline'
    case 'aarch64-unknown-linux-gnu':
      return 'bun-linux-arm64'
    case 'x86_64-unknown-linux-musl':
      return 'bun-linux-x64-musl'
    case 'aarch64-unknown-linux-musl':
      return 'bun-linux-arm64-musl'
    default:
      throw new Error(`[build-sidecars] Unsupported target triple: ${triple}`)
  }
}

async function compileExecutable({
  entrypoint,
  outfileBase,
  productName,
  bunTarget,
  targetTriple,
  external = [],
}: {
  entrypoint: string
  outfileBase: string
  productName: string
  bunTarget: string
  targetTriple: string
  external?: string[]
}) {
  // cc-haha-main 用 bun build --compile CLI；Bun.build({ compile }) 在 CI 上可能不写 outfile。
  const outfile = path.resolve(outfileBase)
  const args = [
    `--config=${sidecarBunfig}`,
    'build',
    '--compile',
    `--target=${bunTarget}`,
    `--outfile=${outfile}`,
    '--minify-whitespace',
    '--minify-syntax',
    '--minify-identifiers',
    '--sourcemap=none',
  ]
  for (const pkg of external) {
    args.push('--external', pkg)
  }
  args.push(entrypoint)

  const proc = Bun.spawn(['bun', ...args], {
    cwd: desktopRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`[build-sidecars] Failed to compile ${productName} (exit ${exitCode})`)
  }

  const outputPath = await normalizeSidecarOutput(outfileBase, targetTriple)
  console.log(`[build-sidecars] ${productName} -> ${outputPath}`)

  if (process.platform === 'darwin') {
    await adHocSignMacBinary(outputPath)
  }
}

function tauriSidecarPath(outfileBase: string, targetTriple: string): string {
  const base = path.resolve(outfileBase)
  return targetTriple.includes('windows') ? `${base}.exe` : base
}

async function normalizeSidecarOutput(outfileBase: string, targetTriple: string): Promise<string> {
  const expected = tauriSidecarPath(outfileBase, targetTriple)
  const base = path.resolve(outfileBase)
  const candidates = [expected, `${base}.exe`, base]

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    if (candidate === expected) return expected
    await mkdir(path.dirname(expected), { recursive: true })
    await rename(candidate, expected)
    return expected
  }

  throw new Error(
    `[build-sidecars] Compiled output not found (tried: ${[...new Set(candidates)].join(', ')})`,
  )
}

function assertTauriExternalBinsExist(binariesDir: string, targetTriple: string): void {
  for (const name of ['claude-sidecar', 'zero-token-gateway', 'zero-token-webauth-runner']) {
    const expected = tauriSidecarPath(
      path.join(binariesDir, `${name}-${targetTriple}`),
      targetTriple,
    )
    if (!existsSync(expected)) {
      throw new Error(`[build-sidecars] Tauri externalBin missing: ${expected}`)
    }
  }
}

async function copyPlaywrightBesideSidecars(binariesDir: string) {
  const stagingNm = path.join(
    repoRoot,
    'desktop',
    'build-artifacts',
    'zero-token-runtime',
    'node_modules',
  )
  const src = path.join(stagingNm, 'playwright-core')
  const dest = path.join(binariesDir, 'node_modules', 'playwright-core')
  if (!existsSync(src)) {
    console.warn('[build-sidecars] skip binaries/node_modules copy — staging playwright missing')
    return
  }
  await mkdir(path.join(binariesDir, 'node_modules'), { recursive: true })
  await cp(src, dest, { recursive: true, force: true })
  console.log(`[build-sidecars] playwright-core -> ${dest}`)
}

async function adHocSignMacBinary(outputPath: string) {
  console.log(`[build-sidecars] ad-hoc signing ${outputPath} for macOS ...`)
  const strip = Bun.spawn(['codesign', '--remove-signature', outputPath], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await strip.exited

  const sign = Bun.spawn(
    ['codesign', '--sign', '-', '--force', '--timestamp=none', outputPath],
    { stdout: 'inherit', stderr: 'inherit' },
  )
  const signExit = await sign.exited
  if (signExit !== 0) {
    throw new Error(`[build-sidecars] ad-hoc codesign failed for ${outputPath} (exit ${signExit})`)
  }
  console.log(`[build-sidecars] ad-hoc signed ${outputPath}`)
}
