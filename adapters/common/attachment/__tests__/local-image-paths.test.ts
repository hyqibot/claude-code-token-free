import { describe, expect, it } from 'bun:test'
import { extractLocalImagePaths, isLocalImagePath } from '../local-image-paths.js'

describe('local-image-paths', () => {
  it('detects Windows absolute image paths', () => {
    expect(isLocalImagePath('D:/CCwork/chart.png')).toBe(true)
    expect(isLocalImagePath('relative/chart.png')).toBe(false)
  })

  it('extracts markdown and inline paths', () => {
    const text = '结果如下 D:/CCwork/a.png 以及 ![b](D:\\CCwork\\b.jpg)'
    const paths = extractLocalImagePaths(text)
    expect(paths).toContain('D:/CCwork/a.png')
    expect(paths.some((p) => p.replace(/\\/g, '/').endsWith('CCwork/b.jpg'))).toBe(true)
  })

  it('extracts paths after Chinese colon labels', () => {
    const text = 'PNG 图表：D:/CCwork/东隐尼神_20260606.png'
    expect(extractLocalImagePaths(text)).toEqual(['D:/CCwork/东隐尼神_20260606.png'])
  })

  it('extracts backtick-wrapped paths', () => {
    const text = '- PNG 图表：`D:/CCwork/星空寰宇_20260606.png`'
    expect(extractLocalImagePaths(text)).toEqual(['D:/CCwork/星空寰宇_20260606.png'])
  })
})
