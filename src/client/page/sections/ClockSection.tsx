/**
 * Section 2 — 实时时钟。
 * setInterval 每秒更新；组件卸载时清理定时器。
 * 时区与格式遵循当前 locale（zh-CN / en-US）。
 */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './sections.module.css'

export interface ClockSectionProps {
  t: PropsLocale<'hello'>['t']
}

/** 一秒一更新的时间显示。 */
export function ClockSection({ t }: ClockSectionProps): JSX.Element {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => { setNow(new Date()) }, 1000)
    return () => { window.clearInterval(id) }
  }, [])

  // 根据 locale 决定格式串 —— 时区跟随浏览器。
  const localeTag = t('section.clock.locale') as 'zh-CN' | 'en-US'
  const dateStr = now.toLocaleDateString(localeTag, {
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const timeStr = now.toLocaleTimeString(localeTag, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })

  return (
    <section className={css.section} aria-labelledby="hello-clock-title">
      <h3 id="hello-clock-title" className={css.sectionTitle}>
        {t('section.clock.title')}
      </h3>
      <dl className={css.kv}>
        <div className={css.kvRow}>
          <dt className={css.kvKey}>{t('section.clock.dateLabel')}</dt>
          <dd className={css.kvVal}>{dateStr}</dd>
        </div>
        <div className={css.kvRow}>
          <dt className={css.kvKey}>{t('section.clock.timeLabel')}</dt>
          <dd className={css.kvVal + ' ' + css.mono}>{timeStr}</dd>
        </div>
      </dl>
    </section>
  )
}