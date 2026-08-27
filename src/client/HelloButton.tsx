/**
 * Sidebar footer entry for the hello plugin: 36px 圆形 icon 按钮，点击
 * 弹出居中弹窗显示 hello world。注册到官方 sidebar.footer.action 列表
 * 槽位（由 ui-sidebar 声明，与 dsh-remote-web-ui / dsh-session-id 共享席位）。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './hello.module.css'

/** Sidebar 槽位提供的注入 prop：sidebar 列状态 + 文案字典座位。 */
export type HelloButtonProps = PropsLocale<'hello'> & {
  /** sidebar 是否为宽列（false = 56px rail）。 */
  wide: boolean
}

/** 简易 emoji 图标，避免引入额外 icon 资源。 */
function HelloIcon(): JSX.Element {
  return (
    <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
      👋
    </span>
  )
}

/**
 * 居中弹窗：受控显示，遮罩点击关闭，按 Esc 关闭。挂到 document.body 上
 * （createPortal），不污染 sidebar 节点。
 */
function HelloDialog({ onClose, t }: { onClose: () => void; t: PropsLocale<'hello'>['t'] }): JSX.Element {
  // Esc 关闭 —— 必须在挂载后绑定，卸载时清理，避免内存泄漏。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  return (
    <div
      className={css.mask}
      role="presentation"
      onClick={(e) => {
        // 点击遮罩关闭，但点击卡片本身不关
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={css.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hello-dialog-title"
      >
        <h2 id="hello-dialog-title" className={css.title}>{t('dialog.title')}</h2>
        <p className={css.body}>{t('dialog.greeting')}</p>
        <div className={css.actions}>
          <button
            type="button"
            className={css.close}
            onClick={onClose}
            autoFocus
          >
            {t('dialog.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * 渲染 sidebar footer trigger 与（可选的）portal 弹窗。
 * @param props - 槽位提供的 prop（wide 状态 + t 文案函数）。
 * @returns trigger 按钮 + 弹窗 portal。
 */
export function HelloButton({ wide, t }: HelloButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className={css.trigger}
        data-dsh-plugin="hello"
        data-dsh-part="entry"
        data-wide={wide ? 'wide' : 'rail'}
        aria-label={t('entry.label')}
        title={t('entry.tooltip')}
        onClick={() => { setOpen(true) }}
      >
        <HelloIcon />
      </button>
      {open && createPortal(
        <HelloDialog onClose={() => { setOpen(false) }} t={t} />,
        document.body,
      )}
    </>
  )
}