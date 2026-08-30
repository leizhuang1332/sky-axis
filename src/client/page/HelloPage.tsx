/**
 * Hello 完整页面 —— 在主列整页渲染「开发工作台」SPA。
 *
 * 视觉规范与 dsh-task-board 的 board 一致（同一套 --dsw-* 设计令
 * 牌、字体、间距、卡片样式），让 hello 页面看起来与 DSH 自带页面无
 * 缝衔接。
 *
 * 布局（5 视图 SPA 形态）：
 *   - 顶栏：返回按钮 + 「开发工作台」标题 + 徽章
 *   - body（flex row, gap 0）：
 *       左  HelloSidebar  内部 sidebar（5 entry + QuickActions 底部）
 *       右  viewArea      按 controller.viewKey 渲染对应视图
 *           ├── HomeView      MetricCards + ActivityStream + TeamOverview
 *           ├── TeamView      团队详情（mock）
 *           ├── PersonalView  个人页（mock）
 *           ├── ReportsView   报表 + SVG 图表（mock）
 *           └── SettingsView  设置 + 表单（mock）
 *   - 底部：footer meta + 返回会话按钮
 *
 * props 全部由 mount.tsx 注入（t 文案函数、onClose 回调、controller）。
 * controller 通过 useSyncExternalStore 订阅，viewKey 变化时整树重渲染。
 * locale 跟随 dsh 整体设置，本组件不持有 locale 切换逻辑。
 */
import { useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { HelloController, HelloViewKey } from '../controller/hello-controller.ts'
import { HelloSidebar } from './sidebar/HelloSidebar.tsx'
import { HomeView } from './views/HomeView.tsx'
import { TeamView } from './views/TeamView.tsx'
import { PersonalView } from './views/PersonalView.tsx'
import { ReportsView } from './views/ReportsView.tsx'
import { SettingsView } from './views/SettingsView.tsx'
import css from './HelloPage.module.css'

export interface HelloPageProps {
  /** locale 文案函数（由 sidebar shell 注入）。 */
  t: PropsLocale<'hello'>['t']
  /** 关闭页面回调 —— 让出主列回 conversation。 */
  onClose: () => void
  /** 控制器（pageOpen + viewKey 状态机）。 */
  controller: HelloController
}

/** 返回箭头 SVG —— 与 shell 内置 icon 风格一致。 */
function BackIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3.5L5.5 8 10 12.5" />
    </svg>
  )
}

/** 整页「开发工作台」SPA 主体。 */
export function HelloPage({ t, onClose, controller }: HelloPageProps): JSX.Element {
  // 订阅 controller —— viewKey 变化时本组件重渲染。
  const { viewKey, sidebarCollapsed } = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const onSelect = (k: HelloViewKey): void => { controller.setView(k) }
  const onToggleCollapse = (): void => { controller.toggleSidebar() }

  return (
    <div className={css.page} data-dsh-part="hello-page">
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

      {/* body —— 左侧 HelloSidebar + 右侧 viewArea */}
      <main className={css.body}>
        <HelloSidebar
          t={t}
          viewKey={viewKey}
          onSelect={onSelect}
          collapsed={sidebarCollapsed}
          onToggleCollapse={onToggleCollapse}
        />
        <div className={css.viewArea}>
          {viewKey === 'home'     && <HomeView t={t} />}
          {viewKey === 'team'     && <TeamView t={t} />}
          {viewKey === 'personal' && <PersonalView t={t} />}
          {viewKey === 'reports'  && <ReportsView t={t} />}
          {viewKey === 'settings' && <SettingsView t={t} />}
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
    </div>
  )
}
