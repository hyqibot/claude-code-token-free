import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import {
  extractToolCallsFromDsml,
  validateDirectDownloadToolSequence,
  mergeToolCallExtractions,
  mapToolCallsToAvailableTools,
  looksLikeToolRefusal,
  isClientToolCallArgsValid,
  sanitizeWebFetchArgs,
  expandWinEnvPath,
  scrubStreamTextDelta,
  cleanToolText,
  planToolCallsForDirectDownload,
  tryPlannerFallbackForParsedUpstream,
  isDirectFileDownloadUrl,
  openaiLastIsToolResult,
  dedupeToolCalls,
  coerceDirectFileDownloadToolCalls,
  guardRepeatDownloadTools,
  lastFailedDownloadToolContext,
  lastSuccessfulDownloadToolContext,
  toolResultLooksSufficient,
  normalizeToolResultForPrompt,
} from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/tool-bridge.mjs'

const claudeTools = [
  { type: 'function', function: { name: 'WebFetch', description: 'fetch url', parameters: {} } },
  { type: 'function', function: { name: 'Bash', description: 'shell', parameters: {} } },
  { type: 'function', function: { name: 'Read', description: 'read file', parameters: {} } },
]

describe('zero-token tool-bridge (protocol only)', () => {
  test('extractToolCallsFromDsml parses invoke blocks', () => {
    const text = [
      'ok',
      '｜DSML｜function_calls>',
      '｜DSML｜invoke name="WebFetch">',
      '｜DSML｜parameter name="url" string="true">https://example.com/a.md</｜DSML｜parameter>',
      '｜DSML｜parameter name="prompt" string="true">read it</｜DSML｜parameter>',
      '｜DSML｜/invoke>',
      '｜DSML｜/function_calls>',
    ].join('\n')
    const parsed = extractToolCallsFromDsml(text)
    expect(parsed.ok).toBe(true)
    expect(parsed.toolCalls[0]?.name).toBe('WebFetch')
    expect(parsed.toolCalls[0]?.arguments?.url).toBe('https://example.com/a.md')
  })

  test('mergeToolCallExtractions prefers DSML over strict XML', () => {
    const strict = () => ({ ok: false, toolCalls: [], _from: 'strict' })
    const text = [
      '<|DSML|tool_calls>',
      '  <|DSML|invoke name="WebFetch">',
      '    <|DSML|parameter name="url"><![CDATA[https://x.test]]></|DSML|parameter>',
      '  </|DSML|invoke>',
      '</|DSML|tool_calls>',
    ].join('\n')
    const merged = mergeToolCallExtractions(text, strict)
    expect(merged.ok).toBe(true)
    expect(merged.toolCalls[0]?.name).toBe('WebFetch')
  })

  test('extractToolCallsFromDsml rejects orphan invoke without tool_calls wrapper', () => {
    const text = '<|DSML|invoke name="Read"><|DSML|parameter name="file_path">C:\\a.md</|DSML|parameter></|DSML|invoke>'
    expect(extractToolCallsFromDsml(text).ok).toBe(false)
  })

  test('validateDirectDownloadToolSequence accepts WebFetch for md URL', () => {
    const url = 'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md'
    expect(
      validateDirectDownloadToolSequence(
        [{ name: 'WebFetch', arguments: { url, prompt: 'Extract the complete plain text of this document' } }],
        `下载 ${url}`,
      ),
    ).toBe(true)
  })

  test('validateDirectDownloadToolSequence rejects Read-only for md URL', () => {
    const url = 'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md'
    expect(
      validateDirectDownloadToolSequence(
        [{ name: 'Read', arguments: { file_path: 'C:\\Users\\hahay\\Downloads\\A620260402NXEUQC.md' } }],
        `下载 ${url}`,
      ),
    ).toBe(false)
    expect(
      validateDirectDownloadToolSequence(
        [{ name: 'Bash', arguments: { command: `curl -L "${url}"` } }],
        `下载 ${url}`,
      ),
    ).toBe(false)
    expect(
      validateDirectDownloadToolSequence(
        [
          { name: 'Bash', arguments: { command: `curl.exe -L -o "%USERPROFILE%\\Downloads\\a.md" "${url}"` } },
          { name: 'Read', arguments: { file_path: '%USERPROFILE%\\Downloads\\a.md' } },
        ],
        `下载 ${url}`,
      ),
    ).toBe(true)
  })

  test('looksLikeToolRefusal detects common refusal phrases', () => {
    expect(looksLikeToolRefusal('无法直接下载您提供的这个网址')).toBe(true)
    expect(
      looksLikeToolRefusal('这个东方财富网（dfcfw.com）的文档链接无法直接访问'),
    ).toBe(true)
    expect(
      looksLikeToolRefusal('尝试下载您提供的文档链接，但遇到了技术问题，无法解析该URL的内容'),
    ).toBe(true)
    expect(looksLikeToolRefusal('unable to parse URL content')).toBe(true)
    expect(looksLikeToolRefusal('Here is the summary of your code.')).toBe(false)
  })

  test('isClientToolCallArgsValid accepts WebFetch url', () => {
    expect(
      isClientToolCallArgsValid(
        {
          name: 'WebFetch',
          arguments: { url: 'https://example.com', prompt: 'x' },
        },
        claudeTools,
      ),
    ).toBe(true)
  })

  test('expandWinEnvPath expands %USERPROFILE%', () => {
    const prev = process.env.USERPROFILE
    process.env.USERPROFILE = 'C:\\Users\\testuser'
    expect(expandWinEnvPath('%USERPROFILE%\\Downloads\\a.md')).toBe('C:\\Users\\testuser\\Downloads\\a.md')
    if (prev === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prev
  })

  test('extractToolCallsFromDsml strips CDATA from WebFetch url parameter', () => {
    const text = [
      '<|DSML|tool_calls>',
      '<|DSML|invoke name="WebFetch">',
      '<|DSML|parameter name="url" string="true"><![CDATA[https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md]]></|DSML|parameter>',
      '<|DSML|parameter name="prompt" string="true">read it</|DSML|parameter>',
      '</|DSML|invoke>',
      '</|DSML|tool_calls>',
    ].join('\n')
    const parsed = extractToolCallsFromDsml(text)
    expect(parsed.ok).toBe(true)
    expect(parsed.toolCalls[0]?.arguments?.url).toBe(
      'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md',
    )
    expect(
      isClientToolCallArgsValid(
        { name: 'WebFetch', arguments: parsed.toolCalls[0]?.arguments },
        claudeTools,
      ),
    ).toBe(true)
  })

  test('mapToolCallsToAvailableTools maps curl alias to Bash without inventing command', () => {
    const url = 'https://marketing.dfcfw.com/res/download/A620260402R6LPWW.md'
    const mapped = mapToolCallsToAvailableTools([{ name: 'curl', arguments: { url } }], claudeTools)
    expect(mapped[0]?.name).toBe('Bash')
    expect(mapped[0]?.arguments?.url).toBeUndefined()
    expect(mapped[0]?.arguments?.command).toBeUndefined()
    expect(isClientToolCallArgsValid(mapped[0], claudeTools)).toBe(false)
    expect(isClientToolCallArgsValid({ name: 'curl', arguments: { url } }, claudeTools)).toBe(false)
  })

  test('sanitizeWebFetchArgs strips max_length and other drift fields', () => {
    const out = sanitizeWebFetchArgs({
      url: 'https://example.com/a.md',
      max_length: 50000,
      prompt: 'Fetch this URL and return its full text content for the user.',
    })
    expect(out).toEqual({
      url: 'https://example.com/a.md',
      prompt: 'Fetch this URL and return its full text content for the user.',
    })
    expect(Object.keys(out)).toEqual(['url', 'prompt'])
  })

  test('scrubStreamTextDelta strips DSML residue from plain text', () => {
    const raw = 'hello <|DSML|invoke name="x">world'
    expect(scrubStreamTextDelta(raw)).toBe('hello world')
    expect(scrubStreamTextDelta('</|DSML|tool_calls>')).toBe('')
    expect(scrubStreamTextDelta('</｜DSML｜tool_calls>')).toBe('')
    expect(scrubStreamTextDelta('prefix</|DSML|tool_calls>')).toBe('prefix')
    expect(cleanToolText(raw)).toContain('hello')
  })

  test('planToolCallsForDirectDownload emits WebFetch for dfcfw md URL', () => {
    const url = 'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md'
    expect(isDirectFileDownloadUrl(url)).toBe(true)
    const planned = planToolCallsForDirectDownload(`下载 ${url} 并总结`, claudeTools)
    expect(planned.ok).toBe(true)
    expect(planned.toolCalls[0]?.name).toBe('WebFetch')
    expect(String(planned.toolCalls[0]?.arguments?.url || '')).toBe(url)
    expect(String(planned.toolCalls[0]?.arguments?.prompt || '')).toContain('Extract')
  })

  test('tryPlannerFallbackForParsedUpstream applies on refusal text when env=1', () => {
    const prev = process.env.COPAW_ZT_TOOL_PLANNER_FALLBACK
    process.env.COPAW_ZT_TOOL_PLANNER_FALLBACK = '1'
    const url = 'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md'
    const base = { ok: false, toolCalls: [], needsStrictRetry: false, refusalNoTool: true, skipRetryOnMarkup: false, plannerApplied: false }
    const out = tryPlannerFallbackForParsedUpstream(base, claudeTools, `无法直接下载 ${url}`)
    if (prev === undefined) delete process.env.COPAW_ZT_TOOL_PLANNER_FALLBACK
    else process.env.COPAW_ZT_TOOL_PLANNER_FALLBACK = prev
    expect(out.plannerApplied).toBe(true)
    expect(out.ok).toBe(true)
    expect(out.toolCalls.length).toBeGreaterThan(0)
  })

  test('tryPlannerFallbackForParsedUpstream skips on tool-result turn', () => {
    const url = 'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md'
    const base = { ok: false, toolCalls: [], needsStrictRetry: false, refusalNoTool: true, skipRetryOnMarkup: false, plannerApplied: false }
    const msgs = [{ role: 'tool', tool_call_id: 't1', content: 'User denied via UI' }]
    expect(openaiLastIsToolResult(msgs)).toBe(true)
    const out = tryPlannerFallbackForParsedUpstream(base, claudeTools, `下载 ${url}`, { skipOnToolResultTurn: true })
    expect(out.plannerApplied).toBe(false)
    expect(out.ok).toBe(false)
  })

  test('extractToolCallsFromDsml rejects closing tag without opening invoke', () => {
    const parsed = extractToolCallsFromDsml('</|DSML|tool_calls>')
    expect(parsed.ok).toBe(false)
    expect(parsed.toolCalls.length).toBe(0)
  })

  test('mapToolCallsToAvailableTools keeps WebFetch without gateway rewrite', () => {
    const url = 'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md'
    const mapped = mapToolCallsToAvailableTools(
      [{ name: 'WebFetch', arguments: { url, prompt: 'read' } }],
      claudeTools,
    )
    expect(mapped.length).toBe(1)
    expect(mapped[0]?.name).toBe('WebFetch')
    expect(mapped[0]?.arguments?.url).toBe(url)
  })

  test('mapToolCallsToAvailableTools does not rewrite Bash curl-only command', () => {
    const url = 'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md'
    const cmd = `curl -L "${url}"`
    const mapped = mapToolCallsToAvailableTools([{ name: 'Bash', arguments: { command: cmd } }], claudeTools)
    expect(mapped.length).toBe(1)
    expect(mapped[0]?.arguments?.command).toBe(cmd)
  })

  test('guardRepeatDownloadTools blocks repeat WebFetch after failure', () => {
    const url = 'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md'
    const msgs = [
      { role: 'assistant', tool_calls: [{ id: 't1', function: { name: 'WebFetch', arguments: JSON.stringify({ url, prompt: 'x' }) } }] },
      { role: 'tool', tool_call_id: 't1', name: 'WebFetch', content: 'User denied via UI' },
    ]
    expect(lastFailedDownloadToolContext(msgs)?.url).toBe(url)
    const guard = guardRepeatDownloadTools([{ name: 'WebFetch', arguments: { url, prompt: 'x' } }], msgs)
    expect(guard.suppressed).toBe(true)
    expect(guard.reason).toBe('failed')
    expect(guard.toolCalls.length).toBe(0)
  })

  test('guardRepeatDownloadTools blocks repeat WebFetch after sufficient success', () => {
    const url = 'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md'
    const summary =
      '该文档是一份名为“东方财富妙想Skills安装指南”的技术说明。前提条件：需要 Node.js 22。安装步骤：清理旧版本、下载技能包、设置 MX_APIKEY。' +
      'x'.repeat(300)
    expect(toolResultLooksSufficient(summary)).toBe(true)
    const msgs = [
      { role: 'assistant', tool_calls: [{ id: 't1', function: { name: 'WebFetch', arguments: JSON.stringify({ url, prompt: 'x' }) } }] },
      { role: 'tool', tool_call_id: 't1', name: 'WebFetch', content: summary },
    ]
    expect(lastSuccessfulDownloadToolContext(msgs)?.url).toBe(url)
    const guard = guardRepeatDownloadTools(
      [{ name: 'WebFetch', arguments: { url, prompt: 'Extract complete text' } }],
      msgs,
    )
    expect(guard.suppressed).toBe(true)
    expect(guard.reason).toBe('success')
    expect(guard.fallbackText).toContain('安装指南')
  })

  test('coerceDirectFileDownloadToolCalls keeps WebFetch unchanged', () => {
    const url = 'https://marketing.dfcfw.com/res/download/a.md'
    const planned = coerceDirectFileDownloadToolCalls(
      [{ name: 'WebFetch', arguments: { url, prompt: 'x' } }],
      claudeTools,
    )
    expect(planned.length).toBe(1)
    expect(planned[0]?.name).toBe('WebFetch')
  })

  test('dedupeToolCalls removes identical Bash invocations', () => {
    const cmd = 'curl -L -o "C:\\\\x.md" "https://example.com/a.md"'
    const dup = [
      { name: 'Bash', arguments: { command: cmd } },
      { name: 'Bash', arguments: { command: cmd } },
      { name: 'Read', arguments: { file_path: 'C:\\x.md' } },
    ]
    const out = dedupeToolCalls(dup)
    expect(out.length).toBe(2)
    expect(out.filter((t) => t.name === 'Bash').length).toBe(1)
  })

  test('normalizeToolResultForPrompt reports on-disk size after curl -o', () => {
    const tmp = join(os.tmpdir(), `zt-curl-${Date.now()}.md`)
    fs.writeFileSync(tmp, '# hello\nbody', 'utf8')
    try {
      const msgs = [
        {
          role: 'assistant',
          tool_calls: [
            {
              id: '1',
              function: {
                name: 'Bash',
                arguments: JSON.stringify({ command: `curl.exe -L -o "${tmp}" "https://example.com/a.md"` }),
              },
            },
          ],
        },
        { role: 'tool', name: 'Bash', content: '' },
      ]
      const out = normalizeToolResultForPrompt('', msgs[1], msgs)
      expect(out).toContain('saved')
      expect(out).toContain('bytes')
      expect(out).toContain('Call Read')
    } finally {
      fs.unlinkSync(tmp)
    }
  })
})
