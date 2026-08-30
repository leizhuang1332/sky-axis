/**
 * PersonalView —— 个人工作台（mock）。
 *
 * 4 个子块：
 *   1. 我的任务（5 条 mock 待办，按状态分 tag）
 *   2. 我的 MR（2 条 mock：我创建的 / 我审查的）
 *   3. 我的统计（本周 commit / 代码行数 / MR 数 + 简单柱状图）
 *   4. 今日安排（4 条 mock 时间线）
 *
 * 数据全部硬编码（DSH ctx 不暴露个人业务域）。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './views.module.css'

export interface PersonalViewProps {
  t: PropsLocale<'hello'>['t']
}

type TaskStatus = 'todo' | 'progress' | 'review' | 'done'

interface Task {
  id: string
  title: string
  status: TaskStatus
}

const TASKS: readonly Task[] = [
  { id: '#456', title: 'feat/login-sso',               status: 'progress' },
  { id: '#454', title: 'fix/memory-leak',              status: 'review'   },
  { id: '#451', title: 'chore/upgrade-react-19',       status: 'progress' },
  { id: '#448', title: 'docs/week-34',                 status: 'todo'     },
  { id: '#447', title: 'feat/sidebar-collapse',        status: 'done'     },
] as const

interface MyMr {
  id: string
  title: string
  relation: 'created' | 'reviewing'
  meta: string
}

const MRS: readonly MyMr[] = [
  { id: '#456', title: 'feat/login-sso',          relation: 'created',  meta: '创建于 2 天前' },
  { id: '#454', title: 'fix/memory-leak',         relation: 'reviewing', meta: '需要审查'      },
  { id: '#451', title: 'chore/upgrade-react-19',  relation: 'created',  meta: '创建于 4 天前' },
] as const

interface StatBar {
  day: string
  commits: number
}

const STATS: readonly StatBar[] = [
  { day: '周一', commits: 3 },
  { day: '周二', commits: 5 },
  { day: '周三', commits: 2 },
  { day: '周四', commits: 6 },
  { day: '周五', commits: 4 },
  { day: '周六', commits: 1 },
  { day: '周日', commits: 0 },
] as const

const TOTALS = { commits: 21, added: 843, removed: 220, mrs: 5 }

interface ScheduleItem {
  time: string
  title: string
  tag: string
}

const SCHEDULE: readonly ScheduleItem[] = [
  { time: '10:00', title: '每日站会',           tag: '会议' },
  { time: '13:30', title: 'code review 集中时段', tag: '活动' },
  { time: '15:00', title: '设计评审 · 新 Dashboard', tag: '评审' },
  { time: '17:00', title: '团队周会',           tag: '会议' },
] as const

function statusLabel(t: PropsLocale<'hello'>['t'], s: TaskStatus): { label: string; cls: string } {
  switch (s) {
    case 'todo':     return { label: '待办',     cls: css.tagBadge }
    case 'progress': return { label: '进行中',   cls: `${css.tagBadge} ${css.tagBadgeAccent}`  }
    case 'review':   return { label: '审查中',   cls: `${css.tagBadge} ${css.tagBadgeWarn}`    }
    case 'done':     return { label: '已完成',   cls: `${css.tagBadge} ${css.tagBadgeSuccess}` }
  }
}

export function PersonalView({ t }: PersonalViewProps): JSX.Element {
  const maxCommits = Math.max(...STATS.map((s) => s.commits), 1)

  return (
    <div className={css.view}>
      <header className={css.viewHeader}>
        <h2 className={css.viewTitle}>{t('view.personal.title')}</h2>
        <p className={css.viewSubtitle}>{t('view.personal.subtitle')}</p>
      </header>

      {/* 子块 1：我的任务 */}
      <section className={css.viewBlock}>
        <h3 className={css.viewBlockTitle}>{t('view.personal.tasks.title')}</h3>
        <ul className={css.itemList}>
          {TASKS.map((task) => {
            const { label, cls } = statusLabel(t, task.status)
            return (
              <li key={task.id} className={css.itemRow}>
                <span className={css.itemMeta} style={{ minWidth: 44, fontFamily: 'var(--dsw-font-family-mono, monospace)' }}>
                  {task.id}
                </span>
                <span className={css.itemTitle}>{task.title}</span>
                <span className={cls}>{label}</span>
              </li>
            )
          })}
        </ul>
      </section>

      {/* 子块 2：我的 MR */}
      <section className={css.viewBlock}>
        <h3 className={css.viewBlockTitle}>{t('view.personal.mrs.title')}</h3>
        <ul className={css.itemList}>
          {MRS.map((mr) => {
            const relLabel = mr.relation === 'created' ? '我创建' : '我审查'
            const relCls = mr.relation === 'created'
              ? `${css.tagBadge} ${css.tagBadgeAccent}`
              : `${css.tagBadge} ${css.tagBadgeWarn}`
            return (
              <li key={mr.id} className={css.itemRow}>
                <span className={css.itemMeta} style={{ minWidth: 44, fontFamily: 'var(--dsw-font-family-mono, monospace)' }}>
                  {mr.id}
                </span>
                <span className={css.itemTitle}>{mr.title}</span>
                <span className={relCls}>{relLabel}</span>
                <span className={css.itemMeta}>{mr.meta}</span>
              </li>
            )
          })}
        </ul>
      </section>

      {/* 子块 3：我的统计 */}
      <section className={css.viewBlock}>
        <h3 className={css.viewBlockTitle}>{t('view.personal.stats.title')}</h3>
        <div className={css.row} style={{ gap: 24, flexWrap: 'wrap' }}>
          <Stat label="Commit" value={TOTALS.commits} />
          <Stat label="代码 +" value={TOTALS.added} tone="accent" />
          <Stat label="代码 −" value={TOTALS.removed} />
          <Stat label="MR" value={TOTALS.mrs} tone="accent" />
        </div>
        <div className={css.chartWrap}>
          <p className={css.viewBlockHint}>本周 commit 分布</p>
          <div className={css.row} style={{ alignItems: 'flex-end', gap: 10, height: 96 }}>
            {STATS.map((s) => {
              const heightPct = Math.round((s.commits / maxCommits) * 100)
              return (
                <div key={s.day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
                  <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                    <div style={{
                      width: '100%',
                      height: `${heightPct}%`,
                      minHeight: s.commits > 0 ? 4 : 0,
                      background: 'var(--dsw-alias-state-business-primary)',
                      borderRadius: 4,
                    }} />
                  </div>
                  <span className={css.itemMeta} style={{ marginTop: 4 }}>{s.day}</span>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* 子块 4：今日安排 */}
      <section className={css.viewBlock}>
        <h3 className={css.viewBlockTitle}>{t('view.personal.calendar.title')}</h3>
        <ul className={css.itemList}>
          {SCHEDULE.map((s) => (
            <li key={s.time + s.title} className={css.itemRow}>
              <span className={css.itemMeta} style={{ minWidth: 48, fontFamily: 'var(--dsw-font-family-mono, monospace)' }}>
                {s.time}
              </span>
              <span className={css.itemTitle}>{s.title}</span>
              <span className={css.tagBadge}>{s.tag}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'accent' }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }}>{label}</span>
      <span style={{
        fontSize: 18,
        fontWeight: 700,
        color: tone === 'accent' ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-label-primary)',
      }}>
        {value.toLocaleString()}
      </span>
    </div>
  )
}
