/**
 * Hello 多功能面板 —— 多 section 卡片式弹窗主体。
 * Esc 关闭、点击遮罩关闭、内容区不滚动出卡片。
 *
 * 通过 sidebar 槽位的 inject 拿到 list 只读面与 locale t 函数。
 */
import { useEffect } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { GreetingSection } from './widgets/GreetingSection.tsx'
import { ClockSection } from './widgets/ClockSection.tsx'
import { SessionSection } from './widgets/SessionSection.tsx'
import { QuoteSection } from './widgets/QuoteSection.tsx'
import type { SessionListReadSource } from './widgets/types.ts'
import css from './hello.module.css'

export interface HelloPanelProps {
  /** locale 文案函数。 */
  t: PropsLocale<'hello'>['t']
  /** 关闭回调。 */
  onClose: () => void
  /** 来自 sidebar.footer.action 注入的 sessions.list 只读面。 */
  list: SessionListReadSource
}

/** 多功能 hello 面板。 */
export function HelloPanel({ t, onClose, list }: HelloPanelProps): JSX.Element {
  // Esc 关闭 —— 卸载时清理避免内存泄漏。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  // 用 locale key 来给 QuoteSection 决定语种；
  // 与 ClockSection 用同一来源（t('section.clock.locale')）保持一致。
  const localeTag = t('section.clock.locale') as 'zh-CN' | 'en-US'

  return (
    <div
      className={css.mask}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={css.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hello-panel-title"
      >
        <header className={css.header}>
          <h2 id="hello-panel-title" className={css.title}>{t('dialog.title')}</h2>
          <button
            type="button"
            className={css.iconClose}
            aria-label={t('dialog.close')}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className={css.scrollArea}>
          <GreetingSection t={t} />
          <ClockSection t={t} />
          <SessionSection t={t} list={list} />
          <QuoteSection t={t} localeTag={localeTag} />
        </div>

        <footer className={css.footer}>
          <button
            type="button"
            className={css.close}
            onClick={onClose}
          >
            {t('dialog.close')}
          </button>
        </footer>
      </div>
    </div>
  )
}