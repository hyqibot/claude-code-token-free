import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PUBLIC_REPO = 'hyqibot/claude-code-token-free'
const RELEASES_URL = `https://github.com/${PUBLIC_REPO}/releases`

const ZH_BANNER = `> **公开仓说明**：桌面安装包与更新见 [Releases](${RELEASES_URL})。**要使用免 Token（Zero-Token）功能，必须安装 Releases 里的桌面版**（内含预编译 sidecar）；公开源码无法自行构建完整 Zero-Token 网关。

`

const EN_BANNER = `> **Public repository notice**: Download desktop builds from [Releases](${RELEASES_URL}). **Zero-Token (free-token) mode requires the Release installer** — it ships prebuilt sidecars; you cannot build the full Zero-Token gateway from this public source tree.

`

function buildZhRunFromSource(): string {
  return `#### 从源码运行

公开仓可用于本地体验 **终端 CLI**、**桌面 Web UI** 与 **API Key 类 Provider**（OpenRouter、MiniMax 等）。更完整的命令说明见 [快速开始文档](docs/guide/quick-start.md)。

> **限制**：本仓库不含 Zero-Token 网关完整源码与预编译 sidecar，**无法**通过源码本地使用免 Token 功能；请安装 [Releases](${RELEASES_URL}) 桌面版。

**环境要求**

- [Bun](https://bun.sh) 1.2+
- Windows 终端 CLI 需 [Git for Windows](https://git-scm.com/download/win)

**1. 克隆与安装**

\`\`\`bash
git clone https://github.com/${PUBLIC_REPO}.git
cd claude-code-token-free
bun install
cd desktop && bun install && cd ..
\`\`\`

如需调试 IM 适配器：\`cd adapters && bun install\`。

**2. 配置 API（可选）**

\`\`\`bash
cp .env.example .env
# 编辑 .env 填入 API Key，见 docs/guide/env-vars.md
\`\`\`

**3. 终端 CLI**

macOS / Linux（或 Windows Git Bash）：

\`\`\`bash
./bin/claude-haha
./bin/claude-haha -p "your prompt"
\`\`\`

Windows PowerShell：

\`\`\`powershell
bun --env-file=.env ./src/entrypoints/cli.tsx
\`\`\`

**4. 桌面 Web UI（浏览器，推荐源码调试）**

开两个终端：

\`\`\`bash
# 终端 1：项目根目录 — API / WebSocket 服务端
# macOS / Linux / Git Bash
SERVER_PORT=3456 bun run src/server/index.ts

# Windows PowerShell
$env:SERVER_PORT=3456; bun run src/server/index.ts
\`\`\`

\`\`\`bash
# 终端 2：desktop 目录 — 前端
cd desktop
bun run dev --host 127.0.0.1 --port 2024
\`\`\`

浏览器打开 [http://127.0.0.1:2024](http://127.0.0.1:2024)，在设置页配置 Provider / API Key 后即可聊天。

**说明**

- 公开仓 **不含** \`vendor/copaw-zero-token/python/\`，本地 \`build:sidecars\` / \`tauri build\` **不能**产出含 Zero-Token 的发行安装包。
- 贡献与本地质量门禁见 [贡献指南](docs/guide/contributing.md)。`
}

function injectZhRunFromSource(md: string): string {
  const section = buildZhRunFromSource()
  if (md.includes('#### 从源码运行')) {
    return md.replace(/#### 从源码运行[\s\S]*?(?=\n#### |\n## )/, `${section}\n\n`)
  }
  if (md.includes('#### 注意事项')) {
    return md.replace(/(#### 注意事项)/, `${section}\n\n$1`)
  }
  if (md.includes('#### 免 Token（Zero-Token）')) {
    return md.replace(/(#### 免 Token（Zero-Token）)/, `${section}\n\n$1`)
  }
  return md.replace(/(---\s*\n\s*\n## 赞助与合作)/, `${section}\n\n---\n\n$1`)
}

function injectZhNavRunFromSource(md: string): string {
  if (md.includes('#从源码运行')) return md
  return md.replace(
    '<a href="#快速开始">快速开始</a>',
    '<a href="#快速开始">快速开始</a> · <a href="#从源码运行">从源码运行</a>',
  )
}

/** 同步到公开仓前，对 README 做公开向覆盖（私有仓 README.md 本身不改结构）。 */
export async function applyPublicReadmeOverlay(exportRoot: string): Promise<void> {
  await patchZhReadme(join(exportRoot, 'README.md'))
  const enPath = join(exportRoot, 'README.en.md')
  if (existsSync(enPath)) await patchEnReadme(enPath)
  await patchPublicDesktopInstallDoc(exportRoot)
  await patchPublicVitepressConfig(exportRoot)
  await patchPublicDocsWithoutReference(exportRoot)
}

/** 公开仓不含 docs/reference/，去掉 README 与文档中的对应链接。 */
function stripReferenceDocTableRows(md: string): string {
  return md.replace(/^\| \[[^\]]+\]\(docs\/reference\/[^)]+\)[^\n]*\n/gm, '')
}

async function patchPublicDocsWithoutReference(exportRoot: string): Promise<void> {
  const archPath = join(exportRoot, 'docs/features/computer-use-architecture.md')
  if (!existsSync(archPath)) return
  let doc = await readFile(archPath, 'utf8')
  doc = doc.replace(/^- \[源码修复记录\]\(\/reference\/fixes\)[^\n]*\n/m, '')
  await writeFile(archPath, doc, 'utf8')
}

async function patchPublicVitepressConfig(exportRoot: string): Promise<void> {
  const configPath = join(exportRoot, 'docs/.vitepress/config.mts')
  if (!existsSync(configPath)) return
  let config = await readFile(configPath, 'utf8')
  config = config.replace(
    /\n  \{\n    text: '参考',\n    collapsed: true,\n    items: \[\n      \{ text: '源码修复记录', link: '\/reference\/fixes' \},\n      \{ text: '项目结构', link: '\/reference\/project-structure' \},\n    \],\n  \},/,
    '',
  )
  await writeFile(configPath, config, 'utf8')
}

/** 公开仓 README：桌面端章节标题与截图表与私有仓保持一致 */
function patchDesktopIntroSection(md: string): string {
  let out = md.replaceAll('#桌面端预览', '#桌面端简介').replaceAll('## 桌面端预览', '## 桌面端简介')
  out = out.replace(
    /<table>\s*<tr>[\s\S]*?docs\/images\/desktop_ui\/[\s\S]*?<\/table>\s*\n?/,
    '',
  )
  return out
}

async function patchZhReadme(readmePath: string): Promise<void> {
  let md = await readFile(readmePath, 'utf8')

  if (md.includes('公开仓说明')) {
    md = md.replace(/> \*\*公开仓说明\*\*：[\s\S]*?\n\n(?=Claude Code)/, ZH_BANNER)
  } else {
    md = md.replace(/(<\/div>\s*\n\s*\n)(Claude Code 永远)/, `$1${ZH_BANNER}$2`)
  }

  md = md.replaceAll('docs/images/app-icon.svg', 'docs/images/app-icon.png')
  md = patchDesktopIntroSection(md)
  md = md.replace(
    'claude-code-token-freetype=Date',
    'claude-code-token-free&type=Date',
  )

  md = md.replace(
    /#### 快速开始\s*\n\s*\n- \*\*下载与安装\*\*：在Releases处下载对应的版本，安装后即可使用/,
    `#### 快速开始

- **普通用户（推荐）**：到 [Releases](${RELEASES_URL}) 下载 macOS / Windows / Linux 安装包，安装后打开桌面端即可。
- **免 Token（Zero-Token）**：**仅 Releases 安装包可用**；公开 clone / 自行 \`bun run dev\` / 本地打包 **不含** Zero-Token 网关 sidecar，无法使用免 Token 模型。
- **从源码运行**：见下方 [从源码运行](#从源码运行)；CLI 与桌面 Web UI 可本地调试，API Key 类 Provider 可用。`,
  )

  // 已同步过的 README：刷新「浏览源码」为「从源码运行」锚点
  md = md.replace(
    /- \*\*浏览源码\*\*：本仓库为只读镜像；CLI 与 API Key 类 Provider 可参考 \[贡献指南\]\(docs\/guide\/contributing\.md\)。/,
    `- **从源码运行**：见下方 [从源码运行](#从源码运行)；CLI 与桌面 Web UI 可本地调试，API Key 类 Provider 可用。`,
  )

  md = injectZhRunFromSource(md)
  md = injectZhNavRunFromSource(md)
  md = stripReferenceDocTableRows(md)

  if (!md.includes('#### 免 Token（Zero-Token）')) {
    md = md.replace(
      /(---\s*\n\s*\n## 赞助与合作)/,
      `#### 免 Token（Zero-Token）

- **要用免 Token 功能 → 请安装 [Releases](${RELEASES_URL}) 桌面版**，不要用公开仓库源码本地编译替代。
- 安装后在设置中配置 \`license.serverUrl\` 并完成激活（授权服务由发行方部署，不在本仓库）。

---

$1`,
    )
  }

  await writeFile(readmePath, md, 'utf8')
}

async function patchPublicDesktopInstallDoc(exportRoot: string): Promise<void> {
  const docPath = join(exportRoot, 'docs/desktop/04-installation.md')
  if (!existsSync(docPath)) return
  let doc = await readFile(docPath, 'utf8')
  doc = doc.replaceAll('https://github.com/NanmiCoder/cc-haha/releases', RELEASES_URL)
  doc = doc.replaceAll('Claude Code Token Free', 'Claude Code Token Free')
  doc = doc.replaceAll('Claude.Code.Haha', 'Claude Code Token Free')
  doc = doc.replaceAll('Claude\\ Code\\ Haha.app', 'Claude Code Token Free.app')
  if (!doc.includes('Zero-Token')) {
    doc = doc.replace(
      /^(# .+\n\n)/,
      `$1> **免 Token（Zero-Token）**：必须使用 [Releases](${RELEASES_URL}) 安装包；公开源码 clone 无法构建含 Zero-Token sidecar 的桌面包。\n\n`,
    )
  }
  await writeFile(docPath, doc, 'utf8')
}

async function patchEnReadme(enPath: string): Promise<void> {
  let md = await readFile(enPath, 'utf8')

  md = md.replaceAll('NanmiCoder/cc-haha', PUBLIC_REPO)
  md = md.replaceAll('https://claudecode-haha.relakkesyang.org', `https://github.com/${PUBLIC_REPO}`)

  if (md.includes('Public repository notice')) {
    md = md.replace(/> \*\*Public repository notice\*\*：[\s\S]*?\n\n(?=A \*\*locally runnable)/, EN_BANNER)
      .replace(/> \*\*Public repository notice\*\*:[\s\S]*?\n\n(?=A \*\*locally runnable)/, EN_BANNER)
  } else {
    md = md.replace(/(<\/div>\s*\n\s*\n)(A \*\*locally runnable)/, `$1${EN_BANNER}$2`)
  }

  md = md.replaceAll('docs/images/logo-horizontal.png', 'docs/images/logo-horizontal.svg')

  md = md.replace(
    /cd \/Users\/nanmi\/workspace\/myself_code\/claude-code-haha\nSERVER_PORT=3456 bun run src\/server\/index\.ts/,
    `# from repo root\nSERVER_PORT=3456 bun run src/server/index.ts`,
  )
  md = md.replace(
    /cd \/Users\/nanmi\/workspace\/myself_code\/claude-code-haha\/desktop\nbun run dev --host 127\.0\.0\.1 --port 2024/,
    `cd desktop\nbun run dev --host 127.0.0.1 --port 2024`,
  )

  if (!md.includes('### Public source limitations')) {
    md = md.replace(
      /(### 5\. Desktop Development\n\n)/,
      `$1> **Public source tree**: Zero-Token sidecars are **not** in this repo. Use [Releases](${RELEASES_URL}) for free-token mode. \`build:sidecars\` / \`tauri build\` here will **not** produce a Zero-Token desktop installer.\n\n`,
    )
  }

  md = md.replace(
    /- Zero-Token local gateway \(`vendor\/copaw-zero-token\/`, Settings page\)\n/,
    '',
  )

  await writeFile(enPath, md, 'utf8')
}
