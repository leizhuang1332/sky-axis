/**
 * Toast —— 全局错误 / 提示浮层。
 *
 * 设计：
 *   - 订阅 controller.requirementsError + detailError；任一非 null 时显示
 *   - 4s 自动消失（用户点 × 立即消失）
 *   - 右上角固定定位，3 个同时可见（堆叠）
 *   - 错误码映射文案：
 *     - ai-not-configured / ai-session-missing / ai-event-failed → 黄条（warning）
 *     - 其它 → 红条（error）
 *   - 关闭后调 controller 端的错误清空 API（TODO Phase 2 加 clearError）
 *
 * Phase 1 限制：
 *   - 仅订阅 + 显示错误；不主动 dismiss 写回 controller（避免双向绑定污染）。
 *   - 等 4s 后只在本地 setState 隐藏，再显示新错误。
 *
 * 数据流：
 *   useSyncExternalStore(controller.subscribe, controller.getSnapshot) → 读 error
 *   本地 useState<ToastItem[]> 维护堆叠；4s 后用 setTimeout 移除。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SkyAxisController, RequirementError } from '../controller/sky-axis-controller.ts'
import css from './Toast.module.css'

/** 单条 toast 内容。 */
export interface ToastItem {
  /** 唯一 id（用错误 detail 或时间戳生成）。 */
  id: string
  /** 文案 key 前缀（与 i18n 对接）。 */
  message: string
  /** 错误级别（决定配色）。 */
  level: 'error' | 'warning'
}

/** Toast 显示时长（4s）。 */
const TOAST_DURATION_MS = 4000

/** 错误码 → 级别映射（决定 toast 配色）。 */
function errorLevel(code: RequirementError['code']): 'error' | 'warning' {
  if (
    code === 'ai-not-configured'
    || code === 'ai-session-missing'
    || code === 'ai-event-failed'
  ) {
    return 'warning'
  }
  return 'error'
}

export interface ToastProps {
  /** sky-axis 控制器（订阅 error）。 */
  controller: SkyAxisController
  /** locale 文案函数。 */
  t: (key: string) => string
}

export function Toast({ controller, t }: ToastProps): JSX.Element {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  // 维护「上一次显示过的错误 code」用于去重（避免同一个 error 重复入栈）
  const lastShownRef = useRef<{ code: string; detail: string | undefined } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 监听 errors → 新错误入栈
  useEffect(() => {
    const err = snapshot.requirementsError ?? snapshot.detailError
    if (err === null) {
      lastShownRef.current = null
      return
    }
    const sig = `${err.code}:${err.detail ?? ''}`
    if (lastShownRef.current !== null && `${lastShownRef.current.code}:${lastShownRef.current.detail ?? ''}` === sig) {
      return
    }
    lastShownRef.current = { code: err.code, detail: err.detail }
    const message = err.detail !== undefined
      ? `${t(`requirement.error.${err.code}`)}：${err.detail}`
      : t(`requirement.error.${err.code}`)
    const item: ToastItem = {
      id: sig,
      message,
      level: errorLevel(err.code),
    }
    setToasts(prev => [...prev, item].slice(-3))
  }, [snapshot.requirementsError, snapshot.detailError, t])

  // 4s 后自动 dismiss
  useEffect(() => {
    if (toasts.length === 0) return
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setToasts(prev => prev.slice(1))
    }, TOAST_DURATION_MS)
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [toasts])

  // 用户点关闭按钮
  const dismiss = (id: string): void => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  if (toasts.length === 0) return <></>

  return (
    <div className={css.container} role="status" aria-live="polite">
      {toasts.map(item => (
        <div
          key={item.id}
          className={item.level === 'warning' ? `${css.toast} ${css.toastWarning}` : `${css.toast} ${css.toastError}`}
        >
          <span className={css.message}>{item.message}</span>
          <button
            type="button"
            className={css.closeButton}
            onClick={() => { dismiss(item.id) }}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}