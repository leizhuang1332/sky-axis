/**
 * FailedTaskResolveModal 组件测试 —— PR-D / 迭代 6 #4。
 *
 * 用 react-dom/server 的 renderToStaticMarkup 渲染 + 关键 prop 切换断言。
 *
 * 覆盖目标：
 *   - 4 选 1 grid 渲染（redo / rewind-plan / skip / abort）
 *   - subtitle 占位符替换（{title} + {n}）
 *   - 未选 decision 时 confirm 按钮 disabled
 *   - submitting=true 时所有输入 + 按钮 disabled
 *   - 4 个 option 的 variant className（primary/secondary/warning/danger）
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FailedTaskResolveModal } from '../src/client/page/sections/FailedTaskResolveModal.tsx'

const fakeT = (key: string): string => key

describe('FailedTaskResolveModal：默认渲染', () => {
  it('4 个决策选项都渲染（redo / rewindPlan / skip / abort）', () => {
    const html = renderToStaticMarkup(
      <FailedTaskResolveModal
        t={fakeT}
        taskTitle="权限中间件"
        failedCount={3}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    // 4 个 option labelKey
    expect(html).toContain('requirement.detail.failedTask.option.redo')
    expect(html).toContain('requirement.detail.failedTask.option.rewindPlan')
    expect(html).toContain('requirement.detail.failedTask.option.skip')
    expect(html).toContain('requirement.detail.failedTask.option.abort')
    // 4 个 descKey
    expect(html).toContain('requirement.detail.failedTask.option.redoDesc')
    expect(html).toContain('requirement.detail.failedTask.option.rewindPlanDesc')
    expect(html).toContain('requirement.detail.failedTask.option.skipDesc')
    expect(html).toContain('requirement.detail.failedTask.option.abortDesc')
  })

  it('subtitle 把 {title} + {n} 占位符替换为真实值', () => {
    // 智能 fakeT：subtitleKey 含占位符时返回带占位符的字符串，让组件的 .replace 能跑通
    const smartT = (key: string): string => {
      if (key === 'requirement.detail.failedTask.subtitle') return 'task「{title}」连续 {n} 次失败'
      return key
    }
    const html = renderToStaticMarkup(
      <FailedTaskResolveModal
        t={smartT}
        taskTitle="OAuth 回调"
        failedCount={5}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('OAuth 回调')
    expect(html).toContain('5')
    // 占位符本身不应残留
    expect(html).not.toContain('{title}')
    expect(html).not.toContain('{n}')
  })

  it('reason textarea 渲染 + placeholder', () => {
    const html = renderToStaticMarkup(
      <FailedTaskResolveModal
        t={fakeT}
        taskTitle="x"
        failedCount={1}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('<textarea')
    expect(html).toContain('requirement.detail.failedTask.reasonLabel')
    expect(html).toContain('requirement.detail.failedTask.reasonPlaceholder')
  })
})

describe('FailedTaskResolveModal：submitting 状态', () => {
  it('submitting=true：4 选项 + textarea + 2 按钮全部 disabled', () => {
    const html = renderToStaticMarkup(
      <FailedTaskResolveModal
        t={fakeT}
        taskTitle="x"
        failedCount={1}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting
      />,
    )
    // 4 option buttons + textarea + cancel + confirm = 至少 6 disabled
    const matches = html.match(/disabled/gu)
    expect(matches !== null && matches.length).toBeGreaterThanOrEqual(6)
  })

  it('submitting=false：confirm 按钮 disabled（decision 还未选）', () => {
    const html = renderToStaticMarkup(
      <FailedTaskResolveModal
        t={fakeT}
        taskTitle="x"
        failedCount={1}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    // confirm button 应该 disabled（decision === null）
    // 我们只确认至少 1 个 disabled（confirm）
    const matches = html.match(/disabled/gu)
    expect(matches !== null && matches.length).toBeGreaterThanOrEqual(1)
  })
})

describe('FailedTaskResolveModal：radiogroup 语义', () => {
  it('optionGrid 是 role=radiogroup，4 选项 role=radio', () => {
    const html = renderToStaticMarkup(
      <FailedTaskResolveModal
        t={fakeT}
        taskTitle="x"
        failedCount={1}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('role="radiogroup"')
    // 4 个 role=radio
    const radios = html.match(/role="radio"/gu)
    expect(radios !== null && radios.length).toBe(4)
  })
})
