#!/usr/bin/env bun
/**
 * 一次性输出 TLS/网络证据链 JSON（stdout）。请在**复现问题时的终端环境**里运行
 *（与 Server / CLI 子进程相同的 env），便于对照 runtime-errors.log。
 *
 * 用法：
 *   cd D:\cc-haha
 *   bun run scripts/tls-evidence-chain.ts
 *
 * 跳过公网探测（仅本机 / env 里配置的 URL）：
 *   bun run scripts/tls-evidence-chain.ts --no-canary
 */
import { runTlsEvidenceChain } from '../src/utils/tlsEvidenceChain.js'

const noCanary = process.argv.includes('--no-canary')

const report = await runTlsEvidenceChain({
  includePublicHttpsCanary: !noCanary,
  timeoutMs: 12_000,
})

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
