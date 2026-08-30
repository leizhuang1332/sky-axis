/**
 * 内部 sidebar —— 工作台 5 个一级视图导航。
 *
 * 行为：
 *   - 高亮当前 viewKey（aria-current="page" + CSS active 样式）
 *   - 点击 entry → onSelect → controller.setView → useSyncExternalStore
 *     触发整树重渲染，viewArea 切换到对应视图
 *   - 底部挂 QuickActions —— 「全局快捷入口」语义，所有视图都可见
 *
 * 注意：5 个 entry 都是 SVG 图标（来自 icons.tsx），无 emoji。entry label
 * 走 locale，icon 永远渲染同样的视觉。
 *
 * props：
 *   - t: 注入的 locale 文案函数
 *   - viewKey: 当前激活的视图 key
 *   - onSelect: 点 entry 回调，由 HelloPage 把 controller.setView 包一层
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { HelloViewKey } from '../../controller/hello-controller.ts'
import type { IconComponent } from '../../icons/icons.tsx'
import type { HelloKey } from '../../locales.ts'
import {
  HomeIcon, TeamIcon, PersonalIcon, ReportsIcon, SettingsIcon,
  ChevronLeftIcon,
} from '../../icons/icons.tsx'
import { QuickActions } from '../sections/QuickActions.tsx'
import css from './sidebar.module.css'

interface SidebarEntry {
  key: HelloViewKey
  Icon: IconComponent
  /** 用 HelloKey 联合类型而不是 string，让 t() 在编译期校验。 */
  labelKey: HelloKey
}

/** sidebar 5 entry —— 视觉顺序与线框图一致：首页 / 团队 / 个人 / 报表 / 设置。 */
const ENTRIES: readonly SidebarEntry[] = [
  { key: 'home',     Icon: HomeIcon,     labelKey: 'sidebar.home.label' },
  { key: 'team',     Icon: TeamIcon,     labelKey: 'sidebar.team.label' },
  { key: 'personal', Icon: PersonalIcon, labelKey: 'sidebar.personal.label' },
  { key: 'reports',  Icon: ReportsIcon,  labelKey: 'sidebar.reports.label' },
  { key: 'settings', Icon: SettingsIcon, labelKey: 'sidebar.settings.label' },
] as const

export interface HelloSidebarProps {
  /** Locale 文案函数（'hello' 命名空间）。 */
  t: PropsLocale<'hello'>['t']
  /** 当前激活视图 key（来自 controller.viewKey）。 */
  viewKey: HelloViewKey
  /** 点击 entry 回调（HelloPage 内 controller.setView 包一层）。 */
  onSelect: (k: HelloViewKey) => void
  /** sidebar 是否折叠（来自 controller.sidebarCollapsed）。
   *  true → icon rail 模式（48px 宽，文字 / QuickActions 隐藏，chevron 旋转 180°）。 */
  collapsed: boolean
  /** 点击顶部 toggle 按钮回调（HelloPage 内 controller.toggleSidebar 包一层）。 */
  onToggleCollapse: () => void
}

export function HelloSidebar({
  t, viewKey, onSelect, collapsed, onToggleCollapse,
}: HelloSidebarProps): JSX.Element {
  const sidebarClass = collapsed ? `${css.sidebar} ${css.collapsed}` : css.sidebar
  // 字面量 key 用联合类型让 t() 在编译期校验（HelloKey 联合类型）
  const toggleKey = collapsed ? 'sidebar.toggle.expand' : 'sidebar.toggle.collapse'
  return (
    <nav className={sidebarClass} aria-label={t('sidebar.ariaLabel')}>
      {/* 顶部 toggle 按钮 —— 展开时显示「收起」+ chevron-left；折叠态由 CSS 隐藏文字 + 旋转 chevron */}
      <div className={css.toggleRow}>
        <button
          type="button"
          className={css.toggleButton}
          aria-label={t(toggleKey)}
          aria-expanded={!collapsed}
          onClick={onToggleCollapse}
        >
          <ChevronLeftIcon size={14} className={css.toggleIcon} />
          <span className={css.toggleLabel}>{t(toggleKey)}</span>
        </button>
      </div>

      <ul className={css.entryList}>
        {ENTRIES.map((e) => {
          const Icon = e.Icon
          const active = e.key === viewKey
          return (
            <li key={e.key} className={css.entryItem}>
              <button
                type="button"
                className={active ? `${css.entry} ${css.entryActive}` : css.entry}
                aria-current={active ? 'page' : undefined}
                onClick={() => { onSelect(e.key) }}
              >
                <Icon size={16} className={css.entryIcon} />
                <span className={css.entryLabel}>{t(e.labelKey)}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className={css.divider} aria-hidden="true" />
      <p className={css.quickLabel}>{t('sidebar.quickActions.label')}</p>
      <QuickActions t={t} />
    </nav>
  )
}
