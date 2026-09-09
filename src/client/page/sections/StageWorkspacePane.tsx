/**
 * StageWorkspacePane —— 详情页中列「当前阶段工作区」。
 *
 * Phase 1.0 重构（[docs/ai工作台整体方案设计.md](../../../docs/ai工作台整体方案设计.md) §11 iteration 1+2）：
 *   - 上下分 30/70 布局：
 *       上 30%：task list（当 taskList 存在时显示，否则回退到 stage hint 占位）
 *       下 70%：current task content + stage history
 *   - task list：每行 = 状态圆点 + 标题 + goal 摘要 + drift badge + 操作按钮
 *   - current task content：header + acceptance 清单 + diff box 占位 + 操作按钮
 *
 * PR-B（迭代 3）：操作按钮接 controller
 *   - Start / Accept / Redo / Skip 4 个按钮按 task.status 启用
 *   - Rewind 按钮留 PR-C（仍 disabled）
 *   - 点击后乐观更新 UI；若 controller 未注入或 taskActionImpl 缺失，按钮 disabled
 *
 * 数据来源：受控 props。父组件传 t + requirement + taskList + controller + onSelectTask。
 */
import { useState, type JSX } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RequirementEntry,
  RequirementStage,
  RequirementTask,
  RequirementTaskList,
  SkyAxisController,
  TaskStatus,
} from '../../controller/sky-axis-controller.ts'
import {
  ClockIcon, FlagIcon, WorkflowIcon, PlayIcon, PauseIcon,
} from '../../icons/icons.tsx'
import type { IconComponent } from '../../icons/icons.tsx'
import css from './StageWorkspacePane.module.css'

export interface StageWorkspacePaneProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
  /** Plan 阶段产物。当前 Phase 1（UI 骨架重构）暂未由 host 落盘，
   *  由 RequirementDetailPage 传 mock 数据；Phase 3 真实接入后从 requirement.artifacts 解析。 */
  taskList?: RequirementTaskList | null
  /** 点击 task 行 → 通知父组件更新当前 task。 */
  onSelectTask?: (taskId: string) => void
  /** 控制器：用于触发 task action mutation（start / accept / redo / skip）。
   *  null/undefined → 操作按钮全部 disabled（Phase 1 早期 / 测试场景）。 */
  controller?: SkyAxisController | null
}

const STAGE_ICONS: Record<RequirementStage, (p: { size?: number; className?: string }) => JSX.Element> = {
  understand: ClockIcon,
  plan: FlagIcon,
  implement: WorkflowIcon,
  verify: PlayIcon,
  deliver: PauseIcon,
}

/** 格式化 stageHistory 条目的 enteredAt/leftAt 为「YYYY-MM-DD HH:mm」。 */
function formatTime(iso: string | undefined): string {
  if (iso === undefined) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const pad = (n: number): string => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

/** Task 状态 → 圆点 className。 */
function taskDotClass(status: TaskStatus): string {
  switch (status) {
    case 'done':        return css.taskDotDone ?? ''
    case 'in_progress': return css.taskDotInProgress ?? ''
    case 'verifying':   return css.taskDotVerifying ?? ''
    case 'failed':      return css.taskDotFailed ?? ''
    case 'rolled_back': return css.taskDotRolledBack ?? ''
    case 'blocked':     return css.taskDotBlocked ?? ''
    case 'skipped':     return css.taskDotSkipped ?? ''
    case 'pending':     return ''
  }
}

/** Task 状态 → UI 标签 key。 */
function taskStatusLabelKey(status: TaskStatus): string {
  return `requirement.detail.task.status.${status}`
}

/** 判断 4 个 task action 在当前 status 下是否可点。 */
function taskActionEnabled(
  status: TaskStatus,
  action: 'start' | 'accept' | 'redo' | 'skip',
): boolean {
  switch (action) {
    case 'start':  return status === 'pending'
    case 'accept': return status === 'in_progress' || status === 'verifying' || status === 'failed'
    case 'redo':   return status === 'failed' || status === 'rolled_back' || status === 'pending'
    case 'skip':   return status === 'pending' || status === 'in_progress' || status === 'failed' || status === 'blocked'
  }
}

/* ── 子组件：task list（顶部 30%）── */

interface TaskListSectionProps {
  t: PropsLocale<'sky-axis'>['t']
  taskList: RequirementTaskList
  currentStage: RequirementStage
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
}

function TaskListSection({
  t, taskList, currentStage, selectedTaskId, onSelectTask,
}: TaskListSectionProps): JSX.Element {
  const tAny = t as unknown as (k: string) => string
  const tasks = taskList.tasks
  const doneCount = tasks.filter(t => t.status === 'done').length
  const totalCount = tasks.length
  return (
    <div className={css.taskListSection}>
      <header className={css.taskListHeader}>
        <div>
          <h3 className={css.taskListTitle}>
            {tAny('requirement.detail.taskList.title').replace('{stage}', tAny(`requirement.detail.stage.${currentStage}.label`))}
          </h3>
          <p className={css.taskListSubtitle}>
            {tAny('requirement.detail.taskList.summary')
              .replace('{done}', String(doneCount))
              .replace('{total}', String(totalCount))}
          </p>
        </div>
        <button
          type="button"
          className={css.taskListAdjustBtn}
          title={tAny('requirement.detail.taskList.adjustHint')}
          disabled
        >
          {tAny('requirement.detail.taskList.adjust')}
        </button>
      </header>
      <ul className={css.taskList}>
        {tasks.map((task) => {
          const dotClass = taskDotClass(task.status)
          const isSelected = selectedTaskId === task.id
          const rowClass = `${css.taskRow} ${isSelected ? css.taskRowSelected : ''}`
          return (
            <li key={task.id} className={rowClass}>
              <button
                type="button"
                className={css.taskRowButton}
                onClick={(): void => { onSelectTask(task.id) }}
                aria-current={isSelected ? 'true' : undefined}
              >
                <span className={`${css.taskDot} ${dotClass}`} aria-hidden="true" />
                <span className={css.taskMain}>
                  <span className={css.taskTitle}>
                    <span className={css.taskIndex}>#{task.id.slice(-2)}</span>
                    {task.title}
                  </span>
                  <span className={css.taskGoal}>{task.goal}</span>
                </span>
                {task.lastDriftScore !== undefined && task.lastDriftScore >= 0.4 && (
                  <span
                    className={css.taskDriftBadge}
                    title={tAny('requirement.detail.taskList.driftTitle')
                      .replace('{score}', task.lastDriftScore.toFixed(2))}
                  >
                    drift {task.lastDriftScore.toFixed(2)}
                  </span>
                )}
                {task.filesExpected.length > 0 && (
                  <span className={css.taskFilesBadge}>
                    {task.filesExpected.length} files
                  </span>
                )}
                <span className={css.taskStatusLabel}>
                  {tAny(taskStatusLabelKey(task.status))}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ── 子组件：current task content（底部 70%）── */

interface CurrentTaskSectionProps {
  t: PropsLocale<'sky-axis'>['t']
  task: RequirementTask | null
  stage: RequirementStage
  stageHistory: RequirementEntry['stageHistory']
  requirementId: string
  controller: SkyAxisController | null
}

function CurrentTaskSection({
  t, task, stage, stageHistory, requirementId, controller,
}: CurrentTaskSectionProps): JSX.Element {
  const tAny = t as unknown as (k: string) => string
  const Icon = STAGE_ICONS[stage]

  /** 单击 task action 按钮的统一入口。action 不在白名单时静默忽略。 */
  const handleAction = (action: 'start' | 'accept' | 'redo' | 'skip'): void => {
    if (task === null || controller === null) return
    const handle = (() => {
      switch (action) {
        case 'start':  return controller.startTask(requirementId, task.id)
        case 'accept': return controller.acceptTask(requirementId, task.id)
        case 'redo':   return controller.redoTask(requirementId, task.id)
        case 'skip':   return controller.skipTask(requirementId, task.id)
      }
    })()
    // 异常兜底：controller 已返回 UploadHandle，正常不会 reject；这里仅用于 console 提示
    handle.promise.catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(`[sky-axis] task ${action} rejected:`, e)
    })
  }

  return (
    <div className={css.currentSection}>
      {/* 阶段标题（保持原行为）*/}
      <header className={css.header}>
        <div className={css.headerIcon}>
          <Icon size={16} className={css.headerIconSvg} />
        </div>
        <div className={css.headerText}>
          <h3 className={css.title}>{tAny(`requirement.detail.stage.${stage}.label`)}</h3>
          <p className={css.subtitle}>{tAny(`requirement.detail.stage.${stage}.desc`)}</p>
        </div>
        <div className={css.headerMeta}>
          <span className={css.metaBadge}>
            {task === null
              ? tAny('requirement.detail.workspace.placeholder')
              : tAny('requirement.detail.taskList.currentBadge')
                .replace('{title}', task.title)}
          </span>
        </div>
      </header>

      {/* 当前 task 内容（有 task 时显示）/ 占位（无 task 时显示） */}
      {task !== null ? (
        <div className={css.taskContent}>
          {/* 验收清单 */}
          <div className={css.acceptanceList}>
            <h4 className={css.acceptanceTitle}>
              {tAny('requirement.detail.taskList.acceptanceTitle')}
            </h4>
            <ol className={css.acceptanceItems}>
              {task.acceptance.map((acc, idx) => (
                <li key={idx} className={css.acceptanceItem}>
                  <span className={css.acceptanceBullet} aria-hidden="true">·</span>
                  <span>{acc}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* 产物区（diff 占位）—— 待 Phase 3 接 artifact */}
          <div className={css.diffPlaceholder}>
            <div className={css.diffPlaceholderHeader}>
              <span className={css.diffPlaceholderLabel}>
                {tAny('requirement.detail.taskList.diffPlaceholder')}
              </span>
              <span className={css.diffPlaceholderHint}>
                {tAny('requirement.detail.taskList.diffPhaseHint')}
              </span>
            </div>
            <div className={css.diffPlaceholderBody}>
              {tAny('requirement.detail.taskList.diffPlaceholderDesc')}
            </div>
          </div>

          {/* 当前 task 操作按钮（PR-B：按 task.status 启用 + 接 controller） */}
          <div className={css.taskActions}>
            {task.status === 'pending' && (
              <button
                type="button"
                className={css.primaryBtn}
                disabled={controller === null}
                onClick={(): void => { handleAction('start') }}
                title={tAny('requirement.detail.taskList.actionStartHint')}
              >
                {tAny('requirement.detail.taskList.actionStart')}
              </button>
            )}
            <button
              type="button"
              className={css.primaryBtn}
              disabled={controller === null || !taskActionEnabled(task.status, 'accept')}
              onClick={(): void => { handleAction('accept') }}
              title={tAny('requirement.detail.taskList.actionAcceptHint')}
            >
              {tAny('requirement.detail.taskList.actionAccept')}
            </button>
            <button
              type="button"
              className={css.secondaryBtn}
              disabled={controller === null || !taskActionEnabled(task.status, 'redo')}
              onClick={(): void => { handleAction('redo') }}
              title={tAny('requirement.detail.taskList.actionRedoHint')}
            >
              {tAny('requirement.detail.taskList.actionRedo')}
            </button>
            <button
              type="button"
              className={css.secondaryBtn}
              disabled
              title={tAny('requirement.detail.taskList.actionRewindHint')}
            >
              {tAny('requirement.detail.taskList.actionRewind')}
            </button>
            <button
              type="button"
              className={css.secondaryBtn}
              style={{ marginLeft: 'auto' }}
              disabled={controller === null || !taskActionEnabled(task.status, 'skip')}
              onClick={(): void => { handleAction('skip') }}
              title={tAny('requirement.detail.taskList.actionSkipHint')}
            >
              {tAny('requirement.detail.taskList.actionSkip')}
            </button>
          </div>
        </div>
      ) : (
        <div className={css.stageContent}>
          <div className={css.stageHint}>
            <span className={css.stageHintIcon} aria-hidden="true">💡</span>
            <p className={css.stageHintText}>{tAny(`requirement.detail.stage.${stage}.hint`)}</p>
          </div>
          <div className={css.placeholder}>
            <span className={css.placeholderLabel}>{tAny('requirement.detail.workspace.placeholder')}</span>
            <p className={css.placeholderText}>{tAny('requirement.detail.workspace.placeholderDesc')}</p>
          </div>
        </div>
      )}

      {/* 阶段历史时间线（保留）*/}
      {stageHistory.length > 0 && (
        <section className={css.history}>
          <h4 className={css.historyTitle}>{tAny('requirement.detail.history.title')}</h4>
          <ol className={css.historyList}>
            {stageHistory.map((entry, idx) => (
              <li key={`${entry.stage}-${idx}`} className={css.historyItem}>
                <span className={`${css.historyDot} ${entry.stage === stage ? css.historyDotCurrent : ''}`} aria-hidden="true" />
                <span className={css.historyStage}>{tAny(`requirement.detail.stage.${entry.stage}.label`)}</span>
                <span className={css.historyTime}>{formatTime(entry.enteredAt)}</span>
                {entry.leftAt !== undefined && (
                  <span className={css.historyOutcome}>
                    {tAny(`requirement.detail.history.outcome.${entry.outcome ?? 'errored'}`)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

/* ── 主组件 ── */

export function StageWorkspacePane({
  t, requirement, taskList, onSelectTask, controller = null,
}: StageWorkspacePaneProps): JSX.Element {
  // 默认选中第一个未 done / rolled_back / skipped 的 task
  const initialSelected = taskList?.tasks.find((tk) =>
    tk.status !== 'done' && tk.status !== 'rolled_back' && tk.status !== 'skipped',
  )?.id ?? null
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialSelected)

  const handleSelect = (taskId: string): void => {
    setSelectedTaskId(taskId)
    onSelectTask?.(taskId)
  }

  const stage: RequirementStage = requirement.stage ?? 'understand'
  const selectedTask = taskList?.tasks.find(tk => tk.id === selectedTaskId) ?? null
  const hasTasks = taskList !== undefined && taskList !== null
  const paneClass = hasTasks ? css.pane : `${css.pane} ${css.paneNoTasks}`

  return (
    <div className={paneClass}>
      {/* 上 30%：task list（有数据时显示；否则空）*/}
      {taskList !== undefined && taskList !== null && (
        <TaskListSection
          t={t}
          taskList={taskList}
          currentStage={stage}
          selectedTaskId={selectedTaskId}
          onSelectTask={handleSelect}
        />
      )}

      {/* 下 70%：current task content（保留 stage history + 当前 stage 头部）*/}
      <CurrentTaskSection
        t={t}
        task={selectedTask}
        stage={stage}
        stageHistory={requirement.stageHistory ?? []}
        requirementId={requirement.id}
        controller={controller}
      />
    </div>
  )
}

/** 让 component 标识别名在 DevTools 友好。 */
StageWorkspacePane.displayName = 'StageWorkspacePane'

// 抑制 unused 警告（IconComponent 留作未来扩展）
void (null as unknown as IconComponent)