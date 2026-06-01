import{_ as n,o as a,c as e,a2 as t}from"./chunks/framework.CHSDihme.js";const m=JSON.parse('{"title":"Project Structure","description":"","frontmatter":{},"headers":[],"relativePath":"en/reference/project-structure.md","filePath":"en/reference/project-structure.md","lastUpdated":1780319135000}'),p={name:"en/reference/project-structure.md"};function c(r,s,l,i,o,u){return a(),e("div",null,[...s[0]||(s[0]=[t(`<h1 id="project-structure" tabindex="-1">Project Structure <a class="header-anchor" href="#project-structure" aria-label="Permalink to &quot;Project Structure&quot;">​</a></h1><div class="language-text vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">text</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>bin/claude-haha          # Entry script</span></span>
<span class="line"><span>preload.ts               # Bun preload (sets MACRO globals)</span></span>
<span class="line"><span>.env.example             # Environment variable template</span></span>
<span class="line"><span>src/</span></span>
<span class="line"><span>├── entrypoints/cli.tsx  # Main CLI entry</span></span>
<span class="line"><span>├── main.tsx             # Main TUI logic (Commander.js + React/Ink)</span></span>
<span class="line"><span>├── localRecoveryCli.ts  # Fallback Recovery CLI</span></span>
<span class="line"><span>├── setup.ts             # Startup initialization</span></span>
<span class="line"><span>├── screens/REPL.tsx     # Interactive REPL screen</span></span>
<span class="line"><span>├── ink/                 # Ink terminal rendering engine</span></span>
<span class="line"><span>├── components/          # UI components</span></span>
<span class="line"><span>├── tools/               # Agent tools (Bash, Edit, Grep, etc.)</span></span>
<span class="line"><span>├── commands/            # Slash commands (/commit, /review, etc.)</span></span>
<span class="line"><span>├── skills/              # Skill system</span></span>
<span class="line"><span>├── services/            # Service layer (API, MCP, OAuth, etc.)</span></span>
<span class="line"><span>├── hooks/               # React hooks</span></span>
<span class="line"><span>└── utils/               # Utility functions</span></span></code></pre></div>`,2)])])}const h=n(p,[["render",c]]);export{m as __pageData,h as default};
