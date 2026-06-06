支持工具调用（Function Calling）

# Claude Code Zero Token


把浏览器凭证整条链路都改成 TypeScript/Bun（Node）实现、不再依赖 Python，常见好处主要是下面这些：

运维与交付
只有一种运行时：服务端 / 桌面侧主要是 Bun/Node，不再要求用户配 Python、venv、conda、PYTHONPATH，也少一层「哪个 Python 装了依赖」的扯皮。
依赖形态统一：版本锁定、升级、审计都在同一套 package.json / lockfile 里，而不是 Python + Node 两套。
CI / 打包更简单：流水线不必再装 Python、pip、playwright install chromium（Python 版）；桌面应用打包时也不必捆绑 Python 解释器（若你愿意做到「纯 TS」分发）。
工程与协作
代码库心智模型单一：调试、重构、类型、日志、错误边界都在 TS 里完成，而不是通过子进程拼字符串 / 解析 stdout。
和 cc-haha 现有逻辑天然对齐：会话、配置、API、审计日志可以共用同一套抽象，而不是通过子进程拼字符串 / 解析 stdout。
测试策略更一致：Vitest 与集成测试覆盖浏览器自动化时，不必跨语言 mock。

需要心里有数的一点：「不用 Python」并不等于「零浏览器自动化依赖」。若在 TS 里仍用 Playwright（npm） 或 Puppeteer，通常还是要下载 Chromium 或依赖本机 Chrome/CDP，安装体积和网络步骤仍在，只是从 Python 生态 挪到了 Node 生态。真正「完全不用 Playwright 类库」就只能手写 CDP/协议或换别的集成方式，工程量与兼容性风险会明显上去。

流式工具
应该用  StreamSieve 实时分离 DSML  代替
先攒全文再 parseUpstreamToolCalls

实施节奏（约 4 个 PR）
PR-1：阶段 0+1 — fixture + runToolPipeline，双端点接入，行为与现在等价
PR-2：Schema 泛化 sanitize（替代逐个 WebFetch if）
PR-3：能力选择 + Schema Planner，删掉 md/curl 硬编码
PR-4：流式 DSML + 调试日志 + 文档

---

## 演进记录（追加，不替代上文）

### 已完成（deepseek-free-api 借鉴 · P0–P1 项 1–6）

> 当前实现范围以 **`deepseek-chat` 为主**；其它 web 模型仅部分能力（见未决事项）。

| 项 | 内容 | 模块 |
|----|------|------|
| 1 | 多轮原生 prompt（`convertMessagesForDeepseek`），非仅最后一条 user | `deepseek-prompt.mjs` |
| 2 | 上游 DSML 工具说明注入 system | `buildDsmlToolPrompt` |
| 3 | DeepSeek SSE：`fragments` / `thinking_content` | `deepseek-sse.mjs` |
| 4 | 有 tools 时全 web 模型走 `StreamSieve` + 解析链 | `tool-sieve.mjs` + `tool-pipeline.mjs` |
| 5 | 解析链：流式 DSML → 全量 fallback → strict XML → Planner | `tool-pipeline.mjs` |
| 6 | `resolveToolName` + 既有 `curl→Bash` 等映射 | `tool-bridge.mjs` |

**无 tools 的流式对话**

- 所有 web 模型、**请求未带 tools** 时：`StreamSieve` **实时**向客户端推 `content` delta，不再「攒全文再一个 chunk」。
- 覆盖：`/v1/chat/completions` stream、`/v1/messages` stream。

**上传文件 PoW**

- `POST /api/v0/file/upload_file` 使用独立 `target_path` 求 PoW（与 completion 不同）。
- 模块：`deepseek-upload.mjs`（`buildPowResponseHeader` / `uploadFileToDeepseek`）。
- 配置：`config.mjs` → `api.uploadFile`。
- **尚未**接入多模态消息里的自动上传（`ref_file_ids` 仍为 `[]`）；上传能力已就绪，待 Vision/附件管线接线。

### 未决事项（后续再决定是否做）

#### A. 将 1–6 扩展到全部 web 模型？

| 能力 | 现状 | 若扩展需考虑 |
|------|------|----------------|
| 原生多轮 prompt（类似 convertMessages） | 仅 DeepSeek | 各站 prompt 形态不同（ChatGPT/Claude/Doubao 已有 merge 逻辑） |
| DSML 上游注入 | 仅 DeepSeek + merge 里 DSML 分支 | 其它站是否产出 DSML 不确定，可能仍用 `<tool_call>` XML |
| 专用 SSE 解析 | 仅 DeepSeek | 各站 SSE 协议不同，需逐模型移植 |
| StreamSieve + 工具解析 | **有 tools 时已全部 web 模型** | 已扩展 |
| Planner 兜底 | 全部 web | 已存在 |

**建议**：先用 DeepSeek 验证工具链稳定，再按模型逐个评估（优先 Doubao/ChatGPT-web，与 OpenClaw 对齐）。

#### B. PoW / 会话（第 7 步剩余子项）

| 子项 | 状态 |
|------|------|
| completion PoW（`DeepSeekHashV1` WASM） | ✅ 已有 `deepseek_pow.js` |
| **upload PoW**（`/api/v0/file/upload_file`） | ✅ 已实现 `deepseek-upload.mjs` |
| 401 自动 relogin 后重试 completion | ⏸ 未做 |
| Python PoW 回退（无 WASM 环境） | ⏸ 未做 |
| 上传后 `fork_file` / `wait_for_file_parsing` + `ref_file_ids` 接线 | ⏸ 未做 |

#### C. 与原「实施节奏」PR 的对应

| PR | 内容 | 状态 |
|----|------|------|
| PR-1 | fixture + runToolPipeline，双端点 |  largely 完成 |
| PR-2 | Schema 泛化 sanitize | ✅ `tool-schema-sanitize.mjs` |
| PR-3 | 能力选择 + Schema Planner，删掉 md/curl 硬编码 | ✅ `tool-capability.mjs` + `tool-schema-planner.mjs` |
| PR-4 | 流式 DSML + 调试日志 + 文档 | ✅ `tool-pipeline-debug.mjs` + 文档 |

#### D. 纯 TS / 去 Python 网关进程

- 长期目标：Zero-Token 网关进程不依赖 `vendor/.../python` 启动方式（若仍存在）。
- 与本次 web 工具链独立，单独排期。

### 验证命令

```powershell
cd d:\cc-haha
bun test src/server/__tests__/zero-token-tool-bridge.test.ts src/server/__tests__/zero-token-tool-pipeline.test.ts src/server/__tests__/zero-token-tool-schema.test.ts src/server/__tests__/zero-token-deepseek-modules.test.ts src/server/__tests__/zero-token-deepseek-upload.test.ts
```

重启 `bun run src/server/index.ts` 后新建会话测试。

- **无 tools**：应看到流式逐字/逐段 `content`（StreamSieve 直通）。
- **有 tools + DeepSeek**：应先网页 DSML，失败再 Planner。
- **上传**（开发/集成测试）：调用 `uploadFileToDeepseek(cred, { fileBytes, filename, contentType })`。

若 `EADDRINUSE 3002`，先结束旧网关进程再启动。

### 文档

- 行为说明：`docs/reference/zero-token-web-toolchain.md`
