/**
 * ai-event-bridge —— 把 DSH session follow 流翻译成 sky-axis aiState 变化。
 *
 * 接入 1（最小可见闭环）核心新增件。
 *
 * 职责：
 *   - 消费 `sessionController.follow({address:{kind:'session',sessionId}}, signal)`
 *     的 `AsyncIterable<SessionFollowFrame>`
 *   - 把 DSH 的 turn/step 事件翻译成 sky-axis 的 aiState（idle/running/errored）
 *   - 通过 `onAiStateChange` callback 回写给 RequirementHostService（不直接操作
 *     mate.yaml，保持职责单一 —— reqSvc 内部 updateRequirements + emitChange put）
 *
 * 接入 0-1 只处理状态映射；artifact 提取 / task list 映射 / stage 推进判定
 * 是接入 2+ 的事（见 docs/ai工作台接入dsh-agent-session-架构预览.md §3 节点3/8）。
 *
 * 帧 dispatch（SessionFollowFrame = {type:'snapshot'} | SessionEventEntry）：
 *   - type='snapshot'（首帧 baseline）→ onAiStateChange('running') —— session 活跃中
 *   - type='event' → 按 event.type 分支：
 *       'turn/start'   → running
 *       'turn/end'     → idle（正常）/ errored（异常 reason）
 *       assistant/chunk | assistant/message | tool/* | user/message | todo/write → 忽略（接入 2+）
 *       未知 type     → 忽略（向前兼容 —— DSH event 名是 merge-extensible）
 *
 * 生命周期：
 *   - signal.aborted → 退出 for-await（reqSvc 的 stopFollow / close 触发）
 *   - 流正常结束（generator return）→ 调用方 consumeSessionFollow 兜底置 idle
 *   - 流抛错 → 调用方 catch + 退避重连（同 consumeWorkspaceFollow 范式）
 */
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'

/** aiState 字面量（与 protocol.ts AiStateSchema 对齐）。 */
export type AiState = 'idle' | 'running' | 'paused' | 'awaiting-input' | 'errored'

/** consumeFollowStream 的入参。 */
export interface ConsumeFollowStreamArgs {
  /** DSH host 半区 SessionController（由 reqSvc 注入）。 */
  readonly sessionController: SessionController
  /** 要 follow 的 DSH session id。 */
  readonly sessionId: string
  /** 取消信号 —— abort 后立即退出 for-await。 */
  readonly signal: AbortSignal
  /**
   * aiState 变化回调 —— reqSvc 注入，内部 updateRequirements 写回 mate.yaml
   * + emitChange put 推 SSE。reqSvc 内部做 lastAiState 去重防抖。
   * @param state 新的 aiState
   * @param activityAt ISO 时间戳（UI「N 秒前活跃」用）
   */
  readonly onAiStateChange: (state: AiState, activityAt: string) => Promise<void>
}

/**
 * 消费 DSH session follow 流，把帧翻译成 aiState 变化。
 *
 * 不做重连 —— 重连由调用方（reqSvc.consumeSessionFollow）的 while 循环负责，
 * 与 consumeWorkspaceFollow 范式一致。本函数只跑一轮 follow 流。
 */
export async function consumeFollowStream(args: ConsumeFollowStreamArgs): Promise<void> {
  const { sessionController, sessionId, signal, onAiStateChange } = args
  // follow 入参：address 指向 session（非 subagent）
  const request = {
    address: { kind: 'session', sessionId: sessionId as never },
    maxMessages: 200,
  } as never

  for await (const frame of sessionController.follow(request, signal) as AsyncIterable<{
    readonly type: 'snapshot' | 'event'
    readonly event?: { readonly type: string; readonly data?: unknown }
  }>) {
    if (signal.aborted) return

    if (frame.type === 'snapshot') {
      // 首帧 baseline —— session 活跃中
      await onAiStateChange('running', new Date().toISOString())
      continue
    }

    // type === 'event' —— 按 event.type 分支
    const eventType = frame.event?.type
    const now = new Date().toISOString()
    switch (eventType) {
      case 'turn/start':
        await onAiStateChange('running', now)
        break
      case 'turn/end': {
        // data 里可能带 reason；异常 reason → errored，否则 idle
        const data = frame.event?.data as { reason?: string } | undefined
        const reason = data?.reason ?? ''
        const isAbnormal = reason !== '' && reason !== 'complete' && reason !== 'end_turn' && reason !== 'stop'
        await onAiStateChange(isAbnormal ? 'errored' : 'idle', now)
        break
      }
      // 接入 2+：assistant/message → artifact 提取；tool/* → artifact (patch)；
      // todo/write → task list 映射；user/message → 不处理。接入 0-1 全忽略。
      case 'assistant/chunk':
      case 'assistant/message':
      case 'tool/call':
      case 'tool/result':
      case 'user/message':
      case 'todo/write':
      case 'request/header':
      case 'request/context':
      case 'session/end-seed':
      case 'step/start':
      case 'step/end':
        break
      default:
        // 未知 event type —— DSH event 名是 merge-extensible，向前兼容忽略
        break
    }
  }
}
