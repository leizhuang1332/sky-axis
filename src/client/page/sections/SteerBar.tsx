/**
 * SteerBar —— 介入点 #2「任务执行中实时插入指令」（PR-D / 迭代 6）。
 *
 * 设计意图：详情页底部 sticky bar（不打断 3 列布局；用户随时输入）。
 *   - 「插入指令」textarea（max 4000 字） + 「发送」按钮
 *   - 提交后清空输入框 + 「指令已暂存」toast（最近 3 条 inline 预览）
 *   - 最近指令显示在 bar 上方（最多 3 条最新）
 *
 * 数据契约：
 *   - text: string：当前输入框内容（受控）
 *   - onChange(next: string)：输入变化回调（父级 setState）
 *   - onSend(text: string)：发送回调（父级调 controller.steerSession）
 *   - submitting: boolean：提交中禁用输入 + 发送按钮
 *   - recentSends: 最近发送的指令列表（最多 3 条，从新到旧）
 *   - disabled?: boolean：整体禁用（如 detailLoading）
 *
 * i18n：所有 label 都用 t(key) 拿。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  CommentIcon, ChevronRightIcon, CheckIcon,
} from '../../icons/icons.tsx'
import css from './SteerBar.module.css'

export interface SteerSendRecord {
  /** 发送时刻（ISO）—— 显示「刚刚 / 5min 前」用。 */
  sentAt: string
  /** 文本内容（截断展示）。 */
  text: string
}

export interface SteerBarProps {
  t: PropsLocale<'sky-axis'>['t']
  text: string
  onChange: (next: string) => void
  onSend: (text: string) => void
  submitting: boolean
  recentSends: readonly SteerSendRecord[]
  /** 整体禁用（detailLoading 等）。 */
  disabled?: boolean
}

/** 把 ISO 时间戳格式化为「5s 前 / 2min 前 / 1h 前 / 2026-08-30 12:34」相对时间。 */
function formatRelative(iso: string, t: (k: string) => string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return iso
  const deltaMs = Date.now() - ts
  if (deltaMs < 60_000) return t('requirement.detail.conductor.justNow')
  if (deltaMs < 3_600_000) return t('requirement.detail.conductor.minutesAgo').replace('{n}', String(Math.floor(deltaMs / 60_000)))
  if (deltaMs < 86_400_000) return t('requirement.detail.conductor.hoursAgo').replace('{n}', String(Math.floor(deltaMs / 3_600_000)))
  return iso.slice(0, 10)
}

export function SteerBar(props: SteerBarProps): JSX.Element {
  const { t, text, onChange, onSend, submitting, recentSends, disabled = false } = props
  const tAny = t as unknown as (k: string) => string

  const canSend = text.trim() !== '' && !submitting && !disabled

  const handleSend = (): void => {
    if (!canSend) return
    onSend(text)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Ctrl+Enter / Cmd+Enter 发送
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <footer className={css.root} aria-label={tAny('requirement.detail.steer.label')}>
      {/* 最近 3 条指令预览 */}
      {recentSends.length > 0 && (
        <div className={css.recent}>
          <span className={css.recentLabel}>{tAny('requirement.detail.steer.recent')}</span>
          <ul className={css.recentList}>
            {recentSends.slice(0, 3).map((rec, idx) => (
              <li key={`${rec.sentAt}-${idx}`} className={css.recentItem}>
                <CheckIcon size={11} className={css.recentIcon} />
                <span className={css.recentTime}>{formatRelative(rec.sentAt, tAny)}</span>
                <span className={css.recentText}>{rec.text.length > 80 ? `${rec.text.slice(0, 80)}…` : rec.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={css.inputRow}>
        <span className={css.inputIcon} aria-hidden="true">
          <CommentIcon size={14} className={css.inputIconSvg} />
        </span>
        <textarea
          className={css.textarea}
          rows={1}
          maxLength={4000}
          placeholder={tAny('requirement.detail.steer.placeholder')}
          value={text}
          disabled={disabled || submitting}
          onChange={(e): void => { onChange(e.target.value) }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={css.sendButton}
          onClick={handleSend}
          disabled={!canSend}
          title={tAny('requirement.detail.steer.sendHint')}
          aria-label={tAny('requirement.detail.steer.send')}
        >
          <ChevronRightIcon size={14} className={css.sendIcon} />
          <span>{tAny('requirement.detail.steer.send')}</span>
        </button>
      </div>
    </footer>
  )
}
