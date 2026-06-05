import { describe, expect, it } from 'vitest'
import {
  extractImagePaths,
  isLocalImagePath,
  localFileImageUrl,
  pathBasename,
  rewriteLocalImageSrc,
} from '../localImageFiles'

describe('localImageFiles', () => {
  it('detects Windows absolute paths and markdown image syntax', () => {
    const text = [
      'Saved chart to D:\\Projects\\demo\\output\\chart.png',
      '![plot](D:/Projects/demo/output/chart.png)',
    ].join('\n')

    const paths = extractImagePaths(text)
    expect(paths).toHaveLength(1)
    expect(paths[0]?.replace(/\\/g, '/')).toBe('D:/Projects/demo/output/chart.png')
  })

  it('rewrites local image src to filesystem API URLs', () => {
    const src = 'C:\\Users\\me\\plot.png'
    expect(isLocalImagePath(src)).toBe(true)
    expect(pathBasename(src)).toBe('plot.png')
    expect(localFileImageUrl(src)).toContain('/api/filesystem/file?path=')
    expect(rewriteLocalImageSrc(src)).toContain(encodeURIComponent('C:\\Users\\me\\plot.png'))
  })

  it('ignores remote and data URLs', () => {
    expect(isLocalImagePath('https://example.com/a.png')).toBe(false)
    expect(isLocalImagePath('data:image/png;base64,abc')).toBe(false)
    expect(rewriteLocalImageSrc('https://example.com/a.png')).toBe('https://example.com/a.png')
  })
})
