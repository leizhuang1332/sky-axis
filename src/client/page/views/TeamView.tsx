/**
 * TeamView —— 团队详情（mock）。
 *
 * 4 个子块：
 *   1. 团队成员详情（大卡片版的成员列表，含角色标签）
 *   2. 本周迭代详情（OKR + 完成情况）
 *   3. 团队 Wiki（mock 文档链接）
 *   4. 团队日历（近期 5 个 mock 事件）
 *
 * 数据全部硬编码（DSH ctx 不暴露团队域），目的是呈现「团队详情页」
 * 的视觉形态，方便后续替换为真实数据源。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './views.module.css'

export interface TeamViewProps {
  t: PropsLocale<'sky-axis'>['t']
}

interface Member {
  initial: string
  name: string
  role: string
  status: 'online' | 'away' | 'offline'
}

const MEMBERS: readonly Member[] = [
  { initial: '李', name: '小李',   role: 'Tech Lead', status: 'online'  },
  { initial: '王', name: '王哥',   role: 'Backend',   status: 'online'  },
  { initial: '张', name: '张姐',   role: 'Frontend',  status: 'away'    },
  { initial: '赵', name: '老赵',   role: 'DevOps',    status: 'online'  },
  { initial: '钱', name: '钱 sir', role: 'QA',        status: 'offline' },
  { initial: '孙', name: '小孙',   role: 'PM',        status: 'online'  },
] as const

interface Iteration {
  done: number
  total: number
}

const ITERATION: Iteration = { done: 18, total: 28 }

interface Okr {
  title: string
  pct: number
}

const OKRS: readonly Okr[] = [
  { title: 'O1 · 提升客户端冷启动速度 30%',           pct: 78 },
  { title: 'O2 · 接入 3 条新业务线',                  pct: 67 },
  { title: 'O3 · 把 P0 bug 数降到 5 以下',             pct: 45 },
] as const

interface WikiLink {
  title: string
  meta: string
}

const WIKI: readonly WikiLink[] = [
  { title: '团队周会纪要（2026-W34）',     meta: '3 天前 · 张姐' },
  { title: '新成员 Onboarding 指南',         meta: '2 周前 · 小李' },
  { title: '前端 Coding Style 规范 v3.2',    meta: '1 月前 · 老赵' },
  { title: '事故复盘：2026-08-12 OOM',      meta: '1 月前 · 王哥' },
] as const

interface CalendarEvent {
  date: string
  title: string
  tag: string
  tone: 'default' | 'accent' | 'success' | 'warn'
}

const EVENTS: readonly CalendarEvent[] = [
  { date: '08-30', title: '迭代启动会',                  tag: '会议', tone: 'accent'  },
  { date: '09-01', title: '代码 Review 集中时段',         tag: '活动', tone: 'default' },
  { date: '09-03', title: '事故复盘讨论',                 tag: '复盘', tone: 'warn'    },
  { date: '09-05', title: '迭代 Demo',                   tag: 'Demo', tone: 'success' },
  { date: '09-08', title: '客户端灰度发版',              tag: '发版', tone: 'default' },
] as const

function statusClass(status: Member['status']): string {
  return status === 'online'  ? 'tagSuccess'
       : status === 'away'    ? 'tagWarn'
       :                        'tagDefault'
}

export function TeamView({ t }: TeamViewProps): JSX.Element {
  const iterPct = Math.round((ITERATION.done / ITERATION.total) * 100)

  return (
    <div className={css.view}>
      <header className={css.viewHeader}>
        <h2 className={css.viewTitle}>{t('view.team.title')}</h2>
        <p className={css.viewSubtitle}>{t('view.team.subtitle')}</p>
      </header>

      {/* 子块 1：团队成员详情 */}
      <section className={css.viewBlock}>
        <h3 className={css.viewBlockTitle}>{t('view.team.members.title')} · {MEMBERS.length}</h3>
        <ul className={css.itemList}>
          {MEMBERS.map((m) => {
            const badgeCls =
              m.status === 'online'  ? `${css.tagBadge} ${css.tagBadgeSuccess}` :
              m.status === 'away'    ? `${css.tagBadge} ${css.tagBadgeWarn}` :
                                       css.tagBadge
            return (
              <li key={m.name} className={css.itemRow}>
                <span className={css.memberAvatar} aria-hidden="true">{m.initial}</span>
                <span className={css.itemTitle}>{m.name}</span>
                <span className={css.itemMeta}>{m.role}</span>
                <span className={badgeCls}>
                  {m.status === 'online' ? t('dashboard.team.status.online')
                  : m.status === 'away'   ? t('dashboard.team.status.away')
                                          : t('dashboard.team.status.offline')}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      {/* 子块 2：本周迭代 */}
      <section className={css.viewBlock}>
        <h3 className={css.viewBlockTitle}>{t('view.team.iteration.title')}</h3>
        <div className={css.rowBetween}>
          <span className={css.itemMeta}>
            完成 {ITERATION.done} / 总共 {ITERATION.total} 个任务
          </span>
          <span className={css.progressPct}>{iterPct}%</span>
        </div>
        <div className={css.progressBar}>
          <div className={css.progressFill} style={{ width: `${iterPct}%` }} />
        </div>
        <ul className={css.itemList}>
          {OKRS.map((o) => (
            <li key={o.title} className={css.itemRow}>
              <span className={css.itemTitle}>{o.title}</span>
              <span className={`${css.tagBadge} ${css.tagBadgeAccent}`}>{o.pct}%</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 子块 3：团队文档 */}
      <section className={css.viewBlock}>
        <h3 className={css.viewBlockTitle}>{t('view.team.wiki.title')}</h3>
        <ul className={css.itemList}>
          {WIKI.map((w) => (
            <li key={w.title} className={css.itemRow}>
              <span className={css.itemTitle}>{w.title}</span>
              <span className={css.itemMeta}>{w.meta}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 子块 4：近期活动 */}
      <section className={css.viewBlock}>
        <h3 className={css.viewBlockTitle}>{t('view.team.calendar.title')}</h3>
        <ul className={css.itemList}>
          {EVENTS.map((e) => {
            const badgeCls =
              e.tone === 'accent'  ? `${css.tagBadge} ${css.tagBadgeAccent}` :
              e.tone === 'success' ? `${css.tagBadge} ${css.tagBadgeSuccess}` :
              e.tone === 'warn'    ? `${css.tagBadge} ${css.tagBadgeWarn}` :
                                      css.tagBadge
            return (
              <li key={e.title} className={css.itemRow}>
                <span className={css.itemMeta} style={{ minWidth: 36 }}>{e.date}</span>
                <span className={css.itemTitle}>{e.title}</span>
                <span className={badgeCls}>{e.tag}</span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
