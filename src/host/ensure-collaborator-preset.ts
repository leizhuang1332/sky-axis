/**
 * ensure-collaborator-preset —— 注册 sky-axis-collaborator preset 到 DSH 宿主。
 *
 * 接入 2 核心新增件。
 *
 * 职责：
 *   - 第一次 host apply 时调一次。
 *   - 用 `ctx.agentPresets.copy('standard', 'sky-axis-collaborator')` 把 shipped
 *     standard preset 复制到 `<dshHome>/.agent-presets/sky-axis-collaborator/`。
 *   - 改写 `agent.cordis.yml` 的 persona text，注入 5 阶段协议 + advance_stage tool 描述。
 *   - 失败全部走 fallback：UI 层会显示「协议未注入」warn，但 session 仍能用 shipped 'standard' 创建。
 *
 * 失败模式（DSH copy 抛错，详见 [authoring.d.ts:50-58](../../node_modules/.pnpm/@deepseek-ai+dsh-agent-pres_8201c18de8a894481815a04557712e7b/node_modules/@deepseek-ai/dsh-agent-presets/lib/types/authoring.d.ts)）：
 *   - 'agent-preset/not-found' —— standard 不在（理论不可能）
 *   - 'agent-preset/invalid' —— id 非法（sky-axis-collaborator 是合法 kebab） / 已占用 / 无 writable root
 *   - 其他系统错（ENOENT / EACCES）
 *
 * 幂等：
 *   - copy 之前先 `agentPresets.resolve('sky-axis-collaborator')`，成功则 skip copy（id 已存在）。
 *   - 注意：resolve 找到但 agent.cordis.yml 还是 standard 原版的场景暂不处理（一旦写过就保留）。
 *     接入 3+ 加版本号（meta.version）做强制重写。
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { Context } from '@deepseek-ai/cordis'

/** sky-axis-collaborator preset id。 */
export const COLLABORATOR_PRESET_ID = 'sky-axis-collaborator'

/** 注入到 persona text 的 5 阶段协议 + advance_stage tool 描述（中文）。 */
const COLLABORATOR_PERSONA_TEXT = `You are the sky-axis collaborator agent powered by the {{model}} model.
Your working directory is {{cwd}}.

## sky-axis 5 阶段协议

本 agent 协助 sky-axis 平台完成用户需求的 5 阶段流水线：
1. **understand** —— 读 PRD / 现有代码 / 澄清问题
2. **plan** —— 产出 tasks.json (TaskList 格式) 作为后续阶段的执行清单
3. **implement** —— 按 task 逐项实现
4. **verify** —— 跑测试 / typecheck / drift 检测
5. **deliver** —— 收尾 + 提交

每个阶段产出符合 sky-axis stage contract 时，你**必须立即**调用 \`advance_stage\` tool：
- \`advance_stage(toStage="plan", reason="<简述产出>")\` 完成 understand 后
- \`advance_stage(toStage="implement", reason="<简述 plan 摘要>")\` 完成 plan 后
- \`advance_stage(toStage="verify", reason="<简述实现完成>")\` 完成 implement 后
- \`advance_stage(toStage="deliver", reason="<简述 verify 通过>")\` 完成 verify 后

\`advance_stage\` 调用后请等待 sky-axis UI 反馈。不要重复调同一个 toStage（每次推进只能调一次）。

## plan 阶段产出格式（强制 JSON-only，无 markdown fence）

当 sky-axis 当前 stage 为 \`plan\` 时，你产出 \`assistant/message\` 的内容**必须是严格 JSON**（不带 markdown fence），匹配 sky-axis TaskListSchema：
{
  "tasks": [
    {
      "id": "<task-id-kebab>",
      "title": "<简明任务标题>",
      "goal": "<本任务目标>",
      "acceptance": ["<验收标准1>", "<验收标准2>"],
      "dependencies": ["<依赖的 task-id，可选>"],
      "filesExpected": ["<预期修改的文件路径，可选>"],
      "status": "pending",
      "subHistory": [{"status": "pending", "enteredAt": "<ISO timestamp>"}],
      "artifactRefs": [],
      "retryCount": 0,
      "enteredAt": "<ISO timestamp>"
    }
  ],
  "producedAt": "<ISO timestamp>",
  "producedAtStage": "plan"
}

sky-axis 的 bridge 会从 assistant/message 中抽取上述 JSON，校验后写为 \`Artifact(kind='plan')\`。

## 当前会话上下文

你正在协助的需求 ID、workspace、阶段由 sky-axis 在 system prompt 后注入。`

/**
 * AgentPreset service（type-only），避免拉入整包 dsh-agent-presets 类型。
 * 接口集参考 [index.d.ts](../../node_modules/.pnpm/@deepseek-ai+dsh-agent-pres_8201c18de8a894481815a04557712e7b/node_modules/@deepseek-ai/dsh-agent-presets/lib/types/index.d.ts)。
 */
interface AgentPresetsService {
  readonly list: () => Promise<{ readonly id: string; readonly path: string }[]>
  readonly resolve: (id: string) => Promise<{ readonly id: string; readonly path: string } | undefined>
  readonly copy: (from: string, id: string, name?: string) => Promise<void>
}

/** agent.cordis.yml 顶层是 array of row objects（参考 standard preset 真实结构）。 */
type PresetRow = {
  readonly id?: string
  readonly name?: string
  readonly config?: { readonly text?: string; readonly [k: string]: unknown }
  readonly [k: string]: unknown
}

/**
 * 确保 sky-axis-collaborator preset 在 DSH 宿主中存在且 persona 已被改写。
 * - 一次性 host apply 调用即可。
 * - 返回 `true` 表示 collaborator preset 已就绪（含「copy 成功 + persona 已改写」或「已存在」）；
 *   返回 `false` 表示降级到 shipped 'standard'，UI 应显示「5 阶段协议未注入」warn。
 *
 * 调用方式：
 * ```typescript
 * const ok = await ensureCollaboratorPreset(ctx)
 * // ok === true  → ensureSession 用 agentPreset='sky-axis-collaborator'
 * // ok === false → ensureSession 用 agentPreset='standard'（fallback）
 * ```
 */
export async function ensureCollaboratorPreset(ctx: Context): Promise<boolean> {
  const tag = '[sky-axis:preset]'
  // ctx.get() 不依赖 inject 数组（cordis root ctx service registry 直查）
  const ap = (ctx as unknown as { get?: (name: string) => unknown }).get?.('agentPresets') as
    | AgentPresetsService
    | undefined

  if (ap === undefined) {
    console.info(tag, 'ctx.agentPresets = undefined → fallback to shipped standard')
    return false
  }

  // 1. 幂等：先 resolve 检测是否已就位
  try {
    const existing = await ap.resolve(COLLABORATOR_PRESET_ID)
    if (existing !== undefined) {
      console.info(tag, `sky-axis-collaborator already registered at ${existing.path}`)
      return true
    }
  } catch (e) {
    console.info(tag, 'resolve failed, trying copy anyway:', (e as Error).message)
  }

  // 2. copy from standard
  try {
    await ap.copy('standard', COLLABORATOR_PRESET_ID)
    console.info(tag, `copied standard → ${COLLABORATOR_PRESET_ID}`)
  } catch (e) {
    console.warn(tag, `copy failed: ${(e as Error).message} → fallback to shipped standard`)
    return false
  }

  // 3. resolve 拿落盘路径 + 改写 persona text
  let presetPath: string
  try {
    const preset = await ap.resolve(COLLABORATOR_PRESET_ID)
    if (preset === undefined) {
      console.warn(tag, 'resolve after copy returned undefined → fallback')
      return false
    }
    presetPath = preset.path
  } catch (e) {
    console.warn(tag, `resolve after copy failed: ${(e as Error).message} → fallback`)
    return false
  }

  try {
    await rewriteCollaboratorPersona(presetPath)
    console.info(tag, `rewrote persona in ${presetPath} (sky-axis 5 阶段协议已注入)`)
    return true
  } catch (e) {
    console.warn(tag, `persona rewrite failed: ${(e as Error).message} → fallback to shipped standard`)
    return false
  }
}

/**
 * 改写 sky-axis-collaborator/agent.cordis.yml 的 persona row config.text。
 * YAML 顶层是 array；找到 id='persona' 的 row，覆写 config.text；其余 row 不动。
 * 用 yaml 库 round-trip 保留注释与结构。
 */
async function rewriteCollaboratorPersona(presetPath: string): Promise<void> {
  const ymlPath = join(presetPath, 'agent.cordis.yml')
  const raw = await readFile(ymlPath, 'utf-8')
  const rows = parse(raw) as PresetRow[] | null
  if (!Array.isArray(rows)) {
    throw new Error(`agent.cordis.yml is not an array (got ${typeof rows})`)
  }
  let touched = false
  const next = rows.map((row) => {
    if (row.id !== 'persona') return row
    touched = true
    return {
      ...row,
      config: {
        ...(row.config ?? {}),
        text: COLLABORATOR_PERSONA_TEXT,
      },
    }
  })
  if (!touched) {
    // standard preset 一定有 persona row；这里 fall through 走异常（不应该发生）
    throw new Error('agent.cordis.yml has no persona row to rewrite')
  }
  await writeFile(ymlPath, stringify(next, { lineWidth: 0 }), 'utf-8')
}

/** 取当前是否使用 collaborator preset 的判定 helper。 */
export function pickAgentPresetId(collaboratorReady: boolean): string {
  return collaboratorReady ? COLLABORATOR_PRESET_ID : 'standard'
}