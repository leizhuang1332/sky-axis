/**
 * Section 4 — 随机名言。
 * 内置名言库（QUOTES）；点击按钮从下一个 index 取下一句，
 * 避免连续重复（顺序游走 + 模运算）。
 */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { QUOTES, type Quote } from '../../locales.ts'
import css from './sections.module.css'

export interface QuoteSectionProps {
  t: PropsLocale<'hello'>['t']
  /** 当前 locale tag，决定显示 zh 还是 en 版本。 */
  localeTag: 'zh-CN' | 'en-US'
}

/** 随机名言卡片 + 切换按钮。 */
export function QuoteSection({ t, localeTag }: QuoteSectionProps): JSX.Element {
  const [index, setIndex] = useState(0)
  // 简单的"next + 回 0"循环 —— 避免连续两秒同一句（点击不会重置到随机）
  const quote: Quote = QUOTES[index % QUOTES.length]!
  const body = localeTag === 'zh-CN' ? quote.zh : quote.en

  const onNext = (): void => {
    setIndex((i) => (i + 1) % QUOTES.length)
  }

  return (
    <section className={css.section} aria-labelledby="hello-quote-title">
      <div className={css.sectionHeader}>
        <h3 id="hello-quote-title" className={css.sectionTitle}>
          {t('section.quote.title')}
        </h3>
        <button
          type="button"
          className={css.refreshBtn}
          onClick={onNext}
          aria-label={t('section.quote.refresh')}
        >
          {t('section.quote.refresh')}
        </button>
      </div>
      <blockquote className={css.quote}>
        <p className={css.quoteBody}>{body}</p>
        <footer className={css.quoteAuthor}>— {quote.author}</footer>
      </blockquote>
    </section>
  )
}