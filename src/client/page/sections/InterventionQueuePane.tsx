/**
 * InterventionQueuePane —— 详情页右 25% 列「介入队列」面板。
 *
 * Phase 1 范围：
 *   - 显示介入项列表（按 createdAt 倒序）
 *   - 每张卡显示 kind + summary + 简化操作按钮（Phase 1 全部 disabled）
 *   - 队列空时显示空状态文案
 *
 * Phase 3 增量：
 *   - 接入 approval/question 应答 → ctx.session.respond(0.1.2,原 ctx.apiProxy)
 *   - 队列项实时更新（push / remove via SSE interventionAdded / interventionRemoved）
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementInterventionItem } from '../../controller/sky-axis-controller.ts'
import {
  EyeIcon, PinIcon, CommentIcon,
} from '../../icons/icons.tsx'
import css from './InterventionQueuePane.module.css'

export interface InterventionQueuePaneProps {
  t: PropsLocale<'sky-axis'>['t']
  items: readonly RequirementInterventionItem[]
}

/** kind → 图标 + 配色 + 文案 key（labelKey 是 string，调用 t() 时强转）。 */
function kindMeta(kind: RequirementInterventionItem['kind']): {
  Icon: (p: { size?: number; className?: string }) => JSX.Element
  labelKey: string
  level: 'approval' | 'question' | 'review'
} {
  switch (kind) {
    case 'approval': return { Icon: PinIcon,    labelKey: 'requirement.detail.queue.section.approval', level: 'approval' }
    case 'question': return { Icon: CommentIcon, labelKey: 'requirement.detail.queue.section.question', level: 'question' }
    case 'review':   return { Icon: EyeIcon,    labelKey: 'requirement.detail.queue.section.review',   level: 'review' }
  }
}

/** 把 ISO 时间戳格式化为「HH:mm」相对时间。 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const pad = (n: number): string => n.toString().padStart(2, '0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

export function InterventionQueuePane({ t, items }: InterventionQueuePaneProps): JSX.Element {
  // t 强转为 (k: string) => string —— 让 labelKey 动态字符串可传入
  const tAny = t as unknown as (k: string) => string
  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (
    <div className={css.pane}>
      <header className={css.header}>
        <h3 className={css.title}>{t('requirement.detail.queue.title')}</h3>
        <span className={css.count}>{items.length}</span>
      </header>

      {sorted.length === 0 ? (
        <div className={css.empty}>
          <span className={css.emptyIcon} aria-hidden="true">○</span>
          <p className={css.emptyText}>{t('requirement.detail.queue.empty')}</p>
        </div>
      ) : (
        <ul className={css.list}>
          {sorted.map(item => {
            const meta = kindMeta(item.kind)
            return (
              <li key={item.id} className={`${css.card} ${css[`card_${meta.level}` as 'card_approval']}`}>
                <div className={css.cardHeader}>
                  <span className={css.cardKind}>
                    <meta.Icon size={11} className={css.cardIcon} />
                    <span>{tAny(meta.labelKey)}</span>
                  </span>
                  <span className={css.cardTime}>{formatTime(item.createdAt)}</span>
                </div>
                <p className={css.cardSummary}>{item.summary}</p>
                <div className={css.cardActions}>
                  <button
                    type="button"
                    className={css.cardActionApprove}
                    disabled
                    title={t('requirement.detail.queue.approveHint')}
                  >
                    {t('requirement.detail.queue.approve')}
                  </button>
                  <button
                    type="button"
                    className={css.cardActionReject}
                    disabled
                    title={t('requirement.detail.queue.rejectHint')}
                  >
                    {t('requirement.detail.queue.reject')}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Phase 1 占位 */}
      <div className={css.placeholder}>
        <p className={css.placeholderText}>{t('requirement.detail.queue.phase1Hint')}</p>
      </div>
    </div>
  )
}

/** 让 component 标识别名在 DevTools 友好。 */
InterventionQueuePane.displayName = 'InterventionQueuePane'