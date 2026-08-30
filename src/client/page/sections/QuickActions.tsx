/**
 * Dashboard section 4 — 底部 3 个快捷入口按钮。
 *
 * 全部 mock：点击只 console.info + window.alert，不调任何 RPC。
 * 让用户预览「开发工作台」3 个常见动作的入口位置。
 * 真实接入时把 onClick 改为 dispatch 命令或路由跳转即可。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './dashboard.module.css'

type QuickActionKey = 'newRequirement' | 'newBranch' | 'newMr'

interface QuickActionData {
  key: QuickActionKey
  icon: string
}

/** 演示快捷入口 —— 3 个常见动作。 */
const ACTIONS: readonly QuickActionData[] = [
  { key: 'newRequirement', icon: '＋' },
  { key: 'newBranch',      icon: '⎘' },
  { key: 'newMr',          icon: '⇄' },
] as const

export interface QuickActionsProps {
  /** Locale 文案函数（'hello' 命名空间）。 */
  t: PropsLocale<'hello'>['t']
}

/** 「新建需求 / 创建分支 / 发起合并请求」3 个 mock 按钮。 */
export function QuickActions({ t }: QuickActionsProps): JSX.Element {
  return (
    <div className={css.quickActions}>
      {ACTIONS.map((a) => {
        const label = t(`dashboard.quickActions.${a.key}`)
        const onClick = (): void => {
          // mock：仅 console + alert，不调任何 RPC
          console.info(`[dsh-hello] mock quick action: ${a.key}`)
          if (typeof window !== 'undefined') {
            window.alert(`${t('dashboard.quickActions.toastPrefix')}${label}`)
          }
        }
        return (
          <button
            key={a.key}
            type="button"
            className={css.quickButton}
            onClick={onClick}
          >
            <span className={css.quickButtonIcon} aria-hidden="true">{a.icon}</span>
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
