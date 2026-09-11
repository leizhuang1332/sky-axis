/**
 * ai-event-bridge —— 把 DSH session follow 流翻译成 sky-axis aiState 变化 + 阶段推进 + plan artifact。
 *
 * 接入 0-1：基础 aiState 映射（snapshot / turn/start / turn/end）。
 * 接入 2：扩展两条核心事件：
 *   1. tool/call 'advance_stage' → 调 onAdvanceStage(toStage, reason) 推进 stageHistory
 *   2. assistant/message（currentStage ∈ {plan, understand}）→ JSON 抽取 + zod 校验
 *      → 调 onPlanArtifact(taskList, now) 写 Artifact(kind='plan')
 *
 * 帧 dispatch（SessionFollowFrame = {type:'snapshot'} | SessionEventEntry）：
 *   - type='snapshot'（首帧 baseline）→ onAiStateChange('running') —— session 活跃中
 *   - type='event' → 按 event.type 分支：
 *       'turn/start'                          → running
 *       'turn/end'                            → idle（正常）/ errored（异常 reason）
 *       'tool/call'                           → name==='advance_stage' → onAdvanceStage(toStage, reason)
 *                                              其他 tool → 忽略
 *       'assistant/message'                   → currentStage ∈ {plan, understand} → JSON 抽取 → onPlanArtifact
 *                                              其他 stage → 忽略
 *       assistant/chunk | tool/result | user/message | todo/write | request/* | session/* | step/* → 忽略
 *       未知 type                              → 忽略（向前兼容 —— DSH event 名是 merge-extensible）
 *
 * 生命周期：
 *   - signal.aborted → 退出 for-await
 *   - 流正常结束 → 调用方（consumeSessionFollow）兜底置 idle
 *   - 流抛错     → 调用方 catch + 退避重连
 *
 * tool/call 事件 payload（[dsh-session/lib/types/types.d.ts:303-309](../../node_modules/.pnpm/@deepseek-ai+dsh-session@0._ee5063a80d448ae764858c08e7528ed1/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts#L303-L309)）：
 *   `{ turn, step, callId, name: string, arguments: string }`（arguments 是 JSON 字符串）
 */
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'

/** aiState 字面量（与 protocol.ts AiStateSchema 对齐）。 */
export type AiState = 'idle' | 'running' | 'paused' | 'awaiting-input' | 'errored'

/** advance_stage tool 的合法 toStage（与 protocol.ts StageSchema 子集对齐）。 */
export type AdvanceStage = 'plan' | 'implement' | 'verify' | 'deliver'

/** 当前 requirement 的 stage（plan artifact 提取阶段门控用）。 */
export type CurrentStage = 'understand' | 'plan' | 'implement' | 'verify' | 'deliver'

/** TaskList —— plan artifact body JSON 反序列化结果（与 protocol.ts TaskListSchema 对齐）。
 *  bridge 只取必要字段，不强 import protocol（避免循环依赖）。 */
export interface BridgeTaskList {
  readonly tasks: ReadonlyArray<{
    readonly id: string
    readonly title: string
    readonly goal: string
    readonly acceptance: readonly string[]
    readonly dependencies: readonly string[]
    readonly filesExpected: readonly string[]
    readonly status: string
    readonly subHistory: ReadonlyArray<unknown>
    readonly artifactRefs: readonly string[]
    readonly retryCount: number
    readonly lastDriftScore?: number
    readonly enteredAt: string
  }>
  readonly producedAt: string
  readonly producedAtStage: CurrentStage
}

/** consumeFollowStream 的入参。 */
export interface ConsumeFollowStreamArgs {
  /** DSH host 半区 SessionController（由 reqSvc 注入）。 */
  readonly sessionController: SessionController
  /** 要 follow 的 DSH session id。 */
  readonly sessionId: string
  /** 取消信号 —— abort 后立即退出 for-await。 */
  readonly signal: AbortSignal
  /** aiState 变化回调（接入 0-1）。 */
  readonly onAiStateChange: (state: AiState, activityAt: string) => Promise<void>
  /** 接入 2：tool/call 'advance_stage' 事件回调。reqSvc 内部 updateRequirements + emitChange put。 */
  readonly onAdvanceStage: (toStage: AdvanceStage, reason: string, activityAt: string) => Promise<void>
  /** 接入 2：assistant/message 中 plan JSON 抽取后的回调。reqSvc 内部 writeArtifact('plan', ...)。 */
  readonly onPlanArtifact: (taskList: BridgeTaskList, activityAt: string) => Promise<void>
  /** 接入 2：当前 requirement 的 stage（plan artifact 提取阶段门控）。 */
  readonly currentStage: () => CurrentStage
}

/** DSH tool/call 事件 data 形态（最窄子集；DSH 真实事件含 turn/step/callId，但 bridge 不消费）。 */
interface ToolCallData {
  readonly name?: string
  readonly arguments?: string
}

/** DSH assistant/message 事件 data 形态（最窄子集）。 */
interface AssistantMessageData {
  readonly message?: {
    readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>
  }
}

/**
 * 消费 DSH session follow 流，把帧翻译成 aiState 变化 / 阶段推进 / plan artifact。
 *
 * 不做重连 —— 由调用方（reqSvc.consumeSessionFollow）的 while 循环负责。
 */
export async function consumeFollowStream(args: ConsumeFollowStreamArgs): Promise<void> {
  const { sessionController, sessionId, signal, onAiStateChange, onAdvanceStage, onPlanArtifact, currentStage } = args
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
      await onAiStateChange('running', new Date().toISOString())
      continue
    }

    const eventType = frame.event?.type
    const now = new Date().toISOString()

    switch (eventType) {
      case 'turn/start':
        await onAiStateChange('running', now)
        break
      case 'turn/end': {
        const data = frame.event?.data as { reason?: string } | undefined
        const reason = data?.reason ?? ''
        const isAbnormal = reason !== '' && reason !== 'complete' && reason !== 'end_turn' && reason !== 'stop'
        await onAiStateChange(isAbnormal ? 'errored' : 'idle', now)
        break
      }

      // 接入 2：tool/call 拆出 advance_stage 识别
      case 'tool/call': {
        const data = frame.event?.data as ToolCallData | undefined
        if (data?.name === 'advance_stage' && typeof data.arguments === 'string') {
          let parsed: { toStage?: unknown; reason?: unknown } = {}
          try { parsed = JSON.parse(data.arguments) as { toStage?: unknown; reason?: unknown } } catch { /* ignore */ }
          const toStage = typeof parsed.toStage === 'string' ? parsed.toStage : undefined
          const reason = typeof parsed.reason === 'string' ? parsed.reason : ''
          if (toStage === 'plan' || toStage === 'implement' || toStage === 'verify' || toStage === 'deliver') {
            await onAdvanceStage(toStage, reason, now)
          }
        }
        break
      }

      // 接入 2：assistant/message 拆出 plan JSON 提取
      case 'assistant/message': {
        // 阶段门控：仅在 understand/plan 阶段抽取（其他阶段产物由接入 3+ 处理）
        const stage = currentStage()
        if (stage !== 'understand' && stage !== 'plan') break
        const data = frame.event?.data as AssistantMessageData | undefined
        const blocks = data?.message?.content ?? []
        // 抽取 text block 拼接 → JSON.parse → BridgeTaskList 校验
        const text = blocks
          .filter((b): b is { type: 'text'; text: string } => b?.type === 'text' && typeof b.text === 'string')
          .map(b => b.text)
          .join('')
        if (text.trim() === '') break
        let parsed: unknown
        try { parsed = JSON.parse(text) } catch { /* ignore */ }
        if (parsed === undefined || typeof parsed !== 'object' || parsed === null) break
        // 极简 schema 校验（不 import protocol TaskListSchema，避免循环依赖；reqSvc 侧再校验一次）
        const obj = parsed as Record<string, unknown>
        if (!Array.isArray(obj['tasks'])) break
        if (typeof obj['producedAt'] !== 'string') break
        if (typeof obj['producedAtStage'] !== 'string') break
        if (obj['producedAtStage'] !== 'understand' && obj['producedAtStage'] !== 'plan' &&
            obj['producedAtStage'] !== 'implement' && obj['producedAtStage'] !== 'verify' && obj['producedAtStage'] !== 'deliver') break
        await onPlanArtifact(parsed as BridgeTaskList, now)
        break
      }

      // 其他事件类型：接入 2+ 处理（artifact 提取 / task list 映射 / stage 推进）
      case 'assistant/chunk':
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