/**
 * Dashboard section 2 — 左侧「我的动态流」。
 *
 * 5 条 mock 事件（分配需求 / 提交 / Bug 告警 / 审查 MR / 合并 MR）。
 * 文案硬编码 zh（演示数据，无需 i18n），标题走 t()。
 *
 * 图标：使用 src/client/icons/icons.tsx 提供的 SVG 组件（替代 emoji）。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  PinIcon, GitCommitIcon, BugIcon, EyeIcon, CheckIcon,
  type IconComponent,
} from '../../icons/icons.tsx'
import css from './dashboard.module.css'

interface ActivityItem {
  /** 类别图标（SVG 组件引用）。 */
  Icon: IconComponent
  /** 事件正文（zh 硬编码）。 */
  text: string
  /** 相对时间显示（zh 硬编码）。 */
  time: string
}

/** 演示事件流 —— 真实接入时改为订阅 ctx.conversationEvents。 */
const ACTIVITIES: readonly ActivityItem[] = [
  { Icon: PinIcon,         text: '王哥给你分配了需求 #123',          time: '10 分钟前' },
  { Icon: GitCommitIcon,   text: '你提交了 abc1234：优化 session 加载', time: '1 小时前'  },
  { Icon: BugIcon,         text: 'Bug 告警：内存泄漏，发生在 chat 主进程', time: '3 小时前' },
  { Icon: EyeIcon,         text: '你审查了 MR #42：feat/login-sso',  time: '昨天'     },
  { Icon: CheckIcon,       text: '小李合并了 MR #41：fix/memory-leak', time: '2 天前'   },
] as const

export interface ActivityStreamProps {
  /** Locale 文案函数（'hello' 命名空间）。 */
  t: PropsLocale<'hello'>['t']
}

/** 「我的动态流」事件列表卡片。 */
export function ActivityStream({ t }: ActivityStreamProps): JSX.Element {
  return (
    <section className={css.section} aria-labelledby="hello-activity-title">
      <h3 id="hello-activity-title" className={css.sectionTitle}>
        {t('dashboard.activity.title')}
      </h3>
      <ul className={css.activityList}>
        {ACTIVITIES.map((a, idx) => {
          const Icon = a.Icon
          return (
            <li key={idx} className={css.activityItem}>
              <span className={css.activityItemIcon}>
                <Icon size={14} />
              </span>
              <span className={css.activityItemText}>{a.text}</span>
              <span className={css.activityItemTime}>{a.time}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
