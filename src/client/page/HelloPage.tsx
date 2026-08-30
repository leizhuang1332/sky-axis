/**
 * Hello 完整页面 —— 在主列整页渲染「开发工作台」仪表板。
 *
 * 视觉规范与 dsh-task-board 的 board 一致（同一套 --dsw-* 设计令
 * 牌、字体、间距、卡片样式），让 hello 页面看起来与 DSH 自带页面无
 * 缝衔接。
 *
 * 布局：
 *   - 顶栏：返回按钮 + 「开发工作台」标题 + 徽章
 *   - 主区（flex column, gap 12）：
 *       1) MetricCards     顶部 4 个指标卡（4 列 → 2×2 响应式）
 *       2) ActivityStream  左侧「我的动态流」  ┐
 *          TeamOverview    右侧「团队概览」    ┘  2 列 → 1 列响应式
 *       3) QuickActions    底部 3 个 mock 按钮
 *   - 底部：footer meta + 返回会话按钮
 *
 * props 全部由 mount.tsx 注入（t 文案函数、onClose 回调）。
 * locale 跟随 dsh 整体设置，本组件不持有 locale 切换逻辑。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { MetricCards } from './sections/MetricCards.tsx'
import { ActivityStream } from './sections/ActivityStream.tsx'
import { TeamOverview } from './sections/TeamOverview.tsx'
import { QuickActions } from './sections/QuickActions.tsx'
import css from './HelloPage.module.css'

export interface HelloPageProps {
  /** locale 文案函数（由 sidebar shell 注入）。 */
  t: PropsLocale<'hello'>['t']
  /** 关闭页面回调 —— 让出主列回 conversation。 */
  onClose: () => void
}

/** 返回箭头 SVG —— 与 shell 内置 icon 风格一致。 */
function BackIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3.5L5.5 8 10 12.5" />
    </svg>
  )
}

/** 整页「开发工作台」主体。 */
export function HelloPage({ t, onClose }: HelloPageProps): JSX.Element {
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

      {/* 主区 —— flex column 装 4 个 section */}
      <main className={css.main}>
        <MetricCards t={t} />
        <div className={css.dashboardGrid}>
          <ActivityStream t={t} />
          <TeamOverview t={t} />
        </div>
        <QuickActions t={t} />
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
