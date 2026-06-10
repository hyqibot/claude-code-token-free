import { describe, it, expect } from 'bun:test'
import { ImageBlockWatcher } from '../image-block-watcher.js'

describe('ImageBlockWatcher', () => {
  it('extracts a markdown image with http URL', () => {
    const w = new ImageBlockWatcher()
    const out = w.feed('Here is ![alt](https://example.com/foo.png) an image.')
    expect(out.length).toBe(1)
    const source = out[0]!.source
    expect(source.kind).toBe('url')
    if (source.kind === 'url') {
      expect(source.url).toBe('https://example.com/foo.png')
    }
    expect(out[0]!.alt).toBe('alt')
  })

  it('extracts a markdown image with absolute local path', () => {
    const w = new ImageBlockWatcher()
    const out = w.feed('![cat](/tmp/cat.jpg)')
    expect(out.length).toBe(1)
    const source = out[0]!.source
    expect(source.kind).toBe('path')
    if (source.kind === 'path') {
      expect(source.path).toBe('/tmp/cat.jpg')
    }
  })

  it('extracts a markdown image with file:// URL as path', () => {
    const w = new ImageBlockWatcher()
    const out = w.feed('![x](file:///var/img/x.png)')
    const source = out[0]!.source
    expect(source.kind).toBe('path')
    if (source.kind === 'path') expect(source.path).toBe('/var/img/x.png')
  })

  it('extracts a data URI as base64', () => {
    const w = new ImageBlockWatcher()
    const out = w.feed('![inline](data:image/png;base64,AAAA)')
    const source = out[0]!.source
    expect(source.kind).toBe('base64')
    if (source.kind === 'base64') {
      expect(source.mime).toBe('image/png')
      expect(source.data).toBe('AAAA')
    }
  })

  it('deduplicates the same image across multiple feeds', () => {
    const w = new ImageBlockWatcher()
    const a = w.feed('![](https://x/y.png)')
    const b = w.feed(' repeated ![](https://x/y.png) again')
    expect(a.length).toBe(1)
    expect(b.length).toBe(0)
  })

  it('handles images split across feed boundaries', () => {
    const w = new ImageBlockWatcher()
    const a = w.feed('a ![al')
    const b = w.feed('t](/tmp/x.png) b')
    expect(a.length).toBe(0)
    expect(b.length).toBe(1)
    const source = b[0]!.source
    expect(source.kind).toBe('path')
    if (source.kind === 'path') expect(source.path).toBe('/tmp/x.png')
  })

  it('skips non-image markdown links', () => {
    const w = new ImageBlockWatcher()
    const out = w.feed('See [docs](https://example.com).')
    expect(out.length).toBe(0)
  })

  it('drain() returns all accumulated uploads', () => {
    const w = new ImageBlockWatcher()
    w.feed('![a](/tmp/a.png)')
    w.feed(' and ![b](/tmp/b.png)')
    const all = w.drain()
    expect(all.length).toBe(2)
  })

  it('reset() clears buffer, seen set, and accumulated list', () => {
    const w = new ImageBlockWatcher()
    w.feed('![a](/tmp/a.png)')
    w.reset()
    // After reset, drain() is empty
    expect(w.drain().length).toBe(0)
    // And re-feeding the same image yields a fresh emit (dedup state cleared)
    const out = w.feed('![a](/tmp/a.png)')
    expect(out.length).toBe(1)
  })

  it('skips relative paths (cannot be resolved safely)', () => {
    const w = new ImageBlockWatcher()
    const out = w.feed('![rel](relative/path.png) and ![ok](/tmp/ok.png)')
    expect(out.length).toBe(1)
    const source = out[0]!.source
    expect(source.kind).toBe('path')
    if (source.kind === 'path') expect(source.path).toBe('/tmp/ok.png')
  })

  it('extracts multiple images from a single feed chunk in order', () => {
    const w = new ImageBlockWatcher()
    const out = w.feed('![a](/tmp/a.png) ![b](https://x/b.png) ![c](data:image/png;base64,QQ==)')
    expect(out.length).toBe(3)
    expect(out[0]!.source.kind).toBe('path')
    expect(out[1]!.source.kind).toBe('url')
    expect(out[2]!.source.kind).toBe('base64')
  })

  it('rejects malformed data URI (not base64)', () => {
    const w = new ImageBlockWatcher()
    const out = w.feed('![bad](data:image/png,ABC)')
    // Not in `;base64,` form → classify returns null → skipped
    expect(out.length).toBe(0)
  })

  it('extracts Windows absolute paths in markdown', () => {
    const w = new ImageBlockWatcher()
    const out = w.feed('![chart](D:/CCwork/chart.png)')
    expect(out.length).toBe(1)
    const source = out[0]!.source
    expect(source.kind).toBe('path')
    if (source.kind === 'path') expect(source.path).toBe('D:/CCwork/chart.png')
  })

  it('extracts inline Windows paths from plain text', () => {
    const w = new ImageBlockWatcher()
    w.feed('PNG图表  D:/CCwork/蒙神_20260605.png')
    const out = w.reconcile()
    expect(out.length).toBe(1)
    const source = out[0]!.source
    expect(source.kind).toBe('path')
    if (source.kind === 'path') expect(source.path).toBe('D:/CCwork/蒙神_20260605.png')
  })

  it('reconcile finds paths after Chinese label in streamed text', () => {
    const w = new ImageBlockWatcher()
    w.feed('文件位置：\n- PNG 图表：D:/CCwork/东隐尼神_20260606.png')
    const out = w.reconcile()
    expect(out.some((p) => p.source.kind === 'path' && p.source.path === 'D:/CCwork/东隐尼神_20260606.png')).toBe(true)
  })
})
