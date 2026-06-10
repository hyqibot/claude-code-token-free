import { describe, expect, test } from 'bun:test'
import {
  sanitizeToolArgsBySchema,
  validateToolArgsBySchema,
  sanitizeWebFetchArgs,
  getToolInputSchema,
} from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/tool-schema-sanitize.mjs'
import {
  selectToolsForPrompt,
  formatToolLineFromSchema,
  buildIntentToolHint,
} from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/tool-capability.mjs'
import { planToolCallsFromSchema } from '../../../vendor/copaw-zero-token/python/src/copaw/zero_token_gateway/tool-schema-planner.mjs'

const claudeTools = [
  {
    type: 'function',
    function: {
      name: 'WebFetch',
      description: 'fetch url',
      parameters: { type: 'object', properties: { url: { type: 'string' }, prompt: { type: 'string' } }, required: ['url', 'prompt'] },
    },
  },
  { type: 'function', function: { name: 'Bash', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'Read', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
]

describe('zero-token tool-schema-sanitize (PR-2)', () => {
  test('sanitizeToolArgsBySchema strips drift fields and applies aliases', () => {
    const out = sanitizeToolArgsBySchema('WebFetch', { link: 'https://x.test/a.md', max_length: 999 }, claudeTools)
    expect(out.url).toBe('https://x.test/a.md')
    expect(out.prompt).toBeTruthy()
    expect(out.max_length).toBeUndefined()
  })

  test('sanitizeToolArgsBySchema maps path→file_path for Read', () => {
    const out = sanitizeToolArgsBySchema('Read', { path: 'C:\\tmp\\a.md' }, claudeTools)
    expect(out.file_path).toContain('tmp')
    expect(out.path).toBeUndefined()
  })

  test('validateToolArgsBySchema uses schema required fields', () => {
    expect(validateToolArgsBySchema('WebFetch', { url: 'https://x.test', prompt: 'x' }, claudeTools)).toBe(true)
    expect(validateToolArgsBySchema('WebFetch', { url: 'https://x.test' }, claudeTools)).toBe(false)
  })

  test('sanitizeWebFetchArgs backward compat', () => {
    const out = sanitizeWebFetchArgs({ url: 'https://example.com', instruction: 'go' }, claudeTools)
    expect(out.url).toBe('https://example.com')
    expect(out.prompt).toBe('go')
  })
})

describe('zero-token tool-capability (PR-3)', () => {
  test('selectToolsForPrompt hides Bash/Read when url+prompt tool available for file URL', () => {
    const url = 'https://example.com/a.md'
    const filtered = selectToolsForPrompt(claudeTools, `下载 ${url}`)
    const names = filtered.map((t) => t.function.name)
    expect(names).toContain('WebFetch')
    expect(names).not.toContain('Bash')
    expect(names).not.toContain('Read')
  })

  test('formatToolLineFromSchema includes required fields', () => {
    const line = formatToolLineFromSchema('WebFetch', 'fetch', claudeTools)
    expect(line).toContain('WebFetch')
    expect(line).toContain('url')
    expect(line).toContain('prompt')
  })

  test('buildIntentToolHint mentions schema tool for file URL', () => {
    const hint = buildIntentToolHint('https://example.com/a.md', claudeTools)
    expect(hint).toContain('WebFetch')
  })
})

describe('zero-token tool-schema-planner (PR-3)', () => {
  test('planToolCallsFromSchema prefers url+prompt tool', () => {
    const url = 'https://marketing.dfcfw.com/res/download/A620260402NXEUQC.md'
    const planned = planToolCallsFromSchema(`下载 ${url}`, claudeTools)
    expect(planned.ok).toBe(true)
    expect(planned.toolCalls[0]?.name).toBe('WebFetch')
  })
})
