/**
 * RewindDrawer —— 阶段级回退表单（PR-C / 迭代 4）。
 *
 * 视觉/交互契约：
 *   - 5 段表单：target（radio）→ task（dropdown，仅 target=task 时显示）→ granularity（A/B/C radio）
 *     → reason（dropdown 5 选 1）→ reasonDetail（textarea，可选）
 *   - 底部 confirm / cancel 按钮由 RightDrawer 的 footer 渲染（parent 传入）
 *   - trigger='stage-go-back'（来自 AiConductorPane「暂回上阶段」按钮）：target 默认 current-stage，
 *     granularity 默认 A，stagePrev 可用
 *   - trigger='task-rewind'（来自 StageWorkspacePane per-task Rewind 按钮）：target 锁定 'task'，
 *     granularity 默认 A（不允许 C），taskId 由 parent 从 trigger 传入
 *
 * 数据契约：
 *   - onSubmit(req: RewindRequest)：把表单状态打包成 RewindRequest 给 parent
 *   - onCancel(): void：父级在 footer 「取消」按钮触发
 *   - submitting: boolean：提交中禁用所有输入 + 关闭按钮（RightDrawer 那边会显示 loading tag）
 *
 * i18n：所有 label 都用 t(key) 拿，遵循包级 zh/en 双语规则。
 */
import { useMemo, useState, type JSX } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RewindGranularity,
  RewindReason,
  RewindRequest,
  RewindTarget,
  RequirementStage,
} from '../../controller/sky-axis-controller.ts'
import css from './RewindDrawer.module.css'

/** 5 个 reason 选项（与 controller RewindReason literal 对应）。
 *  第一项是 default reason（与 design §2.2 rewind triple 配套）。 */
const REASON_OPTIONS: ReadonlyArray<{
  value: RewindReason
  labelKey: string
}> = [
  { value: 'verify-failed',         labelKey: 'requirement.detail.rewind.reason.verifyFailed' },
  { value: 'plan-drift',            labelKey: 'requirement.detail.rewind.reason.planDrift' },
  { value: 'goal-misaligned',       labelKey: 'requirement.detail.rewind.reason.goalMisaligned' },
  { value: 'human-request',         labelKey: 'requirement.detail.rewind.reason.humanRequest' },
  { value: 'auto-detected-issue',   labelKey: 'requirement.detail.rewind.reason.autoDetectedIssue' },
]

/** 8 个 target 选项（与 controller RewindTarget literal 对应）。
 *  'stage-prev' 在 currentStage='understand' 时应禁掉（drawer render 时按需过滤）。 */
const TARGET_OPTIONS: ReadonlyArray<{
  value: RewindTarget
  labelKey: string
}> = [
  { value: 'current-stage',      labelKey: 'requirement.detail.rewind.target.currentStage' },
  { value: 'task',               labelKey: 'requirement.detail.rewind.target.task' },
  { value: 'stage-prev',         labelKey: 'requirement.detail.rewind.target.stagePrev' },
  { value: 'stage-understand',   labelKey: 'requirement.detail.rewind.target.stageUnderstand' },
  { value: 'stage-plan',         labelKey: 'requirement.detail.rewind.target.stagePlan' },
  { value: 'stage-implement',    labelKey: 'requirement.detail.rewind.target.stageImplement' },
  { value: 'stage-verify',       labelKey: 'requirement.detail.rewind.target.stageVerify' },
  { value: 'stage-deliver',      labelKey: 'requirement.detail.rewind.target.stageDeliver' },
]

/** 3 个 granularity 选项 + 对应 label。 */
const GRANULARITY_OPTIONS: ReadonlyArray<{
  value: RewindGranularity
  labelKey: string
}> = [
  { value: 'A', labelKey: 'requirement.detail.rewind.granularity.A' },
  { value: 'B', labelKey: 'requirement.detail.rewind.granularity.B' },
  { value: 'C', labelKey: 'requirement.detail.rewind.granularity.C' },
]

const STAGE_ORDER: readonly RequirementStage[] = ['understand', 'plan', 'implement', 'verify', 'deliver']

/** 据 currentStage 过滤掉不允许的 target。
 *  - 'stage-prev' 在 currentStage='understand' 时禁用（没有更早阶段）
 *  - 与 currentStage 同名的 stage-* target 保留（虽然无意义，但交给 controller 报错更明确） */
function filterTargets(currentStage: RequirementStage): RewindTarget[] {
  return TARGET_OPTIONS.map(o => o.value).filter((target) => {
    if (target === 'stage-prev' && currentStage === 'understand') return false
    return true
  })
}

/** 据 trigger 决定默认 target。
 *  - 'stage-go-back'：默认 current-stage
 *  - 'task-rewind'：强制 'task'，调用方不应该让用户改 */
function defaultTargetForTrigger(trigger: 'stage-go-back' | 'task-rewind'): RewindTarget {
  return trigger === 'stage-go-back' ? 'current-stage' : 'task'
}

export interface RewindDrawerProps {
  t: PropsLocale<'sky-axis'>['t']
  /** 当前 req 的 stage —— 用于过滤可选 target。 */
  currentStage: RequirementStage
  /** 抽屉触发的来源 —— 决定 defaultTarget + granularity 可选范围。 */
  trigger: 'stage-go-back' | 'task-rewind'
  /** trigger='task-rewind' 时必填：让用户从下拉里选要回退的 task。
   *  parent 负责把 plan artifact 解析出来喂给 drawer。 */
  availableTasks?: ReadonlyArray<{ id: string; title: string; status: string }>
  /** trigger='task-rewind' 时的预选 taskId（来自父级 per-task Rewind 按钮）。 */
  preselectedTaskId?: string
  /** 父级已选 target（可由父级覆盖默认；常用于后续切 target）—— 若不传则按 trigger 推算。 */
  initialTarget?: RewindTarget
  /** 提交回调：父级把 RewindRequest 交给 controller.rewind()。
   *  drawer 不直接调 controller —— 解耦 i18n / 表单状态 / 数据流。 */
  onSubmit: (request: RewindRequest) => void
  /** 取消回调：父级 footer「取消」按钮触发。 */
  onCancel: () => void
  /** 提交中状态：禁用所有输入 + 关闭按钮。 */
  submitting: boolean
}

export function RewindDrawer(props: RewindDrawerProps): JSX.Element {
  const {
    t,
    currentStage,
    trigger,
    availableTasks,
    preselectedTaskId,
    initialTarget,
    onSubmit,
    onCancel,
    submitting,
  } = props

  /* ── 表单 state ── */
  const initialT = initialTarget ?? defaultTargetForTrigger(trigger)
  const [target, setTarget] = useState<RewindTarget>(initialT)
  const [taskId, setTaskId] = useState<string>(preselectedTaskId ?? '')
  const [granularity, setGranularity] = useState<RewindGranularity>('A')
  const [reason, setReason] = useState<RewindReason>('verify-failed')
  const [reasonDetail, setReasonDetail] = useState<string>('')

  /* ── 派生：可选 target / granularity 列表 ── */
  const allowedTargets = useMemo(() => filterTargets(currentStage), [currentStage])
  const allowedGranularities = useMemo<RewindGranularity[]>(() => {
    // target=task 时不允许 granularity=C
    if (target === 'task') return ['A', 'B']
    // granularity=C 需要 toStage=understand，否则 controller 会 fail（保留 3 选项但交 controller 报错）
    return ['A', 'B', 'C']
  }, [target])

  /* ── 校验：target=task 必须有 taskId ── */
  const canSubmit = ((): boolean => {
    if (submitting) return false
    if (target === 'task' && taskId === '') return false
    if (!allowedTargets.includes(target)) return false
    if (!allowedGranularities.includes(granularity)) return false
    return true
  })()

  /* ── 提交 ── */
  const handleSubmit = (): void => {
    if (!canSubmit) return
    const detail = reasonDetail.trim()
    const request: RewindRequest = target === 'task'
      ? {
          target: 'task',
          targetTaskId: taskId,
          reason,
          reasonDetail: detail === '' ? undefined : detail,
          granularity,
          options: { preserveDownstream: false, draftNewPlan: false },
        }
      : (target === 'current-stage' || target === 'stage-prev'
        || target === 'stage-understand' || target === 'stage-plan'
        || target === 'stage-implement' || target === 'stage-verify'
        || target === 'stage-deliver')
        ? {
            target,
            reason,
            reasonDetail: detail === '' ? undefined : detail,
            granularity,
            options: { preserveDownstream: false, draftNewPlan: false },
          }
        : (() => { throw new Error('unreachable') })()
    onSubmit(request)
  }

  /* ── hint 文案 ── */
  const stagePrevHint = currentStage === 'understand'
    ? t('requirement.detail.rewind.targetInvalid')
    : `${t('requirement.detail.rewind.target.stagePrev')}: ${STAGE_ORDER[STAGE_ORDER.indexOf(currentStage) - 1] ?? '?'}`

  return (
    <div className={css.root}>
      <p className={css.subtitle}>{t('requirement.detail.rewind.subtitle')}</p>

      {/* Target */}
      <fieldset className={css.field} disabled={submitting}>
        <legend className={css.legend}>{t('requirement.detail.rewind.targetLabel')}</legend>
        <div className={css.radioGroup}>
          {TARGET_OPTIONS.map(({ value, labelKey }) => {
            const disabled = !allowedTargets.includes(value)
            return (
              <label
                key={value}
                className={`${css.radioOption} ${disabled ? css.radioOptionDisabled : ''}`}
              >
                <input
                  type="radio"
                  name="rewind-target"
                  value={value}
                  checked={target === value}
                  disabled={disabled || (trigger === 'task-rewind' && value !== 'task')}
                  onChange={(): void => { setTarget(value) }}
                />
                <span>{t(labelKey as never)}</span>
                {value === 'stage-prev' && disabled && (
                  <span className={css.optionHint}>{stagePrevHint}</span>
                )}
              </label>
            )
          })}
        </div>
      </fieldset>

      {/* Task picker（仅 target=task 时显示） */}
      {target === 'task' && (
        <fieldset className={css.field} disabled={submitting}>
          <legend className={css.legend}>{t('requirement.detail.rewind.taskLabel')}</legend>
          {availableTasks !== undefined && availableTasks.length > 0 ? (
            <select
              className={css.select}
              value={taskId}
              onChange={(e): void => { setTaskId(e.target.value) }}
            >
              <option value="" disabled>
                {t('requirement.detail.rewind.taskPlaceholder')}
              </option>
              {availableTasks.map((tk) => (
                <option key={tk.id} value={tk.id}>
                  {tk.title}（{tk.status}）
                </option>
              ))}
            </select>
          ) : (
            <p className={css.warning}>
              {t('requirement.detail.rewind.taskPlaceholder')}
            </p>
          )}
        </fieldset>
      )}

      {/* Granularity */}
      <fieldset className={css.field} disabled={submitting}>
        <legend className={css.legend}>{t('requirement.detail.rewind.granularityLabel')}</legend>
        <div className={css.radioGroup}>
          {GRANULARITY_OPTIONS.map(({ value, labelKey }) => {
            const disabled = !allowedGranularities.includes(value)
            return (
              <label
                key={value}
                className={`${css.radioOption} ${disabled ? css.radioOptionDisabled : ''}`}
              >
                <input
                  type="radio"
                  name="rewind-granularity"
                  value={value}
                  checked={granularity === value}
                  disabled={disabled}
                  onChange={(): void => { setGranularity(value) }}
                />
                <span>{t(labelKey as never)}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {/* Reason */}
      <fieldset className={css.field} disabled={submitting}>
        <legend className={css.legend}>{t('requirement.detail.rewind.reasonLabel')}</legend>
        <select
          className={css.select}
          value={reason}
          onChange={(e): void => { setReason(e.target.value as RewindReason) }}
        >
          {REASON_OPTIONS.map(({ value, labelKey }) => (
            <option key={value} value={value}>{t(labelKey as never)}</option>
          ))}
        </select>
      </fieldset>

      {/* Reason detail */}
      <fieldset className={css.field} disabled={submitting}>
        <legend className={css.legend}>{t('requirement.detail.rewind.reasonDetailLabel')}</legend>
        <textarea
          className={css.textarea}
          rows={3}
          maxLength={500}
          placeholder={t('requirement.detail.rewind.reasonDetailPlaceholder')}
          value={reasonDetail}
          onChange={(e): void => { setReasonDetail(e.target.value) }}
        />
      </fieldset>

      <p className={css.hint}>{t('requirement.detail.rewind.hint')}</p>

      {/* footer 区由 RightDrawer 渲染（不写在 body 内）；但因为父级 footer 是 props，
          这里返回纯内容，让父级在 RightDrawer 的 footer slot 里放按钮 */}
      <div className={css.footer}>
        <button
          type="button"
          className={css.cancelButton}
          onClick={onCancel}
          disabled={submitting}
        >
          {t('requirement.detail.rewind.cancel')}
        </button>
        <button
          type="button"
          className={css.confirmButton}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {t('requirement.detail.rewind.confirm')}
        </button>
      </div>
    </div>
  )
}