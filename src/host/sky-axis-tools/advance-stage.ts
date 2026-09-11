/**
 * sky-axis 专属 tool —— `advance_stage(toStage)`。
 *
 * 接入 2（最小可见推进闭环）核心新增件。
 *
 * 职责：
 *   - 提供给 sky-axis-collaborator preset 的 agent 一个主动推进 5 阶段的 tool。
 *   - tool body 仅返回 stage（canonical value），sky-axis 不在 tool body 里做事。
 *     stage 推进的真实动作由 ai-event-bridge 监听 follow 流的 `tool/call` 事件
 *     完成（见 src/host/ai-event-bridge.ts 的 tool/call 分支）。
 *   - 这是「最小风险方案」—— tool 全局注册到 ctx.tools（不绑 preset scope），
 *     靠 sky-axis-collaborator 的 system prompt 约束 standard preset 跑出来的 agent 不会主动调。
 *
 * tool 协议（DSH）：
 *   - `defineTool({...})` → ToolDefinition（[dsh-tools/lib/types/schema.d.ts:239](../../node_modules/.pnpm/@deepseek-ai+dsh-tools@0.1._39d2674c82de6d29148a728ff0282af8/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts#L239)）
 *   - 参数/输出 schema 用 DSH 自有 ValueSchemaSpec DSL（非裸 JSON Schema）；
 *     调用方必须传 `ParameterPropertySpec[]` 形式
 *   - execute 返回 canonical value；render 把 value 转 model-facing ContentBlock
 *
 * toStage 字面量必须与 sky-axis protocol.ts StageSchema 一致（[protocol.ts:645](../src/protocol.ts)）。
 */
/**
 * defineTool 是 DSH 工具注册的 DSL（[dsh-tools/lib/types/schema.d.ts:239](../../node_modules/.pnpm/@deepseek-ai+dsh-tools@0.1._39d2674c82de6d29148a728ff0282af8/node_modules/@deepseek-ai/dsh-tools/lib/types/schema.d.ts#L239)）。
 * sky-axis 的 host apply 运行时由 DSH 宿主保证 dsh-tools 可用（DSH 自带）；
 * sky-axis 不持有 dsh-tools runtime 包（不在 deps）—— type-only reference + runtime 用 cast。
 *
 * 关键决策：直接写 runtime cast（`((opts) => opts)`），不通过类型 import 把 dsh-tools 引入编译图。
 * 这是因为 dsh-tools 不在 devDependencies 里，TS 找不到模块。
 *
 * defineTool 返回的 ToolDefinition 在 register 时被 DSH 宿主识别（结构 duck-type）。
 * 这里只关心它返回的对象能被传给 ctx.tools.register —— 类型正确性靠以下本地类型保证。
 */

/** 本地 ToolDefinition 形态（与 dsh-tools ToolDefinition 结构一致 —— 仅取 sky-axis 用到的字段）。 */
interface LocalToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    readonly render: (args: unknown, value: unknown) => readonly unknown[]
  }
  readonly execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** 本地 defineTool —— 接收 LocalToolDefinition options，返回 duck-typed 对象。 */
function defineTool(opts: {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: unknown, value: unknown) => readonly unknown[]
  }
  execute: (args: unknown, exec: unknown) => Promise<unknown>
}): LocalToolDefinition {
  return opts
}

/** 与 src/protocol.ts StageSchema 字面量对齐（'understand' 不可推，是起始阶段）。 */
type AdvanceStage = 'plan' | 'implement' | 'verify' | 'deliver'

/**
 * 接入 2.3：每个 stage 的简明目标（用于 tool render 让 agent 在 tool/result 后看到自己该干什么）。
 *
 * 注意：完整 stage-goal 在 `src/host/prompts/stage-prompts.ts` 的 `STAGE_GOAL`。
 * 这里只放**一句**用于 tool render 的精简版（tool result 是 model-facing content，不应过长）。
 */
const STAGE_GOAL_HINT: Readonly<Record<AdvanceStage, string>> = {
  plan: '通读 spec.md，输出严格 TaskList JSON（无 markdown fence），sky-axis bridge 会抽取写 plan artifact。',
  implement: '按 plan artifact 的 tasks 逐项实现；用户在 task 列表点「开始」时会喂入 task prompt。',
  verify: '跑 typecheck/lint/test，验证 task.goal；产出 verify-report。',
  deliver: '提交 + 部署 + 观测；本阶段为 pipeline 末端。',
}

/**
 * advance_stage tool —— 通知 sky-axis 把需求推进到指定阶段。
 *
 * 参数：
 *   - toStage (required): 目标阶段
 *   - reason  (optional): 推进原因（审计用，写入 stageHistory.reason）
 */
export const advanceStageTool = defineTool({
  name: 'advance_stage',
  description: '把当前需求推到下一阶段。toStage 必须是 plan / implement / verify / deliver 之一。' +
    '推进原因写入审计链。每次完成一个阶段的关键产出后立即调用本 tool，让 sky-axis 刷新 UI 与 stage history。',
  parameters: {
    toStage: {
      type: 'string',
      enum: ['plan', 'implement', 'verify', 'deliver'] as const,
      description: '目标阶段',
      required: true,
    },
    reason: {
      type: 'string',
      description: '推进原因（简短，中英文均可；写入 stage history 审计链）',
    },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        stage: { type: 'string' },
        goal: { type: 'string' },
        nextStep: { type: 'string' },
      },
      additionalProperties: false,
    },
    // 接入 2.3：富文本 render —— 让 agent 在 tool/result 后看到「自己刚进入什么 stage + 该干什么」。
    //   tool body execute 仅返回 canonical（结构化），render 把它转 model-facing ContentBlock。
    //   注意：tool result 是 data，不是 instruction —— agent 不一定听从。这里只是兜底引导。
    //   主要引导靠 applyAdvanceStage 末尾的 followup prompt（host 端主动 push）。
    render: (_args: unknown, value: unknown) => {
      const { stage, goal, nextStep } = value as { stage: AdvanceStage; goal: string; nextStep: string }
      const lines = [
        `sky-axis: stage advanced to ${stage}`,
        `当前阶段目标: ${goal}`,
        `下一步: ${nextStep}`,
      ]
      return [{ type: 'text', text: lines.join('\n') } as never]
    },
  },
  execute: async (args: unknown) => {
    const { toStage } = args as { toStage: AdvanceStage; reason?: string }
    // 真实 stage 推进由 ai-event-bridge 监听 tool/call 事件触发；
    // 这里仅返回 canonical value 给 agent 反馈（render 会再格式化成 model-facing text）。
    return {
      stage: toStage,
      goal: STAGE_GOAL_HINT[toStage],
      nextStep: '按上面 stage-goal 描述继续工作',
    }
  },
})