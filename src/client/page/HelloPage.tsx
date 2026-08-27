/**
 * Hello 完整页面 —— 在主列整页渲染。
 *
 * 视觉规范与 dsh-task-board 的 board 一致（同一套 --dsw-* 设计令
 * 牌、字体、间距、卡片样式），让 hello 页面看起来与 DSH 自带页面无
 * 缝衔接。布局：顶栏（返回按钮 + 标题 + 关闭按钮）+ 2×2 grid 4 个
 * section + 底部状态条。
 *
 * props 全部由 mount.tsx 注入（t 文案函数、list 只读订阅面、onClose
 * 回调）。locale 跟随 dsh 整体设置，本组件不持有 locale 切换逻辑。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { GreetingSection } from './sections/GreetingSection.tsx'
import { ClockSection } from './sections/ClockSection.tsx'
import { SessionSection } from './sections/SessionSection.tsx'
import { QuoteSection } from './sections/QuoteSection.tsx'
import type { SessionListReadSource } from './sections/types.ts'
import css from './HelloPage.module.css'

export interface HelloPageProps {
  /** locale 文案函数（由 sidebar shell 注入）。 */
  t: PropsLocale<'hello'>['t']
  /** 关闭页面回调 —— 让出主列回 conversation。 */
  onClose: () => void
  /** sessions.list 只读面（订阅 current session）。 */
  list: SessionListReadSource
}

/** 返回箭头 SVG —— 与 shell 内置 icon 风格一致。 */
function BackIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 3.5L5.5 8 10 12.5" />
    </svg>
  )
}

/** 整页 Hello 页面主体。 */
export function HelloPage({ t, onClose, list }: HelloPageProps): JSX.Element {
  // 与 HelloPanel 保持同一来源（t('section.clock.locale')）传递 localeTag
  // 给 QuoteSection 决定语种。
  const localeTag = t('section.clock.locale') as 'zh-CN' | 'en-US'

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

      {/* 主区 2×2 grid —— 4 个 section */}
      <main className={css.main}>
        <GreetingSection t={t} />
        <ClockSection t={t} />
        <SessionSection t={t} list={list} />
        <QuoteSection t={t} localeTag={localeTag} />
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