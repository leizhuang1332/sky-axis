/**
 * InterventionRespondDrawer 组件测试 —— PR-D / 迭代 6 #3。
 *
 * 用 react-dom/server 的 renderToStaticMarkup 渲染 + 3 种 kind 切换断言。
 *
 * 覆盖目标：
 *   - kind='approval'：tool call 描述 + approve/reject 二选一
 *   - kind='question' type='text'：textarea + 确认按钮 disabled 直到有内容
 *   - kind='question' type='single'：radio options 渲染
 *   - kind='question' type='multi'：checkbox options 渲染
 *   - kind='question' type='confirm'：是/否按钮渲染
 *   - kind='review'：通过 / 需修改 二选一，needModify=true 弹 modifyReason textarea
 *   - kind='question' 但 payload 无 question 字段 → 显示 questionMissing warning
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { InterventionRespondDrawer } from '../src/client/page/sections/InterventionRespondDrawer.tsx'
import type { RequirementInterventionItem } from '../src/client/controller/sky-axis-controller.ts'

const fakeT = (key: string): string => key

const baseItem = (kind: RequirementInterventionItem['kind'], payload: unknown = {}): RequirementInterventionItem => ({
  id: 'ii-1',
  kind,
  rpcId: 'rpc-1',
  summary: '需要审批 / 回答',
  createdAt: '2026-09-01T00:00:00.000Z',
  payload,
})

describe('InterventionRespondDrawer：kind=approval', () => {
  it('渲染 tool call 描述 + approve / reject 按钮', () => {
    const html = renderToStaticMarkup(
      <InterventionRespondDrawer
        t={fakeT}
        item={baseItem('approval', { toolCall: 'createFile src/auth.ts' })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('createFile src/auth.ts')
    expect(html).toContain('requirement.detail.queue.respond.approve')
    expect(html).toContain('requirement.detail.queue.respond.reject')
  })

  it('payload 缺 toolCall 字段 → 显示 toolCallUnknown fallback', () => {
    const html = renderToStaticMarkup(
      <InterventionRespondDrawer
        t={fakeT}
        item={baseItem('approval', {})}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('requirement.detail.queue.respond.toolCallUnknown')
  })
})

describe('InterventionRespondDrawer：kind=question', () => {
  it("type='text'：渲染 textarea", () => {
    const html = renderToStaticMarkup(
      <InterventionRespondDrawer
        t={fakeT}
        item={baseItem('question', { question: '请选择 OAuth provider', type: 'text' })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('请选择 OAuth provider')
    expect(html).toContain('<textarea')
    expect(html).toContain('requirement.detail.queue.respond.confirm')
  })

  it("type='single'：渲染 radio options", () => {
    const html = renderToStaticMarkup(
      <InterventionRespondDrawer
        t={fakeT}
        item={baseItem('question', { question: '选一个', type: 'single', options: ['A', 'B', 'C'] })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('type="radio"')
    expect(html).toContain('value="A"')
    expect(html).toContain('value="B"')
    expect(html).toContain('value="C"')
  })

  it("type='multi'：渲染 checkbox options", () => {
    const html = renderToStaticMarkup(
      <InterventionRespondDrawer
        t={fakeT}
        item={baseItem('question', { question: '选多个', type: 'multi', options: ['A', 'B'] })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('value="A"')
    expect(html).toContain('value="B"')
  })

  it("type='confirm'：渲染 confirmYes / confirmNo 按钮", () => {
    const html = renderToStaticMarkup(
      <InterventionRespondDrawer
        t={fakeT}
        item={baseItem('question', { question: '是否继续？', type: 'confirm' })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('是否继续？')
    expect(html).toContain('requirement.detail.queue.respond.confirmYes')
    expect(html).toContain('requirement.detail.queue.respond.confirmNo')
  })

  it('payload 无 question 字段 → 显示 questionMissing warning', () => {
    const html = renderToStaticMarkup(
      <InterventionRespondDrawer
        t={fakeT}
        item={baseItem('question', {})}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('requirement.detail.queue.respond.questionMissing')
  })
})

describe('InterventionRespondDrawer：kind=review', () => {
  it('渲染 reviewTitle + confirm / needModify 按钮', () => {
    const html = renderToStaticMarkup(
      <InterventionRespondDrawer
        t={fakeT}
        item={baseItem('review', { summary: 'diff 摘要' })}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('requirement.detail.queue.respond.reviewTitle')
    expect(html).toContain('requirement.detail.queue.respond.confirm')
    expect(html).toContain('requirement.detail.queue.respond.needModify')
    expect(html).toContain('diff 摘要')
  })

  it('submitting=true：所有按钮 disabled', () => {
    const html = renderToStaticMarkup(
      <InterventionRespondDrawer
        t={fakeT}
        item={baseItem('review', {})}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting
      />,
    )
    const matches = html.match(/disabled/gu)
    expect(matches !== null && matches.length).toBeGreaterThanOrEqual(2)
  })
})
