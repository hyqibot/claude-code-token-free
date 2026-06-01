import { describe, expect, test } from 'bun:test'
import {
  buildDsmlToolPrompt,
  buildDeepSeekPromptForTurn,
  buildDeepSeekDsmlStrictRetryPrompt,
  buildDeepSeekXmlStrictRetryPrompt,
  buildDsmlToolPromptCasual,
  buildDsmlToolReminderCasual,
  buildDsmlToolReminderCompact,
  convertMessagesForDeepseek,
  filterToolsForDsmlPrompt,
  formatToolCallsForPrompt,
  trimMessagesForDeepseekTurn,
  isDeepSeekConvFirstTurn,
  shouldMarkDeepSeekDsmlFullSent,
  measureDsmlPromptStats,
} from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/deepseek-prompt.mjs'
import { parseDeepSeekSseLines, extractDeepSeekResponseMessageId } from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/deepseek-sse.mjs'
import {
  capDeepSeekPrompt,
  capDeepSeekSystemText,
  fitDeepSeekSystemParts,
  isDeepSeekBanOrRiskText,
  normalizeDeepSeekParentMessageId,
  promptHasFullDsml,
  promptHasFullToolInstructions,
  resolveDeepSeekParentForApi,
  parseDeepSeekApiError,
  DEEPSEEK_GUARD,
} from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/deepseek-guard.mjs'
import {
  buildDeepSeekWebHeaders,
  isDeepSeekHostUrl,
} from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/deepseek-web-client.mjs'
import { StreamSieve, createTextOnlyStreamSieve } from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/tool-sieve.mjs'
import { resolveToolName, normalizeToolResultForPrompt } from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/tool-bridge.mjs'
import {
  isDeepSeekXmlMode,
  resolveDeepSeekToolMode,
} from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/deepseek-tool-mode.mjs'

describe('deepseek-prompt', () => {
  test('buildDsmlToolPrompt includes DSML wrapper rules', () => {
    const p = buildDsmlToolPrompt([{ type: 'function', function: { name: 'Bash', description: 'run' } }])
    expect(p).toContain('<|DSML|tool_calls>')
    expect(p).toContain('Bash')
  })

  test('measureDsmlPromptStats reports DSML size vs caps', () => {
    const tools = [{ type: 'function', function: { name: 'Bash', description: 'run' } }]
    const p = buildDeepSeekPromptForTurn([{ role: 'user', content: 'hi' }], tools, null, {
      dsmlFullSent: false,
    })
    const s = measureDsmlPromptStats(tools, p)
    expect(s.toolCount).toBe(1)
    expect(s.dsmlChars).toBeGreaterThan(2400)
    expect(s.dsmlPctOfSystemCap).toBeGreaterThan(40)
    expect(s.hasFullDsml).toBe(true)
    expect(s.promptTruncated).toBe(false)
  })

  test('buildDsmlToolPrompt: tool lines include schema required fields (PR-3)', () => {
    const p = buildDsmlToolPrompt([
      {
        type: 'function',
        function: {
          name: 'WebFetch',
          description: 'Fetches content from a specified URL',
          parameters: { type: 'object', properties: { url: {}, prompt: {} }, required: ['url', 'prompt'] },
        },
      },
      { type: 'function', function: { name: 'Bash', description: 'run shell', parameters: { type: 'object', properties: { command: {} }, required: ['command'] } } },
    ])
    expect(p).toContain('Required: url, prompt')
    expect(p).toContain('Required: command')
    expect(p).not.toContain('PREFERRED for direct')
  })

  test('filterToolsForDsmlPrompt omits Bash/Read for direct .md URL when WebFetch available', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'WebFetch',
          description: 'x',
          parameters: { type: 'object', properties: { url: {}, prompt: {} }, required: ['url', 'prompt'] },
        },
      },
      { type: 'function', function: { name: 'Bash', description: 'x', parameters: { type: 'object', properties: { command: {} }, required: ['command'] } } },
      { type: 'function', function: { name: 'Read', description: 'x', parameters: { type: 'object', properties: { file_path: {} }, required: ['file_path'] } } },
    ]
    const url = 'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md'
    const filtered = filterToolsForDsmlPrompt(tools, `下载 ${url}`)
    expect(filtered.map((t) => t.function.name)).toEqual(['WebFetch'])
    const prompt = convertMessagesForDeepseek([{ role: 'user', content: `下载 ${url} 并总结` }], tools)
    expect(prompt).toMatch(/Available tools:[\s\S]*WebFetch/)
    expect(prompt).not.toMatch(/Available tools:[\s\S]*\n  - Bash:/)
    expect(prompt).toContain('WebFetch')
    expect(prompt).toContain('Wrong 5')
  })

  test('convertMessagesForDeepseek embeds tools in system', () => {
    const prompt = convertMessagesForDeepseek(
      [{ role: 'user', content: 'hi' }],
      [{ type: 'function', function: { name: 'Read', description: 'read file' } }],
    )
    expect(prompt).toContain('<｜System｜>')
    expect(prompt).toContain('<|DSML|tool_calls>')
    expect(prompt).toContain('<｜User｜>')
    expect(prompt).toContain('hi')
  })

  test('xml mode: strips Claude system and matches doubao first-turn shape', () => {
    const prev = process.env.COPAW_ZT_DEEPSEEK_TOOL_MODE
    process.env.COPAW_ZT_DEEPSEEK_TOOL_MODE = 'xml'
    try {
      const tools = [{ type: 'function', function: { name: 'Read', description: 'read file' } }]
      const sys = 'You are Claude Code. Read CLAUDE.md for project rules.'
      const prompt = buildDeepSeekPromptForTurn(
        [{ role: 'system', content: sys }, { role: 'user', content: 'hi' }],
        tools,
        null,
        { dsmlFullSent: false },
      )
      expect(prompt).toContain('## Tool Use Instructions')
      expect(prompt).toContain('<tool_call')
      expect(prompt).not.toContain('<|DSML|tool_calls>')
      expect(prompt).not.toContain('Claude Code')
      expect(prompt).not.toContain('规则14')
      expect(prompt).not.toContain('编程助手')
      expect(prompt).toContain('<｜User｜>hi')
      expect(promptHasFullToolInstructions(prompt)).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.COPAW_ZT_DEEPSEEK_TOOL_MODE
      else process.env.COPAW_ZT_DEEPSEEK_TOOL_MODE = prev
    }
  })

  test('xml mode: continue turn is User: prefix only like doubao', () => {
    const prev = process.env.COPAW_ZT_DEEPSEEK_TOOL_MODE
    process.env.COPAW_ZT_DEEPSEEK_TOOL_MODE = 'xml'
    try {
      const tools = [{ type: 'function', function: { name: 'Bash', description: 'run' } }]
      const prompt = buildDeepSeekPromptForTurn([{ role: 'user', content: 'hi' }], tools, 'parent-1', {
        dsmlFullSent: true,
      })
      expect(prompt).toBe('User: hi')
      expect(prompt).not.toContain('[TOOL REMINDER]')
      expect(prompt).not.toContain('Claude')
    } finally {
      if (prev === undefined) delete process.env.COPAW_ZT_DEEPSEEK_TOOL_MODE
      else process.env.COPAW_ZT_DEEPSEEK_TOOL_MODE = prev
    }
  })

  test('xml mode: tool loop matches doubao Please proceed only', () => {
    const prev = process.env.COPAW_ZT_DEEPSEEK_TOOL_MODE
    process.env.COPAW_ZT_DEEPSEEK_TOOL_MODE = 'xml'
    try {
      const tools = [{ type: 'function', function: { name: 'Bash', description: 'run' } }]
      const prompt = buildDeepSeekPromptForTurn(
        [{ role: 'tool', tool_call_id: 't1', name: 'Bash', content: 'ok' }],
        tools,
        'parent-1',
        { dsmlFullSent: true },
      )
      expect(prompt).toContain('<tool_response')
      expect(prompt).toContain('Please proceed based on this tool result.')
      expect(prompt).not.toContain('[TOOL REMINDER]')
      expect(prompt).not.toContain('WebFetch failed')
    } finally {
      if (prev === undefined) delete process.env.COPAW_ZT_DEEPSEEK_TOOL_MODE
      else process.env.COPAW_ZT_DEEPSEEK_TOOL_MODE = prev
    }
  })

  test('buildDeepSeekXmlStrictRetryPrompt requires tool_call not DSML', () => {
    const p = buildDeepSeekXmlStrictRetryPrompt(
      [{ type: 'function', function: { name: 'Bash', description: 'run' } }],
      'download file',
    )
    expect(p).toContain('<tool_call')
    expect(p).not.toContain('<|DSML|tool_calls>')
    expect(p).toContain('## Tool Use Instructions')
  })

  test('convertMessagesForDeepseek merges task hints into existing system (curl download)', () => {
    const url = 'https://marketing.dfcfw.com/res/download/A620260402R6LPWW.md'
    const extra = `Use Bash curl to download ${url}; do NOT read CLAUDE.md.`
    const prompt = convertMessagesForDeepseek(
      [
        {
          role: 'system',
          content: `You are Claude Code. Read CLAUDE.md for project rules.\n\n${extra}`,
        },
        { role: 'user', content: `下载 ${url}，告诉我里面的内容` },
      ],
      [
        { type: 'function', function: { name: 'Bash', description: 'shell' } },
        { type: 'function', function: { name: 'Read', description: 'read file' } },
      ],
    )
    const sysStart = prompt.indexOf('<｜System｜>')
    const sysEnd = prompt.indexOf('<｜end▁of▁instructions｜>')
    const sysBlock = prompt.slice(sysStart, sysEnd)
    expect(sysBlock).toContain('curl')
    expect(sysBlock).toContain('CLAUDE.md')
    expect(prompt).toContain(url)
  })

  test('convertMessagesForDeepseek embeds full tool result by default (no 500-char cap)', () => {
    const prev = process.env.COPAW_ZT_TOOL_RESULT_MAX_CHARS
    delete process.env.COPAW_ZT_TOOL_RESULT_MAX_CHARS
    const body = 'FULL-' + 'x'.repeat(2500)
    const prompt = convertMessagesForDeepseek(
      [{ role: 'tool', tool_call_id: 't1', name: 'WebFetch', content: body }],
      [{ type: 'function', function: { name: 'WebFetch', description: 'fetch' } }],
    )
    if (prev === undefined) delete process.env.COPAW_ZT_TOOL_RESULT_MAX_CHARS
    else process.env.COPAW_ZT_TOOL_RESULT_MAX_CHARS = prev
    expect(prompt).toContain(body)
    expect(prompt).not.toMatch(/FULL-x{500}$/)
  })

  test('convertMessagesForDeepseek appends stop hint after sufficient WebFetch tool result', () => {
    const summary =
      '该文档是东方财富妙想Skills安装指南。前提：Node.js 22+。步骤：清理旧版、下载 zip、设置 MX_APIKEY。' +
      'y'.repeat(400)
    const prompt = convertMessagesForDeepseek(
      [
        { role: 'user', content: '下载并总结' },
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'w1',
              function: {
                name: 'WebFetch',
                arguments: JSON.stringify({
                  url: 'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md',
                  prompt: 'x',
                }),
              },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'w1', name: 'WebFetch', content: summary },
      ],
      [{ type: 'function', function: { name: 'WebFetch', description: 'fetch' } }],
    )
    expect(prompt).toContain('Do NOT output <|DSML|tool_calls>')
    expect(prompt.length).toBeGreaterThan(600)
  })

  test('trimMessagesForDeepseekTurn drops middle tool history for 你能做什么', () => {
    const longTool = { role: 'tool', content: 'x'.repeat(3000) }
    const trimmed = trimMessagesForDeepseekTurn([
      { role: 'system', content: 'sys' },
      { role: 'user', content: '下载某文件' },
      { role: 'assistant', content: 'ok' },
      longTool,
      { role: 'user', content: '你能做什么' },
    ])
    expect(trimmed.length).toBe(2)
    expect(trimmed.at(-1)?.content).toBe('你能做什么')
  })

  test('buildDsmlToolPrompt forbids prose-only download refusals (rule 13)', () => {
    const p = buildDsmlToolPrompt([{ type: 'function', function: { name: 'Bash', description: 'run' } }])
    expect(p).toContain('无法下载')
    expect(p).toContain('NEVER reply with prose-only refusals')
  })

  test('isDeepSeekConvFirstTurn tracks conv-level DSML full prompt', () => {
    expect(isDeepSeekConvFirstTurn(false)).toBe(true)
    expect(isDeepSeekConvFirstTurn(true)).toBe(false)
  })

  test('buildDeepSeekPromptForTurn: conv first turn uses full DSML for 你能做什么 (no rule 14)', () => {
    const tools = [{ type: 'function', function: { name: 'Bash', description: 'shell' } }]
    const prompt = buildDeepSeekPromptForTurn(
      [
        { role: 'system', content: 'sys' },
        { role: 'tool', content: 'HUGE-' + 'z'.repeat(4000) },
        { role: 'user', content: '你能做什么' },
      ],
      tools,
      null,
      { dsmlFullSent: false },
    )
    expect(prompt).toContain('你能做什么')
    expect(prompt).not.toContain('HUGE-')
    expect(prompt).toContain('TOOL CALL FORMAT')
    expect(prompt).not.toContain('规则14适用本句')
    expect(prompt).not.toContain('Wrong 8')
    expect(prompt).not.toContain('编程助手')
    expect(prompt).not.toContain('【执行要求】')
  })

  test('buildDeepSeekPromptForTurn: task turn keeps only last user not 14-turn history', () => {
    const tools = [{ type: 'function', function: { name: 'Bash', description: 'shell' } }]
    const msgs = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: '你是谁' },
      { role: 'assistant', content: '你好！' },
      { role: 'user', content: '下载 https://example.com/a.md 并总结' },
    ]
    const full = buildDeepSeekPromptForTurn(msgs, tools, null, { dsmlFullSent: false })
    expect(full).toContain('下载 https://example.com/a.md')
    expect(full).not.toContain('<｜User｜>你是谁')
    expect(full).toContain('TOOL CALL FORMAT')
  })

  test('trimMessagesForDeepseekTurn: tool-result tail keeps at most 5 non-system msgs', () => {
    const msgs = [
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'a' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'tool', content: 't1' },
      { role: 'user', content: 'u3' },
      { role: 'assistant', content: 'a3' },
      { role: 'tool', content: 't2' },
      { role: 'user', content: 'u4' },
      { role: 'assistant', content: 'a4' },
      { role: 'tool', content: 't3' },
    ]
    const trimmed = trimMessagesForDeepseekTurn(msgs)
    expect(trimmed.filter((m) => m.role !== 'system').length).toBeLessThanOrEqual(5)
    expect(trimmed.at(-1)?.role).toBe('tool')
  })

  test('trimMessagesForDeepseekTurn: long history capped to 5 non-system on first turn', () => {
    const msgs = [{ role: 'system', content: 'sys' }]
    for (let i = 0; i < 12; i++) {
      msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}` })
    }
    msgs.push({ role: 'user', content: 'latest' })
    const trimmed = trimMessagesForDeepseekTurn(msgs)
    expect(trimmed.filter((m) => m.role !== 'system').length).toBeLessThanOrEqual(5)
    expect(trimmed.at(-1)?.content).toBe('latest')
  })

  test('buildDeepSeekPromptForTurn: without tools continue turn stays short', () => {
    const msgs = [
      { role: 'user', content: '你是谁' },
      { role: 'assistant', content: '你好！' },
      { role: 'user', content: '继续' },
    ]
    const cont = buildDeepSeekPromptForTurn(msgs, [], 'msg-parent-1')
    expect(cont).toContain('继续')
    expect(cont).not.toContain('<｜System｜>')
  })

  test('buildDeepSeekPromptForTurn: with tools + parent sends only tool_result', () => {
    const tools = [{ type: 'function', function: { name: 'WebFetch', description: 'fetch' } }]
    const msgs = [
      { role: 'user', content: '下载 https://example.com/a.md' },
      { role: 'assistant', content: 'ok' },
      { role: 'tool', tool_call_id: 'tc1', name: 'WebFetch', content: 'file body here' },
    ]
    const cont = buildDeepSeekPromptForTurn(msgs, tools, 'msg-parent-99', { dsmlFullSent: true })
    expect(cont).toContain('<tool_response')
    expect(cont).toContain('file body here')
    expect(cont).not.toContain('下载 https://example.com/a.md')
    expect(cont).not.toContain('TOOL CALL FORMAT')
    expect(cont).toContain('TOOL REMINDER')
  })

  test('buildDeepSeekPromptForTurn: empty Bash curl -o still sends tool_response without parent', () => {
    const tools = [
      { type: 'function', function: { name: 'Bash', description: 'shell' } },
      { type: 'function', function: { name: 'Read', description: 'read' } },
    ]
    const msgs = [
      { role: 'user', content: '下载 https://marketing.dfcfw.com/res/download/A.md 并总结' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'tc_bash',
            type: 'function',
            function: {
              name: 'Bash',
              arguments:
                '{"command":"curl.exe -L -o \\"C:\\\\Users\\\\hahay\\\\Downloads\\\\A.md\\" \\"https://marketing.dfcfw.com/res/download/A.md\\""}',
            },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'tc_bash', name: 'Bash', content: '' },
    ]
    const cont = buildDeepSeekPromptForTurn(msgs, tools, null, { dsmlFullSent: false })
    expect(cont).toContain('<tool_response')
    expect(cont).toMatch(/curl|file not found|saved \d+ bytes/i)
    expect(cont).not.toContain('TOOL CALL FORMAT')
  })

  test('buildDeepSeekPromptForTurn: with tools + parent sends plain user for 你能做什么', () => {
    const tools = [{ type: 'function', function: { name: 'Bash', description: 'shell' } }]
    const msgs = [
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧答' },
      { role: 'user', content: '你能做什么' },
    ]
    const cont = buildDeepSeekPromptForTurn(msgs, tools, 'msg-parent-2', { dsmlFullSent: true })
    expect(cont).toBe('你能做什么')
    expect(cont).not.toContain('旧问题')
    expect(cont).not.toContain('[TOOL REMINDER]')
    expect(cont).not.toContain('规则14')
  })

  test('buildDeepSeekPromptForTurn: conv first turn hi uses full DSML without 执行要求', () => {
    const tools = [{ type: 'function', function: { name: 'Bash', description: 'x' } }]
    const sys =
      'You are Claude Code. When the user asks you to perform tasks, you MUST use the available tools.'
    for (const hi of ['你好', 'hi']) {
      const p = buildDeepSeekPromptForTurn(
        [{ role: 'system', content: sys }, { role: 'user', content: hi }],
        tools,
        null,
        { dsmlFullSent: false },
      )
      expect(p).toContain('TOOL CALL FORMAT')
      expect(p).not.toContain('规则14适用本句')
      expect(p).not.toContain('Wrong 8')
      expect(p).not.toContain('Rule 14')
      expect(p).not.toContain('编程助手')
      expect(p).not.toContain('【执行要求】')
      expect(p).toContain(hi)
    }
  })

  test('buildDeepSeekPromptForTurn: continue hi after DSML sends plain user only', () => {
    const tools = [{ type: 'function', function: { name: 'Bash', description: 'x' } }]
    const p = buildDeepSeekPromptForTurn([{ role: 'user', content: 'hi' }], tools, 'parent-1', {
      dsmlFullSent: true,
    })
    expect(p).toBe('hi')
    expect(p).not.toContain('[TOOL REMINDER]')
    expect(p).not.toContain('规则14')
  })

  test('buildDeepSeekPromptForTurn: dsmlFullSent true without parent still full DSML for hi', () => {
    const tools = [{ type: 'function', function: { name: 'Bash', description: 'x' } }]
    const p = buildDeepSeekPromptForTurn([{ role: 'user', content: 'hi' }], tools, null, {
      dsmlFullSent: true,
    })
    expect(p).toContain('TOOL CALL FORMAT')
    expect(p).not.toContain('规则14适用本句')
    expect(p).not.toContain('【执行要求】')
  })

  test('buildDeepSeekPromptForTurn: conv first turn download uses full DSML and task directive', () => {
    const tools = [{ type: 'function', function: { name: 'Bash', description: 'x' } }]
    const p = buildDeepSeekPromptForTurn(
      [{ role: 'user', content: '下载 https://example.com/a.md 并总结' }],
      tools,
      null,
      { dsmlFullSent: false },
    )
    expect(p).toContain('TOOL CALL FORMAT')
    expect(p).toContain('【执行要求】')
    expect(p).toContain('Wrong 6')
  })

  test('buildDeepSeekPromptForTurn: conv first turn with parent id still sends full DSML when dsmlFullSent=false', () => {
    const tools = [{ type: 'function', function: { name: 'Bash', description: 'x' } }]
    const msgs = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好' },
      { role: 'user', content: '下载 https://example.com/a.md 并总结' },
    ]
    const full = buildDeepSeekPromptForTurn(msgs, tools, 'parent-1', { dsmlFullSent: false })
    expect(full).toContain('TOOL CALL FORMAT')
    expect(full).toContain('https://example.com/a.md')
  })

  test('shouldMarkDeepSeekDsmlFullSent: marks after conv first turn only', () => {
    expect(shouldMarkDeepSeekDsmlFullSent({ wasFirstTurn: true })).toBe(true)
    expect(shouldMarkDeepSeekDsmlFullSent({ wasFirstTurn: false })).toBe(false)
  })

  test('buildDeepSeekPromptForTurn: continue turn with download URL sends reminder + 执行要求 not full DSML', () => {
    const tools = [{ type: 'function', function: { name: 'Bash', description: 'shell' } }]
    const p = buildDeepSeekPromptForTurn(
      [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！' },
        { role: 'user', content: '下载 https://example.com/a.md 并总结' },
      ],
      tools,
      'parent-1',
      { dsmlFullSent: true },
    )
    expect(p).not.toContain('TOOL CALL FORMAT')
    expect(p).toContain('[TOOL REMINDER]')
    expect(p).toContain('【执行要求】')
    expect(p).toContain('https://example.com/a.md')
    expect(p).toContain('start of this conversation')
  })

  test('buildDeepSeekPromptForTurn: dsmlFullSent true but no parent re-sends full DSML for download', () => {
    const tools = [{ type: 'function', function: { name: 'Bash', description: 'shell' } }]
    const p = buildDeepSeekPromptForTurn(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '你好！' },
        { role: 'user', content: '下载 https://example.com/a.md 并总结' },
      ],
      tools,
      null,
      { dsmlFullSent: true },
    )
    expect(p).toContain('TOOL CALL FORMAT')
    expect(p).toContain('【执行要求】')
    expect(p).not.toContain('[TOOL REMINDER]')
    expect(p).toContain('https://example.com/a.md')
  })

  test('buildDsmlToolReminderCompact adds schema hint for file URL tasks', () => {
    const tools = [{
      type: 'function',
      function: {
        name: 'WebFetch',
        description: 'fetch',
        parameters: { type: 'object', properties: { url: {}, prompt: {} }, required: ['url', 'prompt'] },
      },
    }]
    const r = buildDsmlToolReminderCompact(
      tools,
      '下载 https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md',
    )
    expect(r).toContain('WebFetch')
    expect(r).toContain('url, prompt')
  })

  test('buildDeepSeekDsmlStrictRetryPrompt uses DSML not XML tool_call', () => {
    const tools = [{ type: 'function', function: { name: 'Bash', description: 'shell' } }]
    const p = buildDeepSeekDsmlStrictRetryPrompt(tools, 'download https://example.com/a.md')
    expect(p).toContain('<|DSML|tool_calls>')
    expect(p).toContain('WRONG')
    expect(p).not.toContain('<tool_call>{')
    expect(p).toContain('download https://example.com/a.md')
  })

  test('formatToolCallsForPrompt round-trips assistant tool_calls', () => {
    const dsml = formatToolCallsForPrompt([
      { type: 'function', function: { name: 'Bash', arguments: '{"command":"echo 1"}' } },
    ])
    expect(dsml).toContain('<|DSML|invoke name="Bash"')
    expect(dsml).toContain('echo 1')
  })
})

describe('deepseek-guard', () => {
  test('capDeepSeekSystemText truncates oversized system', () => {
    const long = 'x'.repeat(20_000)
    const out = capDeepSeekSystemText(long)
    expect(out.length).toBeLessThan(long.length)
    expect(out).toContain('truncated')
  })

  test('fitDeepSeekSystemParts keeps DSML when upstream is huge', () => {
    const prev = process.env.COPAW_DEEPSEEK_MAX_SYSTEM_CHARS
    process.env.COPAW_DEEPSEEK_MAX_SYSTEM_CHARS = '6000'
    try {
      const upstream = 'CLAUDE_CODE_RULES_' + 'u'.repeat(12_000)
      const dsml = buildDsmlToolPrompt([
        { type: 'function', function: { name: 'Bash', description: 'run shell' } },
      ])
      const out = fitDeepSeekSystemParts(upstream, dsml)
      expect(out).toContain('<|DSML|tool_calls>')
      expect(out).toContain('Bash')
      expect(out.length).toBeLessThanOrEqual(6000 + 80)
    } finally {
      if (prev === undefined) delete process.env.COPAW_DEEPSEEK_MAX_SYSTEM_CHARS
      else process.env.COPAW_DEEPSEEK_MAX_SYSTEM_CHARS = prev
    }
  })

  test('convertMessagesForDeepseek preserves DSML under long system', () => {
    const prev = process.env.COPAW_DEEPSEEK_MAX_SYSTEM_CHARS
    process.env.COPAW_DEEPSEEK_MAX_SYSTEM_CHARS = '6000'
    try {
      const prompt = convertMessagesForDeepseek(
        [{ role: 'system', content: 'SYS_' + 's'.repeat(12_000) }, { role: 'user', content: 'hi' }],
        [{ type: 'function', function: { name: 'Read', description: 'read file' } }],
      )
      expect(prompt).toContain('<|DSML|tool_calls>')
      expect(prompt).toContain('Read')
    } finally {
      if (prev === undefined) delete process.env.COPAW_DEEPSEEK_MAX_SYSTEM_CHARS
      else process.env.COPAW_DEEPSEEK_MAX_SYSTEM_CHARS = prev
    }
  })

  test('normalizeDeepSeekParentMessageId parses numeric ids', () => {
    expect(normalizeDeepSeekParentMessageId(null)).toBe(null)
    expect(normalizeDeepSeekParentMessageId('12345')).toBe(12345)
  })

  test('promptHasFullDsml detects task-turn DSML block', () => {
    const dsml = buildDsmlToolPrompt([{ type: 'function', function: { name: 'Bash', description: 'run' } }])
    expect(promptHasFullDsml(dsml)).toBe(true)
    expect(promptHasFullDsml(buildDsmlToolPromptCasual([{ type: 'function', function: { name: 'Bash', description: 'run' } }]))).toBe(false)
  })

  test('resolveDeepSeekParentForApi: first turn returns null', () => {
    expect(
      resolveDeepSeekParentForApi({ dsmlFullSent: false, isFirstTurn: true, parentMessageId: null, toolsCount: 3 }),
    ).toBe(null)
  })

  test('resolveDeepSeekParentForApi: continue turn requires parent when dsmlFullSent', () => {
    expect(() =>
      resolveDeepSeekParentForApi({ dsmlFullSent: true, isFirstTurn: false, parentMessageId: null, toolsCount: 2 }),
    ).toThrow(/parent_message_id/)
    expect(
      resolveDeepSeekParentForApi({
        dsmlFullSent: true,
        isFirstTurn: false,
        parentMessageId: '99901',
        toolsCount: 2,
      }),
    ).toBe(99901)
  })

  test('resolveDeepSeekParentForApi: missing parent on continue is ok when caller treats as first turn', () => {
    expect(
      resolveDeepSeekParentForApi({ dsmlFullSent: true, isFirstTurn: true, parentMessageId: null, toolsCount: 2 }),
    ).toBe(null)
  })

  test('isDeepSeekBanOrRiskText detects ban phrases', () => {
    expect(isDeepSeekBanOrRiskText('账号已被禁言')).toBe(true)
    expect(isDeepSeekBanOrRiskText('ok')).toBe(false)
  })

  test('parseDeepSeekApiError extracts code and msg from JSON body', () => {
    expect(parseDeepSeekApiError('{"code":40002,"msg":"Missing Token"}', 400)).toEqual({
      code: 40002,
      msg: 'Missing Token',
    })
    expect(parseDeepSeekApiError('', 429)?.code).toBe(429)
  })

  test('DEEPSEEK_GUARD defaults use slower turn spacing', () => {
    const prevGap = process.env.COPAW_DEEPSEEK_MIN_GAP_MS
    const prevSess = process.env.COPAW_DEEPSEEK_MIN_SESSION_CREATE_GAP_MS
    delete process.env.COPAW_DEEPSEEK_MIN_GAP_MS
    delete process.env.COPAW_DEEPSEEK_MIN_SESSION_CREATE_GAP_MS
    try {
      expect(DEEPSEEK_GUARD.minGapMs()).toBe(10000)
      expect(DEEPSEEK_GUARD.minSessionCreateGapMs()).toBe(12000)
    } finally {
      if (prevGap === undefined) delete process.env.COPAW_DEEPSEEK_MIN_GAP_MS
      else process.env.COPAW_DEEPSEEK_MIN_GAP_MS = prevGap
      if (prevSess === undefined) delete process.env.COPAW_DEEPSEEK_MIN_SESSION_CREATE_GAP_MS
      else process.env.COPAW_DEEPSEEK_MIN_SESSION_CREATE_GAP_MS = prevSess
    }
  })

  test('capDeepSeekPrompt keeps system head and latest user tail', () => {
    const prev = process.env.COPAW_DEEPSEEK_MAX_PROMPT_CHARS
    process.env.COPAW_DEEPSEEK_MAX_PROMPT_CHARS = '520'
    try {
      const longMid = 'm'.repeat(8000)
      const prompt = convertMessagesForDeepseek(
        [
          { role: 'system', content: 'SYS' },
          { role: 'user', content: longMid },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'FINAL_USER_TASK' },
        ],
        [{ type: 'function', function: { name: 'Bash', description: 'shell' } }],
      )
      const capped = capDeepSeekPrompt(prompt)
      expect(capped).toContain('<|DSML|tool_calls>')
      expect(capped).toContain('FINAL_USER_TASK')
      expect(capped.length).toBeLessThanOrEqual(620)
    } finally {
      if (prev === undefined) delete process.env.COPAW_DEEPSEEK_MAX_PROMPT_CHARS
      else process.env.COPAW_DEEPSEEK_MAX_PROMPT_CHARS = prev
    }
  })

  test('capDeepSeekPrompt applied via buildDeepSeekPromptForTurn on first turn', () => {
    const prev = process.env.COPAW_DEEPSEEK_MAX_PROMPT_CHARS
    process.env.COPAW_DEEPSEEK_MAX_PROMPT_CHARS = '120'
    try {
      const p = buildDeepSeekPromptForTurn([{ role: 'user', content: 'a'.repeat(500) }], [], null)
      expect(p.length).toBeLessThanOrEqual(200)
      expect(p).toContain('truncated')
    } finally {
      if (prev === undefined) delete process.env.COPAW_DEEPSEEK_MAX_PROMPT_CHARS
      else process.env.COPAW_DEEPSEEK_MAX_PROMPT_CHARS = prev
    }
  })
})

describe('deepseek-sse', () => {
  test('parseDeepSeekSseLines handles fragments content path', () => {
    const line = 'data: {"p":"response/fragments/-1/content","v":"hello"}'
    const events = [...parseDeepSeekSseLines([line])]
    expect(events.some((e) => e.type === 'content' && e.value === 'hello')).toBe(true)
  })

  test('parseDeepSeekSseLines emits meta for response_message_id', () => {
    const line = 'data: {"response_message_id":12345,"v":{"response":{}}}'
    const events = [...parseDeepSeekSseLines([line])]
    expect(events.some((e) => e.type === 'meta' && e.value?.response_message_id === 12345)).toBe(true)
  })

  test('parseDeepSeekSseLines emits meta for response/message_id path', () => {
    const line = 'data: {"p":"response/message_id","v":987654}'
    const events = [...parseDeepSeekSseLines([line])]
    expect(events.some((e) => e.type === 'meta' && e.value?.response_message_id === 987654)).toBe(true)
  })

  test('extractDeepSeekResponseMessageId reads nested response.message_id', () => {
    expect(extractDeepSeekResponseMessageId({ v: { response: { message_id: 42 } } })).toBe(42)
  })

  test('parseDeepSeekSseLines contentOnly: pathless early deltas are content not thinking', () => {
    const line = 'data: {"v":"哟，"}'
    const events = [...parseDeepSeekSseLines([line], { contentOnly: true })]
    expect(events).toEqual([{ type: 'content', value: '哟，' }])
  })

  test('parseDeepSeekSseLines contentOnly: THINK fragment streams as content', () => {
    const meta = 'data: {"v":{"response":{"fragments":[{"type":"THINK","content":"思考中"}]}}}'
    const events = [...parseDeepSeekSseLines([meta], { contentOnly: true })]
    expect(events.some((e) => e.type === 'content' && e.value === '思考中')).toBe(true)
  })
})

describe('tool-sieve + resolveToolName', () => {
  test('resolveToolName maps case and snake_case aliases', () => {
    expect(resolveToolName('Bash', ['Bash'])).toBe('Bash')
    expect(resolveToolName('bash', ['Bash'])).toBe('Bash')
    expect(resolveToolName('ReadFile', ['read_file'])).toBe('read_file')
  })

  test('StreamSieve does not hold stream on lone < before URL', () => {
    const sieve = createTextOnlyStreamSieve()
    const e1 = sieve.feed('尝试下载 https://example.com/a.md')
    expect(e1.map((x) => x.data).join('')).toBe('尝试下载 https://example.com/a.md')
    const e2 = sieve.feed('，继续')
    expect(e2.map((x) => x.data).join('')).toBe('，继续')
  })

  test('StreamSieve holds split DSML opening angle bracket', () => {
    const sieve = new StreamSieve((buf) => {
      if (buf.includes('</|DSML|tool_calls>')) {
        return { ok: true, toolCalls: [{ name: 'Bash', arguments: { command: 'echo hi' } }] }
      }
      return { ok: false, toolCalls: [] }
    })
    const e1 = sieve.feed('<')
    expect(e1.some((e) => e.type === 'text')).toBe(false)
    const e2 = sieve.feed('|DSML|tool_calls><|DSML|invoke name="Bash">')
    expect(e2.some((e) => e.type === 'text' && String(e.data).includes('<'))).toBe(false)
  })

  test('StreamSieve does not leak orphan DSML closing tag as visible text', () => {
    const sieve = new StreamSieve(() => ({ ok: false, toolCalls: [] }))
    const events = sieve.feed('</|DSML|tool_calls>')
    expect(events.some((e) => e.type === 'text' && String(e.data).includes('DSML'))).toBe(false)
    const flushed = sieve.flush()
    expect(flushed.some((e) => e.type === 'text' && String(e.data).includes('DSML'))).toBe(false)
  })

  test('StreamSieve does not leak DSML closer split across SSE chunks', () => {
    const sieve = new StreamSieve(() => ({ ok: false, toolCalls: [] }))
    const e1 = sieve.feed('</|DSML|tool')
    expect(e1.some((e) => e.type === 'text' && String(e.data).includes('DSML'))).toBe(false)
    const e2 = sieve.feed('_calls>')
    const all = [...e1, ...e2, ...sieve.flush()]
    expect(all.some((e) => e.type === 'text' && /DSML|tool_calls/i.test(String(e.data)))).toBe(false)
  })

  test('StreamSieve does not leak fullwidth DSML closer', () => {
    const sieve = new StreamSieve(() => ({ ok: false, toolCalls: [] }))
    const events = sieve.feed('</｜DSML｜tool_calls>')
    expect(events.some((e) => e.type === 'text' && String(e.data).includes('DSML'))).toBe(false)
  })

  test('StreamSieve extracts DSML tool block', () => {
    const text = [
      'Sure.',
      '<|DSML|tool_calls>',
      '<|DSML|invoke name="Bash">',
      '<|DSML|parameter name="command"><![CDATA[echo hi]]></|DSML|parameter>',
      '</|DSML|invoke>',
      '</|DSML|tool_calls>',
    ].join('\n')
    const sieve = new StreamSieve((buf) => {
      if (buf.includes('</|DSML|tool_calls>')) {
        return { ok: true, toolCalls: [{ name: 'Bash', arguments: { command: 'echo hi' } }] }
      }
      return { ok: false, toolCalls: [] }
    })
    const events = sieve.feed(text)
    expect(events.some((e) => e.type === 'tool_calls')).toBe(true)
  })
})

describe('deepseek-web-client', () => {
  test('buildDeepSeekWebHeaders includes browser sec-fetch and sec-ch-ua', () => {
    const h = buildDeepSeekWebHeaders({
      cookie: 'c=1',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    })
    expect(h['sec-fetch-site']).toBe('same-origin')
    expect(h['sec-fetch-mode']).toBe('cors')
    expect(h['sec-fetch-dest']).toBe('empty')
    expect(h['sec-ch-ua']).toContain('Chrome')
    expect(h['Accept-Language']).toContain('zh-CN')
    expect(h['x-client-version']).toBeTruthy()
  })

  test('isDeepSeekHostUrl matches chat.deepseek.com only', () => {
    expect(isDeepSeekHostUrl('https://chat.deepseek.com/api/v0/chat/completion')).toBe(true)
    expect(isDeepSeekHostUrl('https://example.com/')).toBe(false)
  })
})
