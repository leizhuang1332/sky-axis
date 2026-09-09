/**
 * SteerBar 组件测试 —— PR-D / 迭代 6 #2。
 *
 * 用 react-dom/server 的 renderToStaticMarkup 渲染 + 关键交互断言。
 *
 * 覆盖目标：
 *   - 默认渲染：textarea + send 按钮
 *   - text 为空 / 仅空白：send 按钮 disabled
 *   - submitting=true：textarea + send 都 disabled
 *   - disabled=true（detailLoading）：同样禁用
 *   - recentSends 渲染：每条都显示 text + 相对时间
 *   - recentSends 截断：text > 80 字显示「…」
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SteerBar, type SteerSendRecord } from '../src/client/page/sections/SteerBar.tsx'

const fakeT = (key: string): string => key

describe('SteerBar：默认渲染', () => {
  it('渲染 textarea + send 按钮 + label', () => {
    const html = renderToStaticMarkup(
      <SteerBar
        t={fakeT}
        text=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        submitting={false}
        recentSends={[]}
      />,
    )
    expect(html).toContain('<textarea')
    expect(html).toContain('requirement.detail.steer.placeholder')
    expect(html).toContain('requirement.detail.steer.send')
  })

  it('disabled + submitting=false + text 空 → send 按钮 disabled', () => {
    const html = renderToStaticMarkup(
      <SteerBar
        t={fakeT}
        text=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        submitting={false}
        recentSends={[]}
      />,
    )
    // 至少 1 个 disabled：send 按钮
    expect(html).toMatch(/disabled/gu)
  })

  it('disabled=true 时 textarea 也 disabled', () => {
    const html = renderToStaticMarkup(
      <SteerBar
        t={fakeT}
        text="hello"
        onChange={vi.fn()}
        onSend={vi.fn()}
        submitting={false}
        recentSends={[]}
        disabled
      />,
    )
    // textarea + send 都应 disabled
    const matches = html.match(/disabled/gu)
    expect(matches !== null && matches.length).toBeGreaterThanOrEqual(2)
  })

  it('submitting=true 时 textarea + send 都 disabled（即使 text 有内容）', () => {
    const html = renderToStaticMarkup(
      <SteerBar
        t={fakeT}
        text="hello"
        onChange={vi.fn()}
        onSend={vi.fn()}
        submitting
        recentSends={[]}
      />,
    )
    const matches = html.match(/disabled/gu)
    expect(matches !== null && matches.length).toBeGreaterThanOrEqual(2)
  })
})

describe('SteerBar：recentSends 渲染', () => {
  it('空数组时不渲染 recent list', () => {
    const html = renderToStaticMarkup(
      <SteerBar
        t={fakeT}
        text=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        submitting={false}
        recentSends={[]}
      />,
    )
    expect(html).not.toContain('requirement.detail.steer.recent')
  })

  it('有 recentSends 时显示每条 text + 相对时间', () => {
    const recents: readonly SteerSendRecord[] = [
      { sentAt: new Date().toISOString(), text: '第一条指令' },
      { sentAt: new Date(Date.now() - 5 * 60_000).toISOString(), text: '第二条指令' },
    ]
    const html = renderToStaticMarkup(
      <SteerBar
        t={fakeT}
        text=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        submitting={false}
        recentSends={recents}
      />,
    )
    expect(html).toContain('requirement.detail.steer.recent')
    expect(html).toContain('第一条指令')
    expect(html).toContain('第二条指令')
    // 相对时间 key（justNow 或 minutesAgo）
    expect(html).toMatch(/requirement\.detail\.conductor\.(justNow|minutesAgo)/)
  })

  it('text 长度 > 80 字时显示「…」截断', () => {
    const longText = 'a'.repeat(100)
    const recents: readonly SteerSendRecord[] = [
      { sentAt: new Date().toISOString(), text: longText },
    ]
    const html = renderToStaticMarkup(
      <SteerBar
        t={fakeT}
        text=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        submitting={false}
        recentSends={recents}
      />,
    )
    // 80 个 a + …
    expect(html).toContain('a'.repeat(80) + '…')
    // 完整 100 个 a 不应出现
    expect(html).not.toContain('a'.repeat(100))
  })

  it('recentSends 最多展示 3 条（slice 上限）', () => {
    const recents: readonly SteerSendRecord[] = [
      { sentAt: new Date().toISOString(), text: 't1' },
      { sentAt: new Date().toISOString(), text: 't2' },
      { sentAt: new Date().toISOString(), text: 't3' },
      { sentAt: new Date().toISOString(), text: 't4-不该显示' },
    ]
    const html = renderToStaticMarkup(
      <SteerBar
        t={fakeT}
        text=""
        onChange={vi.fn()}
        onSend={vi.fn()}
        submitting={false}
        recentSends={recents}
      />,
    )
    expect(html).toContain('t1')
    expect(html).toContain('t3')
    expect(html).not.toContain('t4-不该显示')
  })
})
