/**
 * stage-prompts —— sky-axis 5 阶段 stage-aware prompt 模板。
 *
 * 接入 2.3：解决「agent 在 understand 阶段提前看到 plan 阶段要做的事」导致的执行混乱。
 *
 * 设计原则：
 *   - 每段 stage prompt 只讲**当前阶段**的目标，不剧透未来阶段
 *   - ensureSession 时发「整体框架 + 当前 stage 目标」首条 prompt
 *   - applyAdvanceStage 末尾 fire-and-forget 发「下一阶段目标 + 上阶段产物摘要」
 *   - 静态、不依赖 LLM 推理（避免方案 C 的不确定性）
 *
 * 模式（DSH sessionController.prompt）：
 *   - mode='queue'（agent.followup）—— 不打断当前 turn，新消息等 driver 顺序 claim
 *   - content: PromptContentPart[] 只有 text/image 两类（typert.host.js:562-571）
 *   - requestId: branded string，写 source.rpcId；sky-axis 自己 mint 不影响
 *
 * 与 ensureSession 首条 prompt 的区别：
 *   - buildInitialPrompt：协议整体框架 + 当前 stage 目标（agent 启动时发一次）
 *   - buildStageTransitionPrompt：下一阶段目标 + 上阶段产物摘要（applyAdvanceStage 后发）
 *
 * 后续扩展：
 *   - 接入 3+：plan→implement 转换时可把 plan JSON body 内联到 prompt（无需 agent 读文件）
 *   - 接入 4+：steer 阶段可单独 prompt 注入实时纠偏
 */
import type { Requirement, Artifact } from '../../protocol.ts'
import { randomUUID } from 'node:crypto'

/** 5 阶段字面量（与 protocol.ts StageSchema 对齐）。 */
export type Stage = 'understand' | 'plan' | 'implement' | 'verify' | 'deliver'

/**
 * Stage-specific goal sections —— 每段只讲当前 stage 的目标，不剧透未来。
 *
 * agent 看完只知道自己该做什么，看不到下游 stage 的产物形态。
 */
export const STAGE_GOAL: Record<Stage, string> = {
  understand: [
    '你当前处于 **understand** 阶段。',
    '',
    '本阶段目标：',
    '- 通读 PRD 文件（路径已在「Workspace 上下文」中）+ 全部 attachment 物料',
    '- 浏览 workspace 现有代码、找关键模块和数据模型',
    '- 产出 spec.md 内容（goal / non-goals / open-questions / decisions）',
    '',
    '完成时调用 advance_stage(toStage="plan", reason="<spec 摘要>") 推进到下一阶段。',
    '如缺信息可调 ask_user_question 申请用户介入（接入 3+ 启用）。',
  ].join('\n'),

  plan: [
    '你当前处于 **plan** 阶段。',
    '',
    '本阶段目标：',
    '- 读 understand 阶段产物（spec.md）',
    '- **assistant/message 输出必须是严格 TaskList JSON**（不含 markdown fence）',
    '  匹配 sky-axis TaskListSchema：{ tasks: [{id, title, goal, acceptance, dependencies, filesExpected, ...}], producedAt, producedAtStage: "plan" }',
    '- sky-axis bridge 会从 assistant_message 中抽取 JSON 校验后写为 Artifact(kind="plan")',
    '',
    '完成时调用 advance_stage(toStage="implement", reason="<plan 摘要 + N tasks>") 推进到下一阶段。',
  ].join('\n'),

  implement: [
    '你当前处于 **implement** 阶段。',
    '',
    '本阶段目标：',
    '- 逐项实现 plan artifact 的 tasks',
    '- 用户在 task 列表点「开始」时 sky-axis 会调 DSH prompt 喂入 task 专属 prompt',
    '- 完成每个 task 时调用 advance_stage 不需要 — 由 sky-axis controller 统一推进 task.status',
    '- 完成整个 stage 时调用 advance_stage(toStage="verify", reason="<实现摘要 + 已完成任务数>") 推进。',
  ].join('\n'),

  verify: [
    '你当前处于 **verify** 阶段。',
    '',
    '本阶段目标：',
    '- 跑 typecheck / lint / test',
    '- 与 task.goal 对比算 drift score（接入 5+ 增量实现）',
    '- 产出 verify-report.md（含每个 task 的 verify 结论）',
    '',
    '完成时调用 advance_stage(toStage="deliver", reason="<verify 通过情况 + drift 摘要>") 推进到下一阶段。',
  ].join('\n'),

  deliver: [
    '你当前处于 **deliver** 阶段。',
    '',
    '本阶段目标：',
    '- 提交代码（commit / MR / 部署）',
    '- 上线观测指标',
    '- 产出 delivery 摘要',
    '',
    '本阶段为 pipeline 末端，完成后无需再调 advance_stage。',
    'sky-axis UI 会显示「已完成」。',
  ].join('\n'),
}

/** 共用框架 preamble —— 协议 + tool 列表 + 关键行为约束。发一次，agent 基础认知。 */
export const COMMON_PREAMBLE = [
  '你是 sky-axis 协作 agent。',
  '遵守 sky-axis 5 阶段协议：understand → plan → implement → verify → deliver。',
  '',
  '可用 tool：',
  '- **advance_stage(toStage, reason?)**：把需求推进到下一阶段。toStage ∈ ∈ {plan, implement, verify, deliver}',
  '- ask_user_question：申请用户介入（接入 3+ 启用）',
  '',
  'session 已绑定到当前需求，follow 流已启动。sky-axis UI 实时显示 aiState / stage / task list。',
].join('\n')

/**
 * 构造首条 prompt —— 确保只讲当前 stage 目标，不剧透未来。
 *
 * @param req  - 已写回 aiSessionId 的 requirement
 * @param workspacePath - DSH workspace path（已 resolve）
 */
export function buildInitialPrompt(req: Requirement, workspacePath: string): string {
  const prdFiles = req.materials.prdFiles.map(f => f.path).join(', ') || '(无)'
  const tags = req.tags.length > 0 ? req.tags.join(', ') : '(无)'
  return [
    `需求 ID: ${req.id}`,
    '',
    '## 需求快照',
    `- 标题: ${req.title}`,
    `- 描述: ${req.description.length > 0 ? req.description : '(空)'}`,
    `- 优先级: ${req.priority}`,
    `- 标签: ${tags}`,
    '',
    '## Workspace 上下文',
    `- Workspace 路径: ${workspacePath}`,
    `- PRD 文件: ${prdFiles}`,
    '',
    '## 当前阶段',
    STAGE_GOAL[req.stage],
    '',
    '---',
    COMMON_PREAMBLE,
  ].join('\n')
}

/**
 * 构造阶段切换 prompt —— applyAdvanceStage 末尾 fire-and-forget 调用。
 *
 * 包含：
 *   - 下一阶段目标（agent 之前没看到过的 stage-goal）
 *   - 上阶段产物摘要（plan artifact task 数 / spec 标题等）
 *
 * 写入格式：让 agent 在 turn 边界后立即看到下一阶段指令。
 */
export function buildStageTransitionPrompt(req: Requirement, toStage: Stage): string {
  const artifactSummary = summarizeArtifacts(req.artifacts)
  return [
    `## 阶段已推进到 ${toStage}`,
    '',
    STAGE_GOAL[toStage],
    '',
    '## 上阶段产物',
    artifactSummary || '(无)',
    '',
    '请基于上述产物继续工作。',
  ].join('\n')
}

/**
 * 把 artifact KV 压成简短摘要 —— 给 stage-transition prompt 用。
 * 不暴露 artifact body 全文（agent 可自己读 .sky轴/mate.yaml），只给索引信息。
 */
function summarizeArtifacts(artifacts: Requirement['artifacts']): string {
  const lines: string[] = []
  for (const [id, a] of Object.entries(artifacts)) {
    lines.push(formatArtifactLine(id, a))
  }
  return lines.join('\n')
}

function formatArtifactLine(id: string, a: Artifact): string {
  const meta = a.meta as { isTaskList?: boolean; taskCount?: number } | undefined
  if (a.kind === 'plan' && meta?.isTaskList === true) {
    const count = meta.taskCount ?? 0
    return `- [${id.slice(0, 8)}] plan: ${count} tasks (${a.title})`
  }
  if (a.kind === 'note') {
    return `- [${id.slice(0, 8)}] note: ${a.title}`
  }
  if (a.kind === 'patch') {
    return `- [${id.slice(0, 8)}] patch: ${a.title}`
  }
  if (a.kind === 'log') {
    return `- [${id.slice(0, 8)}] log: ${a.title}`
  }
  return `- [${id.slice(0, 8)}] ${a.kind}: ${a.title}`
}

/** mint sky-axis 风格 requestId（DSH branded string，写 source.rpcId）。 */
export function mintSkyAxisRequestId(prefix: string = 'sky-axis'): string {
  return `${prefix}-${randomUUID()}`
}