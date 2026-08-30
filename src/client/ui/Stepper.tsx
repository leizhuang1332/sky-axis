/**
 * Stepper —— 5 阶段开发意图工作台横向流水线组件。
 *
 * 视觉契约：
 *   - 横向 5 节点 + 连接线（用 flex gap + 节点间 ::before 实现）
 *   - 每个节点 = 圆 + 图标 + label + 描述
 *   - 节点状态：done / current / upcoming
 *     - done：绿边 + 勾号，节点填充业务绿色背景（--dsw-alias-state-business-success）
 *     - current：蓝边 + 主图标，节点填充业务蓝色背景（--dsw-alias-state-business-primary）
 *     - upcoming：灰边 + 灰文字
 *   - 当前 stage 通过 `current` prop 决定；其它 stage 节点点击触发 onStageClick(stage)
 *     （让用户能「暂回上阶段」/「跳到某阶段」—— 详情页 StageActions 用）
 *
 * 数据流：完全受控。props: stages（5 元素 + icon + label + desc）+ current + onStageClick
 *
 * 设计要点：
 *   - 不引第三方 Stepper 库（包级约定）
 *   - 颜色全部 --dsw-alias-* 设计令牌；暗色主题自动跟随
 *   - 单文件 1 root class + 子 class，无嵌套
 */
import type { JSX, ReactNode } from 'react'
import type { RequirementStage } from '../controller/sky-axis-controller.ts'
import css from './Stepper.module.css'

/** 单个 stage 节点配置。 */
export interface StepperItem {
  /** stage key。 */
  stage: RequirementStage
  /** 节点图标（来自 icons.tsx）。 */
  Icon: (props: { size?: number; className?: string }) => JSX.Element
  /** 主标题（来自 locale 'requirement.detail.stage.<stage>.label'）。 */
  label: string
  /** 副描述（来自 locale 'requirement.detail.stage.<stage>.desc'），可空。 */
  desc?: string
}

export interface StepperProps {
  /** 5 个 stage 配置（顺序固定：understand → plan → implement → verify → deliver）。 */
  items: readonly StepperStep[]
  /** 当前 stage（高亮 + 蓝色填充）。 */
  current: RequirementStage
  /** 点击节点回调；缺省则节点不可点。 */
  onStepClick?: (stage: RequirementStage) => void
}

/** Stepper 节点配置（与 StepperItem 同义 —— 命名差异仅为「item / step」偏好，保留别名兼容）。 */
export type StepperStep = StepperItem

/** 比较两个 stage 在 STAGE_ORDER 中的位置。 */
function indexOf(stage: RequirementStage): number {
  const order: readonly RequirementStage[] = ['understand', 'plan', 'implement', 'verify', 'deliver']
  return order.indexOf(stage)
}

export function Stepper({ items, current, onStepClick }: StepperProps): JSX.Element {
  const currentIdx = indexOf(current)
  return (
    <ol className={css.stepper} aria-label="开发意图工作流 5 阶段">
      {items.map((item, idx) => {
        const itemIdx = indexOf(item.stage)
        const status: 'done' | 'current' | 'upcoming'
          = itemIdx < currentIdx ? 'done' : itemIdx === currentIdx ? 'current' : 'upcoming'
        const stepClass
          = status === 'current'
            ? `${css.step} ${css.stepCurrent}`
            : status === 'done'
            ? `${css.step} ${css.stepDone}`
            : `${css.step} ${css.stepUpcoming}`
        const isClickable = onStepClick !== undefined && status !== 'current'
        const handleClick = isClickable ? (): void => { onStepClick!(item.stage) } : undefined
        return (
          <li key={item.stage} className={css.stepLi}>
            {idx > 0 && (
              <span
                className={status === 'upcoming' ? css.connector : `${css.connector} ${css.connectorDone}`}
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              className={stepClass}
              onClick={handleClick}
              disabled={!isClickable}
              aria-current={status === 'current' ? 'step' : undefined}
            >
              <span className={css.stepIcon} aria-hidden="true">
                <item.Icon size={14} className={css.stepIconSvg} />
              </span>
              <span className={css.stepText}>
                <span className={css.stepLabel}>{item.label}</span>
                {item.desc !== undefined && <span className={css.stepDesc}>{item.desc}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** 简单的 stepper 用 ReactNode 替代物（让上层按需插入复杂子节点）。
 *  当前实现不暴露，留作未来扩展。 */
export type _StepperChildren = ReactNode