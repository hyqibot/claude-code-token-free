import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  resolveBundledNodeBinary,
  resolveWebauthNodeBinary,
} from './sidecarRuntimePaths'

const tmpRoot = join(process.cwd(), '.tmp-bundled-node-test')

describe('sidecarRuntimePaths bundled node', () => {
  beforeEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
    await mkdir(tmpRoot, { recursive: true })
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
    delete process.env.CC_HAHA_WEBAUTH_NODE
  })

  it('resolveBundledNodeBinary finds zero-token-runtime/node/node.exe', async () => {
    const nodeDir = join(tmpRoot, 'zero-token-runtime', 'node')
    await mkdir(nodeDir, { recursive: true })
    const nodeExe = join(nodeDir, 'node.exe')
    await writeFile(nodeExe, '', 'utf8')

    expect(resolveBundledNodeBinary(tmpRoot)).toBe(nodeExe)
  })

  it('resolveWebauthNodeBinary prefers bundled over PATH fallback', async () => {
    const nodeDir = join(tmpRoot, 'resources', 'zero-token-runtime', 'node')
    await mkdir(nodeDir, { recursive: true })
    const nodeExe = join(nodeDir, 'node.exe')
    await writeFile(nodeExe, '', 'utf8')

    expect(resolveWebauthNodeBinary(tmpRoot)).toBe(nodeExe)
  })
})
