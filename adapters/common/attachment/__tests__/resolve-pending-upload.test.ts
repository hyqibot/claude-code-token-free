import { describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { formatOutboundImageLogLabel } from '../resolve-pending-upload.js'

describe('formatOutboundImageLogLabel', () => {
  it('logs resolved filesystem path instead of garbled stream path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'im-log-'))
    const realPath = path.join(dir, '东隐三三彡_20260606.png')
    await fs.writeFile(realPath, Buffer.from('png'))

    const garbled = path.join(dir, '����������_20260606.png')
    const label = await formatOutboundImageLogLabel({
      id: 'x',
      source: { kind: 'path', path: garbled },
    })
    expect(label.replace(/\\/g, '/')).toBe(realPath.replace(/\\/g, '/'))

    await fs.rm(dir, { recursive: true, force: true })
  })

  it('falls back to wildcard suffix when file is not on disk yet', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'im-log-'))
    const garbled = path.join(dir, '��������_20260606.png')
    const label = await formatOutboundImageLogLabel({
      id: 'x',
      source: { kind: 'path', path: garbled },
    })
    expect(label.replace(/\\/g, '/')).toBe(path.join(dir, '*_20260606.png').replace(/\\/g, '/'))

    await fs.rm(dir, { recursive: true, force: true })
  })
})
