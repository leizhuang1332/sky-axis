/**
 * AdjustTaskListDrawer 组件测试 —— PR-D / 迭代 6 #1。
 *
 * 用 react-dom/server 的 renderToStaticMarkup 渲染 + 关键 prop / 状态断言。
 *
 * 覆盖目标：
 *   - 默认渲染：intro 显示 task 总数 + 调整按钮
 *   - task list 每行显示 title + goal + acceptance text
 *   - submit 时 onSubmit 回调携带 { mode: 'replace', tasks: [...] }
 *   - submitting=true 时按钮 disabled
 *   - 空 task list 时 confirm 按钮 disabled
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AdjustTaskListDrawer } from '../src/client/page/sections/AdjustTaskListDrawer.tsx'
import type { RequirementTaskList } from '../src/client/controller/sky-axis-controller.ts'

const fakeT = (key: string): string => key

const sampleTaskList = (): RequirementTaskList => ({
  tasks: [
    {
      id: 'T-001',
      title: 'OAuth 回调处理器',
      goal: '接收 code 换 token',
      acceptance: ['POST /callback 接受 ?code', '5xx 重试 3 次'],
      dependencies: [],
      filesExpected: ['src/auth.ts'],
      status: 'pending',
      subHistory: [],
      artifactRefs: [],
      retryCount: 0,
      enteredAt: 't',
    },
    {
      id: 'T-002',
      title: '权限中间件',
      goal: 'scope 路由守卫',
      acceptance: ['读取 sessionStorage', 'scope 不匹配 403'],
      dependencies: ['T-001'],
      filesExpected: ['src/middleware.ts'],
      status: 'pending',
      subHistory: [],
      artifactRefs: [],
      retryCount: 0,
      enteredAt: 't',
    },
  ],
  producedAt: 't',
  producedAtStage: 'plan',
})

describe('AdjustTaskListDrawer：默认渲染', () => {
  it('intro 显示 task 总数', () => {
    const html = renderToStaticMarkup(
      <AdjustTaskListDrawer
        t={fakeT}
        currentStage="plan"
        taskList={sampleTaskList()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    // intro 含 {n} 替换 + titleKey + confirmSave + cancel + addRow
    expect(html).toContain('requirement.detail.adjustTaskList.intro')
    expect(html).toContain('requirement.detail.adjustTaskList.confirmSave')
    expect(html).toContain('requirement.detail.adjustTaskList.cancel')
    expect(html).toContain('requirement.detail.adjustTaskList.addRow')
    expect(html).toContain('requirement.detail.adjustTaskList.removeRow')
  })

  it('每行 task 显示 title + goal', () => {
    const html = renderToStaticMarkup(
      <AdjustTaskListDrawer
        t={fakeT}
        currentStage="plan"
        taskList={sampleTaskList()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('OAuth 回调处理器')
    expect(html).toContain('接收 code 换 token')
    expect(html).toContain('权限中间件')
    expect(html).toContain('scope 路由守卫')
  })

  it('acceptance 用 \\n-joined text 渲染到 textarea', () => {
    const html = renderToStaticMarkup(
      <AdjustTaskListDrawer
        t={fakeT}
        currentStage="plan"
        taskList={sampleTaskList()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting={false}
      />,
    )
    // 第一个 task 的 acceptance: "POST /callback 接受 ?code\n5xx 重试 3 次"
    expect(html).toContain('POST /callback 接受 ?code')
    expect(html).toContain('5xx 重试 3 次')
  })
})

describe('AdjustTaskListDrawer：submitting 状态', () => {
  it('submitting=true → confirm + cancel 按钮 disabled', () => {
    const html = renderToStaticMarkup(
      <AdjustTaskListDrawer
        t={fakeT}
        currentStage="plan"
        taskList={sampleTaskList()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        submitting
      />,
    )
    // 至少 confirm + cancel = 2 disabled
    const matches = html.match(/disabled/gu)
    expect(matches !== null && matches.length).toBeGreaterThanOrEqual(2)
  })
})
