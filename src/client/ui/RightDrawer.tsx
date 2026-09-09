/**
 * RightDrawer —— 右侧滑入抽屉（PR-C / 迭代 4 用于 RewindDrawer）。
 *
 * 视觉/交互契约与 Modal 一致（ESC + overlay-click 关闭，role=dialog + aria-modal + aria-label），
 * 区别只在 layout：右侧贴边 + 从右滑入 + 左圆角 + 最大宽度可控。
 *
 * 设计参考 design §2.2 rewind UI（右侧抽屉避免遮挡 conductor 主流程）。
 *
 * 用法：
 *   <RightDrawer title="回退到..." onClose={() => setOpen(false)}>
 *     <RewindDrawerForm ... />
 *   </RightDrawer>
 */
import { useEffect, type ReactNode } from 'react'
import css from './RightDrawer.module.css'

export interface RightDrawerProps {
  /** 标题（必填，让 header 永远有内容）。 */
  title: string
  /** 关闭回调（按 ESC / 点 overlay / 点关闭按钮均触发）。 */
  onClose: () => void
  /** 抽屉内容（表单 / 列表 / 提示等）。 */
  children: ReactNode
  /** 底部操作区（按钮组）；可选。 */
  footer?: ReactNode
  /** 抽屉宽度（px）；默认 420。 */
  width?: number
  /** 加载中文案（可选；显示在 header 右侧）。 */
  loading?: boolean
}

export function RightDrawer({
  title,
  onClose,
  children,
  footer,
  width,
  loading,
}: RightDrawerProps): JSX.Element {
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

  const style = width !== undefined ? { width: `min(${width}px, 92vw)` } : undefined

  return (
    <div className={css.overlay} onClick={onOverlayClick} role="presentation">
      <aside
        className={css.root}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className={css.header}>
          <h2 className={css.title}>{title}</h2>
          <div className={css.headerRight}>
              {loading === true && <span className={css.loadingTag}>处理中…</span>}
              <button
                type="button"
                className={css.closeButton}
                onClick={onClose}
                aria-label="关闭"
                disabled={loading === true}
              >
                ×
              </button>
            </div>
        </header>
        <div className={css.body}>{children}</div>
        {footer !== undefined && <footer className={css.footer}>{footer}</footer>}
      </aside>
    </div>
  )
}