/**
 * StageGateModal —— 介入点 #5「阶段完成后 Gate」（PR-D / 迭代 6）。
 *
 * 设计意图：用户在 AiConductorPane 点击「自动推进下一阶段」→ 父级打开此 modal；
 * modal 显示当前阶段已完成摘要 + 下一阶段预览（taskProgress + drift + rewind 统计），
 * 用户选择「进入下一阶段」或「暂留本阶段」。
 *
 * Modal 居中显示（与失败 4 选 1 一致）。
 *
 * 视觉/交互契约：
 *   - 居中 Modal（复用 Modal.tsx 视觉骨架）
 *   - 顶部：「{fromStage} 已完成」副标题
 *   - 中部：下阶段摘要（task 总数 + done 数 + drift 平均 + rewind 计数）
 *   - 底部：「进入下一阶段 / 暂留」按钮（footer 由 Modal 渲染）
 *
 * 数据契约：
 *   - onAdvance(): void：父级 footer 触发；调 controller.advanceStage
 *   - onStay(): void：父级 footer「暂留」触发；仅关闭 modal
 *   - submitting: boolean：提交中禁用所有输入 + 关闭按钮
 *
 * i18n：所有 label 都用 t(key) 拿。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementStage } from '../../controller/sky-axis-controller.ts'
import css from './StageGateModal.module.css'

export interface StageGateSummary {
  /** 下一阶段 task list 的总数。0 表示下阶段尚无 task（很少见，UI 提示）。 */
  taskTotal: number
  /** 下一阶段 task list 中 status='done' 的数量。 */
  taskDone: number
  /** 下一阶段 drift 综合分（0-1）。null 表示无 drift snapshot。 */
  driftOverall: number | null
  /** 当前 requirement 总 rewind 计数（stageHistory.rolled-back + task.rolled-back 累加）。 */
  rewindCount: number
}

export interface StageGateModalProps {
  t: PropsLocale<'sky-axis'>['t']
  /** 当前阶段（即将离开）。 */
  fromStage: RequirementStage
  /** 下一阶段（即将进入）。 */
  toStage: RequirementStage
  /** 下阶段摘要。 */
  summary: StageGateSummary
  /** 父级 footer 触发「进入下一阶段」按钮 → controller.advanceStage。 */
  onAdvance: () => void
  /** 父级 footer「暂留本阶段」按钮 → 仅关闭 modal。 */
  onStay: () => void
  /** 提交中状态：禁用所有输入 + 关闭按钮。 */
  submitting: boolean
}

/** 据 STAGE_ORDER 索引计算 drift 等级标签。 */
function getDriftLevel(score: number): 'low' | 'mid' | 'high' {
  if (score < 0.3) return 'low'
  if (score < 0.6) return 'mid'
  return 'high'
}

export function StageGateModal(props: StageGateModalProps): JSX.Element {
  const { t, fromStage, toStage, summary, onAdvance, onStay, submitting } = props
  const tAny = t as unknown as (k: string) => string

  const taskDonePct = summary.taskTotal === 0 ? 0 : Math.round((summary.taskDone / summary.taskTotal) * 100)
  const driftLevelLabel: 'low' | 'mid' | 'high' | 'none' = summary.driftOverall === null
    ? 'none'
    : getDriftLevel(summary.driftOverall)

  return (
    <div className={css.root}>
      <p className={css.subtitle}>
        {tAny('requirement.detail.stageGate.subtitle')
          .replace('{fromStage}', tAny(`requirement.detail.stage.${fromStage}.label`))}
      </p>

      <section className={css.summaryBlock}>
        <h3 className={css.summaryTitle}>
          {tAny('requirement.detail.stageGate.nextStage')}
          <span className={`${css.stageBadge} ${css[`stageBadge_${toStage}` as 'stageBadge_understand']}`}>
            {tAny(`requirement.detail.stage.${toStage}.label`)}
          </span>
        </h3>

        <div className={css.metricsRow}>
          <div className={css.metric}>
            <span className={css.metricLabel}>{tAny('requirement.detail.stageGate.taskProgress')}</span>
            <span className={css.metricValue}>
              {summary.taskDone}/{summary.taskTotal}
              <span className={css.metricPct}>({taskDonePct}%)</span>
            </span>
          </div>

          <div className={css.metric}>
            <span className={css.metricLabel}>{tAny('requirement.detail.stageGate.drift')}</span>
            <span className={`${css.metricValue} ${css[`drift_${driftLevelLabel}` as 'drift_low']}`}>
              {summary.driftOverall === null
                ? tAny('requirement.detail.stageGate.driftUnknown')
                : summary.driftOverall.toFixed(2)}
            </span>
          </div>

          <div className={css.metric}>
            <span className={css.metricLabel}>{tAny('requirement.detail.stageGate.rewinds')}</span>
            <span className={css.metricValue}>{summary.rewindCount}</span>
          </div>
        </div>
      </section>

      <p className={css.hint}>{tAny('requirement.detail.stageGate.hint')}</p>

      <div className={css.footer}>
        <button
          type="button"
          className={css.cancelButton}
          onClick={onStay}
          disabled={submitting}
        >
          {tAny('requirement.detail.stageGate.stay')}
        </button>
        <button
          type="button"
          className={css.confirmButton}
          onClick={onAdvance}
          disabled={submitting}
        >
          {tAny('requirement.detail.stageGate.advance')}
        </button>
      </div>
    </div>
  )
}
