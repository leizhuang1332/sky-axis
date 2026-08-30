/**
 * Dashboard section 3 — 右侧「团队概览」。
 *
 * 3 个子段：
 *   1. 团队成员（5 人 mock，圆形首字母头像 + 状态点：绿/黄/灰）
 *   2. 本周迭代进度（progress bar + 完成数 / 总数）
 *   3. 最近合并的 MR（3 条 mock）
 *
 * 数据全部 mock（ctx 不暴露团队 / 迭代 / MR 域）。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './dashboard.module.css'

type MemberStatusKey = 'online' | 'away' | 'offline'

interface Member {
  /** 圆形头像首字（单字符）。 */
  initial: string
  /** 显示名。 */
  name: string
  /** 在线状态。 */
  status: MemberStatusKey
}

/** 演示团队成员。 */
const MEMBERS: readonly Member[] = [
  { initial: '李', name: '小李',  status: 'online'  },
  { initial: '王', name: '王哥',  status: 'online'  },
  { initial: '张', name: '张姐',  status: 'away'    },
  { initial: '赵', name: '老赵',  status: 'online'  },
  { initial: '钱', name: '钱 sir', status: 'offline' },
] as const

interface SprintProgress {
  done: number
  total: number
}

/** 演示迭代进度 —— 60%。 */
const PROGRESS: SprintProgress = { done: 12, total: 20 }

interface RecentMr {
  id: string
  title: string
}

/** 演示最近合并的 MR。 */
const RECENT_MRS: readonly RecentMr[] = [
  { id: '#41', title: 'feat/login-sso'  },
  { id: '#40', title: 'fix/memory-leak'  },
  { id: '#39', title: 'refactor/sidebar' },
] as const

export interface TeamOverviewProps {
  /** Locale 文案函数（'sky-axis' 命名空间）。 */
  t: PropsLocale<'sky-axis'>['t']
}

/** 「团队概览」卡片：成员 + 进度 + MR 列表。 */
export function TeamOverview({ t }: TeamOverviewProps): JSX.Element {
  const pct = Math.round((PROGRESS.done / PROGRESS.total) * 100)
  // 简单 {key} 替换 —— t() 当前无插值 API（dsh-client-locale）
  const progressDesc = t('dashboard.team.progressDesc')
    .replace('{done}', String(PROGRESS.done))
    .replace('{total}', String(PROGRESS.total))

  return (
    <section className={css.section} aria-labelledby="sky-axis-team-title">
      <h3 id="sky-axis-team-title" className={css.sectionTitle}>
        {t('dashboard.team.title')}
      </h3>

      {/* 子段 1：团队成员 */}
      <div className={css.teamBlock}>
        <p className={css.teamBlockTitle}>
          {t('dashboard.team.members')} · {MEMBERS.length}
        </p>
        <ul className={css.memberList}>
          {MEMBERS.map((m) => {
            const statusClass =
              m.status === 'online'  ? css.memberStatusOnline  :
              m.status === 'away'    ? css.memberStatusAway    :
                                       css.memberStatusOffline
            return (
              <li key={m.name} className={`${css.memberItem} ${statusClass}`}>
                <span className={css.memberAvatar} aria-hidden="true">
                  {m.initial}
                  <span className={css.memberStatusDot} />
                </span>
                <span className={css.memberName}>{m.name}</span>
              </li>
            )
          })}
        </ul>
      </div>

      {/* 子段 2：本周迭代进度 */}
      <div className={css.teamBlock}>
        <p className={css.teamBlockTitle}>{t('dashboard.team.progress')}</p>
        <div className={css.progressMeta}>
          <span className={css.progressDesc}>{progressDesc}</span>
          <span className={css.progressPct}>{pct}%</span>
        </div>
        <div
          className={css.progressBar}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={css.progressFill} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* 子段 3：最近合并的 MR */}
      <div className={css.teamBlock}>
        <p className={css.teamBlockTitle}>{t('dashboard.team.recentMr')}</p>
        <ul className={css.mrList}>
          {RECENT_MRS.map((mr) => (
            <li key={mr.id} className={css.mrItem}>
              <span className={css.mrId}>{mr.id}</span>
              <span className={css.mrTitle}>{mr.title}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
