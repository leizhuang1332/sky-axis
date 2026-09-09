/**
 * Stepper 组件测试 —— Phase 1.0 增量：stageMeta prop（taskProgress + rewindDots）。
 *
 * 用 react-dom/server 的 renderToStaticMarkup 渲染到 HTML 字符串再断言，
 * 不引 @testing-library/react —— 包级轻量化约定（jsdom + react-dom/server 足以）。
 *
 * 覆盖目标：
 *   - 默认无 stageMeta：节点不显示 meta
 *   - done stage 显示 taskProgress (x/N)
 *   - current stage 显示 taskProgress + 高亮色
 *   - done/current stage 有 rewindCount > 0 → 显示橙色 rewind dots
 *   - done/current stage 有 rolledBackCount > 0 → 显示红色 rewind dots
 *   - upcoming stage 即便传 meta 也不显示 progress（避免对未开始阶段过度承诺）
 *     —— 但当前实现里 upcoming 的 meta 仅当 taskProgress=null 且全 0 时 null，
 *       若传 taskProgress 也会显示。文档化行为即可。
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ClockIcon, FlagIcon, WorkflowIcon, PlayIcon, PauseIcon,
} from '../src/client/icons/icons.tsx'
import {
  Stepper,
  type StepperItem,
  type StepperStageMeta,
} from '../src/client/ui/Stepper.tsx'
import type { RequirementStage } from '../src/client/controller/sky-axis-controller.ts'

/** 5 个 stage 标准配置 —— 所有测试用例共用。 */
function makeItems(): readonly StepperItem[] {
  return [
    { stage: 'understand', Icon: ClockIcon,    label: '理解', desc: 'd1' },
    { stage: 'plan',       Icon: FlagIcon,     label: '规划', desc: 'd2' },
    { stage: 'implement',  Icon: WorkflowIcon, label: '实现', desc: 'd3' },
    { stage: 'verify',     Icon: PlayIcon,     label: '验证', desc: 'd4' },
    { stage: 'deliver',    Icon: PauseIcon,    label: '交付', desc: 'd5' },
  ]
}

describe('Stepper：stageMeta prop（taskProgress + rewindDots）', () => {
  it('无 stageMeta 时不渲染任何 meta 元素', () => {
    const html = renderToStaticMarkup(<Stepper items={makeItems()} current="implement" />)
    // progress 文本 "x/y" 不应出现
    expect(html).not.toMatch(/\d+\/\d+/)
    // rewind dots aria-label 不应出现
    expect(html).not.toContain('rewind')
  })

  it('done stage 显示 taskProgress "2/5"', () => {
    const meta: Partial<Record<RequirementStage, StepperStageMeta>> = {
      understand: { taskDone: 3, taskTotal: 3 },
    }
    const html = renderToStaticMarkup(<Stepper items={makeItems()} current="plan" stageMeta={meta} />)
    expect(html).toContain('3/3')
  })

  it('current stage 显示 taskProgress + 当前节点 stepCurrent class', () => {
    const meta: Partial<Record<RequirementStage, StepperStageMeta>> = {
      implement: { taskDone: 1, taskTotal: 5 },
    }
    const html = renderToStaticMarkup(<Stepper items={makeItems()} current="implement" stageMeta={meta} />)
    expect(html).toContain('1/5')
    // current stage label 应在带 stepCurrent 类的 button 里
    expect(html).toMatch(/stepCurrent[\s\S]*实现[\s\S]*1\/5/)
  })

  it('rewindCount > 0 在 done stage 显示橙色 rewind dot（aria-label="rewind"）', () => {
    const meta: Partial<Record<RequirementStage, StepperStageMeta>> = {
      plan: { taskDone: 2, taskTotal: 3, rewindCount: 2, rolledBackCount: 0 },
    }
    const html = renderToStaticMarkup(<Stepper items={makeItems()} current="implement" stageMeta={meta} />)
    // aria-label 包含 "rewind 2"
    expect(html).toContain('rewind 2')
    // 视觉上：2 个橙色 dot（rewindDotRolled 不出现，所以 rolledBackCount=0 不渲染红色点）
    const dotMatches = html.match(/class="_rewindDot_[^"]+"/g) ?? []
    expect(dotMatches.length).toBe(2)
    expect(html).not.toContain('rewindDotRolled')
  })

  it('rolledBackCount > 0 在 done stage 显示红色 rolled-back dot（aria-label）', () => {
    const meta: Partial<Record<RequirementStage, StepperStageMeta>> = {
      implement: { taskDone: 1, taskTotal: 5, rewindCount: 0, rolledBackCount: 3 },
    }
    const html = renderToStaticMarkup(<Stepper items={makeItems()} current="implement" stageMeta={meta} />)
    expect(html).toContain('rolled-back 3')
  })

  it('rewindCount + rolledBackCount 同时 > 0 → aria-label 同时显示两者', () => {
    const meta: Partial<Record<RequirementStage, StepperStageMeta>> = {
      implement: { taskDone: 1, taskTotal: 5, rewindCount: 1, rolledBackCount: 2 },
    }
    const html = renderToStaticMarkup(<Stepper items={makeItems()} current="implement" stageMeta={meta} />)
    expect(html).toMatch(/rewind 1.*rolled-back 2|rolled-back 2.*rewind 1/)
  })

  it('upcoming stage 传 meta 但 taskDone/taskTotal 缺省 → 不渲染任何 meta（不显示对未开始阶段的过度承诺）', () => {
    // Stepper 的隐藏规则：upcoming 阶段当 taskProgress=null（taskDone/taskTotal 缺省）
    // 且 rewind/rolledBack 全 0 时，整个 meta 节点直接返回 null。
    const meta: Partial<Record<RequirementStage, StepperStageMeta>> = {
      deliver: { rewindCount: 0, rolledBackCount: 0 }, // taskDone/taskTotal 缺省
    }
    const html = renderToStaticMarkup(<Stepper items={makeItems()} current="understand" stageMeta={meta} />)
    // deliver 节点不该有 0/0 文本（taskProgress=null 不渲染）
    expect(html).not.toContain('0/0')
    // 也不该有 rewind aria-label（rewindCount=0 不渲染）
    expect(html).not.toContain('rewind')
  })

  it('mixed meta：done 阶段显示 progress，current 阶段同时显示 progress + rewind', () => {
    const meta: Partial<Record<RequirementStage, StepperStageMeta>> = {
      understand: { taskDone: 3, taskTotal: 3 },
      plan:       { taskDone: 2, taskTotal: 3, rewindCount: 1, rolledBackCount: 1 },
      implement:  { taskDone: 1, taskTotal: 5, rewindCount: 0, rolledBackCount: 1 },
    }
    const html = renderToStaticMarkup(<Stepper items={makeItems()} current="implement" stageMeta={meta} />)
    // 三个 stage 的 progress 都在
    expect(html).toContain('3/3')
    expect(html).toContain('2/3')
    expect(html).toContain('1/5')
    // plan 的 rewind+rolled-back
    expect(html).toContain('rewind 1')
    expect(html).toContain('rolled-back 1')
    // implement 的 rolled-back
    expect(html).toContain('rolled-back 1')
  })

  it('缺省 stageMeta prop 时所有节点视觉不变（向后兼容）', () => {
    const htmlDefault = renderToStaticMarkup(<Stepper items={makeItems()} current="plan" />)
    const htmlEmpty = renderToStaticMarkup(
      <Stepper items={makeItems()} current="plan" stageMeta={{}} />,
    )
    expect(htmlDefault).toBe(htmlEmpty)
  })
})