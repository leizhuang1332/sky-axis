/**
 * Dashboard section 4 — 底部 3 个快捷入口按钮（由 HelloSidebar 引用）。
 *
 * 全部 mock：点击只 console.info + window.alert，不调任何 RPC。
 * 让用户预览「开发工作台」3 个常见动作的入口位置。
 *
 * 位置：上一轮在 HelloPage 底部；这一轮改为挂在 HelloSidebar 底部，
 *      任何视图都可见（语义升级为「全局快捷入口」）。
 *
 * 图标：使用 src/client/icons/icons.tsx 提供的 SVG 组件（替代 unicode）。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  PlusIcon, BranchIcon, MergeRequestIcon,
  type IconComponent,
} from '../../icons/icons.tsx'
import css from './dashboard.module.css'

type QuickActionKey = 'newRequirement' | 'newBranch' | 'newMr'

interface QuickActionData {
  key: QuickActionKey
  Icon: IconComponent
}

/** 演示快捷入口 —— 3 个常见动作。 */
const ACTIONS: readonly QuickActionData[] = [
  { key: 'newRequirement', Icon: PlusIcon },
  { key: 'newBranch',      Icon: BranchIcon },
  { key: 'newMr',          Icon: MergeRequestIcon },
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
        const Icon = a.Icon
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
            <span className={css.quickButtonIcon}>
              <Icon size={14} />
            </span>
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
