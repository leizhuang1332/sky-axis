/**
 * AuditTimelineModal —— 审计时间线（PR-E / 迭代 7）。
 *
 * 设计意图：用户在 detail header 点击 🔍 按钮 → 父级打开此 modal；
 * modal 把 4 维审计数据（阶段流转 / task 状态变化 / 产物写入 / 人工介入）
 * 归一化成统一时间线，按时间戳倒序混合展示；顶部 5 个筛选 chip 可切换单维度。
 *
 * 视觉/交互契约：
 *   - 居中 Modal（复用 Modal.tsx 视觉骨架 + ESC + overlay-click 关闭）
 *   - 顶部筛选 chip 行：全部 / 阶段流转 / task 状态 / 产物写入 / 人工介入（单选）
 *   - 时间线主体：每条 event = 图标 + 类型标签 + 标题 + 时间 + 可选 outcome badge / detail
 *   - 空状态：该维度无数据时显示空状态文案
 *
 * 数据契约（全部从 requirement 真实字段 + taskList 读取，无 mutation）：
 *   - requirement.stageHistory         → 阶段流转事件
 *   - requirement.artifacts            → 产物写入事件
 *   - requirement.interventionQueue    → 人工介入事件
 *   - taskList.tasks[].subHistory       → task 状态变化事件（taskList 由父级从 plan artifact 反序列化传入）
 *
 * i18n：所有 label 都用 t(key) 拿，遵循包级 zh/en 双语规则。
 */
import { useMemo, useState, type JSX } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RequirementArtifact,
  RequirementEntry,
  RequirementInterventionItem,
  RequirementStage,
  RequirementStageHistoryEntry,
  RequirementTask,
  RequirementTaskList,
  TaskStatus,
} from '../../controller/sky-axis-controller.ts'
import {
  GitCommitIcon, FlagIcon, CommentIcon, CheckIcon, BugIcon,
  WorkflowIcon, PlayIcon, PinIcon, EyeIcon, PauseIcon,
} from '../../icons/icons.tsx'
import type { IconComponent } from '../../icons/icons.tsx'
import css from './AuditTimelineModal.module.css'

/* ── 归一化事件类型 ── */

export type TimelineEventKind = 'stage' | 'task' | 'artifact' | 'intervention'

export interface TimelineEvent {
  /** 去重 key（stageHistory 用 stage+enteredAt；task 用 taskId+enteredAt 等）。 */
  id: string
  /** 决定图标 + 配色 + 筛选。 */
  kind: TimelineEventKind
  /** enteredAt / createdAt（排序用）。 */
  timestamp: string
  /** 主标题。 */
  title: string
  /** 副标题（如 reason / outcome / artifact.kind / intervention.kind）。 */
  detail?: string
  /** badge 配色用（stage + task 共用 4 态 outcome）。 */
  outcome?: 'completed' | 'manual' | 'rolled-back' | 'errored'
  /** task 事件的状态色用。 */
  status?: TaskStatus
  /** artifact / intervention 细分图标用（kind 字符串）。 */
  iconKind?: string
  /** 特殊标注：steer note / drift snapshot / 已应答 intervention。 */
  badge?: string
}

/* ── 归一化 helper（4 个纯函数，可单测）── */

/** STAGE_ORDER 用于推断 stageHistory 条目之间的流转方向。 */
const STAGE_ORDER: readonly RequirementStage[] = ['understand', 'plan', 'implement', 'verify', 'deliver']

/**
 * 把 stageHistory 归一化成事件。
 * 每个 entry → 1 条 event；title 推断为「{stage} 进入」或与下一条 entry 配对成「{from} → {to}」。
 * outcome / reason 进 detail。
 */
export function stageHistoryToEvents(
  stageHistory: readonly RequirementStageHistoryEntry[],
): TimelineEvent[] {
  return stageHistory.map((entry, idx) => {
    // 与下一条 entry 配对推断流转方向（下一条的 stage 就是 toStage）
    const next = stageHistory[idx + 1]
    const fromStage = entry.stage
    const toStage = next?.stage ?? entry.stage
    const isTransition = next !== undefined && next.stage !== entry.stage
    const title = isTransition
      ? `${fromStage} → ${toStage}`
      : `${fromStage}`
    const detailParts: string[] = []
    if (entry.outcome !== undefined) detailParts.push(entry.outcome)
    if (entry.reason !== undefined && entry.reason !== '') detailParts.push(`reason: ${entry.reason}`)
    return {
      id: `stage-${idx}-${entry.stage}-${entry.enteredAt}`,
      kind: 'stage' as const,
      timestamp: entry.enteredAt,
      title,
      detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
      outcome: entry.outcome,
    } satisfies TimelineEvent
  })
}

/**
 * 把 task list 的 subHistory 归一化成事件。
 * 遍历每个 task 的 subHistory，每条 entry → 1 条 event；title = #{taskId} {taskTitle} + status。
 */
export function subHistoryToEvents(tasks: readonly RequirementTask[]): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const task of tasks) {
    for (let i = 0; i < task.subHistory.length; i++) {
      const entry = task.subHistory[i]!
      events.push({
        id: `task-${task.id}-${i}-${entry.enteredAt}`,
        kind: 'task' as const,
        timestamp: entry.enteredAt,
        title: `#${task.id.slice(-2)} ${task.title}`,
        detail: `status: ${entry.status}`,
        outcome: entry.outcome,
        status: entry.status,
      } satisfies TimelineEvent)
    }
  }
  return events
}

/**
 * 把 artifacts 归一化成事件。
 * 每个 artifact → 1 条 event；title = artifact.title；kind 进 detail。
 * meta.source='steer' / title='Drift snapshot' 特殊标注。
 */
export function artifactsToEvents(
  artifacts: Readonly<Record<string, RequirementArtifact>>,
): TimelineEvent[] {
  return Object.values(artifacts).map((art, idx) => {
    const detailParts: string[] = [`kind: ${art.kind}`]
    let badge: string | undefined
    const metaSource = art.meta?.source
    if (typeof metaSource === 'string') {
      if (metaSource === 'steer') badge = 'steer'
      else if (metaSource === 'drift') badge = 'drift'
    }
    // 兜底：title 含 'Drift snapshot' 也标 drift（drift detect 写入的 artifact）
    if (badge === undefined && art.title === 'Drift snapshot') badge = 'drift'
    return {
      id: `artifact-${art.id}-${idx}`,
      kind: 'artifact' as const,
      timestamp: art.createdAt,
      title: art.title,
      detail: detailParts.join(' · '),
      iconKind: art.kind,
      badge,
    } satisfies TimelineEvent
  })
}

/**
 * 把 interventionQueue 归一化成事件。
 * 每个 item → 1 条 event；title = item.summary；kind 进 detail；resolved=true 标记已应答。
 */
export function interventionsToEvents(
  queue: readonly RequirementInterventionItem[],
): TimelineEvent[] {
  return queue.map((item, idx) => ({
    id: `intervention-${item.id}-${idx}`,
    kind: 'intervention' as const,
    timestamp: item.createdAt,
    title: item.summary,
    detail: `kind: ${item.kind}`,
    iconKind: item.kind,
    badge: item.resolved === true ? 'resolved' : undefined,
  } satisfies TimelineEvent))
}

/* ── 图标映射 ── */

/** stage event 统一用 GitCommitIcon（表示阶段流转节点）。 */
function stageIcon(): IconComponent {
  return GitCommitIcon
}

/** task event 按 status 配图标。 */
function taskIcon(status: TaskStatus | undefined): IconComponent {
  switch (status) {
    case 'done':        return CheckIcon
    case 'failed':      return BugIcon
    case 'in_progress': return WorkflowIcon
    case 'verifying':   return PlayIcon
    case 'pending':     return PauseIcon
    case 'rolled_back': return GitCommitIcon
    case 'blocked':     return PauseIcon
    case 'skipped':     return CheckIcon
    default:            return WorkflowIcon
  }
}

/** artifact event 按 kind 配图标。 */
function artifactIcon(kind: string | undefined): IconComponent {
  switch (kind) {
    case 'plan':   return FlagIcon
    case 'note':   return CommentIcon
    case 'patch':  return GitCommitIcon
    case 'log':
    case 'report': return CheckIcon
    default:       return CheckIcon
  }
}

/** intervention event 按 kind 配图标（复用 InterventionQueuePane 的映射）。 */
function interventionIcon(kind: string | undefined): IconComponent {
  switch (kind) {
    case 'approval': return PinIcon
    case 'question': return CommentIcon
    case 'review':   return EyeIcon
    default:         return CommentIcon
  }
}

/** 据 event 选图标。 */
function eventIcon(event: TimelineEvent): IconComponent {
  switch (event.kind) {
    case 'stage':        return stageIcon()
    case 'task':         return taskIcon(event.status)
    case 'artifact':     return artifactIcon(event.iconKind)
    case 'intervention': return interventionIcon(event.iconKind)
  }
}

/* ── 时间格式化 ── */

/** 把 ISO 时间戳格式化为「YYYY-MM-DD HH:mm」。 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const pad = (n: number): string => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

/* ── 组件 ── */

export interface AuditTimelineModalProps {
  t: PropsLocale<'sky-axis'>['t']
  /** 当前 requirement（提供 stageHistory / artifacts / interventionQueue）。 */
  requirement: RequirementEntry
  /** 当前阶段的 task list（提供 tasks[].subHistory）。null → task 维度显示空状态。 */
  taskList?: RequirementTaskList | null
  /** 父级 footer「关闭」触发（Modal 的 onClose 已由父级接通，这里保留用于未来扩展）。 */
  onClose?: () => void
}

/** 筛选维度；'all' 表示全部混合。 */
type FilterKind = TimelineEventKind | 'all'

/** 筛选 chip 配置。 */
const FILTER_CHIPS: ReadonlyArray<{ value: FilterKind; labelKey: string }> = [
  { value: 'all',          labelKey: 'requirement.detail.audit.filter.all' },
  { value: 'stage',        labelKey: 'requirement.detail.audit.filter.stage' },
  { value: 'task',         labelKey: 'requirement.detail.audit.filter.task' },
  { value: 'artifact',     labelKey: 'requirement.detail.audit.filter.artifact' },
  { value: 'intervention', labelKey: 'requirement.detail.audit.filter.intervention' },
]

export function AuditTimelineModal(props: AuditTimelineModalProps): JSX.Element {
  const { t, requirement, taskList } = props
  const tAny = t as unknown as (k: string) => string
  const [filter, setFilter] = useState<FilterKind>('all')

  /* ── 4 维归一化 + 合并 + 倒序 ── */
  const allEvents = useMemo<TimelineEvent[]>(() => {
    const stage = stageHistoryToEvents(requirement.stageHistory ?? [])
    const task = taskList !== null && taskList !== undefined
      ? subHistoryToEvents(taskList.tasks)
      : []
    const artifact = artifactsToEvents(requirement.artifacts ?? {})
    const intervention = interventionsToEvents(requirement.interventionQueue ?? [])
    return [...stage, ...task, ...artifact, ...intervention]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }, [requirement.stageHistory, requirement.artifacts, requirement.interventionQueue, taskList])

  /* ── 按筛选 chip 过滤 ── */
  const filtered = useMemo<TimelineEvent[]>(() => {
    if (filter === 'all') return allEvents
    return allEvents.filter(e => e.kind === filter)
  }, [allEvents, filter])

  /* ── badge 文案 key ── */
  const badgeLabelKey = (badge: string): string => {
    switch (badge) {
      case 'steer':    return 'requirement.detail.audit.event.steerNote'
      case 'drift':    return 'requirement.detail.audit.event.driftSnapshot'
      case 'resolved': return 'requirement.detail.audit.event.resolved'
      default:         return badge
    }
  }

  return (
    <div className={css.root}>
      {/* 顶部筛选 chip 行 */}
      <div className={css.filterRow} role="tablist" aria-label={tAny('requirement.detail.audit.title')}>
        {FILTER_CHIPS.map(chip => {
          const active = filter === chip.value
          const count = chip.value === 'all'
            ? allEvents.length
            : allEvents.filter(e => e.kind === chip.value).length
          return (
            <button
              key={chip.value}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${css.filterChip} ${active ? css.filterChipActive : ''}`}
              onClick={(): void => { setFilter(chip.value) }}
            >
              <span>{tAny(chip.labelKey)}</span>
              <span className={css.filterChipCount}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* 事件计数 */}
      <p className={css.countLine}>
        {tAny('requirement.detail.audit.event.count').replace('{n}', String(filtered.length))}
      </p>

      {/* 时间线主体 */}
      {filtered.length === 0 ? (
        <div className={css.empty}>
          <span className={css.emptyIcon} aria-hidden="true">○</span>
          <p className={css.emptyText}>
            {filter === 'all'
              ? tAny('requirement.detail.audit.empty')
              : tAny('requirement.detail.audit.emptyFiltered')}
          </p>
        </div>
      ) : (
        <ol className={css.timeline}>
          {filtered.map(event => {
            const Icon = eventIcon(event)
            const outcomeLabel = event.outcome !== undefined
              ? tAny(`requirement.detail.history.outcome.${event.outcome}`)
              : null
            return (
              <li key={event.id} className={css.eventItem} data-kind={event.kind}>
                <span className={`${css.eventIcon} ${css[`eventIcon_${event.kind}` as 'eventIcon_stage']}`}>
                  <Icon size={14} className={css.eventIconSvg} />
                </span>
                <div className={css.eventBody}>
                  <div className={css.eventHeader}>
                    <span className={css.eventTitle}>{event.title}</span>
                    {event.badge !== undefined && (
                      <span className={css.eventBadge} data-badge={event.badge}>
                        {tAny(badgeLabelKey(event.badge))}
                      </span>
                    )}
                    {outcomeLabel !== null && (
                      <span className={css.eventOutcome} data-outcome={event.outcome}>
                        {outcomeLabel}
                      </span>
                    )}
                  </div>
                  {event.detail !== undefined && (
                    <p className={css.eventDetail}>{event.detail}</p>
                  )}
                </div>
                <span className={css.eventTime}>{formatTime(event.timestamp)}</span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/** 让 component 标识别名在 DevTools 友好。 */
AuditTimelineModal.displayName = 'AuditTimelineModal'

// 抑制 unused 警告（RequirementStage 留作未来扩展使用）
void (null as unknown as RequirementStage)
