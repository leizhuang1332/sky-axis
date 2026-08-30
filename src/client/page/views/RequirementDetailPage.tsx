/**
 * RequirementDetailPage —— 需求详情页（开发意图工作台核心载体）。
 *
 * 布局（grid 4 行：顶栏 / stepper / body / 产物）：
 *   - 顶栏：← 返回 + 标题 + status/priority pill + workspace + branch
 *   - stepper：5 阶段横向流水线
 *   - body（25 / 50 / 25 三列）：
 *       左  AiConductorPane   AI 协奏
 *       中  StageWorkspacePane  当前阶段工作区
 *       右  InterventionQueue    介入队列
 *   - 底部产物面板（可折叠）—— Phase 1 暂空，Phase 4 实现
 *
 * Phase 1 范围：
 *   - 顶栏 + stepper + 三列布局到位
 *   - AI 状态全 mock（AiConductorPane 显示「启动 AI」按钮，点击无操作）
 *   - 介入队列 Phase 1 显示「空」
 *   - 当前 stage 内容按 stage label/desc 渲染不同文案
 *
 * 数据来源：完全受控 props（由 SkyAxisPage 从 controller 投影传入）。
 */
import { useMemo } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  ClockIcon, FlagIcon, WorkflowIcon, PlayIcon, PauseIcon, StopIcon,
  WarningTriangleIcon,
} from '../../icons/icons.tsx'
import type {
  RequirementEntry,
  RequirementStage,
} from '../../controller/sky-axis-controller.ts'
import type { RequirementOption } from '../../controller/sky-axis-controller.ts'
import { Stepper, type StepperItem } from '../../ui/Stepper.tsx'
import { AiConductorPane } from '../sections/AiConductorPane.tsx'
import { StageWorkspacePane } from '../sections/StageWorkspacePane.tsx'
import { InterventionQueuePane } from '../sections/InterventionQueuePane.tsx'
import css from './RequirementDetailPage.module.css'

export interface RequirementDetailPageProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
  workspaces: readonly RequirementOption[]
  detailLoading: boolean
  detailError: { code: string; detail?: string } | null
  onBack: () => void
}

const STAGE_ICONS: Record<RequirementStage, (p: { size?: number; className?: string }) => JSX.Element> = {
  understand: ClockIcon,
  plan: FlagIcon,
  implement: WorkflowIcon,
  verify: PlayIcon,
  deliver: PauseIcon,
}

export function RequirementDetailPage({
  t, requirement, workspaces, detailLoading, detailError, onBack,
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

      {/* Stepper */}
      <Stepper
        items={stepperItems}
        current={requirement.stage ?? 'understand'}
      />

      {/* 主体三列 */}
      <main className={css.body}>
        <aside className={css.conductor}>
          <AiConductorPane
            t={t}
            requirement={requirement}
            loading={detailLoading}
          />
        </aside>
        <section className={css.workspace}>
          <StageWorkspacePane
            t={t}
            requirement={requirement}
          />
        </section>
        <aside className={css.queue}>
          <InterventionQueuePane t={t} items={requirement.interventionQueue ?? []} />
        </aside>
      </main>
    </div>
  )
}

/** 让 component 标识别名在 DevTools 友好。 */
RequirementDetailPage.displayName = 'RequirementDetailPage'

// 抑制 unused 警告（WarningTriangleIcon 留作 Phase 1.9 替换 icon 用）
void WarningTriangleIcon
void STAGE_ICONS