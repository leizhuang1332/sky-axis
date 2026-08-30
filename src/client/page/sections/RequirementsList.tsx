/**
 * 「需求列表」组件 —— 显示 controller.requirements，按 workspaceId 分组。
 *
 * 视觉：每组顶部一行 workspace title（join workspaces，找不到显示 id + 「（已移除）」）；
 *       组内按时间倒序的 requirement 卡片：title / priority / status / 创建时间 / tags / 删除按钮。
 *
 * stale 处理（与 task-board workspaceKnown 模式一致）：
 *   - 当 requirement.workspaceId 不在当前 workspaces 列表中时，group header 标注「（工作区已删除）」
 *   - workspace title 缺失时显示 id 前 12 字符 + 省略号
 *
 * props 全部受控，parent 传 controller 拿到的快照。
 */
import { useMemo } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RequirementEntry,
  RequirementOption,
} from '../../controller/sky-axis-controller.ts'
import css from './requirements-list.module.css'

export interface RequirementsListProps {
  t: PropsLocale<'sky-axis'>['t']
  requirements: readonly RequirementEntry[]
  workspaces: readonly RequirementOption[]
  loading: boolean
  error: { code: string; detail?: string } | null
  onDelete: (id: string) => void
}

/** 把 ISO 时间戳格式化为「YYYY-MM-DD HH:mm」（loc 无关、紧凑）。 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const pad = (n: number): string => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

interface Group {
  workspaceId: string
  /** 展示标题。 */
  title: string
  /** workspace 当前是否在 workspaces 列表里。 */
  known: boolean
  items: RequirementEntry[]
}

/** 按 workspaceId 分组，保持插入顺序（workspaces 顺序优先，其次是 stale 项）。 */
function groupByWorkspace(
  requirements: readonly RequirementEntry[],
  workspaces: readonly RequirementOption[],
): Group[] {
  const byId = new Map<string, RequirementEntry[]>()
  for (const r of requirements) {
    const list = byId.get(r.workspaceId) ?? []
    list.push(r)
    byId.set(r.workspaceId, list)
  }
  const groups: Group[] = []
  // 先按 workspaces 列表顺序
  for (const ws of workspaces) {
    const items = byId.get(ws.id)
    if (items !== undefined) {
      // 组内按 id 倒序（最新在前）
      groups.push({ workspaceId: ws.id, title: ws.title, known: true, items: [...items].sort((a, b) => b.id.localeCompare(a.id)) })
      byId.delete(ws.id)
    }
  }
  // 再补 stale（workspaces 列表里没有的）
  for (const [id, items] of byId) {
    groups.push({ workspaceId: id, title: id.slice(0, 12) + (id.length > 12 ? '…' : ''), known: false, items: [...items].sort((a, b) => b.id.localeCompare(a.id)) })
  }
  return groups
}

/** status 标签色（priority 同款，CSS 变量驱动明/暗主题）。 */
function statusClass(s: RequirementEntry['status']): string {
  switch (s) {
    case 'open':         return css.statusOpen
    case 'in_progress':  return css.statusInProgress
    case 'done':         return css.statusDone
    case 'cancelled':    return css.statusCancelled
  }
}

export function RequirementsList(props: RequirementsListProps): JSX.Element {
  const { t, requirements, workspaces, loading, error, onDelete } = props
  const groups = useMemo(() => groupByWorkspace(requirements, workspaces), [requirements, workspaces])

  if (loading && requirements.length === 0) {
    return <div className={css.empty}>{t('requirement.list.loading')}</div>
  }

  if (error !== null && requirements.length === 0) {
    return (
      <div className={css.errorState}>
        <strong>{t('requirement.list.errorPrefix')}</strong>
        <span>{t(`requirement.error.${error.code}` as never)}</span>
        {error.detail !== undefined && <code>{error.detail}</code>}
      </div>
    )
  }

  if (groups.length === 0) {
    return <div className={css.empty}>{t('requirement.list.empty')}</div>
  }

  return (
    <div className={css.root}>
      {groups.map(group => (
        <section key={group.workspaceId} className={css.group}>
          <header className={css.groupHeader}>
            <h3 className={css.groupTitle}>
              {group.title}
              {!group.known && <span className={css.staleTag}>{t('requirement.workspace.removed')}</span>}
            </h3>
            <span className={css.groupCount}>{group.items.length}</span>
          </header>
          <ul className={css.items}>
            {group.items.map(item => (
              <li key={item.id} className={css.item}>
                <div className={css.itemMain}>
                  <div className={css.itemTitleRow}>
                    <span className={css.itemTitle}>{item.title}</span>
                    <span className={`${css.statusPill} ${statusClass(item.status)}`}>{t(`requirement.status.${item.status}`)}</span>
                    <span className={`${css.priority} ${css[`priority_${item.priority}`]}`}>{t(`requirement.priority.${item.priority}`)}</span>
                  </div>
                  {item.description !== '' && <p className={css.itemDescription}>{item.description}</p>}
                  <div className={css.itemMeta}>
                    <span className={css.itemTime}>{formatTime(item.createdAt)}</span>
                    {item.tags.length > 0 && (
                      <span className={css.itemTags}>
                        {item.tags.map(tag => <span key={tag} className={css.tag}>#{tag}</span>)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className={css.deleteButton}
                  onClick={() => { onDelete(item.id) }}
                  aria-label={t('requirement.list.delete')}
                  title={t('requirement.list.delete')}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
