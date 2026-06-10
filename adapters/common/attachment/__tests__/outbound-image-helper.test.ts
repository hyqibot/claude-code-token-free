import { describe, expect, it } from 'bun:test'
import { ImageBlockWatcher } from '../image-block-watcher.js'
import {
  feedOutboundImageText,
  OutboundImageTracker,
  userRequestsImageResend,
} from '../outbound-image-helper.js'

describe('outbound-image-helper', () => {
  it('detects user image resend requests', () => {
    expect(userRequestsImageResend('你可以把生成的图直接发送到聊天里给我吗')).toBe(true)
    expect(userRequestsImageResend('把图直接展示在这里')).toBe(true)
    expect(userRequestsImageResend('你好')).toBe(false)
  })

  it('tracks session paths and feeds watcher on complete text', () => {
    const tracker = new OutboundImageTracker()
    const watcher = new ImageBlockWatcher()
    const dispatched: string[] = []

    feedOutboundImageText(
      'chat-1',
      'PNG 图表：D:/CCwork/a.png',
      watcher,
      tracker,
      (_chatId, pending) => {
        if (pending.source.kind === 'path') dispatched.push(pending.source.path)
      },
      { complete: true },
    )

    expect(dispatched).toEqual(['D:/CCwork/a.png'])
    expect(tracker.pendingFromSession('chat-1')).toHaveLength(1)
  })
})
