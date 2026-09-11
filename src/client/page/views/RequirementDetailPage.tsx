/**
 * RequirementDetailPage —— 需求详情页（开发意图工作台核心载体）。
 *
 * Phase 1.13 增量：拆出 tab 路由
 *   - 顶栏：← 返回 + 标题 + status/priority pill + workspace + branch
 *   - tab header：需求物料 / AI 工作台 两个 tab
 *   - tab body：按 detailTabKey 分支渲染
 *       - 'materials'  → <MaterialsPane>     （需求物料占位）
 *       - 'workbench'  → <Stepper + 三列布局> （AI 工作台）
 *
 * 布局（grid 4 行：顶栏 / error / tab header / body）：
 *   - 顶栏：标题 + meta（所有 tab 共用）
 *   - tab header：tab 切换器
 *   - body：按当前 tab 渲染
 *
 * PR-C 迭代 4 + 5：
 *   - 新增 rewind drawer state（trigger / taskId）
 *   - 条件渲染 RightDrawer + RewindDrawer
 *   - 把 drawer state 通过 callbacks 透传给 AiConductorPane + StageWorkspacePane
 *   - Drift rerun callback：调 controller.rerunDriftDetection（mock 兜底，无 impl）
 *
 * PR-D 迭代 6（5 个介入点 UI 化）：
 *   - 4 个 modal/drawer：AdjustTaskListDrawer (#1) / InterventionRespondDrawer (#3) /
 *     FailedTaskResolveModal (#4) / StageGateModal (#5)
 *   - 1 个 Sticky bar：SteerBar (#2) — 详情页底部（workbench tab 时显示）
 *   - 状态全部在 RequirementDetailPage 集中管理（与 PR-C rewind drawer 一致）
 *
 * 数据来源：完全受控 props（由 SkyAxisPage 从 controller 投影传入）。
 */
import { useCallback, useMemo, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  ClockIcon, FlagIcon, WorkflowIcon, PlayIcon, PauseIcon, EyeIcon,
} from '../../icons/icons.tsx'
import type {
  AdjustTaskListPatch,
  DetailTabKey,
  FailedTaskResolveDecision,
  RequirementEntry,
  RequirementOption,
  RequirementStage,
  RequirementTask,
} from '../../controller/sky-axis-controller.ts'
import type {
  SkyAxisController,
  RewindRequest,
} from '../../controller/sky-axis-controller.ts'
import { Stepper, type StepperItem, type StepperStageMeta } from '../../ui/Stepper.tsx'
import { countRequirementMaterials } from '../../controller/sky-axis-controller.ts'
import { AiConductorPane } from '../sections/AiConductorPane.tsx'
import { StageWorkspacePane } from '../sections/StageWorkspacePane.tsx'
import { InterventionQueuePane } from '../sections/InterventionQueuePane.tsx'
import { MaterialsPane } from '../sections/MaterialsPane.tsx'
import { RightDrawer } from '../../ui/RightDrawer.tsx'
import { RewindDrawer } from '../sections/RewindDrawer.tsx'
import { AdjustTaskListDrawer } from '../sections/AdjustTaskListDrawer.tsx'
import { InterventionRespondDrawer } from '../sections/InterventionRespondDrawer.tsx'
import { FailedTaskResolveModal } from '../sections/FailedTaskResolveModal.tsx'
import { StageGateModal, type StageGateSummary } from '../sections/StageGateModal.tsx'
import { SteerBar, type SteerSendRecord } from '../sections/SteerBar.tsx'
import { AuditTimelineModal } from '../sections/AuditTimelineModal.tsx'
import { Modal } from '../../ui/Modal.tsx'
import { allMockTaskLists, mockDriftSnapshot, pickMockTaskList, summarizeForStepper } from './requirement-detail.mock.ts'
import css from './RequirementDetailPage.module.css'

/** PR-D 迭代 6 #5：阶段推进顺序（用于 StageGate 计算 toStage）。 */
const STAGE_ORDER_FOR_ADVANCE: readonly RequirementStage[] = [
  'understand', 'plan', 'implement', 'verify', 'deliver',
] as const

export interface RequirementDetailPageProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
  workspaces: readonly RequirementOption[]
  detailLoading: boolean
  detailError: { code: string; detail?: string } | null
  detailTabKey: DetailTabKey
  controller: SkyAxisController
  onBack: () => void
  onTabChange: (tab: DetailTabKey) => void
}

export function RequirementDetailPage({
  t, requirement, workspaces, detailLoading, detailError,
  detailTabKey, controller, onBack, onTabChange,
}: RequirementDetailPageProps): JSX.Element {
  // t 强转为 (k: string) => string —— 模板字符串是动态 key
  const tAny = t as unknown as (k: string) => string
  const workspace = useMemo(
    () => workspaces.find(w => w.id === requirement.workspaceId),
    [workspaces, requirement.workspaceId],
  )

  /* ── PR-C：rewind drawer state + callbacks ── */
  type DrawerTrigger = 'stage-go-back' | 'task-rewind'
  const [rewindDrawer, setRewindDrawer] = useState<{
    open: boolean
    trigger: DrawerTrigger | null
    taskId: string | null
  }>({ open: false, trigger: null, taskId: null })
  const [rewindSubmitting, setRewindSubmitting] = useState<boolean>(false)
  const [driftLoading, setDriftLoading] = useState<boolean>(false)
  // 接入 0-1：AI session 启动中（POST /ai/start 进行中）—— 启动按钮 loading + 禁用。
  const [aiStarting, setAiStarting] = useState<boolean>(false)

  /* ── PR-D：4 个 modal/drawer 状态 + 1 个 sticky bar 状态 ── */
  const [adjustDrawerOpen, setAdjustDrawerOpen] = useState<boolean>(false)
  const [adjustSubmitting, setAdjustSubmitting] = useState<boolean>(false)

  const [respondDrawer, setRespondDrawer] = useState<{
    open: boolean
    rpcId: string | null
  }>({ open: false, rpcId: null })
  const [respondSubmitting, setRespondSubmitting] = useState<boolean>(false)

  const [failedTaskModal, setFailedTaskModal] = useState<{
    open: boolean
    taskId: string | null
    taskTitle: string
    failedCount: number
  }>({ open: false, taskId: null, taskTitle: '', failedCount: 0 })
  const [failedTaskSubmitting, setFailedTaskSubmitting] = useState<boolean>(false)

  const [stageGateModal, setStageGateModal] = useState<{
    open: boolean
    toStage: RequirementStage | null
    summary: StageGateSummary | null
  }>({ open: false, toStage: null, summary: null })
  const [stageGateSubmitting, setStageGateSubmitting] = useState<boolean>(false)

  const [steerText, setSteerText] = useState<string>('')
  const [steerSubmitting, setSteerSubmitting] = useState<boolean>(false)
  const [steerRecent, setSteerRecent] = useState<readonly SteerSendRecord[]>([])

  /* ── PR-E 迭代 7：审计时间线 modal 状态 ── */
  const [auditOpen, setAuditOpen] = useState<boolean>(false)

  const handleOpenRewindStage = useCallback((_trigger: 'stage-go-back') => {
    setRewindDrawer({ open: true, trigger: 'stage-go-back', taskId: null })
  }, [])
  const handleOpenRewindTask = useCallback((taskId: string) => {
    setRewindDrawer({ open: true, trigger: 'task-rewind', taskId })
  }, [])
  const handleCloseRewind = useCallback(() => {
    if (rewindSubmitting) return
    setRewindDrawer({ open: false, trigger: null, taskId: null })
  }, [rewindSubmitting])
  const handleSubmitRewind = useCallback((request: RewindRequest) => {
    setRewindSubmitting(true)
    const handle = controller.rewind(requirement.id, request)
    handle.promise.then((result) => {
      setRewindSubmitting(false)
      if (result.ok) {
        setRewindDrawer({ open: false, trigger: null, taskId: null })
      }
      // 失败：保留 drawer 让用户看到 error；detail 由 toast 触发（Phase 2）
    }).catch(() => {
      setRewindSubmitting(false)
    })
  }, [controller, requirement.id])
  const handleRerunDrift = useCallback(() => {
    setDriftLoading(true)
    const handle = controller.rerunDriftDetection(requirement.id, 'all')
    handle.promise.finally(() => {
      setDriftLoading(false)
    })
  }, [controller, requirement.id])

  // 接入 0-1：启动 AI session —— controller.startAi 返回 {ok, error?}（非 UploadHandle）。
  //   成功时 SSE put 帧会回流更新 aiState/aiSessionId（controller 已乐观更新 snapshot）；
  //   失败时 aiState 保持 idle，error 经 snapshot.requirementsError 暴露（parent toast）。
  //   aiStarting 仅控制按钮 loading 视觉；HTTP 完成即 false（不等 follow 流）。
  const handleStartAi = useCallback(() => {
    setAiStarting(true)
    controller.startAi(requirement.id).then((result) => {
      setAiStarting(false)
      // 成功：aiState 已被 controller 乐观更新为 running；follow 流会持续驱动。
      // 失败：controller 已写 requirementsError；UI 可经 parent toast 展示（Phase 2）。
      void result
    }).catch(() => {
      setAiStarting(false)
    })
  }, [controller, requirement.id])

  /* ── PR-D：#1 AdjustTaskListDrawer 回调 ── */
  const handleOpenAdjustTaskList = useCallback(() => {
    setAdjustDrawerOpen(true)
  }, [])
  const handleCloseAdjustTaskList = useCallback(() => {
    if (adjustSubmitting) return
    setAdjustDrawerOpen(false)
  }, [adjustSubmitting])
  const handleSubmitAdjustTaskList = useCallback((patch: AdjustTaskListPatch) => {
    setAdjustSubmitting(true)
    const handle = controller.adjustTaskList(requirement.id, patch)
    handle.promise.then((result) => {
      setAdjustSubmitting(false)
      if (result.ok) {
        setAdjustDrawerOpen(false)
      }
    }).catch(() => {
      setAdjustSubmitting(false)
    })
  }, [controller, requirement.id])

  /* ── PR-D：#3 InterventionRespondDrawer 回调 ── */
  const handleOpenRespond = useCallback((rpcId: string) => {
    setRespondDrawer({ open: true, rpcId })
  }, [])
  const handleCloseRespond = useCallback(() => {
    if (respondSubmitting) return
    setRespondDrawer({ open: false, rpcId: null })
  }, [respondSubmitting])
  const handleSubmitRespond = useCallback((answer: unknown) => {
    if (respondDrawer.rpcId === null) return
    setRespondSubmitting(true)
    const rpcId = respondDrawer.rpcId
    const handle = controller.respondIntervention(requirement.id, rpcId, answer)
    handle.promise.then((result) => {
      setRespondSubmitting(false)
      if (result.ok) {
        setRespondDrawer({ open: false, rpcId: null })
      }
    }).catch(() => {
      setRespondSubmitting(false)
    })
  }, [controller, requirement.id, respondDrawer.rpcId])

  /* ── PR-D：#4 FailedTaskResolveModal 回调 ── */
  // 注入测试入口（phase 1 演示）—— 调用方可以从 console 触发：
  //   window.__sky_axis.openFailedTask('T-implement-002', '权限中间件', 3)
  // Phase 3：改为 SSE 推 'taskFailed' 事件自动触发。
  ;(globalThis as unknown as { __sky_axis?: {
    openFailedTask: (taskId: string, title: string, n: number) => void
  } }).__sky_axis = {
    openFailedTask: (taskId: string, title: string, n: number) => {
      setFailedTaskModal({ open: true, taskId, taskTitle: title, failedCount: n })
    },
  }
  const handleCloseFailedTask = useCallback(() => {
    if (failedTaskSubmitting) return
    setFailedTaskModal({ open: false, taskId: null, taskTitle: '', failedCount: 0 })
  }, [failedTaskSubmitting])
  const handleSubmitFailedTask = useCallback((decision: FailedTaskResolveDecision, _reason: string) => {
    if (failedTaskModal.taskId === null) return
    const taskId = failedTaskModal.taskId
    setFailedTaskSubmitting(true)
    const handle = controller.resolveFailedTask(requirement.id, taskId, decision)
    handle.promise.then((result) => {
      setFailedTaskSubmitting(false)
      if (result.ok) {
        setFailedTaskModal({ open: false, taskId: null, taskTitle: '', failedCount: 0 })
      }
    }).catch(() => {
      setFailedTaskSubmitting(false)
    })
  }, [controller, requirement.id, failedTaskModal.taskId])

  /* ── PR-D：#5 StageGateModal 回调 ── */
  const handleOpenStageGate = useCallback(() => {
    const current = requirement.stage ?? 'understand'
    const idx = STAGE_ORDER_FOR_ADVANCE.indexOf(current)
    const toStage = idx >= 0 && idx < STAGE_ORDER_FOR_ADVANCE.length - 1
      ? STAGE_ORDER_FOR_ADVANCE[idx + 1] ?? null
      : null
    if (toStage === null) return
    // 汇总下阶段 task + drift + rewind 计数（mock 兜底）
    const taskList = pickMockTaskList(toStage)
    const taskTotal = taskList?.tasks.length ?? 0
    const taskDone = taskList?.tasks.filter(t => t.status === 'done').length ?? 0
    const driftSnap = mockDriftSnapshot(toStage)
    const rewindCount = (requirement.stageHistory ?? [])
      .filter(he => he.outcome === 'rolled-back').length
      + (taskList?.tasks.filter(t => t.subHistory.some(sh => sh.outcome === 'rolled-back')).length ?? 0)
    const summary: StageGateSummary = {
      taskTotal,
      taskDone,
      driftOverall: driftSnap?.overall ?? null,
      rewindCount,
    }
    setStageGateModal({ open: true, toStage, summary })
  }, [requirement.stage, requirement.stageHistory])
  const handleAdvanceStage = useCallback(() => {
    if (stageGateModal.toStage === null) return
    const toStage = stageGateModal.toStage
    setStageGateSubmitting(true)
    const handle = controller.advanceStage(requirement.id, toStage)
    handle.promise.then((result) => {
      setStageGateSubmitting(false)
      if (result.ok) {
        setStageGateModal({ open: false, toStage: null, summary: null })
      }
    }).catch(() => {
      setStageGateSubmitting(false)
    })
  }, [controller, requirement.id, stageGateModal.toStage])
  const handleStayStage = useCallback(() => {
    setStageGateModal({ open: false, toStage: null, summary: null })
  }, [])

  /* ── PR-D：#2 SteerBar 回调 ── */
  const handleSteerSend = useCallback((text: string) => {
    setSteerSubmitting(true)
    const handle = controller.steerSession(requirement.id, text)
    handle.promise.then((result) => {
      setSteerSubmitting(false)
      if (result.ok) {
        setSteerText('')
        setSteerRecent(prev => [{ sentAt: new Date().toISOString(), text }, ...prev].slice(0, 3))
      }
    }).catch(() => {
      setSteerSubmitting(false)
    })
  }, [controller, requirement.id])

  /* ── PR-D：派生：当前正在应答的 InterventionItem（respondDrawer.rpcId 找出来）── */
  const respondingItem = useMemo(() => {
    if (!respondDrawer.open || respondDrawer.rpcId === null) return null
    return (requirement.interventionQueue ?? []).find(it => it.rpcId === respondDrawer.rpcId) ?? null
  }, [respondDrawer.open, respondDrawer.rpcId, requirement.interventionQueue])

  // Stepper 配置：每个节点的 icon + label + desc
  const stepperItems: StepperItem[] = useMemo(() => ([
    { stage: 'understand', Icon: ClockIcon,    label: t('requirement.detail.stage.understand.label'), desc: t('requirement.detail.stage.understand.desc') },
    { stage: 'plan',       Icon: FlagIcon,     label: t('requirement.detail.stage.plan.label'),       desc: t('requirement.detail.stage.plan.desc') },
    { stage: 'implement',  Icon: WorkflowIcon, label: t('requirement.detail.stage.implement.label'),  desc: t('requirement.detail.stage.implement.desc') },
    { stage: 'verify',     Icon: PlayIcon,     label: t('requirement.detail.stage.verify.label'),     desc: t('requirement.detail.stage.verify.desc') },
    { stage: 'deliver',    Icon: PauseIcon,    label: t('requirement.detail.stage.deliver.label'),    desc: t('requirement.detail.stage.deliver.desc') },
  ]), [t])

  // Phase 1.0 mock：当前 stage 的 task list（驱动中列上下分 30/70 的 task list 区）。
  // Phase 3 接 artifact 系统后改为 controller 投影。固定传同一份 mock 以保证 demo 稳定。
  const mockTaskList = useMemo(() => {
    void allMockTaskLists // 防止 lint 误报「导入但未使用」
    return pickMockTaskList(requirement.stage ?? 'understand')
  }, [requirement.stage])

  // Stepper stageMeta：每个 stage 节点下挂 taskProgress + rewind dots。
  // Phase 1 没有真实数据，演示时从 mock 数据汇总；空 stage（verify/deliver）跳过即可（Stepper 行为）。
  const stageMeta = useMemo<Partial<Record<RequirementStage, StepperStageMeta>>>(() => {
    const lists = allMockTaskLists()
    const map: Partial<Record<RequirementStage, StepperStageMeta>> = {}
    for (const [stage, list] of Object.entries(lists) as [RequirementStage, ReturnType<typeof pickMockTaskList>][]) {
      const summary = summarizeForStepper(list)
      if (summary.taskTotal === 0 && summary.rewindCount === 0 && summary.rolledBackCount === 0) continue
      map[stage] = {
        taskDone: summary.taskDone,
        taskTotal: summary.taskTotal,
        rewindCount: summary.rewindCount,
        rolledBackCount: summary.rolledBackCount,
      }
    }
    return map
  }, [])

  // Drift 快照 mock —— 当前 stage 的 drift。Phase 3 接真实检测器。
  const mockDrift = useMemo(
    () => mockDriftSnapshot(requirement.stage ?? 'understand'),
    [requirement.stage],
  )

  return (
    <div className={css.page}>
      {/* 顶栏 */}
      <header className={css.header}>
        <button
          type="button"
          className={css.backButton}
          onClick={onBack}
          aria-label={t('requirement.detail.back')}
        >
          <span aria-hidden="true">←</span>
          <span>{t('requirement.detail.back')}</span>
        </button>
        <div className={css.headerMain}>
          <div className={css.headerTitleRow}>
            <h1 className={css.title}>{requirement.title}</h1>
            <span className={`${css.statusPill} ${css[`statusPill_${requirement.status}` as 'statusPill_open']}`}>
              {t(`requirement.status.${requirement.status}`)}
            </span>
            <span className={`${css.priority} ${css[`priority_${requirement.priority}` as 'priority_normal']}`}>
              {t(`requirement.priority.${requirement.priority}`)}
            </span>
            {/* PR-E 迭代 7：审计时间线入口按钮 */}
            <button
              type="button"
              className={css.auditButton}
              onClick={(): void => { setAuditOpen(true) }}
              title={t('requirement.detail.audit.buttonHint')}
              aria-label={t('requirement.detail.audit.buttonLabel')}
            >
              <EyeIcon size={14} className={css.auditButtonIcon} />
            </button>
          </div>
          <div className={css.headerMeta}>
            <span className={css.metaItem}>
              <span className={css.metaLabel}>{t('requirement.detail.meta.workspace')}</span>
              <span className={css.metaValue}>{workspace?.title ?? t('requirement.detail.meta.workspaceRemoved')}</span>
            </span>
            {requirement.branch !== null && requirement.branch !== undefined && (
              <span className={css.metaItem}>
                <span className={css.metaLabel}>{t('requirement.detail.meta.branch')}</span>
                <span className={css.metaValue}>{requirement.branch}</span>
              </span>
            )}
            <span className={css.metaItem}>
              <span className={css.metaLabel}>{t('requirement.detail.meta.id')}</span>
              <span className={css.metaValueMono}>#{requirement.id.slice(0, 12)}</span>
            </span>
          </div>
        </div>
      </header>

      {/* 错误条（如有） */}
      {detailError !== null && (
        <div className={css.errorBar}>
          <strong>{t('requirement.detail.errorPrefix')}</strong>
          <span>{tAny(`requirement.error.${detailError.code}`)}</span>
          {detailError.detail !== undefined && <code>{detailError.detail}</code>}
        </div>
      )}

      {/* Tab Header —— Phase 1.13 新增；Phase 2.1 徽标改显示物料总数 */}
      <nav className={css.tabHeader} aria-label={t('requirement.detail.tabHeader.ariaLabel')}>
        <button
          type="button"
          role="tab"
          aria-selected={detailTabKey === 'materials'}
          className={`${css.tabButton} ${detailTabKey === 'materials' ? css.tabButtonActive : ''}`}
          onClick={(): void => { onTabChange('materials') }}
        >
          <span>{t('requirement.detail.tabHeader.materials')}</span>
          <span className={css.tabBadge}>{countRequirementMaterials(requirement.materials)}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={detailTabKey === 'workbench'}
          className={`${css.tabButton} ${detailTabKey === 'workbench' ? css.tabButtonActive : ''}`}
          onClick={(): void => { onTabChange('workbench') }}
        >
          <span>{t('requirement.detail.tabHeader.workbench')}</span>
        </button>
      </nav>

      {/* Tab Body —— 按 detailTabKey 分支渲染 */}
      {detailTabKey === 'materials' ? (
        <main className={css.tabBody}>
          <MaterialsPane t={t} requirement={requirement} controller={controller} />
        </main>
      ) : (
        <>
          {/* Stepper —— AI 工作台专属 */}
          <Stepper
            items={stepperItems}
            current={requirement.stage ?? 'understand'}
            stageMeta={stageMeta}
          />

          {/* 主体三列 */}
          <main className={css.body}>
            <aside className={css.conductor}>
              <AiConductorPane
                t={t}
                requirement={requirement}
                loading={detailLoading}
                driftSnapshot={mockDrift}
                onOpenRewind={handleOpenRewindStage}
                onRerunDrrift={handleRerunDrift}
                driftLoading={driftLoading}
                onAdvanceStage={handleOpenStageGate}
                onStartAi={handleStartAi}
                aiStarting={aiStarting}
              />
            </aside>
            <section className={css.workspace}>
              <StageWorkspacePane
                t={t}
                requirement={requirement}
                taskList={mockTaskList}
                controller={controller}
                onOpenRewind={handleOpenRewindTask}
                onOpenAdjustTaskList={handleOpenAdjustTaskList}
              />
            </section>
            <aside className={css.queue}>
              <InterventionQueuePane
                t={t}
                items={requirement.interventionQueue ?? []}
                onRespond={handleOpenRespond}
              />
            </aside>

            {/* PR-D 迭代 6 #2：底部 Sticky SteerBar —— 仅 workbench tab 显示 */}
            <SteerBar
              t={t}
              text={steerText}
              onChange={setSteerText}
              onSend={handleSteerSend}
              submitting={steerSubmitting}
              recentSends={steerRecent}
              disabled={detailLoading}
            />
          </main>
        </>
      )}

      {/* PR-C 迭代 4：rewind RightDrawer —— 条件渲染 */}
      {rewindDrawer.open && rewindDrawer.trigger !== null && (
        <RightDrawer
          title={t('requirement.detail.rewind.title')}
          onClose={handleCloseRewind}
          loading={rewindSubmitting}
        >
          <RewindDrawer
            t={t}
            currentStage={requirement.stage ?? 'understand'}
            trigger={rewindDrawer.trigger}
            preselectedTaskId={rewindDrawer.taskId ?? undefined}
            availableTasks={mockTaskList?.tasks.map((tk) => ({ id: tk.id, title: tk.title, status: tk.status }))}
            onSubmit={handleSubmitRewind}
            onCancel={handleCloseRewind}
            submitting={rewindSubmitting}
          />
        </RightDrawer>
      )}

      {/* PR-D 迭代 6 #1：AdjustTaskListDrawer —— 条件渲染 */}
      {adjustDrawerOpen && mockTaskList !== null && (
        <RightDrawer
          title={t('requirement.detail.adjustTaskList.title')}
          onClose={handleCloseAdjustTaskList}
          loading={adjustSubmitting}
        >
          <AdjustTaskListDrawer
            t={t}
            currentStage={requirement.stage ?? 'understand'}
            taskList={mockTaskList}
            onSubmit={handleSubmitAdjustTaskList}
            onCancel={handleCloseAdjustTaskList}
            submitting={adjustSubmitting}
          />
        </RightDrawer>
      )}

      {/* PR-D 迭代 6 #3：InterventionRespondDrawer —— 条件渲染 */}
      {respondDrawer.open && respondDrawer.rpcId !== null && respondingItem !== null && (
        <RightDrawer
          title={t('requirement.detail.queue.respond.title')}
          onClose={handleCloseRespond}
          loading={respondSubmitting}
        >
          <InterventionRespondDrawer
            t={t}
            item={respondingItem}
            onSubmit={handleSubmitRespond}
            onCancel={handleCloseRespond}
            submitting={respondSubmitting}
          />
        </RightDrawer>
      )}

      {/* PR-D 迭代 6 #4：FailedTaskResolveModal —— 居中 Modal 条件渲染 */}
      {failedTaskModal.open && failedTaskModal.taskId !== null && (
        <Modal
          title={t('requirement.detail.failedTask.title')}
          onClose={handleCloseFailedTask}
        >
          <FailedTaskResolveModal
            t={t}
            taskTitle={failedTaskModal.taskTitle}
            failedCount={failedTaskModal.failedCount}
            onSubmit={handleSubmitFailedTask}
            onCancel={handleCloseFailedTask}
            submitting={failedTaskSubmitting}
          />
        </Modal>
      )}

      {/* PR-D 迭代 6 #5：StageGateModal —— 居中 Modal 条件渲染 */}
      {stageGateModal.open && stageGateModal.toStage !== null && stageGateModal.summary !== null && (
        <Modal
          title={t('requirement.detail.stageGate.title')}
          onClose={handleStayStage}
        >
          <StageGateModal
            t={t}
            fromStage={requirement.stage ?? 'understand'}
            toStage={stageGateModal.toStage}
            summary={stageGateModal.summary}
            onAdvance={handleAdvanceStage}
            onStay={handleStayStage}
            submitting={stageGateSubmitting}
          />
        </Modal>
      )}

      {/* PR-E 迭代 7：审计时间线 modal —— 居中 Modal 条件渲染 */}
      {auditOpen && (
        <Modal
          title={t('requirement.detail.audit.title')}
          onClose={(): void => { setAuditOpen(false) }}
          maxWidth={720}
        >
          <AuditTimelineModal
            t={t}
            requirement={requirement}
            taskList={mockTaskList}
            onClose={(): void => { setAuditOpen(false) }}
          />
        </Modal>
      )}
    </div>
  )
}

/** 让 component 标识别名在 DevTools 友好。 */
RequirementDetailPage.displayName = 'RequirementDetailPage'

// 抑制 unused 警告（RequirementStage 留作未来扩展使用）
void (null as unknown as RequirementStage)