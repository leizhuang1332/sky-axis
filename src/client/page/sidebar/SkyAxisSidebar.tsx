/**
 * 内部 sidebar —— 工作台 7 个视图入口（5 一级 + 个人下「概览」+ 复合「需求列表」）。
 *
 * 结构（自上而下）：
 *   - 顶部：sidebar 折叠/展开 toggle 按钮
 *   - 5 个一级 entry（首页 / 团队 / 个人 / 报表 / 设置）
 *     - 「个人」是 group entry：点击切换二级菜单展开 / 收起，不进视图
 *     - 「个人」展开时，下方缩进显示 2 个同级子项「概览」+「需求列表」
 *       - 「概览」是 leaf entry：点击进 viewKey='personal'（PersonalView）
 *       - 「需求列表」是**复合 entry**（macOS Finder 风格）：
 *         · 左侧主按钮 = 点击进 viewKey='requirements'（RequirementsView，**保留**）
 *         · 右侧独立 chevron 按钮 = 点击切子菜单展开/收起（不切视图）
 *         · 复合 entry 展开时，缩进更深一层展示「未完成需求」列表
 *           （status ∈ {open, in_progress}，按 updatedAt 倒序）
 *           每条点一下直接 openDetail(id) —— 不进列表页，快速切换
 *   - 分隔线
 *   - 「快捷操作」标题 + QuickActions 区
 *
 * 高亮规则：
 *   - leaf entry（一级非 group：首页 / 团队 / 报表 / 设置）：viewKey 命中时高亮
 *   - group entry（「个人」）：永远不高亮 —— group 只切二级菜单展开/收起，不进视图
 *   - 二级 leaf 子项（「概览」）：viewKey 命中时高亮
 *   - 二级复合 entry 主按钮（「需求列表」文字区域）：viewKey='requirements' 时高亮
 *   - 三级需求子项：selectedRequirementId 命中时高亮（与 viewKey 解耦 —— 详情
 *     打开时 viewKey 不变，sidebar 仍保持原视图选中态）
 *
 * 折叠态（sidebarCollapsed）行为：
 *   - sidebar 缩成 48px icon rail
 *   - 所有文字、QuickActions、二级 / 三级菜单、chevron 全部隐藏
 *   - 「个人」点击行为保持（仍然切换二级菜单展开，只是子菜单不可见）
 *   - 复合 entry 右侧 chevron 也隐藏
 *   - 用户可随时展开 sidebar 重新看到多级菜单
 *
 * props：
 *   - t: 注入的 locale 文案函数
 *   - viewKey: 当前激活视图 key
 *   - selectedRequirementId: 当前打开详情的需求 id（用于三级子项 active 高亮）
 *   - onSelect: 点一级 entry / 二级子项 / 复合 entry 主区域回调
 *               （SkyAxisPage 把 controller.setView 包一层）
 *   - onPersonalToggle: 点「个人」group entry 回调
 *   - personalExpanded: 「个人」二级菜单是否展开
 *   - onRequirementsListToggle: 点复合 entry 右侧 chevron 回调
 *   - requirementsListExpanded: 「需求列表」三级子菜单是否展开
 *   - openRequirements: 未完成需求列表（来自 controller.getOpenRequirements()）
 *   - onSelectRequirement: 点三级需求子项回调（SkyAxisPage 包 controller.openDetail）
 *   - collapsed / onToggleCollapse: sidebar 折叠状态 + 切换回调
 *   - onNewRequirement / hasWorkspace: 顶部「新建需求」按钮
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RequirementEntry, SkyAxisViewKey,
} from '../../controller/sky-axis-controller.ts'
import type { IconComponent } from '../../icons/icons.tsx'
import type { SkyAxisKey } from '../../locales.ts'
import {
  HomeIcon, TeamIcon, PersonalIcon, PersonalOverviewIcon, ReportsIcon, SettingsIcon,
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

/** sidebar 二级子项 —— 当前只在「个人」下挂「概览」一个 leaf。
 *  「需求列表」是复合 entry，不在 ENTRIES.children 里维护，而是在 render 内
 *  作为「个人」group 的特殊子项手动追加（子项是动态的，源自 controller.getOpenRequirements）。 */
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
      { key: 'personal', Icon: PersonalOverviewIcon, labelKey: 'sidebar.personalOverview.label' },
    ],
  },
  { key: 'reports',  Icon: ReportsIcon,  labelKey: 'sidebar.reports.label' },
  { key: 'settings', Icon: SettingsIcon, labelKey: 'sidebar.settings.label' },
] as const

/** 「需求列表」复合 entry 配置 —— 单独常量化方便 render 复用。 */
const REQUIREMENTS_COMPOSITE: SidebarSubEntry = {
  key: 'requirements',
  Icon: RequirementIcon,
  labelKey: 'sidebar.requirements.label',
}

/** sidebar 是否折叠（来自 controller.sidebarCollapsed）。
 *  true → icon rail 模式（48px 宽，文字 / QuickActions / 二级菜单 隐藏，chevron 旋转 180°）。 */
export interface SkyAxisSidebarProps {
  /** Locale 文案函数（'sky-axis' 命名空间）。 */
  t: PropsLocale<'sky-axis'>['t']
  /** 当前激活视图 key（来自 controller.viewKey）。 */
  viewKey: SkyAxisViewKey
  /** 当前打开详情的需求 id（无则 null）—— 用于三级子项 active 高亮。 */
  selectedRequirementId: string | null
  /** 点击一级 / 二级 entry / 复合 entry 主区域回调。 */
  onSelect: (k: SkyAxisViewKey) => void
  /** 点击「个人」group entry 回调（只有 children 非空的 entry 才会触发）。 */
  onPersonalToggle: () => void
  /** sidebar「个人」分组二级菜单是否展开。 */
  personalExpanded: boolean
  /** 点击「需求列表」复合 entry 右侧 chevron 回调。 */
  onRequirementsListToggle: () => void
  /** sidebar「需求列表」子菜单是否展开（独立于 personalExpanded）。 */
  requirementsListExpanded: boolean
  /** 未完成需求列表（来自 controller.getOpenRequirements()，
   *  已过滤 status ∈ {open, in_progress} 并按 updatedAt 倒序）。 */
  openRequirements: readonly RequirementEntry[]
  /** 点击三级需求子项回调（SkyAxisPage 包 controller.openDetail）。 */
  onSelectRequirement: (id: string) => void
  /** sidebar 是否折叠（来自 controller.sidebarCollapsed）。
   *  true → icon rail 模式。 */
  collapsed: boolean
  /** 点击顶部 toggle 按钮回调。 */
  onToggleCollapse: () => void
  /** 点击「新建需求」按钮回调。 */
  onNewRequirement: () => void
  /** 当前是否有可用 workspace（空列表时「新建需求」按钮 disabled）。 */
  hasWorkspace: boolean
}

export function SkyAxisSidebar({
  t, viewKey, selectedRequirementId,
  onSelect, onPersonalToggle, personalExpanded,
  onRequirementsListToggle, requirementsListExpanded, openRequirements, onSelectRequirement,
  collapsed, onToggleCollapse, onNewRequirement, hasWorkspace,
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
          // group entry 是 toggle，不进视图 —— 任何时候都不高亮（哪怕 viewKey 恰好等于
          // group.key，例如 viewKey='personal' 让「个人」group 也被框成蓝色是 bug）。
          // 只有 leaf entry 才参与 active 计算；子项高亮由下面 subActive 处理。
          const active = !isGroup && e.key === viewKey
          // 「需求列表」复合 entry 是「个人」group 的特殊子项 —— 仅当 group 是「个人」时追加
          const showRequirementsComposite = e.key === 'personal'
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

                  {/* 「需求列表」复合 entry（macOS Finder 风格）：
                       左主按钮 = 进 RequirementsView（保留原入口）；右 chevron = 切子菜单展开。
                       子菜单（sub-sub 列表）放在下面，缩进更深。 */}
                  {showRequirementsComposite && (() => {
                    const ReqIcon = REQUIREMENTS_COMPOSITE.Icon
                    const reqMainActive = viewKey === 'requirements'
                    return (
                      <li className={css.subItem} key={REQUIREMENTS_COMPOSITE.key}>
                        <div className={css.compositeRow}>
                          <button
                            type="button"
                            className={reqMainActive ? `${css.entry} ${css.entryActive} ${css.compositeMain}` : `${css.entry} ${css.compositeMain}`}
                            aria-current={reqMainActive ? 'page' : undefined}
                            onClick={() => { onSelect('requirements') }}
                            title={t(REQUIREMENTS_COMPOSITE.labelKey)}
                          >
                            <ReqIcon size={14} className={css.entryIcon} />
                            <span className={css.entryLabel}>{t(REQUIREMENTS_COMPOSITE.labelKey)}</span>
                          </button>
                          <button
                            type="button"
                            className={css.compositeChevronButton}
                            aria-label={t(REQUIREMENTS_COMPOSITE.labelKey)}
                            aria-expanded={requirementsListExpanded}
                            onClick={onRequirementsListToggle}
                          >
                            <ChevronDownIcon
                              size={11}
                              className={`${css.entryChevron} ${requirementsListExpanded ? css.entryChevronExpanded : ''}`}
                            />
                          </button>
                        </div>

                        {/* 三级需求子菜单 —— 独立 ul，最大高度受限支持滚动 */}
                        <ul
                          className={`${css.subList} ${css.reqSubList} ${requirementsListExpanded ? css.subListExpanded : ''}`}
                          role="group"
                          aria-label={t('sidebar.requirementsList.groupAriaLabel')}
                        >
                          {openRequirements.length === 0 ? (
                            <li className={css.subItem}>
                              <span className={css.reqSubEmpty}>{t('sidebar.requirementsList.empty')}</span>
                            </li>
                          ) : openRequirements.map((req) => {
                            const subActive = selectedRequirementId === req.id
                            return (
                              <li key={req.id} className={css.subItem}>
                                <button
                                  type="button"
                                  className={subActive ? `${css.subEntry} ${css.reqSubEntry} ${css.entryActive}` : `${css.subEntry} ${css.reqSubEntry}`}
                                  aria-current={subActive ? 'page' : undefined}
                                  onClick={() => { onSelectRequirement(req.id) }}
                                  title={req.title}
                                >
                                  <span
                                    aria-hidden="true"
                                    className={`${css.reqSubEntryStatus} ${req.status === 'in_progress' ? css.reqSubEntryStatusProgress : css.reqSubEntryStatusOpen}`}
                                  />
                                  <span className={css.reqSubEntryTitle}>{req.title}</span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      </li>
                    )
                  })()}
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
