/**
 * SkyAxis 完整页面 —— 在主列整页渲染「开发工作台」SPA。
 *
 * 视觉规范与 dsh-task-board 的 board 一致（同一套 --dsw-* 设计令
 * 牌、字体、间距、卡片样式），让 sky-axis 页面看起来与 DSH 自带页面无
 * 缝衔接。
 *
 * 布局（5 视图 SPA 形态）：
 *   - 顶栏：返回按钮 + 「开发工作台」标题 + 徽章
 *   - body（flex row, gap 0）：
 *       左  SkyAxisSidebar  内部 sidebar（5 entry + QuickActions 底部）
 *       右  viewArea      按 controller.viewKey 渲染对应视图
 *           ├── HomeView      MetricCards + ActivityStream + TeamOverview
 *           ├── TeamView      团队详情（mock）
 *           ├── PersonalView  个人页（mock）
 *           ├── RequirementsView  需求列表（host CRUD + SSE）
 *           ├── ReportsView   报表 + SVG 图表（mock）
 *           └── SettingsView  设置 + 表单（mock）
 *   - 底部：footer meta + 返回会话按钮
 *   - 顶层 modal 槽：NewRequirementModal（QuickActions 触发）
 *
 * props 全部由 mount.tsx 注入（t 文案函数、onClose 回调、controller）。
 * controller 通过 useSyncExternalStore 订阅，viewKey 变化时整树重渲染。
 * locale 跟随 dsh 整体设置，本组件不持有 locale 切换逻辑。
 */
import { useCallback, useMemo, useState } from 'react'
import { useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkyAxisController, SkyAxisViewKey } from '../controller/sky-axis-controller.ts'
import { Toast } from '../ui/Toast.tsx'
import { NewRequirementModal } from './sections/NewRequirementModal.tsx'
import { SkyAxisSidebar } from './sidebar/SkyAxisSidebar.tsx'
import { HomeView } from './views/HomeView.tsx'
import { TeamView } from './views/TeamView.tsx'
import { PersonalView } from './views/PersonalView.tsx'
import { RequirementsView } from './views/RequirementsView.tsx'
import { ReportsView } from './views/ReportsView.tsx'
import { SettingsView } from './views/SettingsView.tsx'
import { RequirementDetailPage } from './views/RequirementDetailPage.tsx'
import css from './SkyAxisPage.module.css'

export interface SkyAxisPageProps {
  /** locale 文案函数（由 sidebar shell 注入）。 */
  t: PropsLocale<'sky-axis'>['t']
  /** 关闭页面回调 —— 让出主列回 conversation。 */
  onClose: () => void
  /** 控制器（pageOpen + viewKey + requirements + workspaces 状态机）。 */
  controller: SkyAxisController
}

/** 返回箭头 SVG —— 与 shell 内置 icon 风格一致。 */
function BackIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3.5L5.5 8 10 12.5" />
    </svg>
  )
}

/** 整页「开发工作台」SPA 主体。 */
export function SkyAxisPage({ t, onClose, controller }: SkyAxisPageProps): JSX.Element {
  // 订阅 controller —— viewKey / requirements / workspaces 任一变化时整组件重渲染。
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const {
    viewKey, sidebarCollapsed, personalExpanded, requirementsListExpanded,
    requirements, workspaces, requirementsLoading, requirementsError,
    selectedRequirementId, detailLoading, detailError, detailTabKey,
  } = snapshot

  /* ── 弹窗状态（modal 是 QuickActions 触发，渲染在 page 顶层）── */
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<typeof requirementsError>(null)

  /* 0.1.2:`workspaceOps` 由 modal 通过 `useWorkspaceOps()` 自取 —— 此处不再 useState 持有。 */

  const openModal = useCallback((): void => {
    setSubmitError(null)
    setModalOpen(true)
  }, [])
  const closeModal = useCallback((): void => {
    if (submitting) return
    setModalOpen(false)
  }, [submitting])
  const handleSubmit = useCallback((input: {
    workspaceId: string
    title: string
    description: string
    priority: 'low' | 'normal' | 'high' | 'urgent'
    tags: string[]
  }): void => {
    setSubmitting(true)
    setSubmitError(null)
    void controller.createRequirement(input).then((result) => {
      setSubmitting(false)
      if (result.ok) {
        setModalOpen(false)
      } else {
        setSubmitError(result.error ?? null)
      }
    })
  }, [controller])

  /** Plan I:导入模式 submit —— modal 在 import 模式下调用,触发 controller.importRequirement。
   *  成功后跳详情页(与 create 成功后行为对齐);失败把错误暴露给 modal 顶部。 */
  const handleImport = useCallback((input: {
    workspaceId: string
  }): void => {
    setSubmitting(true)
    setSubmitError(null)
    void controller.importRequirement(input).then((result) => {
      setSubmitting(false)
      if (result.ok && result.id !== undefined) {
        // 导入成功 → 关闭 modal + 打开详情页(让用户看到刚导入的需求)
        setModalOpen(false)
        controller.openDetail(result.id)
      } else {
        setSubmitError(result.error ?? null)
      }
    })
  }, [controller])

  const handleDelete = useCallback((id: string): void => {
    void controller.deleteRequirement(id)
  }, [controller])

  // Phase 1.2：详情页路由回调
  const handleOpen = useCallback((id: string): void => {
    controller.openDetail(id)
  }, [controller])
  const handleBackFromDetail = useCallback((): void => {
    controller.closeDetail()
  }, [controller])
  // Phase 1.13：详情内 tab 切换回调
  const handleDetailTabChange = useCallback((tab: 'materials' | 'workbench'): void => {
    controller.setDetailTab(tab)
  }, [controller])

  const onSelect = (k: SkyAxisViewKey): void => { controller.setView(k) }
  const onToggleCollapse = (): void => { controller.toggleSidebar() }
  const onPersonalToggle = (): void => { controller.togglePersonalExpanded() }
  // sidebar 复合 entry「需求列表」右侧 chevron 回调 —— 与 onPersonalToggle 解耦，
  //   允许用户保留「个人展开」但收起「需求列表子菜单」（或反之）。
  const onRequirementsListToggle = (): void => { controller.toggleRequirementsListExpanded() }

  // 当前详情 requirement（从列表里找）
  const detailRequirement = selectedRequirementId !== null
    ? requirements.find(r => r.id === selectedRequirementId) ?? null
    : null

  // 1:1 不变量 UX 加速：派生 workspaceId → RequirementEntry 映射，
  //   NewRequirementModal 用它来灰显已占用 workspace。
  //   useMemo 仅在 requirements 引用变化时重算；要求 → requirements 不会高频变化。
  const takenByWorkspaceId = useMemo(() => {
    const m = new Map<string, typeof requirements[number]>()
    for (const r of requirements) {
      // 同一 workspace 理论上最多 1 条；脏数据时后写覆盖前写，UI 红框另说
      m.set(r.workspaceId, r)
    }
    return m
  }, [requirements])

  return (
    <div className={css.page} data-dsh-part="sky-axis-page">
      {/* 顶栏 —— 沿用 dsh-task-board 的 boardHeader 视觉 */}
      <header className={css.header}>
        <button
          type="button"
          className={css.backButton}
          aria-label={t('page.close')}
          title={t('page.close')}
          onClick={onClose}
        >
          <BackIcon />
          <span>{t('page.back')}</span>
        </button>
        <h1 className={css.title}>{t('page.title')}</h1>
        <div className={css.headerSpacer} />
        <span className={css.badge}>{t('page.badge')}</span>
      </header>

      {/* body —— 左侧 SkyAxisSidebar + 右侧 viewArea */}
      <main className={css.body}>
        <SkyAxisSidebar
          t={t}
          viewKey={viewKey}
          selectedRequirementId={selectedRequirementId}
          onSelect={onSelect}
          onPersonalToggle={onPersonalToggle}
          personalExpanded={personalExpanded}
          onRequirementsListToggle={onRequirementsListToggle}
          requirementsListExpanded={requirementsListExpanded}
          openRequirements={controller.getOpenRequirements()}
          onSelectRequirement={handleOpen}
          collapsed={sidebarCollapsed}
          onToggleCollapse={onToggleCollapse}
          onNewRequirement={openModal}
          hasWorkspace={workspaces.length > 0}
        />
        <div className={css.viewArea}>
          {/* Phase 1.2：详情页路由 —— 顶层短路渲染。
             *  与 viewKey 独立：详情打开不影响 viewKey，回到列表仍是当前 viewKey。
             *  detailRequirement 缺失（被并发删除 / 列表还没拉到）时降级空态。 */}
          {selectedRequirementId !== null ? (
            detailRequirement !== null ? (
              <RequirementDetailPage
                t={t}
                requirement={detailRequirement}
                workspaces={workspaces}
                detailLoading={detailLoading}
                detailError={detailError}
                detailTabKey={detailTabKey}
                controller={controller}
                onBack={handleBackFromDetail}
                onTabChange={handleDetailTabChange}
              />
            ) : (
              <div className={css.view}>
                <header className={css.viewHeader}>
                  <h2 className={css.viewTitle}>{t('requirement.detail.title')}</h2>
                  <p className={css.viewSubtitle}>{t('requirement.detail.notFound')}</p>
                </header>
                <button
                  type="button"
                  className={css.viewPrimaryButton}
                  onClick={handleBackFromDetail}
                >
                  {t('requirement.detail.back')}
                </button>
              </div>
            )
          ) : (
            <>
              {viewKey === 'home'     && (
                <HomeView t={t} />
              )}
              {viewKey === 'team'     && <TeamView t={t} />}
              {viewKey === 'personal' && <PersonalView t={t} />}
              {viewKey === 'requirements' && (
                <RequirementsView
                  t={t}
                  requirements={requirements}
                  workspaces={workspaces}
                  loading={requirementsLoading}
                  error={requirementsError}
                  onDelete={handleDelete}
                  onNewRequirement={openModal}
                  hasWorkspace={workspaces.length > 0}
                  onOpen={handleOpen}
                />
              )}
              {viewKey === 'reports'  && <ReportsView t={t} />}
              {viewKey === 'settings' && <SettingsView t={t} />}
            </>
          )}
        </div>
      </main>

      {/* 底部状态条 —— 与 shell 视觉融合 */}
      <footer className={css.footer}>
        <span className={css.footerMeta}>{t('page.footerMeta')}</span>
        <button
          type="button"
          className={css.closeButton}
          onClick={onClose}
        >
          {t('page.close')}
        </button>
      </footer>

      {/* 「新建需求」弹窗 —— 顶层渲染,遮罩覆盖整个 page。
          0.1.2:`workspaceOps` 由 modal 内部通过 `useWorkspaceOps()` hook 自取,
          不再由父组件透传 prop。 */}
      {modalOpen && (
        <NewRequirementModal
          t={t}
          workspaces={workspaces}
          takenByWorkspaceId={takenByWorkspaceId}
          submitError={submitError}
          submitting={submitting}
          onSubmit={handleSubmit}
          onImport={handleImport}
          onClose={closeModal}
        />
      )}

      {/* Phase 1.2：Toast 全局错误提示（订阅 controller.requirementsError / detailError） */}
      <Toast controller={controller} t={t as unknown as (k: string) => string} />
    </div>
  )
}
