import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** 与 docs / CI Node 22 对齐；仅打包 node 二进制供 webauth onboard。 */
export const BUNDLED_NODE_VERSION = process.env.CC_HAHA_BUNDLED_NODE_VERSION?.trim() || '22.19.0'

type NodeDist = {
  archiveName: string
  archiveExt: 'zip' | 'tar.gz'
  binaryInArchive: string
}

function nodeDistForTriple(triple: string): NodeDist {
  const ver = BUNDLED_NODE_VERSION
  if (triple.includes('windows')) {
    const arch = triple.includes('aarch64') ? 'arm64' : 'x64'
    const folder = `node-v${ver}-win-${arch}`
    return {
      archiveName: folder,
      archiveExt: 'zip',
      binaryInArchive: `${folder}/node.exe`,
    }
  }
  if (triple.includes('apple')) {
    const arch = triple.includes('aarch64') ? 'arm64' : 'x64'
    const folder = `node-v${ver}-darwin-${arch}`
    return {
      archiveName: folder,
      archiveExt: 'tar.gz',
      binaryInArchive: `${folder}/bin/node`,
    }
  }
  const arch = triple.includes('aarch64') ? 'arm64' : 'x64'
  const folder = `node-v${ver}-linux-${arch}`
  return {
    archiveName: folder,
    archiveExt: 'tar.gz',
    binaryInArchive: `${folder}/bin/node`,
  }
}

async function detectTargetTriple(): Promise<string> {
  const fromEnv =
    process.env.TAURI_ENV_TARGET_TRIPLE?.trim() || process.env.CARGO_BUILD_TARGET?.trim()
  if (fromEnv) return fromEnv

  const proc = Bun.spawn(['rustc', '-vV'], { stdout: 'pipe', stderr: 'pipe' })
  const stdout = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error('[stage-bundled-node] rustc -vV failed')
  }
  const hostLine = stdout
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('host: '))
  if (!hostLine) throw new Error('[stage-bundled-node] could not detect host triple')
  return hostLine.replace('host: ', '')
}

async function copyFromLocalSource(dest: string, source: string): Promise<void> {
  if (!existsSync(source)) {
    throw new Error(`[stage-bundled-node] CC_HAHA_BUNDLED_NODE_SOURCE not found: ${source}`)
  }
  await mkdir(path.dirname(dest), { recursive: true })
  await cp(source, dest, { force: true })
  console.log(`[stage-bundled-node] copied local node -> ${dest}`)
}

async function downloadArchive(url: string, dest: string): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`[stage-bundled-node] download failed ${res.status}: ${url}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await Bun.write(dest, buf)
}

async function extractNodeBinary(params: {
  archivePath: string
  dist: NodeDist
  destBinary: string
}): Promise<void> {
  const tmpDir = path.join(path.dirname(params.archivePath), `extract-${params.dist.archiveName}`)
  await rm(tmpDir, { recursive: true, force: true })
  await mkdir(tmpDir, { recursive: true })

  const tarArgs =
    params.dist.archiveExt === 'zip'
      ? ['-xf', params.archivePath, '-C', tmpDir]
      : ['-xzf', params.archivePath, '-C', tmpDir]

  const proc = Bun.spawn(['tar', ...tarArgs], { stdout: 'pipe', stderr: 'pipe' })
  const stderr = proc.stderr ? await new Response(proc.stderr).text() : ''
  const code = (await proc.exited) ?? 1
  if (code !== 0) {
    throw new Error(`[stage-bundled-node] tar extract failed: ${stderr}`)
  }

  const extracted = path.join(tmpDir, params.dist.binaryInArchive)
  if (!existsSync(extracted)) {
    throw new Error(`[stage-bundled-node] missing ${extracted} after extract`)
  }

  await mkdir(path.dirname(params.destBinary), { recursive: true })
  await cp(extracted, params.destBinary, { force: true })
  if (process.platform !== 'win32') {
    await Bun.spawn(['chmod', '+x', params.destBinary]).exited
  }
  await rm(tmpDir, { recursive: true, force: true })
}

/**
 * 将官方 Node 便携二进制放入 zero-token-runtime/node/，随 Tauri resources 分发。
 * 跳过：CC_HAHA_SKIP_BUNDLED_NODE=1
 * 本地复制：CC_HAHA_BUNDLED_NODE_SOURCE=C:\\path\\to\\node.exe
 */
export async function stageBundledNode(stagingRoot: string): Promise<void> {
  if (process.env.CC_HAHA_SKIP_BUNDLED_NODE?.trim() === '1') {
    console.log('[stage-bundled-node] skipped (CC_HAHA_SKIP_BUNDLED_NODE=1)')
    return
  }

  const triple = await detectTargetTriple()
  const dist = nodeDistForTriple(triple)
  const binName = triple.includes('windows') ? 'node.exe' : 'node'
  const destBinary = path.join(stagingRoot, 'node', binName)

  if (existsSync(destBinary) && process.env.CC_HAHA_FORCE_BUNDLED_NODE?.trim() !== '1') {
    console.log(`[stage-bundled-node] reuse ${destBinary}`)
    return
  }

  const localSource = process.env.CC_HAHA_BUNDLED_NODE_SOURCE?.trim()
  if (localSource) {
    await copyFromLocalSource(destBinary, localSource)
    return
  }

  const cacheDir = path.join(stagingRoot, '..', 'cache', 'bundled-node')
  await mkdir(cacheDir, { recursive: true })
  const archiveFile = `${dist.archiveName}.${dist.archiveExt}`
  const archivePath = path.join(cacheDir, archiveFile)
  const url = `https://nodejs.org/dist/v${BUNDLED_NODE_VERSION}/${archiveFile}`

  if (!existsSync(archivePath)) {
    console.log(`[stage-bundled-node] downloading ${url}`)
    await downloadArchive(url, archivePath)
  } else {
    console.log(`[stage-bundled-node] using cache ${archivePath}`)
  }

  await extractNodeBinary({ archivePath, dist, destBinary })
  console.log(`[stage-bundled-node] -> ${destBinary} (${triple}, v${BUNDLED_NODE_VERSION})`)
}

if (import.meta.main) {
  const stagingRoot = path.resolve(
    import.meta.dir,
    '../build-artifacts/zero-token-runtime',
  )
  await stageBundledNode(stagingRoot)
}
