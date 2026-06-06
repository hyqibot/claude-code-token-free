import { describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveExistingImagePath } from '../resolve-image-path.js'

describe('resolveExistingImagePath', () => {
  it('finds file by date suffix when filename bytes differ', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'im-img-'))
    const realName = '与国一起成长_20260606.png'
    const filePath = path.join(dir, realName)
    await fs.writeFile(filePath, Buffer.from('png'))

    const garbled = path.join(dir, '乱码_20260606.png')
    const resolved = await resolveExistingImagePath(garbled)
    expect(resolved?.replace(/\\/g, '/')).toBe(filePath.replace(/\\/g, '/'))

    await fs.rm(dir, { recursive: true, force: true })
  })

  it('picks the newest file when multiple share the same date suffix', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'im-img-'))
    const older = path.join(dir, '与国一起成长_20260606.png')
    const newer = path.join(dir, '东隐三三彡_20260606.png')
    await fs.writeFile(older, Buffer.from('old'))
    await new Promise((r) => setTimeout(r, 20))
    await fs.writeFile(newer, Buffer.from('new'))

    const garbled = path.join(dir, '����������_20260606.png')
    const resolved = await resolveExistingImagePath(garbled)
    expect(resolved?.replace(/\\/g, '/')).toBe(newer.replace(/\\/g, '/'))

    await fs.rm(dir, { recursive: true, force: true })
  })

  it('ignores files older than minMtimeMs when using suffix fallback', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'im-img-'))
    const older = path.join(dir, '尼神_20260606.png')
    const newer = path.join(dir, '东隐三三彡_20260606.png')
    await fs.writeFile(older, Buffer.from('old'))
    await new Promise((r) => setTimeout(r, 20))
    await fs.writeFile(newer, Buffer.from('new'))
    const olderStat = await fs.stat(older)

    const garbled = path.join(dir, '乱码_20260606.png')
    const resolved = await resolveExistingImagePath(garbled, { minMtimeMs: olderStat.mtimeMs + 1 })
    expect(resolved?.replace(/\\/g, '/')).toBe(newer.replace(/\\/g, '/'))

    await fs.rm(dir, { recursive: true, force: true })
  })
})
