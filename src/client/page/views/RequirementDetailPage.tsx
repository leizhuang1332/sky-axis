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
 * Phase 1 范围：
 *   - 「AI 工作台」tab 保留原有 3 列布局 + Stepper
 *   - 「需求物料」tab 显示 MaterialsPane 占位（Phase 2.5 实现）
 *   - tab 状态完全由 controller 持有，父组件透传
 *
 * 数据来源：完全受控 props（由 SkyAxisPage 从 controller 投影传入）。
 */
import { useMemo } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  ClockIcon, FlagIcon, WorkflowIcon, PlayIcon, PauseIcon,
} from '../../icons/icons.tsx'
import type {
  DetailTabKey,
  RequirementEntry,
  RequirementOption,
  RequirementStage,
} from '../../controller/sky-axis-controller.ts'
import type { SkyAxisController } from '../../controller/sky-axis-controller.ts'
import { Stepper, type StepperItem, type StepperStageMeta } from '../../ui/Stepper.tsx'
import { countRequirementMaterials } from '../../controller/sky-axis-controller.ts'
import { AiConductorPane } from '../sections/AiConductorPane.tsx'
import { StageWorkspacePane } from '../sections/StageWorkspacePane.tsx'
import { InterventionQueuePane } from '../sections/InterventionQueuePane.tsx'
import { MaterialsPane } from '../sections/MaterialsPane.tsx'
import { allMockTaskLists, mockDriftSnapshot, pickMockTaskList, summarizeForStepper } from './requirement-detail.mock.ts'
import css from './RequirementDetailPage.module.css'

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
              />
            </aside>
            <section className={css.workspace}>
              <StageWorkspacePane
                t={t}
                requirement={requirement}
                taskList={mockTaskList}
              />
            </section>
            <aside className={css.queue}>
              <InterventionQueuePane t={t} items={requirement.interventionQueue ?? []} />
            </aside>
          </main>
        </>
      )}
    </div>
  )
}

/** 让 component 标识别名在 DevTools 友好。 */
RequirementDetailPage.displayName = 'RequirementDetailPage'

// 抑制 unused 警告（RequirementStage 留作未来扩展使用）
void (null as unknown as RequirementStage)