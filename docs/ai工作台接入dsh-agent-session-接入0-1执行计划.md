# AI 工作台接入 DSH Agent Session —— 接入 0-1 执行计划

> 范围：把 sky-axis AI 工作台从 mock 切到真实 DSH agent session 的「最小可见闭环」完整执行计划。
> 依据：[架构预览](./ai工作台接入dsh-agent-session-架构预览.md) §5 渐进接入路径 + 第 0 步探测结论 + 已批准实施计划。
> 读者：sky-axis 插件维护者、参与 AI 工作台接入实现的同学。
> 状态：**接入 0-1 已实现完成，端到端验证发现 2 处与 DSH API 实际行为的偏差，已修复**（2026-09-11）。本文同步代码现状 + 端到端验证发现。

---

## 0. 背景与前置结论

sky-axis 的 AI 工作台 UI 骨架已全部完成（迭代 1-7，PR-A~E 已合入），TaskList / rewind / drift / 介入点 / audit timeline 的 schema + controller + UI 三层就位。但整条流水线是**断的**——controller 里 8 个会话相关 `*Impl` 注入点全部就位却一个都没接，全部回落到 mock noop 兜底；host 端没有 sessionController，也没有 ai-event-bridge。

### 第 0 步探测结论（已确认）

通过三个独立探测 effect（不进主流程，全程 try/catch，trap 不传播），实测确认 DSH 0.1.2 三块拼图**全部就绪**，推翻了架构预览稿里「gateway 未就绪」的旧假设：

| 探测 | 位置 | 结论 |
|---|---|---|
| `ctx.sessions`（client） | [src/client/index.ts](../src/client/index.ts) effect 9 | ✅ 存在，gateway 已就绪，session 对接可走 client 直连 |
| `ctx.sessionController`（host） | [src/index.ts](../src/index.ts) probe effect | ✅ 存在，`list()` ok，host 端 session 就绪，接入 0 可动手 |
| `ctx.agentPresets`（host） | [src/index.ts](../src/index.ts) probe effect #2 | ✅ 存在，`defaultId = standard`，4 个 shipped preset（standard/ptc/minimal/cordis），`list()` ok |

详见记忆 [sky-axis-sessions-gateway-ready](../../C:/Users/lorcan.lei.JMS/.claude/projects/d--TraeProject-sky-axis/memory/sky-axis-sessions-gateway-ready.md)。

### 拍板决策

- **preset 起步**：用 shipped `standard` preset 先跑通闭环。自定义 `sky-axis-collaborator` preset 创作延后（接入 2+ 处理）。
- **闭环范围**：接入 0-1 = create session + follow 流 → aiState 变化 → SSE put 回流 → UI 显示 AI 在跑。**不**接 prompt、**不**提取 artifact、**不**映射 task list、**不**接 8 个 `*Impl`——这些是接入 2-5 的事。

---

## 1. 关键简化：onAiStateChange 走现有 put 通道

**aiState 变化通过现有 `emitChange({operation:'put', item})` 通道，不扩 `RequirementStreamEvent` 类型。**

aiState 变化只是 Requirement 实体字段更新。现有 `emitChange put`（[requirement-service.ts](../src/host/requirement-service.ts) `emitChange` 方法）已携带完整 Requirement，client `handleStreamEvent`（[sky-axis-controller.ts](../src/client/controller/sky-axis-controller.ts)）收到 put 自动替换整条 req，`aiState` / `aiSessionId` / `aiLastActivityAt` 自然更新。

架构预览文档提的 8 种新帧（`aiStateChanged` / `stageChanged` / `artifactUpdated` 等）是接入 2+ 的事。**接入 0-1 用 put 就够**，无需改 `RequirementStreamEvent` 类型、无需改 SSE 路由、无需改 client `handleStreamEvent` 分支。

### 闭环数据流

```
用户点「启动」 → client POST /ai/start?requirementId=xxx
→ host ensureSession: sessionController.create({workspaceId, cwd, agentPreset:'standard'})
→ 写回 mate.yaml (aiSessionId/aiState='running') → emitChange put（现有 SSE 通道）
→ host startFollow(sessionId) → follow 流帧 → ai-event-bridge 翻译 → onAiStateChange
→ applyAiStateChange: updateRequirements 改 aiState/aiLastActivityAt + emitChange put（同通道）
→ client handleStreamEvent put → req.aiState 变化 → AiConductorPane 自动显示（UI 已就绪）
```

---

## 2. 5 个改动块（按依赖顺序）

### 块 1：host ensureSession + follow 流管理（`src/host/requirement-service.ts`）

**目标**：让 host 端能创建 DSH session、消费 follow 事件流、把帧翻译成 aiState 变化写回。

**改动**：

1. **构造函数加第三参数 `sessionController: SessionController`**（type-only import）。[src/index.ts](../src/index.ts) 装配时传 `ctx.sessionController`。
2. **新增两个私有 Map**：
   - `followControllers = new Map<RequirementId, AbortController>()` —— 管 per-session 流生命周期。
   - `lastAiState = new Map<RequirementId, string>()` —— 去重防抖（'running'→'running' 不重复写盘）。
3. **新增 `async ensureSession(requirementId): Promise<Requirement>`**：
   - 幂等查 `req.aiSessionId`（非 null 直接返回）。
   - `resolveWorkspacePath` 拿 cwd。
   - `sessionController.create({workspaceId, cwd, agentPreset:'standard'})`（带 `as never` 类型转换绕过 DSH 类型不导出问题）。
   - `updateRequirements` mutator 写回 `aiSessionId / aiState='running' / aiLastActivityAt`。
   - `emitChange({operation:'put', item})`。
   - create 抛错包成 `SkyAxisHostError('ai-not-configured')`（复用 protocol 错误码，`mapStatus` 已映射 503）。
4. **新增 `startFollow(requirementId): void` / `stopFollow(requirementId): void`**：
   - `startFollow` 幂等（已有活跃流则 return），创建 AbortController，调 `consumeSessionFollow`。
   - `stopFollow` 中断 + 删除 followControllers + 清除 lastAiState。
5. **新增 `private async consumeSessionFollow(requirementId, signal)`**：while + for-await + 重连退避模式（同 `consumeWorkspaceFollow` 范式），动态 `await import('./ai-event-bridge.ts')` 避免循环依赖，传 `onAiStateChange` 回调。流正常结束兜底置 idle。
6. **新增 `private async applyAiStateChange(requirementId, state, activityAt)`**：去重防抖 + `updateRequirements` 改 aiState/aiLastActivityAt + `emitChange put`。
7. **`close()` 末尾**：遍历 `followControllers` 全部 abort + clear。

**依赖**：`import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'`（type-only，不进 runtime bundle）。

---

### 块 2：ai-event-bridge（新建 `src/host/ai-event-bridge.ts`）

**目标**：把 DSH session follow 流的帧翻译成 sky-axis aiState 变化，通过 callback 回写 reqSvc。

**导出**：

```typescript
export type AiState = 'idle' | 'running' | 'paused' | 'awaiting-input' | 'errored'

export interface ConsumeFollowStreamArgs {
  readonly sessionController: SessionController
  readonly sessionId: string
  readonly signal: AbortSignal
  readonly onAiStateChange: (state: AiState, activityAt: string) => Promise<void>
}

export async function consumeFollowStream(args: ConsumeFollowStreamArgs): Promise<void>
```

**帧 dispatch**（`SessionFollowFrame = {type:'snapshot'} | SessionEventEntry`）：

| 帧 | 处理 | 理由 |
|---|---|---|
| `type='snapshot'`（首帧 baseline） | `onAiStateChange('running')` | session 活跃中 |
| `event.type='turn/start'` | `onAiStateChange('running')` | agent 开始响应 |
| `event.type='turn/end'` | `idle`（正常）/ `errored`（异常 reason） | turn 结束 |
| `assistant/chunk` / `assistant/message` / `tool/call` / `tool/result` / `user/message` / `todo/write` / `request/*` / `session/*` / `step/*` | 忽略 | 接入 2+ 处理（artifact 提取 / task list 映射） |
| 未知 type | 忽略 | DSH event 名 merge-extensible，向前兼容 |

**职责单一**：bridge 不直接操作 mate.yaml，只通过 `onAiStateChange` callback 与 reqSvc 交互。重连由调用方（reqSvc）的 while 循环负责，本函数只跑一轮 follow 流。

---

### 块 3：protocol.ts 端点 + host route

**目标**：暴露 POST /ai/start 路由。

**改动**：

1. **[src/protocol.ts](../src/protocol.ts)**：`SkyAxisEndpoints` 新增 `aiStart: \`${SKY_AXIS_API_PREFIX}/ai/start\``（在 `artifactWrite` 之后，`} as const` 之前）。`AiStartRequestSchema` 已定义，复用。
2. **[src/host/routes/requirements.ts](../src/host/routes/requirements.ts)**：`makeRequirementRoutes` 末尾新增 POST /ai/start route：
   - query `?requirementId=xxx`（与 delete 路由风格一致，复用 `getQueryParam` + `zodParseOrThrow(RequirementIdSchema, ...)`）。
   - `service.ensureSession(id)` → `service.startFollow(id)` → `jsonResponse(200, {ok:true, item})`。
   - 错误走 `translateError`（`ai-not-configured`→503，`requirement-not-found`→404）。
   - body 不校验（接入 0-1 暂不调 prompt，initialPrompt 保留为后续注入）。

---

### 块 4：client controller + 装配 + API client

**目标**：把 `startAi` 从 controller 接口一路通到 HTTP fetch。

**改动（3 个文件）**：

1. **[src/client/api/requirement-client.ts](../src/client/api/requirement-client.ts)**：新增 `async startAi(requirementId): Promise<Result<Requirement>>`，fetch `POST /ai/start?requirementId=xxx`，body `{}`，`parseJson` 用 `RequirementResponseSchema`。
2. **[src/client/controller/sky-axis-controller.ts](../src/client/controller/sky-axis-controller.ts)**：
   - `SkyAxisController` interface 新增 `startAi(requirementId): Promise<{ok; error?}>`（在 `deleteRequirement` 之后）。
   - deps 类型新增 `startAiImpl?: (requirementId: string) => Promise<{ok; item?: RequirementEntry; error?}>`。
   - 实现里调 `deps.startAiImpl`（undefined→`internal-error`），成功时**乐观更新 snapshot**（用 server 返回 item 立即替换本条 req，不等 SSE put 帧回流），失败写 `requirementsError` + aiState 保持 idle。
3. **[src/client/index.ts](../src/client/index.ts)**：`createSkyAxisController({...})` 注入 `startAiImpl`（调 `reqClient.startAi`，`r.value` spread 成 item 形态，失败 wrap 成 `{ok:false, error:{code,detail}}`）。

---

### 块 5：UI 接线（AiConductorPane + RequirementDetailPage）

**目标**：启动按钮从 disabled 占位变成真实触发。

**改动**：

1. **[src/client/page/sections/AiConductorPane.tsx](../src/client/page/sections/AiConductorPane.tsx)**：
   - 加 `onStartAi?: () => void` + `aiStarting: boolean` 属性。
   - 启动按钮 disabled 逻辑改 `loading || aiStarting || !isIdle || onStartAi === undefined`。
   - 接 `onClick` → `onStartAi()`。
   - `aiStarting` 时按钮文案显示 `…`（loading 视觉）。
   - `aiStateMeta`（状态→文案+图标映射）已就绪，无需改显示逻辑。
2. **[src/client/page/views/RequirementDetailPage.tsx](../src/client/page/views/RequirementDetailPage.tsx)**：
   - 新增 `aiStarting` state。
   - 新增 `handleStartAi`（调 `controller.startAi`，`.then` 收 loading，catch 兜底）。
   - 传给 `<AiConductorPane onStartAi={handleStartAi} aiStarting={aiStarting}>`。

**mock 不动**：taskList / drift mock 在接入 2-5 才替换。接入 0-1 只让 aiState 从 idle→running（SSE put 驱动，`handleStreamEvent` 已支持）。

---

## 3. host 装配变更（`src/index.ts`）

两处装配变更：

1. **构造传 sessionController**：
   ```typescript
   const reqSvc = new RequirementHostService(ctx, ctx.workspaceController, ctx.sessionController)
   ```
   `inject` 数组（文件头）已声明 `'sessionController'`。

2. **bootstrap 恢复 follow 流**（在 routes effect 的 IIFE 末尾，`refreshRequirementSnapshots()` 之后）：
   - 遍历 `aiState='running'` 且有 `aiSessionId` 的 requirement，调 `reqSvc.startFollow(r.id)`。
   - 场景：host 重启（DSH 升级 / crash 恢复）时，已绑定 session 的 requirement 需重新挂 follow 流，否则 session 在跑但 sky-axis 收不到 turn 事件 → aiState 停在 'running' 不再更新。
   - 幂等：`startFollow` 内部 Map 去重；session 已结束的 follow 流自然 return，`consumeSessionFollow` 兜底置 idle。
   - 只恢复 `running` 的——idle 的说明上次 turn 已结束，下次用户点启动会重新 `ensureSession` + `startFollow`。

---

## 4. 不改的（接入 2+ 延后）

| 延后项 | 接入阶段 | 说明 |
|---|---|---|
| `RequirementStreamEvent` 扩 8 种帧 | 接入 2+ | put 通道够用 |
| artifact 提取（`assistant/message`→plan/patch） | 接入 2 | ai-event-bridge 增强 |
| task list 映射（`todo/write`→TaskList） | 接入 3 | 替换 mockTaskList |
| initialPrompt（接入 0-1 只 create+follow，不调 prompt） | 接入 2 | `advanceStageImpl` 路径 |
| client 直连 `ctx.sessions`（steer / respondIntervention） | 接入 4-5 | 8 个 `*Impl` |
| 自定义 `sky-axis-collaborator` preset | 接入 2+ | 系统提示词写死 5 阶段协议 + `advance_stage` tool |

---

## 5. 验证

### 静态验证（已完成）

```bash
pnpm run typecheck   # tsc --noEmit，零错误通过
```

关键类型点已验证：
- `SessionCreateRequest` 字段匹配（`workspaceId` / `cwd` / `agentPreset`）。
- `follow` 返回 `AsyncIterable<SessionFollowFrame>` 的 frame.type 分支（`snapshot` / `event`）。
- `SessionController` type-only import（参考 `WorkspaceController` 范式）。
- `sessionController.create(...)` 的 `as never` 类型转换绕过 DSH 类型不导出问题。
- `reqSvc.list()` 返回 `Promise<...[]>`，bootstrap 恢复 follow 处需 `await`。

### 端到端验证（待执行）

1. 启动 DSH host（probe effect 应确认 sessionController + agentPresets 就绪，控制台打印 `[sky-axis:probe:sessionController] ... 就绪` + `[sky-axis:probe:agentPresets] defaultId = standard`）。
2. 创建 requirement → 详情页 → AI 工作台 tab。
3. AiConductorPane 显示 idle（灰）→ 点「启动」→ POST /ai/start。
4. host: `ensureSession` create + 写 mate.yaml + `emitChange put` + `startFollow`。
5. client: SSE put → `aiState=running` → AiConductorPane 变绿（running dot）。
6. follow 流 `turn/start`→running / `turn/end`→idle，UI 实时切换。

### 失败场景

- **sessionController 未就绪 / preset 未注册** → 503 `ai-not-configured` → 按钮 loading 结束，aiState 保持 idle。
- **follow 流断开** → bridge catch 不 crash，`consumeSessionFollow` 退避重连；状态回 idle（兜底）。
- **host 重启** → bootstrap 恢复 follow 对 `running` 的 requirement 重新挂流；session 已结束的兜底置 idle。

### 5.1 端到端验证发现（2026-09-11，DSH 0.1.2-rc.1）

端到端测试发现 2 处与 DSH API 实际行为的偏差，已修复：

**问题 1（已修复）：`session.create` 互斥守卫**

DSH `sessionController.create` 是 `workspaceId` / `cwd` 互斥设计，两个都传会抛：

```
gateway/bad-request: session.create accepts workspaceId or cwd, not both
```

依据：[`@deepseek-ai/dsh-api-session-controller/lib/types/commands.js:85-86`](../../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/commands.js)

修复：去掉 `workspaceId`，只传 `cwd`（已从 `resolveWorkspacePath` 拿到确定性路径）。sky-axis 的 workspaceId 是自有 FK，与 DSH `workspaceRegistry` 未必同源，直接传 cwd 最可靠，还顺带绕过 `workspaceRegistry` 反查和 `attachSession` 的不确定性。

**问题 2（已修复）：create 可能挂起导致响应空白**

DSH `create` 内部会调 `ctx.agents.create → agentDefaultModel.currentSelection()`。如果宿主 agent 框架级服务（`agents` / `agentDefaultModel` / `llm provider`）未就绪，create 可能**永远不 resolve**，route handler 永远走不到 `res.end()`，浏览器看到空白响应（pending、无状态码）。

修复：

1. **`ensureSession` 加 30s 超时**（[requirement-service.ts](../src/host/requirement-service.ts)）：`Promise.race` 包住 create 调用，超时抛 `SkyAxisHostError('ai-not-configured', 'create session timed out...')`，route handler 走 `translateError` 返回 503，UI 能拿到明确 actionable 错误而非空白。

2. **加第 3 个探测 effect**（[src/index.ts](../src/index.ts)）：用 `ctx.get()`（cordis root ctx service registry，不污染 inject 数组）依次探 `agentDefaultModel` / `agents` / `llm` 三个 agent 框架级服务。启动时打印就绪情况：
   ```
   [sky-axis:probe:agent-framework] ctx.agentDefaultModel 存在，currentSelection = { provider: ..., model: ... }
   [sky-axis:probe:agent-framework] ctx.agents 存在，keys = [...]
   [sky-axis:probe:agent-framework] ctx.llm 存在，keys = [...]
   ```
   若任一为 `undefined` 或 `currentSelection` 为空，提示明确原因（"LLM provider 未配置" / "agents service 未注册"），不用等 30s 超时就能从启动日志知道卡在哪。

**为什么之前没发现这两个问题**：架构预览文档调研阶段只确认了 `SessionController.create` 的入参 schema（`workspaceId?: WorkspaceId; cwd?: string`），两个字段都标 optional，没意识到运行时是**互斥守卫**而非"二选一推荐"。第一次端到端才暴露出来——这印证了接入 0-1「先跑通闭环再继续接入 2」的必要性。

---

## 9. 接入 2 设计稿（最小可见推进闭环）

> 状态：调研完成，待拍板 + 实施。三个核心决策用户已对齐：
> 1. **preset 创作**：host apply 时自动 `agentPresets.copy('standard', 'sky-axis-collaborator')`，copy 失败走 fallback 到 shipped 'standard'。
> 2. **stage 推进**：tool 显式推进——agent 调 `advance_stage(toStage)` tool，bridge 识别 `tool/call` 事件提取参数。
> 3. **artifact 提取**：接入 2 只提 plan（understand→plan 阶段 assistant/message 输出 JSON tasks 写为 Artifact(kind='plan')）；patch/note/log/report 延后到接入 3+。

### 9.1 核心机制（依据 + 设计）

#### A. sky-axis-collaborator preset 落盘

**copy API**（[`dsh-agent-presets/lib/types/index.d.ts:282`](../../node_modules/.pnpm/@deepseek-ai+dsh-agent-pres_8201c18de8a894481815a04557712e7b/node_modules/@deepseek-ai/dsh-agent-presets/lib/types/index.d.ts#L282)）：

```typescript
copy(from: string, id: string, name?: string): Promise<void>
// 写到 <dshHome>/.agent-presets/<id>/ 目录（[discovery.d.ts:38](../../node_modules/.pnpm/@deepseek-ai+dsh-agent-pres_8201c18de8a894481815a04557712e7b/node_modules/@deepseek-ai/dsh-agent-presets/lib/types/discovery.d.ts#L38) USER_PRESET_DIR = '.agent-presets'）
```

**关键约束**（[authoring.d.ts:10-12](../../node_modules/.pnpm/@deepseek-ai+dsh-agent-pres_8201c18de8a894481815a04557712e7b/node_modules/@deepseek-ai/dsh-agent-presets/lib/types/authoring.d.ts#L10-L12)）：*copy 不允许 caller 注入 composition text*——只能复制源 preset 的整个目录，sky-axis 必须在 copy 完成后**自己编辑落盘的 `agent.cordis.yml`**（覆写 persona text 注入 5 阶段协议 + `advance_stage` tool 说明）。

**幂等 + fallback 流程**：

```
1. resolve('sky-axis-collaborator') 成功 → skip copy（已存在）
2. copy('standard', 'sky-axis-collaborator') 成功 → 改写 agent.cordis.yml 注入 5 阶段协议
3. copy 失败（路径不可写 / 已占用） → console.warn + fallback 到 shipped 'standard'
   ensureSession 仍传 agentPreset='sky-axis-collaborator'（resolve 会失败）→ ai-not-configured
4. ensureSession fallback：临时改用 agentPreset='standard' 让 session 起得来，
   UI 显式提示「5 阶段协议未注入，agent 不会主动调 advance_stage」
```

#### B. advance_stage tool 注册

**tool 协议**（[`dsh-tools/lib/types/index.d.ts:106-119`](../../node_modules/.pnpm/@deepseek-ai+dsh-tools@0.1._39d2674c82de6d29148a728ff0282af8/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts#L106-L119)）：

```typescript
export interface ToolDefinition extends ToolSchema {
  name: string; description: string; parameters: Record<string, unknown>; // JSON Schema
  output: ToolOutputDefinition;
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>;
}
// 通过 ctx.tools.register(definition) 注册到 ToolRuntime
```

**注册路径**（最小风险方案）：sky-axis 把 `advanceStageTool` 通过 `cordis.patch.yml` 注入到 host composition，工具对**所有 session 全局可见**——但只有 sky-axis-collaborator preset 的 system prompt 提到它，standard preset 跑出来的 agent 不会主动调（靠 system prompt 约束）。

**新建文件** `src/host/sky-axis-tools/advance-stage.ts`：

```typescript
import { defineTool } from '@deepseek-ai/dsh-tools'
export const advanceStageTool = defineTool({
  name: 'advance_stage',
  description: '把当前需求推到下一阶段.toStage 必须是 plan/implement/verify/deliver 之一',
  parameters: {
    type: 'object',
    properties: {
      toStage: { type: 'string', enum: ['plan', 'implement', 'verify', 'deliver'] },
      reason:  { type: 'string' },
    },
    required: ['toStage'],
  },
  output: { schema: { type: 'object' }, render: (_a, val) => [{ type: 'text', text: `stage=${(val as { stage: string }).stage}` }] },
  execute: async (args) => ({ stage: (args as { toStage: string }).toStage }),
})
// cordis plugin entry: ctx.tools.register(advanceStageTool)
```

**tool 调用识别**（[`dsh-session/lib/types/types.d.ts:303-309`](../../node_modules/.pnpm/@deepseek-ai+dsh-session@0._ee5063a80d448ae764858c08e7528ed1/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts#L303-L309)）：

```typescript
'tool/call': { turn, step, callId, name: string, arguments: string /* JSON */ };
```

bridge 在 `tool/call` case 解析 `arguments` 提取 `toStage` → 调 `reqSvc.applyAdvanceStage(reqId, toStage, reason, now)`。

#### C. taskAction → DSH.prompt 映射

**prompt API**（[`dsh-api-session-controller/lib/types/types.d.ts:284-296`](../../node_modules/.pnpm/@deepseek-ai+dsh-api-sessio_d4d423faa7d34f889f15e29291267e23/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/types.d.ts#L284-L296)）：

```typescript
SessionPromptRequest {
  requestId, sessionId,
  mode: 'queue' | 'steer',  // 接入 2 用 'queue'（不打断 running turn）
  content: readonly PromptContentPart[]  // 接入 2 用 [{type:'text', text:'...'}]
}
```

**4 个 action 实现差异**：

| action | 是否调 DSH prompt | prompt 模板 | 是否写 stageHistory |
|---|---|---|---|
| **start** | ✅ | `task ${taskId} (${title}) 目标 ${goal}; 验收 ${acceptance.join('\n')};完成后请调 advance_stage` | 否（stage 由 advance_stage 推进） |
| **redo** | ✅ | `task ${taskId} 之前失败需重做;目标 ${goal};请修复并继续` | 否 |
| **accept** | ❌（仅本地状态切换） | —— | 否 |
| **skip** | ❌（仅本地状态切换） | —— | 否 |

**新 route**：`POST /api/sky-axis/ai/task/action`，body = `{requirementId, taskId, action}`。

#### D. plan artifact 提取

**assistant/message 事件**（[`dsh-session/lib/types/types.d.ts:281-297`](../../node_modules/.pnpm/@deepseek-ai+dsh-session@0._ee5063a80d448ae764858c08e7528ed1/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts#L281-L297)）：

```typescript
'assistant/message': { turn, step, message: AssistantMessage, usage?, interrupted? }
// AssistantMessage.content: ContentBlock[] = TextBlock | ReasoningBlock | ToolCallBlock | ...
```

**识别策略**（用户已拍板）：

1. **阶段门控**：只处理 `currentStage ∈ {'plan', 'understand'}` 期间的 assistant/message（其他阶段暂不处理）
2. **JSON 抽取**：system prompt 强制要求 agent 输出严格 JSON（不含 markdown fence），直接 `JSON.parse(message.content.text)`
3. **zod 校验**：必须能通过 `TaskListSchema.parse`（[protocol.ts:754-769](../src/protocol.ts#L754-L769)）；失败 → 忽略，不报错
4. **幂等**：同 stage 内多次成功 → 取最后一次（last-write-wins）

**写回路径**：ai-event-bridge 通过 `onPlanArtifact` callback 调 `reqSvc.writeArtifact(reqId, artifact)`（接口已存在，[requirement-service.ts:1570](../src/host/requirement-service.ts#L1570)）。artifact schema 见 [protocol.ts:645-654](../src/protocol.ts#L645-L654)。

```typescript
// bridge → reqSvc callback
const artifact: Artifact = {
  id: `plan-${Date.now().toString(36)}`,
  kind: 'plan',
  title: `Tasks for ${reqId}`,
  createdAt: now,
  body: JSON.stringify(taskList),  // TaskList 序列化为 JSON
  meta: { isTaskList: true, taskCount: taskList.tasks.length },
}
await reqSvc.writeArtifact(reqId, artifact)
```

#### E. mock task list 替换边界

**mock 引用点**（3 处，2 处保留 + 1 处替换）：

| 位置 | 用途 | 接入 2 处理 |
|---|---|---|
| `RequirementDetailPage.tsx:268` | Stepper meta（导航条描述） | **保留 mock**（不需要真实数据） |
| `RequirementDetailPage.tsx:343` | Stepper summary 计算 | **保留 mock** |
| `RequirementDetailPage.tsx:333-336` | StageWorkspacePane 数据源 | **替换**：从 `requirement.artifacts[?].kind==='plan'` parse → null fallback to mock |

**StageWorkspacePane 是受控组件**（接 `taskList?: RequirementTaskList \| null` prop），改 RequirementDetailPage 传值即可，**不动 StageWorkspacePane**。

### 9.2 改动清单（按依赖顺序）

| # | 文件 | 性质 | 内容 |
|---|---|---|---|
| 1 | `cordis.patch.yml` | 修改 | 把 `src/host/sky-axis-tools` plugin 加入 host composition |
| 2 | `src/host/sky-axis-tools/index.ts` | 新建 | 导出 `apply(ctx)` cordis plugin entry |
| 3 | `src/host/sky-axis-tools/advance-stage.ts` | 新建 | `defineTool({name:'advance_stage', ...})` |
| 4 | `src/host/ensure-collaborator-preset.ts` | 新建 | `ensureCollaboratorPreset(ctx)`：`copy('standard','sky-axis-collaborator')` + rewrite agent.cordis.yml + 失败 fallback |
| 5 | `src/index.ts` | 修改 | inject 数组 + 加 effect 调 `ensureCollaboratorPreset(ctx)` + bootstrap ensureSession 失败时 fallback 到 'standard' |
| 6 | `src/protocol.ts` | 修改 | 加 `SkyAxisEndpoints.aiTaskAction` + `TaskActionRequestSchema` |
| 7 | `src/host/requirement-service.ts` | 新增 | `taskAction(reqId, taskId, action)` 方法（start/redo 调 prompt，accept/skip 仅本地状态切换）+ `applyAdvanceStage(reqId, toStage, reason, now)` 方法（写 stageHistory entry + emitChange put）+ `applyPlanArtifact(reqId, taskList, now)` 方法（调 writeArtifact） |
| 8 | `src/host/routes/requirements.ts` | 新增 | POST `/ai/task/action` route |
| 9 | `src/host/ai-event-bridge.ts` | 修改 | `tool/call` case 拆出 `advance_stage` 识别 + `assistant/message` case 加 plan JSON 提取 + `ConsumeFollowStreamArgs` 加 `onAdvanceStage`/`onPlanArtifact`/`currentStage` 字段 |
| 10 | `src/client/api/requirement-client.ts` | 新增 | `taskAction(reqId, taskId, action)` fetch |
| 11 | `src/client/index.ts` | 修改 | 注入 `taskActionImpl`（调 `reqClient.taskAction`） |
| 12 | `src/client/page/views/RequirementDetailPage.tsx` | 修改 | `mockTaskList` 计算：plan artifact → null fallback to mock |

### 9.3 实施风险

| 风险 | 缓解 |
|---|---|
| preset copy 路径不可写 → fallback 到 standard preset → agent 不知道 advance_stage | UI 显式 warn banner；stageHistory 不增长但 task action 仍可用 |
| agent 不调 advance_stage（LLM 跑偏） | system prompt 强约束；接入 3+ 引入 auto-advance timeout |
| plan JSON 解析失败（LLM 输出非严格 JSON） | system prompt 强制 JSON-only；解析失败保留 mock fallback |
| tool execute 抛错 → agent 重试死循环 | tool body 包 try/catch，execute 必须 total |
| 多人同时 startTask（racing） | controller `appendTaskTransition` 已带 dedup；DSH queue 自动 dedup by requestId |
| host apply 时 copy + fallback 都失败 | 健康检查 route（`/health`）+ UI 启动 warn banner |

### 9.4 验证

1. **静态**：`pnpm run typecheck` 零错误 + `pnpm run build` 产物更新 + `pnpm run test` 6 失败维持基线（Windows 权限环境问题，无新增回归）
2. **端到端**：
   - 启动 DSH 宿主 → 控制台看到 `[sky-axis:preset] collaborator preset registered at <path>` 或 fallback warn
   - 创建 requirement → 启动 AI session → 看到 `[sky-axis:preset] using sky-axis-collaborator for <reqId>`
   - agent 跑 plan stage → 产出 plan JSON → bridge 识别 → `writeArtifact('plan', ...)` → `[sky-axis:ai] plan artifact written for <reqId>, N tasks`
   - UI StageWorkspacePane 切到 plan artifact 渲染（替换 mockTaskList fallback）
   - 点 task 列表的「开始」→ POST `/ai/task/action` → host `taskAction('start')` → DSH `prompt('queue', taskPrompt)` → 日志 `[sky-axis:ai] taskAction: prompt sent for task <id> action=start`
   - agent 调 `advance_stage('implement')` → bridge `tool/call` 识别 → `applyAdvanceStage` → `[sky-axis:ai] applyAdvanceStage: <reqId> toStage=implement` → stageHistory 收尾 + emitChange put → SSE 回流 → UI Stepper 切到 implement 阶段
3. **失败路径**：copy 失败 → fallback 'standard' → ensureSession 仍能 create → UI 显示「advance_stage 协议未注入」warn + 任务可调但 stage 不自动推进

---

## 6. 关键文件清单

| 文件 | 角色 | 改动类型 |
|---|---|---|
| [src/host/requirement-service.ts](../src/host/requirement-service.ts) | ensureSession + startFollow/stopFollow + consumeSessionFollow + applyAiStateChange + 构造参数 | 改 |
| [src/host/ai-event-bridge.ts](../src/host/ai-event-bridge.ts) | consumeFollowStream（follow 帧→aiState） | 新建 |
| [src/host/routes/requirements.ts](../src/host/routes/requirements.ts) | POST /ai/start route | 改 |
| [src/index.ts](../src/index.ts) | 装配传 sessionController + bootstrap 恢复 follow + 两个 probe effect | 改 |
| [src/protocol.ts](../src/protocol.ts) | SkyAxisEndpoints.aiStart | 改 |
| [src/client/controller/sky-axis-controller.ts](../src/client/controller/sky-axis-controller.ts) | startAi 接口 + startAiImpl deps + 实现 | 改 |
| [src/client/api/requirement-client.ts](../src/client/api/requirement-client.ts) | startAi fetch | 改 |
| [src/client/index.ts](../src/client/index.ts) | 注入 startAiImpl | 改 |
| [src/client/page/sections/AiConductorPane.tsx](../src/client/page/sections/AiConductorPane.tsx) | 启动按钮接线 | 改 |
| [src/client/page/views/RequirementDetailPage.tsx](../src/client/page/views/RequirementDetailPage.tsx) | handleStartAi + aiStarting state | 改 |

---

## 7. 后续接入路线图

对接入 0-1 之后的渐进路径（与架构预览 §5 对齐）：

| 阶段 | 内容 | 解锁能力 | 前置依赖 |
|---|---|---|---|
| **接入 0-1** ✅ | create session + follow 流 → aiState → SSE put → UI | 用户看到 AI 真的在跑 | 第 0 步探测（已完成） |
| **接入 2** | artifact 提取（`assistant/message`→plan/patch）+ `advanceStageImpl` 接 `prompt('queue')` | 阶段推进真起作用 + 产物实时填充 | 接入 0-1 端到端验证通过 |
| **接入 3** | task list 映射（`todo/write`→TaskList）+ `taskActionImpl` | task 状态机真活，点「开始」真起 AI | 接入 2 |
| **接入 4** | UserQuestionProvider + `respondInterventionImpl` | ask-human 闭环，介入点真活 | 接入 2-3 |
| **接入 5** | `steerSessionImpl` 接 `prompt('steer')`（client 直调） | 实时 steer | 接入 4 |
| **接入 6** | `rewindImpl` + `driftDetectImpl`（semantic 层接 LLM） | 回退让 agent 重新生成 + 真实 drift | 接入 2-3 |

**接入 2 的关键决策点**（实施前需拍板，见架构预览 §4）：
- **决策 2（stage 推进由谁判定）**：建议走 prompt 驱动——在 agentPreset 的 system prompt 里定义 `advance_stage(to)` tool，让 agent 显式推进。
- **决策 3（agentPreset 注册时机）**：接入 2 需创建 `sky-axis-collaborator` preset（含 5 阶段协议 + stage contract + `advance_stage` tool），要么 host apply 时自动注册，要么要求用户预置。当前用 shipped `standard` 起步，自定义 preset 创作是接入 2 的事。

---

## 8. 关键设计回顾

### 为什么 aiState 走 put 而不是新帧？

- **最小改动**：现有 `emitChange put` + `handleStreamEvent` 已携带完整 Requirement，aiState 是字段而非独立事件，无需扩类型。
- **去重防抖**：`lastAiState` Map 在 reqSvc 层做，'running'→'running' 不重复写盘；SSE 端 client 收到重复 put 也只是同字段覆盖，无副作用。
- **向前兼容**：接入 2+ 需要 artifact / task list 增量推送时，再扩 `RequirementStreamEvent` 类型不迟。put 通道与未来新帧通道可并存。

### 为什么 ensureSession 在 host 而非 client？

- `aiSessionId` 是持久化字段（写 mate.yaml），必须在 host 端 `updateRequirements` 锁内原子写。
- `create` 是写操作（真起 session），走 host 便于统一鉴权 + bootstrap 恢复。
- client 直调 `ctx.sessions.create` 虽就绪，但拿不到 mate.yaml 写回，且 host 重启时无法恢复——follow 流的宿主必须是 host。

### 为什么 steerSession 走 client 直调而 create 走 host？

- steer 是低延迟、纯文本插入（`ISession.prompt(mode:'steer')` 语义 = 插入当前 running turn），client 直调延迟最低，无需 host 中转。
- 但接入 0-1 暂不接 steer，接入 5 再处理。届时 `ctx.sessions` gateway 已就绪（探测确认），client 直调方案可行。

---

## 9. 术语对照

| 术语 | 出处 | 含义 |
|---|---|---|
| `SessionController` | `@deepseek-ai/dsh-api-session-controller` | DSH host 端 RPC 面，`create`/`prompt`/`follow`/`cancel` |
| `ISessions` | 同上，client contract | DSH client 端 session 集合面，`list`/`create`/`open`/`binding` |
| `SessionFollowFrame` | 同上 | follow 流帧 = `{type:'snapshot'}` \| `SessionEventEntry` |
| `agentPreset` | 同上 | session 预设配置（系统提示词 + tool 定义），`SessionCreateRequest.agentPreset` 指定 |
| `ai-event-bridge` | sky-axis 新增 | follow 流帧→aiState 翻译件，职责单一（不碰 mate.yaml，只 callback） |
| `lastAiState` | sky-axis 新增 | per-requirement 去重防抖 Map，避免高频 turn/start 重复写盘 |
| `followControllers` | sky-axis 新增 | per-requirement AbortController Map，管 follow 流生命周期 |
| `stage contract` | sky-axis 自有 | 每阶段产出的 schema 合约（understand→spec.md、plan→plan.md+tasks.json…） |

> 更完整的术语表见 [架构预览 §7](./ai工作台接入dsh-agent-session-架构预览.md#7-术语表)。
