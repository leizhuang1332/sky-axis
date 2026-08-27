/**
 * Section 3 — 当前会话信息。
 * 通过 useSyncExternalStore 订阅 ctx.sessions.list（只读面），
 * 与 dsh-session-id 范例使用相同订阅模式。
 *
 * 不持有会话状态、不写日志、不发起请求。
 */
import { useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListReadSource } from './types.ts'
import css from '../hello.module.css'

export interface SessionSectionProps {
  t: PropsLocale<'hello'>['t']
  /** 已包装的 sessions.list 只读面（apply 函数在 register 时注入）。 */
  list: SessionListReadSource
}

/**
 * 当前活跃会话展示。
 * 三态：未激活 / 激活但无名 / 激活且有标题。
 */
export function SessionSection({ t, list }: SessionSectionProps): JSX.Element {
  const snapshot = useSyncExternalStore(list.subscribe, list.getSnapshot)
  const currentId = snapshot.current
  const current = currentId !== undefined ? snapshot.byId[currentId] : undefined

  let body: JSX.Element
  if (current === undefined) {
    body = <p className={css.sessionNone}>{t('section.session.none')}</p>
  } else {
    // SessionSummary.title 是可选的（durable log 还没有时为空）。
    // 用 displayTitle 作为 fallback（"durable title, project basename, then session id"）。
    const title = current.title?.trim().length
      ? current.title
      : current.displayTitle
    body = <p className={css.sessionTitle} title={current.id}>{title}</p>
  }

  return (
    <section className={css.section} aria-labelledby="hello-session-title">
      <h3 id="hello-session-title" className={css.sectionTitle}>
        {t('section.session.title')}
      </h3>
      {body}
    </section>
  )
}