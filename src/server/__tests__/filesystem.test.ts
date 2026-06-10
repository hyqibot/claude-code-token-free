import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { handleFilesystemRoute, isAllowedFilesystemPath } from '../api/filesystem.js'
import { conversationService } from '../services/conversationService.js'
import { sessionService } from '../services/sessionService.js'

const cleanupDirs = new Set<string>()

function makeUrl(route: string, params: Record<string, string>): URL {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url
}

afterEach(async () => {
  for (const dir of cleanupDirs) {
    try {
      await fsp.rm(dir, { recursive: true, force: true })
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      if (code !== 'EBUSY' && code !== 'EPERM') throw err
    }
  }
  cleanupDirs.clear()
})

describe('filesystem API', () => {
  it('allows browsing a directory under the user home directory', async () => {
    const homeFixtureDir = await fsp.mkdtemp(path.join(os.homedir(), 'claude-filesystem-test-'))
    cleanupDirs.add(homeFixtureDir)
    await fsp.writeFile(path.join(homeFixtureDir, 'note.txt'), 'hello')

    const res = await handleFilesystemRoute(
      '/api/filesystem/browse',
      makeUrl('/api/filesystem/browse', {
        path: homeFixtureDir,
        includeFiles: 'true',
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { entries: Array<{ name: string }> }
    expect(body.entries.some((entry) => entry.name === 'note.txt')).toBe(true)
  })

  it('accepts /private/tmp aliases on macOS for browsing and file serving', async () => {
    if (process.platform !== 'darwin') return

    const tmpFixtureDir = await fsp.mkdtemp('/tmp/claude-filesystem-test-')
    cleanupDirs.add(tmpFixtureDir)
    const canonicalTmpDir = fs.realpathSync(tmpFixtureDir)
    const imagePath = path.join(canonicalTmpDir, 'preview.png')
    await fsp.writeFile(
      imagePath,
      Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082', 'hex'),
    )

    const browseRes = await handleFilesystemRoute(
      '/api/filesystem/browse',
      makeUrl('/api/filesystem/browse', {
        path: canonicalTmpDir,
        includeFiles: 'true',
      }),
    )
    expect(browseRes.status).toBe(200)
    const browseBody = await browseRes.json() as { entries: Array<{ name: string }> }
    expect(browseBody.entries.some((entry) => entry.name === 'preview.png')).toBe(true)

    const fileRes = await handleFilesystemRoute(
      '/api/filesystem/file',
      makeUrl('/api/filesystem/file', {
        path: imagePath,
      }),
    )
    expect(fileRes.status).toBe(200)
    expect(fileRes.headers.get('Content-Type')).toBe('image/png')
  })

  it('allows serving images under an active session workDir outside home', async () => {
    const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-session-workdir-'))
    cleanupDirs.add(workDir)
    const imagePath = path.join(workDir, 'chart.png')
    await fsp.writeFile(
      imagePath,
      Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082', 'hex'),
    )

    const sessionId = 'filesystem-session-test'
    await conversationService.startSession(
      sessionId,
      workDir,
      'ws://127.0.0.1:1/sdk/test?token=test',
      {},
    )

    try {
      expect(await isAllowedFilesystemPath(imagePath, sessionId)).toBe(true)

      const fileRes = await handleFilesystemRoute(
        '/api/filesystem/file',
        makeUrl('/api/filesystem/file', {
          path: imagePath,
          sessionId,
        }),
      )
      expect(fileRes.status).toBe(200)
      expect(fileRes.headers.get('Content-Type')).toBe('image/png')
    } finally {
      conversationService.stopSession(sessionId)
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  })

  it('allows images under directories referenced in session transcript', async () => {
    const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-output-dir-'))
    cleanupDirs.add(outputDir)
    const imagePath = path.join(outputDir, 'chart.png')
    await fsp.writeFile(
      imagePath,
      Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082', 'hex'),
    )

    const sessionId = 'filesystem-referenced-path-test'
    const getSessionMessages = async () => ([
      {
        id: 'assistant-1',
        type: 'assistant' as const,
        content: `输出文件\nPNG图表\t${imagePath}`,
        timestamp: new Date().toISOString(),
      },
    ])

    const originalGetSessionMessages = sessionService.getSessionMessages.bind(sessionService)
    sessionService.getSessionMessages = getSessionMessages as typeof sessionService.getSessionMessages

    try {
      expect(await isAllowedFilesystemPath(imagePath, sessionId)).toBe(true)

      const fileRes = await handleFilesystemRoute(
        '/api/filesystem/file',
        makeUrl('/api/filesystem/file', {
          path: imagePath,
          sessionId,
        }),
      )
      expect(fileRes.status).toBe(200)
      expect(fileRes.headers.get('Content-Type')).toBe('image/png')
    } finally {
      sessionService.getSessionMessages = originalGetSessionMessages
    }
  })
})
