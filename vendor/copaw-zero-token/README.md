# Zero-Token 网关（公开源码说明）

本公开仓库 **不包含** Zero-Token 网关完整实现（`vendor/copaw-zero-token/python/` 等）及预编译 sidecar（`zero-token-gateway.exe`、`zero-token-webauth-runner.exe`）。

- **桌面安装包**：请从 [Releases](https://github.com/hyqibot/claude-code-token-free/releases) 下载；安装包内已含发行方私有构建的 sidecar。
- **Zero-Token 功能**：需在设置中配置 `license.serverUrl` 并完成激活；授权服务由发行方单独部署，不在本仓库。
- **本地开发**：可正常使用 CLI、桌面 Web UI（`cd desktop && bun run dev`）及 Anthropic / OpenRouter 等 API Key 类 Provider；**无法**在公开 clone 上本地执行完整 `build:sidecars` 打含 Zero-Token 的 Tauri 包。

维护者从私有源码仓单向同步至本目录；请勿向私有仓 merge 公开仓变更。
