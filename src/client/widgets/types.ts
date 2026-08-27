/**
 * 透传官方 sessions.list 只读面契约（来自 dsh-session-id 范例）。
 * apply() 在 register 时包装 ctx.sessions.list 并通过 inject 传给组件。
 *
 * 直接使用官方 SessionListState 类型 —— 自定义类型会和 dsh-client-runtime
 * 的真实导出产生形状偏差（已通过 typecheck 验证）。
 */
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'

/** 只读订阅面 —— 组件用 useSyncExternalStore 消费。 */
export interface SessionListReadSource {
  getSnapshot(): SessionListState
  subscribe(listener: () => void): () => void
}