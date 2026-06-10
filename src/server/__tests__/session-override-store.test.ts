import { describe, expect, test, beforeEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import {
  SessionOverrideStore,
  normalizeSessionOverridesFile,
} from '../services/sessionOverrideStore.js'

async function makeTempDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'cc-haha-session-overrides-'))
}

describe('normalizeSessionOverridesFile', () => {
  test('returns default empty overrides when shape is wrong', () => {
    expect(normalizeSessionOverridesFile(null)).toBeNull()
    expect(normalizeSessionOverridesFile([])).toBeNull()
    expect(normalizeSessionOverridesFile('foo')).toBeNull()
  })

  test('keeps only valid override entries; drops malformed ones', () => {
    const out = normalizeSessionOverridesFile({
      schemaVersion: 1,
      overrides: {
        good: { providerId: 'p1', modelId: 'm1' },
        nullProvider: { providerId: null, modelId: 'm2' },
        emptyModel: { providerId: 'p3', modelId: '' },
        wrongType: { providerId: 5, modelId: 'm4' },
        notObject: 'oops',
      },
    })
    expect(out).not.toBeNull()
    expect(out!.schemaVersion).toBe(1)
    expect(Object.keys(out!.overrides).sort()).toEqual(['good', 'nullProvider'])
    expect(out!.overrides.good).toEqual({ providerId: 'p1', modelId: 'm1' })
    expect(out!.overrides.nullProvider).toEqual({ providerId: null, modelId: 'm2' })
  })

  test('returns empty overrides when overrides field is missing or wrong type', () => {
    expect(normalizeSessionOverridesFile({ schemaVersion: 1 })?.overrides).toEqual({})
    expect(
      normalizeSessionOverridesFile({ schemaVersion: 1, overrides: 'no' })?.overrides,
    ).toEqual({})
  })
})

describe('SessionOverrideStore', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await makeTempDir()
  })

  test('loadAll returns empty when file does not exist', async () => {
    const store = new SessionOverrideStore(tempDir)
    expect(await store.loadAll()).toEqual({})
  })

  test('loadAll returns persisted entries from existing file', async () => {
    const filePath = path.join(tempDir, 'session-overrides.json')
    await fs.writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        overrides: {
          'sess-a': { providerId: 'p1', modelId: 'deepseek-chat' },
          'sess-b': { providerId: null, modelId: 'fallback' },
        },
      }),
      'utf-8',
    )
    const store = new SessionOverrideStore(tempDir)
    expect(await store.loadAll()).toEqual({
      'sess-a': { providerId: 'p1', modelId: 'deepseek-chat' },
      'sess-b': { providerId: null, modelId: 'fallback' },
    })
  })

  test('set persists entry; reload sees it', async () => {
    const a = new SessionOverrideStore(tempDir)
    await a.loadAll()
    a.set('sess-x', { providerId: 'zero-token', modelId: 'deepseek-chat' })
    await a.waitForPendingWrites()

    const b = new SessionOverrideStore(tempDir)
    expect(await b.loadAll()).toEqual({
      'sess-x': { providerId: 'zero-token', modelId: 'deepseek-chat' },
    })
  })

  test('delete removes entry from persistence', async () => {
    const a = new SessionOverrideStore(tempDir)
    await a.loadAll()
    a.set('sess-x', { providerId: 'p1', modelId: 'm1' })
    a.set('sess-y', { providerId: 'p2', modelId: 'm2' })
    await a.waitForPendingWrites()
    a.delete('sess-x')
    await a.waitForPendingWrites()

    const b = new SessionOverrideStore(tempDir)
    expect(await b.loadAll()).toEqual({
      'sess-y': { providerId: 'p2', modelId: 'm2' },
    })
  })

  test('multiple set/delete operations are serialized to last state', async () => {
    const a = new SessionOverrideStore(tempDir)
    await a.loadAll()
    a.set('sess-x', { providerId: 'p1', modelId: 'm1' })
    a.set('sess-x', { providerId: 'p2', modelId: 'm2' })
    a.delete('sess-x')
    a.set('sess-x', { providerId: 'p3', modelId: 'm3' })
    await a.waitForPendingWrites()

    const b = new SessionOverrideStore(tempDir)
    expect(await b.loadAll()).toEqual({
      'sess-x': { providerId: 'p3', modelId: 'm3' },
    })
  })

  test('quarantines malformed JSON file and falls back to empty', async () => {
    const filePath = path.join(tempDir, 'session-overrides.json')
    await fs.writeFile(filePath, 'not-json{', 'utf-8')
    const store = new SessionOverrideStore(tempDir)
    expect(await store.loadAll()).toEqual({})
  })
})
