/**
 * Hello 完整页面 —— 在主列整页渲染。
 *
 * 布局：hero header（左侧大字 hero + 右侧 close 按钮）+ 2×2 grid 的 4 个
 * section（greeting / clock / session / quote）。沿用 HelloPanel 的 4 个
 * widget，但去掉弹窗遮罩、把滚动容器换成整页 main 区。
 *
 * props 全部由 mount.tsx 注入（t 文案函数、list 只读订阅面、onClose
 * 回调）。locale 跟随 dsh 整体设置，本组件不持有 locale 切换逻辑。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { GreetingSection } from './widgets/GreetingSection.tsx'
import { ClockSection } from './widgets/ClockSection.tsx'
import { SessionSection } from './widgets/SessionSection.tsx'
import { QuoteSection } from './widgets/QuoteSection.tsx'
import type { SessionListReadSource } from './widgets/types.ts'
import css from './HelloPage.module.css'

export interface HelloPageProps {
  /** locale 文案函数（由 sidebar shell 注入）。 */
  t: PropsLocale<'hello'>['t']
  /** 关闭页面回调 —— 让出主列回 conversation。 */
  onClose: () => void
  /** sessions.list 只读面（订阅 current session）。 */
  list: SessionListReadSource
}

/** 整页 Hello 页面主体。 */
export function HelloPage({ t, onClose, list }: HelloPageProps): JSX.Element {
  // 与 HelloPanel 保持同一来源（t('section.clock.locale')）传递 localeTag
  // 给 QuoteSection 决定语种。
  const localeTag = t('section.clock.locale') as 'zh-CN' | 'en-US'

  return (
    <div className={css.page} data-dsh-part="hello-page">
      <header className={css.hero}>
        <div className={css.heroBody}>
          <h1 className={css.heroTitle}>{t('page.title')}</h1>
          <p className={css.heroSubtitle}>{t('page.subtitle')}</p>
        </div>
        <button
          type="button"
          className={css.heroClose}
          aria-label={t('page.close')}
          title={t('page.close')}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <main className={css.main}>
        <GreetingSection t={t} />
        <ClockSection t={t} />
        <SessionSection t={t} list={list} />
        <QuoteSection t={t} localeTag={localeTag} />
      </main>
    </div>
  )
}