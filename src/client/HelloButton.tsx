/**
 * Sidebar footer entry for the hello plugin: 36px 圆形 icon 按钮，点击
 * 弹出多功能 hello 面板（HelloPanel）。
 * 注册到 sidebar.footer.action 列表槽位。
 */
import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListReadSource } from './widgets/types.ts'
import { HelloPanel } from './HelloPanel.tsx'
import css from './hello.module.css'

/** Sidebar 槽位提供的 prop：sidebar 列状态 + 注入的面板数据 + 文案座位。 */
export type HelloButtonProps = PropsLocale<'hello'> & {
  /** sidebar 是否为宽列（false = 56px rail）。 */
  wide: boolean
  /** 由 apply() 注入：sessions.list 只读面。 */
  list: SessionListReadSource
}

/** 简易 emoji 图标。 */
function HelloIcon(): JSX.Element {
  return (
    <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
      👋
    </span>
  )
}

/**
 * 渲染 sidebar footer trigger 与（可选的）portal 多功能面板。
 * @param props - 槽位提供的 prop（wide 状态 + 注入的 list + t 文案）。
 */
export function HelloButton({ wide, list, t }: HelloButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const onClose = (): void => { setOpen(false) }

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
        <HelloPanel t={t} onClose={onClose} list={list} />,
        document.body,
      )}
    </>
  )
}