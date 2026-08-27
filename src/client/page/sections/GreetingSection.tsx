/**
 * Section 1 — 问候大字。
 * 仅渲染一行 hello world 卡片，保留原插件的核心语义。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './sections.module.css'

export interface GreetingSectionProps {
  /** Locale 文案函数（'hello' 命名空间）。 */
  t: PropsLocale<'hello'>['t']
}

/** 渲染问候大字。 */
export function GreetingSection({ t }: GreetingSectionProps): JSX.Element {
  return (
    <section className={css.section} aria-labelledby="hello-greeting-title">
      <h3 id="hello-greeting-title" className={css.sectionTitle}>
        {t('section.greeting.title')}
      </h3>
      <p className={css.greetingBody}>{t('section.greeting.body')}</p>
    </section>
  )
}