/**
 * Dashboard section 4 — 底部 3 个快捷入口按钮（由 SkyAxisSidebar 引用）。
 *
 * Phase 1 升级：
 *   - 「新建需求」按钮改成真实入口 —— 通过 props.onNewRequirement 回调
 *     打开 NewRequirementModal（之前是 mock alert）
 *   - 「创建分支」「发起合并请求」保留 mock（未来 Phase 接入会话系统）
 *
 * 位置：sidebar 底部，所有视图都可见（语义 = 全局快捷入口）。
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
  /** Locale 文案函数（'sky-axis' 命名空间）。 */
  t: PropsLocale<'sky-axis'>['t']
  /** 用户点击「新建需求」—— parent 应打开 NewRequirementModal。 */
  onNewRequirement: () => void
  /** 当前是否有可用 workspace（空列表时「新建需求」按钮 disabled）。 */
  hasWorkspace: boolean
}

/** 「新建需求 / 创建分支 / 发起合并请求」3 个入口按钮。 */
export function QuickActions({ t, onNewRequirement, hasWorkspace }: QuickActionsProps): JSX.Element {
  return (
    <div className={css.quickActions}>
      {ACTIONS.map((a) => {
        const Icon = a.Icon
        const label = t(`dashboard.quickActions.${a.key}`)
        const isNewRequirement = a.key === 'newRequirement'
        const disabled = isNewRequirement && !hasWorkspace
        const onClick = (): void => {
          if (isNewRequirement) {
            onNewRequirement()
            return
          }
          // 其他两个动作保留 mock
          console.info(`[sky-axis] mock quick action: ${a.key}`)
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
            disabled={disabled}
            title={disabled ? t('dashboard.quickActions.newRequirementDisabledHint') : undefined}
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
