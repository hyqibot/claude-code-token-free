# Cursor Agent workflow（私有仓）

Workflow 文件：`.github/workflows/cursor-agent.yml`

在 GitHub Actions 里手动 **Run workflow** 触发，需要 Secret `CURSOR_API_KEY`。

## mode：audit vs implement

| mode | 用途 | 会改代码？ | 会推分支？ |
|------|------|------------|------------|
| **audit** | 看项目、找改善点、架构/代码评审 | **否** | **否** |
| **implement** | 明确要 Agent 改代码（修 bug、小功能） | 是 | 是（有改动时） |

**调研 / 「有没有值得改善的地方」类任务请选 `audit`。**

### audit 模式

- Agent 只能阅读、搜索、分析；报告写在 **Actions 日志**里。
- 查看路径：Actions → 对应 run → 步骤 **Run Cursor Agent (audit — read only)** 的完整 stdout。
- 若 Agent 仍改了文件，workflow 会在 **Reject audit workspace mutations** 步骤 **失败**，并列出 diff，**不会** push 分支。

### implement 模式

- Agent 可改业务文件（仍禁止改 workflow、根 package.json、Tauri 等，见 workflow 内提示）。
- 有改动时推 `cursor/agent-<run_id>`；`create_pr=true` 时自动开 PR。
- `verify_mode`：`narrow` / `verify` / `skip`（默认 skip）。

## 常用 dispatch 示例

**只读评审（推荐用于 #5 那种任务）：**

- mode: `audit`
- prompt: `通读 desktop 与 server 核心路径，列出按优先级排序的改善建议，不要改任何文件。`

**修 CI / 改代码：**

- mode: `implement`
- verify_mode: `narrow` 或 `verify`（按需）
- create_pr: 按需

## 输出在哪里

| mode | 结论 /  diff |
|------|----------------|
| audit | 仅 Actions 日志（无 PR、无分支） |
| implement | 日志 + `cursor/agent-<run_id>` 分支 compare |

Run URL 形如：`https://github.com/hyqibot/claude-code-private/actions/runs/<run_id>`
