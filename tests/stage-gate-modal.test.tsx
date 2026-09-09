/**
 * StageGateModal 组件测试 —— PR-D / 迭代 6 #5。
 *
 * 用 react-dom/server 的 renderToStaticMarkup 渲染 + 关键 prop 切换断言。
 *
 * 覆盖目标：
 *   - 默认渲染：subtitle + 3 个 metric + 2 个 footer 按钮
 *   - subtitle 占位符 {fromStage} 替换为真实 stage label
 *   - driftOverall=null 时显示「driftUnknown」
 *   - driftOverall 有值时显示对应分数
 *   - submitting=true 时 advance + stay 按钮都 disabled
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StageGateModal, type StageGateSummary } from '../src/client/page/sections/StageGateModal.tsx'

const fakeT = (key: string): string => key

const baseSummary: StageGateSummary = {
  taskTotal: 4,
  taskDone: 2,
  driftOverall: 0.42,
  rewindCount: 1,
}

describe('StageGateModal：默认渲染', () => {
  it('3 个 metric 渲染（taskProgress / drift / rewinds）', () => {
    const html = renderToStaticMarkup(
      <StageGateModal
        t={fakeT}
        fromStage="plan"
        toStage="implement"
        summary={baseSummary}
        onAdvance={vi.fn()}
        onStay={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('requirement.detail.stageGate.taskProgress')
    expect(html).toContain('requirement.detail.stageGate.drift')
    expect(html).toContain('requirement.detail.stageGate.rewinds')
  })

  it('subtitle 把 {fromStage} 替换为真实 stage label', () => {
    // 智能 fakeT：subtitleKey 含占位符时返回带占位符的字符串，让组件的 .replace 能跑通
    const smartT = (key: string): string => {
      if (key === 'requirement.detail.stageGate.subtitle') return '{fromStage} 阶段已完成'
      return key
    }
    const html = renderToStaticMarkup(
      <StageGateModal
        t={smartT}
        fromStage="plan"
        toStage="implement"
        summary={baseSummary}
        onAdvance={vi.fn()}
        onStay={vi.fn()}
        submitting={false}
      />,
    )
    // plan 的 stage label 是 fakeT 返回的 key
    expect(html).toContain('requirement.detail.stage.plan.label')
    expect(html).not.toContain('{fromStage}')
  })

  it('nextStage badge 显示 toStage 的 stage key', () => {
    const html = renderToStaticMarkup(
      <StageGateModal
        t={fakeT}
        fromStage="plan"
        toStage="implement"
        summary={baseSummary}
        onAdvance={vi.fn()}
        onStay={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('requirement.detail.stageGate.nextStage')
    expect(html).toContain('requirement.detail.stage.implement.label')
  })

  it('footer 渲染 advance + stay 按钮', () => {
    const html = renderToStaticMarkup(
      <StageGateModal
        t={fakeT}
        fromStage="plan"
        toStage="implement"
        summary={baseSummary}
        onAdvance={vi.fn()}
        onStay={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('requirement.detail.stageGate.advance')
    expect(html).toContain('requirement.detail.stageGate.stay')
  })
})

describe('StageGateModal：drift 显示', () => {
  it('driftOverall=null → 显示「driftUnknown」', () => {
    const html = renderToStaticMarkup(
      <StageGateModal
        t={fakeT}
        fromStage="plan"
        toStage="implement"
        summary={{ ...baseSummary, driftOverall: null }}
        onAdvance={vi.fn()}
        onStay={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('requirement.detail.stageGate.driftUnknown')
  })

  it('driftOverall 有值 → 显示 toFixed(2) 分数', () => {
    const html = renderToStaticMarkup(
      <StageGateModal
        t={fakeT}
        fromStage="plan"
        toStage="implement"
        summary={{ ...baseSummary, driftOverall: 0.42 }}
        onAdvance={vi.fn()}
        onStay={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('0.42')
    expect(html).not.toContain('requirement.detail.stageGate.driftUnknown')
  })
})

describe('StageGateModal：taskProgress 计算', () => {
  it('taskTotal=0 → 显示 0/0（0%）', () => {
    const html = renderToStaticMarkup(
      <StageGateModal
        t={fakeT}
        fromStage="plan"
        toStage="implement"
        summary={{ taskTotal: 0, taskDone: 0, driftOverall: null, rewindCount: 0 }}
        onAdvance={vi.fn()}
        onStay={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('0/0')
    expect(html).toContain('0%)')
  })

  it('taskDone=2 / taskTotal=4 → 显示 50%', () => {
    const html = renderToStaticMarkup(
      <StageGateModal
        t={fakeT}
        fromStage="plan"
        toStage="implement"
        summary={{ ...baseSummary, taskDone: 2, taskTotal: 4 }}
        onAdvance={vi.fn()}
        onStay={vi.fn()}
        submitting={false}
      />,
    )
    expect(html).toContain('2/4')
    expect(html).toContain('50%)')
  })
})

describe('StageGateModal：submitting 状态', () => {
  it('submitting=true → advance + stay 按钮都 disabled', () => {
    const html = renderToStaticMarkup(
      <StageGateModal
        t={fakeT}
        fromStage="plan"
        toStage="implement"
        summary={baseSummary}
        onAdvance={vi.fn()}
        onStay={vi.fn()}
        submitting
      />,
    )
    // advance + stay 都 disabled
    const matches = html.match(/disabled/gu)
    expect(matches !== null && matches.length).toBeGreaterThanOrEqual(2)
  })
})
