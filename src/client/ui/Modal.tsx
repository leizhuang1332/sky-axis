/**
 * Modal —— 通用模态弹窗（沿用 NewRequirementModal 的视觉骨架）。
 *
 * 抽出公共 15 个 CSS class，避免每个使用 modal 的组件都重复粘贴；
 * NewRequirementModal 改为包一层 <Modal>。
 *
 * 用法：
 *   <Modal title="标题" onClose={() => setOpen(false)} footer={<div>...</div>}>
 *     <form>...</form>
 *   </Modal>
 *
 * 视觉契约：
 *   - overlay: 全屏半透明遮罩（fixed inset:0）+ 居中（flex center）+ fadeIn 动画
 *   - root: 白底卡片 12px 圆角 + box-shadow + max-height: 90vh + overflow-y: auto
 *   - header: 标题区（左侧 title + 右侧关闭按钮）
 *   - body: 内容区（padding 20）
 *   - footer: 操作按钮区（padding-top 12 + border-top）
 *
 * 交互契约：
 *   - 按 ESC 关闭（受控 —— onClose 触发；调用方决定是否 setOpen(false)）
 *   - 点 overlay 关闭（点 root 内部不关闭）
 *   - 关闭按钮 hover 有反馈
 */
import { useEffect, type ReactNode } from 'react'
import css from './Modal.module.css'

export interface ModalProps {
  /** 标题（必填，让 header 永远有内容）。 */
  title: string
  /** 关闭回调（必填；按 ESC / 点 overlay / 点关闭按钮均触发）。 */
  onClose: () => void
  /** 弹窗内容（表单 / 列表 / 提示等）。 */
  children: ReactNode
  /** 底部操作区（按钮组）；可选。 */
  footer?: ReactNode
  /** 弹窗最大宽度（px）；默认 560。 */
  maxWidth?: number
}

export function Modal({ title, onClose, children, footer, maxWidth }: ModalProps): JSX.Element {
  // 按 ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => { document.removeEventListener('keydown', handler) }
  }, [onClose])

  // 点 overlay 关闭（点 root 内部冒泡到这里）
  const onOverlayClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose()
  }

  const style = maxWidth !== undefined ? { maxWidth: `${maxWidth}px` } : undefined

  return (
    <div className={css.overlay} onClick={onOverlayClick} role="presentation">
      <div className={css.root} style={style} role="dialog" aria-modal="true" aria-label={title}>
        <header className={css.header}>
          <h2 className={css.title}>{title}</h2>
          <button
            type="button"
            className={css.closeButton}
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>
        <div className={css.body}>{children}</div>
        {footer !== undefined && <footer className={css.footer}>{footer}</footer>}
      </div>
    </div>
  )
}