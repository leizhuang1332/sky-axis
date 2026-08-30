/**
 * 内部 sidebar —— 工作台 6 个视图入口（5 一级 + 个人下 1 二级）。
 *
 * 结构（自上而下）：
 *   - 顶部：sidebar 折叠/展开 toggle 按钮
 *   - 5 个一级 entry（首页 / 团队 / 个人 / 报表 / 设置）
 *     - 「个人」是 group entry：点击切换二级菜单展开 / 收起，不进视图
 *     - 「个人」展开时，下方缩进显示子项「需求列表」
 *     - 「需求列表」是 leaf entry：点击进 viewKey='requirements'
 *   - 分隔线
 *   - 「快捷操作」标题 + QuickActions 区
 *
 * 高亮规则：
 *   - viewKey === 'personal'       → 「个人」一级 entry 高亮
 *   - viewKey === 'requirements'   → 「需求列表」二级子项高亮
 *   - 其它 viewKey               → 对应一级 entry 高亮
 *
 * 折叠态（sidebarCollapsed）行为：
 *   - sidebar 缩成 48px icon rail
 *   - 所有文字、QuickActions、二级菜单、chevron 全部隐藏
 *   - 「个人」点击行为保持（仍然切换二级菜单展开，只是子菜单不可见）
 *   - 用户可随时展开 sidebar 重新看到二级菜单
 *
 * props：
 *   - t: 注入的 locale 文案函数
 *   - viewKey: 当前激活视图 key
 *   - onSelect: 点一级 entry / 二级子项回调（SkyAxisPage 把 controller.setView 包一层）
 *   - onPersonalToggle: 点「个人」group entry 回调（SkyAxisPage 把 controller.togglePersonalExpanded 包一层）
 *   - personalExpanded: 「个人」二级菜单是否展开
 *   - collapsed / onToggleCollapse: sidebar 折叠状态 + 切换回调
 *   - onNewRequirement / hasWorkspace: 顶部「新建需求」按钮
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkyAxisViewKey } from '../../controller/sky-axis-controller.ts'
import type { IconComponent } from '../../icons/icons.tsx'
import type { SkyAxisKey } from '../../locales.ts'
import {
  HomeIcon, TeamIcon, PersonalIcon, ReportsIcon, SettingsIcon,
  ChevronLeftIcon, ChevronDownIcon, RequirementIcon,
} from '../../icons/icons.tsx'
import { QuickActions } from '../sections/QuickActions.tsx'
import css from './sidebar.module.css'

/** sidebar 一级 entry —— 5 个（home / team / personal / reports / settings）。
 *  「个人」是 group：有 children + chevron，点击行为是切换展开而非切视图。 */
interface SidebarEntry {
  key: SkyAxisViewKey
  Icon: IconComponent
  /** SkyAxisKey 联合类型而非 string，让 t() 在编译期校验。 */
  labelKey: SkyAxisKey
  /** 子项列表；非空表示这是 group entry（点 entry 切展开而非切视图）。 */
  children?: readonly SidebarSubEntry[]
}

/** sidebar 二级子项 —— 当前只在「个人」下挂「需求列表」。
 *  leaf：点击进对应视图。 */
interface SidebarSubEntry {
  key: SkyAxisViewKey
  Icon: IconComponent
  labelKey: SkyAxisKey
}

/** sidebar 5 entry —— 视觉顺序与线框图一致：首页 / 团队 / 个人 / 报表 / 设置。 */
const ENTRIES: readonly SidebarEntry[] = [
  { key: 'home',     Icon: HomeIcon,     labelKey: 'sidebar.home.label' },
  { key: 'team',     Icon: TeamIcon,     labelKey: 'sidebar.team.label' },
  {
    key: 'personal',
    Icon: PersonalIcon,
    labelKey: 'sidebar.personal.label',
    children: [
      { key: 'requirements', Icon: RequirementIcon, labelKey: 'sidebar.requirements.label' },
    ],
  },
  { key: 'reports',  Icon: ReportsIcon,  labelKey: 'sidebar.reports.label' },
  { key: 'settings', Icon: SettingsIcon, labelKey: 'sidebar.settings.label' },
] as const

export interface SkyAxisSidebarProps {
  /** Locale 文案函数（'sky-axis' 命名空间）。 */
  t: PropsLocale<'sky-axis'>['t']
  /** 当前激活视图 key（来自 controller.viewKey）。 */
  viewKey: SkyAxisViewKey
  /** 点击一级 / 二级 entry 回调（SkyAxisPage 内 controller.setView 包一层）。 */
  onSelect: (k: SkyAxisViewKey) => void
  /** 点击「个人」group entry 回调（SkyAxisPage 内 controller.togglePersonalExpanded 包一层）。
   *  只有 children 非空的 entry 才会触发。 */
  onPersonalToggle: () => void
  /** sidebar「个人」分组二级菜单是否展开（来自 controller.personalExpanded）。 */
  personalExpanded: boolean
  /** sidebar 是否折叠（来自 controller.sidebarCollapsed）。
   *  true → icon rail 模式（48px 宽，文字 / QuickActions / 二级菜单 隐藏，chevron 旋转 180°）。 */
  collapsed: boolean
  /** 点击顶部 toggle 按钮回调（SkyAxisPage 内 controller.toggleSidebar 包一层）。 */
  onToggleCollapse: () => void
  /** 点击「新建需求」按钮回调（SkyAxisPage 内维护 modal 状态）。 */
  onNewRequirement: () => void
  /** 当前是否有可用 workspace（空列表时「新建需求」按钮 disabled）。 */
  hasWorkspace: boolean
}

export function SkyAxisSidebar({
  t, viewKey, onSelect, onPersonalToggle, personalExpanded, collapsed, onToggleCollapse, onNewRequirement, hasWorkspace,
}: SkyAxisSidebarProps): JSX.Element {
  const sidebarClass = collapsed ? `${css.sidebar} ${css.collapsed}` : css.sidebar
  // 字面量 key 用联合类型让 t() 在编译期校验（SkyAxisKey 联合类型）
  const toggleKey: 'sidebar.toggle.expand' | 'sidebar.toggle.collapse' = collapsed ? 'sidebar.toggle.expand' : 'sidebar.toggle.collapse'

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
          const isGroup = e.children !== undefined && e.children.length > 0
          const active = e.key === viewKey
          return (
            <li key={e.key} className={css.entryItem}>
              {isGroup ? (
                // 「个人」group entry：点击切展开（不进视图），右侧 chevron 旋转指示状态
                <button
                  type="button"
                  className={`${css.entry} ${active ? css.entryActive : ''}`}
                  aria-current={active ? 'page' : undefined}
                  aria-expanded={personalExpanded}
                  onClick={onPersonalToggle}
                >
                  <Icon size={16} className={css.entryIcon} />
                  <span className={css.entryLabel}>{t(e.labelKey)}</span>
                  <ChevronDownIcon
                    size={12}
                    className={`${css.entryChevron} ${personalExpanded ? css.entryChevronExpanded : ''}`}
                  />
                </button>
              ) : (
                // 普通 leaf entry：点击进视图
                <button
                  type="button"
                  className={active ? `${css.entry} ${css.entryActive}` : css.entry}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => { onSelect(e.key) }}
                >
                  <Icon size={16} className={css.entryIcon} />
                  <span className={css.entryLabel}>{t(e.labelKey)}</span>
                </button>
              )}

              {/* 二级菜单 —— 仅 group entry 渲染；折叠态或收起态下隐藏 */}
              {isGroup && (
                <ul
                  className={`${css.subList} ${personalExpanded ? css.subListExpanded : ''}`}
                  role="group"
                  aria-label={t(e.labelKey)}
                >
                  {e.children!.map((sub) => {
                    const SubIcon = sub.Icon
                    const subActive = sub.key === viewKey
                    return (
                      <li key={sub.key} className={css.subItem}>
                        <button
                          type="button"
                          className={subActive ? `${css.subEntry} ${css.entryActive}` : css.subEntry}
                          aria-current={subActive ? 'page' : undefined}
                          onClick={() => { onSelect(sub.key) }}
                        >
                          <SubIcon size={14} className={css.subEntryIcon} />
                          <span className={css.subEntryLabel}>{t(sub.labelKey)}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      <div className={css.divider} aria-hidden="true" />
      <p className={css.quickLabel}>{t('sidebar.quickActions.label')}</p>
      <QuickActions t={t} onNewRequirement={onNewRequirement} hasWorkspace={hasWorkspace} />
    </nav>
  )
}
