import{_ as a,o as n,c as e,a2 as p}from"./chunks/framework.CHSDihme.js";const m=JSON.parse('{"title":"项目结构","description":"","frontmatter":{},"headers":[],"relativePath":"reference/project-structure.md","filePath":"reference/project-structure.md","lastUpdated":1780380166000}'),t={name:"reference/project-structure.md"};function l(c,s,i,r,o,d){return n(),e("div",null,[...s[0]||(s[0]=[p(`<h1 id="项目结构" tabindex="-1">项目结构 <a class="header-anchor" href="#项目结构" aria-label="Permalink to &quot;项目结构&quot;">​</a></h1><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>bin/claude-haha          # 入口脚本</span></span>
<span class="line"><span>preload.ts               # Bun preload（设置 MACRO 全局变量）</span></span>
<span class="line"><span>.env.example             # 环境变量模板</span></span>
<span class="line"><span>src/</span></span>
<span class="line"><span>├── entrypoints/cli.tsx  # CLI 主入口</span></span>
<span class="line"><span>├── main.tsx             # TUI 主逻辑（Commander.js + React/Ink）</span></span>
<span class="line"><span>├── localRecoveryCli.ts  # 降级 Recovery CLI</span></span>
<span class="line"><span>├── setup.ts             # 启动初始化</span></span>
<span class="line"><span>├── screens/REPL.tsx     # 交互 REPL 界面</span></span>
<span class="line"><span>├── ink/                 # Ink 终端渲染引擎</span></span>
<span class="line"><span>├── components/          # UI 组件</span></span>
<span class="line"><span>├── tools/               # Agent 工具（Bash, Edit, Grep 等）</span></span>
<span class="line"><span>├── commands/            # 斜杠命令（/commit, /review 等）</span></span>
<span class="line"><span>├── skills/              # Skill 系统</span></span>
<span class="line"><span>├── services/            # 服务层（API, MCP, OAuth 等）</span></span>
<span class="line"><span>├── hooks/               # React hooks</span></span>
<span class="line"><span>└── utils/               # 工具函数</span></span></code></pre></div>`,2)])])}const _=a(t,[["render",l]]);export{m as __pageData,_ as default};
