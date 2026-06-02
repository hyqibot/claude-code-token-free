import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PIPELINE_DECISIONS,
  parseUpstreamToolCalls,
  processParsedUpstream,
  collectUpstreamWithToolSieve,
  finalizeStreamSieveCollection,
  fullBufHasToolMarkup,
} from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/tool-pipeline.mjs'
import {
  sanitizeWebFetchArgs,
  isClientToolCallArgsValid,
} from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/tool-bridge.mjs'

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, 'fixtures', 'zero-token-tool-fixtures.json'), 'utf8'),
)

const claudeTools = [
  { type: 'function', function: { name: 'WebFetch', parameters: { type: 'object', properties: { url: {}, prompt: {} } } } },
  { type: 'function', function: { name: 'Bash', parameters: { type: 'object', properties: { command: {} } } } },
  { type: 'function', function: { name: 'Read', parameters: { type: 'object', properties: { file_path: {} } } } },
]

const strictFail = () => ({ ok: false, toolCalls: [] })

const strictXmlExtract = (text: string) => {
  const m = String(text || '').match(/<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/i)
  if (!m) return { ok: false, toolCalls: [] as { name: string; arguments: Record<string, unknown> }[] }
  try {
    const obj = JSON.parse(m[1]) as { name?: string; arguments?: Record<string, unknown> }
    if (obj?.name && obj.arguments && typeof obj.arguments === 'object') {
      return { ok: true, toolCalls: [{ name: obj.name, arguments: obj.arguments }] }
    }
  } catch {
    /* ignore */
  }
  return { ok: false, toolCalls: [] }
}

describe('zero-token tool-pipeline', () => {
  test('PIPELINE_DECISIONS: DSML-first parse flags', () => {
    expect(PIPELINE_DECISIONS.multiToolUsePerTurn).toBe(true)
    expect(PIPELINE_DECISIONS.dsmlFirstParse).toBe(true)
    expect(PIPELINE_DECISIONS.skipStrictRetryWhenFullBufHasToolMarkup).toBe(true)
  })

  test('fullBufHasToolMarkup detects lone closing DSML tag (no URL retry loop)', () => {
    const buf = '无法直接访问该链接。</|DSML|tool_calls>'
    expect(fullBufHasToolMarkup(buf)).toBe(true)
  })

  test('parseUpstreamToolCalls: lone closing DSML tag does not invent tools', () => {
    const buf = 'refusal text</|DSML|tool_calls>'
    const parsed = parseUpstreamToolCalls([], '', claudeTools, strictFail, buf)
    expect(parsed.ok).toBe(false)
  })

  test('parseUpstreamToolCalls: DSML before strict XML', () => {
    const parsed = parseUpstreamToolCalls([], fixtures.dsmlWebFetchSnippet, claudeTools, strictFail)
    expect(parsed.ok).toBe(true)
    expect(parsed.toolCalls[0]?.name).toBe('WebFetch')
  })

  test('processParsedUpstream: accepts WebFetch DSML for direct .md URL', () => {
    const r = processParsedUpstream({
      capturedToolCalls: [],
      outAll: fixtures.dsmlWebFetchMdSnippet,
      fullBuf: fixtures.dsmlWebFetchMdSnippet,
      tools: claudeTools,
      strictExtractFn: strictFail,
      requireTool: false,
      userText: fixtures.mdDownloadUserText,
    })
    expect(r.ok).toBe(true)
    expect(r.toolCalls[0]?.name).toBe('WebFetch')
  })

  test('processParsedUpstream: refusal on URL task does not inject tools without planner', () => {
    const r = processParsedUpstream({
      capturedToolCalls: [],
      outAll: fixtures.refusalText,
      fullBuf: fixtures.refusalText,
      tools: claudeTools,
      strictExtractFn: strictFail,
      requireTool: true,
      userText: fixtures.mdDownloadUserText,
    })
    expect(r.ok).toBe(false)
    expect(r.needsStrictRetry).toBe(true)
    expect(r.directDownloadFallback).toBeUndefined()
  })

  test('processParsedUpstream: casual 你能做什么 does not strict-retry even when requireTool', () => {
    const r = processParsedUpstream({
      capturedToolCalls: [],
      outAll: '我可以帮你读写文件、执行命令等。',
      tools: claudeTools,
      strictExtractFn: strictFail,
      requireTool: true,
      userText: '你能做什么',
    })
    expect(r.needsStrictRetry).toBe(false)
  })

  test('processParsedUpstream: refusal on .md URL stays non-tool unless planner env=1', () => {
    const r = processParsedUpstream({
      capturedToolCalls: [],
      outAll: fixtures.refusalText,
      fullBuf: fixtures.refusalText,
      tools: claudeTools,
      strictExtractFn: strictFail,
      requireTool: false,
      userText: fixtures.mdDownloadUserText,
    })
    expect(r.ok).toBe(false)
    expect(r.plannerApplied).toBe(false)
  })

  test('processParsedUpstream: planner on when COPAW_ZT_TOOL_PLANNER_FALLBACK=1', () => {
    const prev = process.env.COPAW_ZT_TOOL_PLANNER_FALLBACK
    process.env.COPAW_ZT_TOOL_PLANNER_FALLBACK = '1'
    const r = processParsedUpstream({
      capturedToolCalls: [],
      outAll: fixtures.refusalText,
      fullBuf: fixtures.refusalText,
      tools: claudeTools,
      strictExtractFn: strictFail,
      requireTool: false,
      userText: fixtures.mdDownloadUserText,
    })
    if (prev === undefined) delete process.env.COPAW_ZT_TOOL_PLANNER_FALLBACK
    else process.env.COPAW_ZT_TOOL_PLANNER_FALLBACK = prev
    expect(r.plannerApplied).toBe(true)
    expect(r.ok).toBe(true)
    expect(r.toolCalls[0]?.name).toBe('WebFetch')
  })

  test('processParsedUpstream: no planner on tool-result turn (avoids repeat curl)', () => {
    const r = processParsedUpstream({
      capturedToolCalls: [],
      outAll: '好的，我再试一次',
      fullBuf: '好的，我再试一次',
      tools: claudeTools,
      strictExtractFn: strictFail,
      requireTool: false,
      userText: fixtures.mdDownloadUserText,
      plannerSkipToolResultTurn: true,
    })
    expect(r.plannerApplied).toBe(false)
    expect(r.ok).toBe(false)
  })

  test('processParsedUpstream: wrong Read path still parses (no intent gate)', () => {
    const r = processParsedUpstream({
      capturedToolCalls: [],
      outAll:
        '<tool_call>{"name":"Read","arguments":{"file_path":"C:\\\\Users\\\\hahay\\\\.claude\\\\CLAUDE.md"}}</tool_call>',
      tools: claudeTools,
      strictExtractFn: strictXmlExtract,
      requireTool: true,
    })
    expect(r.ok).toBe(true)
    expect(r.toolCalls[0]?.name).toBe('Read')
    expect(r.needsStrictRetry).toBe(false)
  })

  test('processParsedUpstream: valid XML tool calls pass', () => {
    const r = processParsedUpstream({
      capturedToolCalls: [],
      outAll: fixtures.xmlToolCallSnippet,
      tools: claudeTools,
      strictExtractFn: strictXmlExtract,
      requireTool: true,
    })
    expect(r.ok).toBe(true)
    expect(r.toolCalls[0]?.name).toBe('WebFetch')
    expect(r.needsStrictRetry).toBe(false)
  })

  test('collectUpstreamWithToolSieve: keeps greeting text when DSML follows (no throw/skip flush)', async () => {
    const dsml = [
      '<|DSML|tool_calls>',
      '<|DSML|invoke name="Bash">',
      '<|DSML|parameter name="command"><![CDATA[echo x]]></|DSML|parameter>',
      '</|DSML|invoke>',
      '</|DSML|tool_calls>',
    ].join('\n')
    const r = await collectUpstreamWithToolSieve(
      async (onChunk) => {
        onChunk('你好！')
        onChunk('\n')
        onChunk(dsml)
      },
      { tools: claudeTools, strictExtractFn: strictFail },
    )
    expect(r.outAll).toContain('你好')
    expect(r.toolCalls.length).toBeGreaterThan(0)
    expect(r.toolCalls[0]?.name).toBe('Bash')
  })

  test('collectUpstreamWithToolSieve: fragmented SSE still gets tools from fullBuf fallback', async () => {
    const dsml = [
      '<|DSML|tool_calls>',
      '<|DSML|invoke name="Bash">',
      '<|DSML|parameter name="command"><![CDATA[curl -L url]]></|DSML|parameter>',
      '</|DSML|invoke>',
      '</|DSML|tool_calls>',
    ].join('\n')
    const r = await collectUpstreamWithToolSieve(
      async (onChunk) => {
        onChunk('用 curl 下载 https://example.com/a.md\n')
        onChunk('<|DSML|')
        onChunk('tool_calls>')
        onChunk(dsml.slice(dsml.indexOf('\n') + 1))
      },
      { tools: claudeTools, strictExtractFn: strictFail },
    )
    expect(r.outAll).toContain('curl')
    expect(r.toolCalls[0]?.name).toBe('Bash')
    expect(fullBufHasToolMarkup(r.fullBuf)).toBe(true)
  })

  test('processParsedUpstream: fullBuf DSML skips strict retry when sieve missed tools', () => {
    const full = '说明文字<|DSML|tool_calls></|DSML|tool_calls>'
    const r = processParsedUpstream({
      capturedToolCalls: [],
      outAll: '说明文字',
      fullBuf: full,
      tools: claudeTools,
      strictExtractFn: strictFail,
      requireTool: true,
    })
    expect(r.skipRetryOnMarkup).toBe(true)
    expect(r.needsStrictRetry).toBe(false)
  })

  test('finalizeStreamSieveCollection: prefers fullBuf text when sieve text is shorter', () => {
    const full = '完整前缀<|DSML|tool_calls><|DSML|invoke name="Bash"><|DSML|parameter name="command"><![CDATA[echo]]></|DSML|parameter></|DSML|invoke></|DSML|tool_calls>'
    const r = finalizeStreamSieveCollection({
      fullBuf: full,
      sieveOutAll: '碎片',
      sieveToolCalls: null,
      tools: claudeTools,
      strictExtractFn: strictFail,
    })
    expect(r.outAll).toContain('完整前缀')
    expect(r.toolCalls[0]?.name).toBe('Bash')
  })

  test('golden: polluted WebFetch args stripped for CLI schema', () => {
    const clean = sanitizeWebFetchArgs(fixtures.webFetchPollutedArgs)
    expect(Object.keys(clean).sort()).toEqual(['prompt', 'url'])
    expect(isClientToolCallArgsValid({ name: 'WebFetch', arguments: clean }, claudeTools)).toBe(true)
  })
})
