/**
 * FailedTaskResolveModal —— 介入点 #4「任务失败后 4 选 1 决策」（PR-D / 迭代 6）。
 *
 * 设计意图：用户从 StageWorkspacePane / 其它地方触发打开；用户在 modal 内选择
 *   - 「重做」(decision='redo')          → controller.redoTask
 *   - 「改 plan」(decision='rewind-plan') → controller.rewind(target='stage-prev')
 *   - 「跳过」(decision='skip')           → controller.skipTask
 *   - 「中止」(decision='abort')          → Phase 2 接 abort 接口（fail loud）
 *
 * Modal 居中显示，复用 Modal.tsx；4 个选项带 icon + 简短说明。
 *
 * 视觉/交互契约：
 *   - 居中 Modal（复用 Modal.tsx 的视觉骨架 + ESC + overlay-click 关闭）
 *   - 顶部：「task "{title}" 连续 {n} 次失败」副标题
 *   - 中部：4 选项 grid（2x2）
 *   - 底部：reason textarea（可选）+ 取消 / 确认按钮（footer 由 Modal 渲染）
 *
 * 数据契约：
 *   - onSubmit(decision: FailedTaskResolveDecision, reason: string)：把决策 + 原因给 parent
 *   - onCancel(): void：父级 footer 触发
 *   - submitting: boolean：提交中禁用所有输入 + 关闭按钮
 *
 * i18n：所有 label 都用 t(key) 拿。
 */
import { useState, type JSX } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  RefreshIcon, StopIcon, ChevronLeftIcon, ChevronRightIcon,
} from '../../icons/icons.tsx'
import type { IconComponent } from '../../icons/icons.tsx'
import type { FailedTaskResolveDecision } from '../../controller/sky-axis-controller.ts'
import css from './FailedTaskResolveModal.module.css'

/** 4 决策选项配置 —— labelKey / descKey 是 string，调用 t() 时强转。 */
const DECISION_OPTIONS: ReadonlyArray<{
  value: FailedTaskResolveDecision
  labelKey: string
  descKey: string
  Icon: IconComponent
  variant: 'primary' | 'secondary' | 'warning' | 'danger'
}> = [
  {
    value: 'redo',
    labelKey: 'requirement.detail.failedTask.option.redo',
    descKey: 'requirement.detail.failedTask.option.redoDesc',
    Icon: RefreshIcon,
    variant: 'primary',
  },
  {
    value: 'rewind-plan',
    labelKey: 'requirement.detail.failedTask.option.rewindPlan',
    descKey: 'requirement.detail.failedTask.option.rewindPlanDesc',
    Icon: ChevronLeftIcon,
    variant: 'secondary',
  },
  {
    value: 'skip',
    labelKey: 'requirement.detail.failedTask.option.skip',
    descKey: 'requirement.detail.failedTask.option.skipDesc',
    Icon: ChevronRightIcon,
    variant: 'warning',
  },
  {
    value: 'abort',
    labelKey: 'requirement.detail.failedTask.option.abort',
    descKey: 'requirement.detail.failedTask.option.abortDesc',
    Icon: StopIcon,
    variant: 'danger',
  },
]

export interface FailedTaskResolveModalProps {
  t: PropsLocale<'sky-axis'>['t']
  /** 失败 task 的标题（modal 副标题用）。 */
  taskTitle: string
  /** 失败次数（用于「连续 N 次失败」提示）。 */
  failedCount: number
  /** 父级 footer 触发；modal 把 decision + reason 交给 controller.resolveFailedTask。 */
  onSubmit: (decision: FailedTaskResolveDecision, reason: string) => void
  /** 父级 footer「取消」触发。 */
  onCancel: () => void
  /** 提交中状态：禁用所有输入 + 关闭按钮。 */
  submitting: boolean
}

export function FailedTaskResolveModal(props: FailedTaskResolveModalProps): JSX.Element {
  const { t, taskTitle, failedCount, onSubmit, onCancel, submitting } = props
  const tAny = t as unknown as (k: string) => string
  const [decision, setDecision] = useState<FailedTaskResolveDecision | null>(null)
  const [reason, setReason] = useState<string>('')

  const canSubmit = decision !== null && !submitting

  const handleSubmit = (): void => {
    if (decision === null) return
    onSubmit(decision, reason.trim())
  }

  return (
    <div className={css.root}>
      <p className={css.subtitle}>
        {tAny('requirement.detail.failedTask.subtitle')
          .replace('{title}', taskTitle)
          .replace('{n}', String(failedCount))}
      </p>

      <div className={css.optionGrid} role="radiogroup" aria-label={tAny('requirement.detail.failedTask.title')}>
        {DECISION_OPTIONS.map(({ value, labelKey, descKey, Icon, variant }) => {
          const selected = decision === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`${css.optionCard} ${css[`variant_${variant}`]} ${selected ? css.optionCardSelected : ''}`}
              disabled={submitting}
              onClick={(): void => { setDecision(value) }}
            >
              <span className={css.optionIcon} aria-hidden="true">
                <Icon size={20} className={css.optionIconSvg} />
              </span>
              <span className={css.optionLabel}>{tAny(labelKey)}</span>
              <span className={css.optionDesc}>{tAny(descKey)}</span>
            </button>
          )
        })}
      </div>

      <fieldset className={css.field} disabled={submitting}>
        <legend className={css.legend}>
          {tAny('requirement.detail.failedTask.reasonLabel')}
        </legend>
        <textarea
          className={css.textarea}
          rows={3}
          maxLength={500}
          placeholder={tAny('requirement.detail.failedTask.reasonPlaceholder')}
          value={reason}
          onChange={(e): void => { setReason(e.target.value) }}
        />
      </fieldset>

      <p className={css.hint}>{tAny('requirement.detail.failedTask.hint')}</p>

      <div className={css.footer}>
        <button
          type="button"
          className={css.cancelButton}
          onClick={onCancel}
          disabled={submitting}
        >
          {tAny('requirement.detail.failedTask.cancel')}
        </button>
        <button
          type="button"
          className={css.confirmButton}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {tAny('requirement.detail.failedTask.confirm')}
        </button>
      </div>
    </div>
  )
}
