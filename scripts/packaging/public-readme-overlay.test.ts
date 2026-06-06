import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyPublicReadmeOverlay } from './public-readme-overlay.ts'

describe('public readme overlay', () => {
  test('adds banner and fixes broken asset URLs for public repo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'public-readme-'))
    const sample = `<div align="center">

[![License](https://img.shields.io/badge/x)](LICENSE)

</div>

Claude Code 永远免token费，测试。

#### 快速开始 

- **下载与安装**：在Releases处下载对应的版本，安装后即可使用

<img src="docs/images/app-icon.png" />
<img src="https://api.star-history.com/svg?repos=hyqibot/claude-code-token-freetype=Date" />

---

## 赞助与合作
`
    await writeFile(join(dir, 'README.md'), sample, 'utf8')
    await applyPublicReadmeOverlay(dir)
    const out = await readFile(join(dir, 'README.md'), 'utf8')
    expect(out).toContain('公开仓说明')
    expect(out).toContain('claude-code-token-free/releases')
    expect(out).toContain('app-icon.png')
    expect(out).not.toContain('vendor/copaw-zero-token/README.md')
    expect(out).toContain('claude-code-token-free&type=Date')
    expect(out).toContain('普通用户（推荐）')
    expect(out).toContain('仅 Releases 安装包可用')
    expect(out).toContain('#### 免 Token（Zero-Token）')
    expect(out).not.toContain('desktop_ui/01_full_ui.png')
    expect(out).not.toContain('桌面端预览')
    await rm(dir, { recursive: true, force: true })
  })
})
