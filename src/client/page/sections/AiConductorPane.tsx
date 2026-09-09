/**
 * AiConductorPane —— 详情页左 25% 列「AI 协奏」面板。
 *
 * 职责：
 *   - 展示当前 requirement 的 AI session 状态（idle / running / paused /
 *     awaiting-input / errored）
 *   - 显示最近活动时间（mock）
 *   - 提供 AI 控制按钮（启动 / 暂停 / 恢复 / 取消 / 重启）
 *   - 提供阶段推进按钮（自动推进下一阶段 / 暂回上一阶段）
 *
 * Phase 1 限制：
 *   - 所有按钮均 disabled（host 路由 /ai/start 与 /ai/action 未接）
 *   - tooltip 文案说明「Phase 2 待接入」
 *   - 数据完全来自 controller 投影的 requirement；state 改变全靠 SSE（Phase 2）
 *
 * 数据流：完全受控 props。parent 传 t + requirement + loading。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  ProgressIcon, AlertIcon, PinIcon, EyeIcon, CheckIcon, StopIcon,
} from '../../icons/icons.tsx'
import type {
  RequirementEntry,
  RequirementAiState,
} from '../../controller/sky-axis-controller.ts'
import type { DriftSnapshot } from '../views/requirement-detail.mock.ts'
import { DriftCard } from './DriftCard.tsx'
import css from './AiConductorPane.module.css'

export interface AiConductorPaneProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
  /** 详情加载中（host 端 GET 进行中）—— 用于按钮 disabled 视觉。 */
  loading: boolean
  /** 当前阶段的 drift 快照。null → 不渲染 DriftCard。Phase 1 由 mock 驱动。 */
  driftSnapshot?: DriftSnapshot | null
  /** PR-C 迭代 4：「暂回上阶段」按钮触发 —— parent 打开 RightDrawer。
   *  未传时按钮保持 disabled（向后兼容）。 */
  onOpenRewind?: (trigger: 'stage-go-back') => void
  /** PR-C 迭代 5：DriftCard 重跑按钮触发 —— parent 调 controller.rerunDriftDetection。
   *  未传时 DriftCard 按钮 disabled。 */
  onRerunDrrift?: () => void
  /** PR-C 迭代 5：drift 检测进行中（用于 DriftCard 显示「正在检测…」+ 禁用按钮）。 */
  driftLoading?: boolean
  /** PR-D 迭代 6 #5：「自动推进下一阶段」按钮触发 —— parent 打开 StageGateModal。
   *  未传时按钮保持 disabled（向后兼容）。 */
  onAdvanceStage?: () => void
}

/** AI 状态 → i18n 文案 key + 图标。
 *  labelKey / hintKey 是 string —— 调用 t() 时用 `as never` 强转（SkyAxisKey 联合类型
 *  不允许 string 注入，但运行时 locale 系统支持任意 string key 走 fallback）。 */
function aiStateMeta(state: RequirementAiState | undefined): {
  labelKey: string
  hintKey: string
  Icon: (p: { size?: number; className?: string }) => JSX.Element
  level: 'idle' | 'running' | 'paused' | 'awaiting' | 'errored'
} {
  const s = state ?? 'idle'
  switch (s) {
    case 'idle':
      return { labelKey: 'requirement.detail.conductor.status.idle', hintKey: 'requirement.detail.conductor.status.idleHint', Icon: ProgressIcon, level: 'idle' }
    case 'running':
      return { labelKey: 'requirement.detail.conductor.status.running', hintKey: 'requirement.detail.conductor.status.runningHint', Icon: ProgressIcon, level: 'running' }
    case 'paused':
      return { labelKey: 'requirement.detail.conductor.status.paused', hintKey: 'requirement.detail.conductor.status.pausedHint', Icon: StopIcon, level: 'paused' }
    case 'awaiting-input':
      return { labelKey: 'requirement.detail.conductor.status.awaiting', hintKey: 'requirement.detail.conductor.status.awaitingHint', Icon: EyeIcon, level: 'awaiting' }
    case 'errored':
      return { labelKey: 'requirement.detail.conductor.status.errored', hintKey: 'requirement.detail.conductor.status.erroredHint', Icon: AlertIcon, level: 'errored' }
  }
}

/** 把 ISO 时间戳格式化为「5s 前 / 2min 前 / 1h 前 / 2026-08-30 12:34」相对时间。
 *  t 接受 string key（强转规避 LocaleKeysOf 类型）—— 运行时 locale 系统支持 fallback。 */
function formatRelative(iso: string | null | undefined, t: (k: string) => string): string {
  if (iso === null || iso === undefined) return t('requirement.detail.conductor.neverActive')
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return t('requirement.detail.conductor.neverActive')
  const deltaMs = Date.now() - ts
  if (deltaMs < 60_000) return t('requirement.detail.conductor.justNow')
  if (deltaMs < 3_600_000) return t('requirement.detail.conductor.minutesAgo').replace('{n}', String(Math.floor(deltaMs / 60_000)))
  if (deltaMs < 86_400_000) return t('requirement.detail.conductor.hoursAgo').replace('{n}', String(Math.floor(deltaMs / 3_600_000)))
  return new Date(iso).toISOString().slice(0, 10)
}

export function AiConductorPane(props: AiConductorPaneProps): JSX.Element {
  const {
    t,
    requirement,
    loading,
    driftSnapshot = null,
    onOpenRewind,
    onRerunDrrift,
    driftLoading,
    onAdvanceStage,
  } = props
  // 把 LocaleKeysOf 强转为 (k: string) => string —— labelKey/hintKey 是动态字符串，
  // 编译期 SkyAxisKey 联合不允许直接传 string，但运行时 locale 系统会兜底。
  const tAny = t as unknown as (k: string) => string
  const meta = aiStateMeta(requirement.aiState)
  const lastActivity = formatRelative(requirement.aiLastActivityAt, tAny)
  // 按钮组可见性按 AI 状态分桶（Phase 1 全部 disabled）
  const isIdle = (requirement.aiState ?? 'idle') === 'idle'
  const isRunning = requirement.aiState === 'running'
  const isPaused = requirement.aiState === 'paused'
  const isErrored = requirement.aiState === 'errored'

  return (
    <div className={css.pane}>
      <header className={css.header}>
        <h3 className={css.title}>{t('requirement.detail.conductor.title')}</h3>
        <p className={css.subtitle}>{t('requirement.detail.conductor.subtitle')}</p>
      </header>

      {/* Drift 占位卡 —— 默认折叠；PR-C 迭代 5：父级注入 onRerunDrrift + driftLoading */}
      <DriftCard
        t={t}
        driftSnapshot={driftSnapshot}
        onRerunDrift={onRerunDrrift}
        loading={driftLoading}
      />

      {/* AI 状态卡 */}
      <section className={css.statusCard} data-level={meta.level}>
        <div className={css.statusIcon}>
          <meta.Icon size={16} className={css.statusIconSvg} />
        </div>
        <div className={css.statusText}>
          <span className={css.statusLabel}>{tAny(meta.labelKey)}</span>
          <span className={css.statusHint}>{tAny(meta.hintKey)}</span>
        </div>
        {meta.level === 'running' && (
          <span className={`${css.dot} ${css.dotRunning}`} aria-hidden="true" />
        )}
      </section>

      {/* 最近活动 */}
      <section className={css.metaRow}>
        <span className={css.metaLabel}>{t('requirement.detail.conductor.lastActivity')}</span>
        <span className={css.metaValue}>{lastActivity}</span>
      </section>

      {/* 操作按钮组 —— Phase 1 全 disabled */}
      <section className={css.actions}>
        <button
          type="button"
          className={css.primaryButton}
          disabled={loading || !isIdle}
          title={t('requirement.detail.conductor.startHint')}
        >
          <CheckIcon size={12} className={css.buttonIcon} />
          <span>{t('requirement.detail.conductor.start')}</span>
        </button>
        <div className={css.actionsRow}>
          <button
            type="button"
            className={css.secondaryButton}
            disabled={loading || !isRunning}
            title={t('requirement.detail.conductor.pauseHint')}
          >
            <span>{t('requirement.detail.conductor.pause')}</span>
          </button>
          <button
            type="button"
            className={css.secondaryButton}
            disabled={loading || !isPaused}
            title={t('requirement.detail.conductor.resumeHint')}
          >
            <span>{t('requirement.detail.conductor.resume')}</span>
          </button>
          <button
            type="button"
            className={css.secondaryButton}
            disabled={loading || !(isRunning || isPaused)}
            title={t('requirement.detail.conductor.cancelHint')}
          >
            <span>{t('requirement.detail.conductor.cancel')}</span>
          </button>
        </div>
        {isErrored && (
          <button
            type="button"
            className={css.secondaryButton}
            disabled={loading}
            title={t('requirement.detail.conductor.restartHint')}
          >
            <span>{t('requirement.detail.conductor.restart')}</span>
          </button>
        )}
      </section>

      {/* 阶段推进按钮组 */}
      <section className={css.stageActions}>
        <h4 className={css.stageActionsTitle}>{t('requirement.detail.action.title')}</h4>
        <div className={css.actionsRow}>
          <button
            type="button"
            className={css.secondaryButton}
            disabled={onAdvanceStage === undefined}
            onClick={(): void => {
              if (onAdvanceStage !== undefined) onAdvanceStage()
            }}
            title={onAdvanceStage === undefined
              ? t('requirement.detail.action.autoAdvanceHint')
              : t('requirement.detail.action.autoAdvance')}
          >
            <PinIcon size={12} className={css.buttonIcon} />
            <span>{t('requirement.detail.action.autoAdvance')}</span>
          </button>
          <button
            type="button"
            className={css.secondaryButton}
            disabled={onOpenRewind === undefined}
            onClick={(): void => {
              if (onOpenRewind !== undefined) onOpenRewind('stage-go-back')
            }}
            title={onOpenRewind === undefined
              ? t('requirement.detail.action.goBackHint')
              : t('requirement.detail.action.goBack')}
          >
            <span>{t('requirement.detail.action.goBack')}</span>
          </button>
        </div>
      </section>

      {/* Phase 1 占位 */}
      <section className={css.placeholder}>
        <p className={css.placeholderText}>{t('requirement.detail.conductor.phase1Hint')}</p>
      </section>
    </div>
  )
}

/** 让 component 标识别名在 DevTools 友好。 */
AiConductorPane.displayName = 'AiConductorPane'