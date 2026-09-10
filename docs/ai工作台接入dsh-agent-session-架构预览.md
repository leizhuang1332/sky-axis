# AI 工作台接入 DSH Agent Session —— 架构预览

> 范围：sky-axis AI 工作台如何接入 DSH agent session，标清接入节点、接入方式与接入效果。
> 依据：sky-axis 源码（`src/`）+ DSH 源码（`deepseek-harness/packages/` + `@deepseek-ai/dsh-api-session-controller` 类型声明）双向调研。
> 读者：sky-axis 插件维护者、DSH 集成方、未来参与 AI 工作台接入实现的同学。
> 状态：架构预览稿（v1），尚未进入编码实现。

---

## 0. 背景与现状判定

sky-axis 已完成 5 阶段流水线 UI（迭代 1-7，PR-A~E 已合入），TaskList / rewind / drift / 介入点 / audit timeline 的 **schema + controller + UI** 三层全部就位。但整条流水线是**断的**——controller 里 8 个会话相关动作的 `*Impl` 注入点全部就位，却一个都没接，全部回落到 mock noop 兜底。

### 关键结论：接入面已留好，但全部走 mock

- **controller 层**：8 个会话相关 `*Impl` 注入点在 `src/client/controller/sky-axis-controller.ts:1208-1263` 全部就位（`taskActionImpl` / `rewindImpl` / `driftDetectImpl` / `respondInterventionImpl` / `steerSessionImpl` / `advanceStageImpl` / `adjustTaskListImpl` / `resolveFailedTaskImpl`）。
- **client 装配层**：`src/client/index.ts:200-274` 里**只接了物料和需求 CRUD 的 impl，8 个会话相关 impl 一个都没接**——全部走 controller 内部 mock noop 兜底。
- **host 层**：`inject = ['webServer', 'workspaceController', 'storageDomain']`（`src/index.ts:75`）**没有 sessionController**；host 端也没有 ai-event-bridge。
- **SSE 流**：`stageChanged` / `aiStateChanged` 等 8 个 AI 事件帧在 `src/protocol.ts:936` 标着"Phase 2/3 扩展"，`handleStreamEvent` 只处理 `put`/`deleted`。

**接入工作 = 把 8 个 `*Impl` 从 mock 切到真实 DSH session 调用 + host 端补 sessionController + 补一个 ai-event-bridge 把 session 事件流翻译回 sky-axis 的 SSE 帧。**

---

## 1. 接入拓扑总览

```
┌─────────────────────── sky-axis 插件(双半区) ───────────────────────┐
│                                                                     │
│  client 半区 (browser)                host 半区 (node)               │
│  ┌─────────────────────┐            ┌───────────────────────────┐  │
│  │ React UI            │            │ RequirementHostService    │  │
│  │ (5阶段Stepper +      │  SSE ◀────│  + host routes            │  │
│  │  task list + drift) │            │                           │  │
│  │   ▲                 │            │   ▲                       │  │
│  │   │ controller       │            │   │ ai-event-bridge(新)    │  │
│  │   │ .steerSession()  │            │   │ 翻译 SessionEvent      │  │
│  │   │ .startTask()     │  HTTP ───▶│   │ → stageChanged SSE 帧  │  │
│  │   │ .rewind() ...    │            │   │                         │  │
│  │   ▼                 │            │   ▼                       │  │
│  │ *Impl(8个,现mock)   │            │ ctx.sessionController(新) │  │
│  └─────────┬───────────┘            │  + ctx.userQuestions(新) │  │
│            │                         └───────────┬───────────────┘  │
│            │ 直接调 DSH client API               │ 直接调 DSH host API│
└────────────┼──────────────────────────────────────┼──────────────────┘
             ▼                                      ▼
  ctx.sessions: ISessions                ctx.sessionController: SessionController
  (client 端,已 inject 'sessions')      (host 端,需补 inject)
  create() / open() / binding()         create() / prompt() / follow() / cancel()
  ISession.prompt(mode:'steer')         UserQuestionProvider(新注册)
```

**核心思路**：steer / startTask / respondIntervention 这类"用户即时操作"走 client 端 `ctx.sessions` 直接调（低延迟，UI 即时反馈）；create session / follow 事件流 / ask-human 桥接这类"需要 host 中转"的走 host 端 `ctx.sessionController`。两边分工，避免所有流量都过一遍 HTTP。

---

## 2. DSH 侧可用能力（调研结论）

### 2.1 Session 生命周期（`ctx.sessionController`，host 端）

来源：`@deepseek-ai/dsh-api-session-controller/lib/types/index.d.ts`

```typescript
declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionController: SessionController;
  }
}

export declare class SessionController extends TypertRemoteService {
  create(request: SessionCreateRequest): Promise<SessionCreateValue>;
  prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue>;
  cancel(request: SessionCancelRequest): SessionCancelValue;
  follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame>;
  control(signal: AbortSignal): AsyncIterable<SessionControlFrame>;
  rename(request: SessionRenameRequest): Promise<SessionRenameValue>;
  fork(request: SessionForkRequest): Promise<SessionForkValue>;
  page(request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage>;
  // ...list / inspect / resolveAgent / selectModel
}
```

**关键类型**：

```typescript
interface SessionCreateRequest {
  readonly workspaceId?: WorkspaceId;
  readonly cwd?: string;
  readonly sessionId?: SessionId;
  readonly agentPreset?: string;          // ← sky-axis 需预注册的 preset 名
}

interface SessionPromptRequest {
  readonly requestId: SessionRequestId;
  readonly sessionId: SessionId;
  readonly mode: 'queue' | 'steer';       // ← steer 直接对应 sky-axis steerSession
  readonly content: readonly PromptContentPart[];
  readonly clientTimeZone?: string;
}
```

### 2.2 Session 行为面（`ctx.sessions: ISessions`，client 端）

来源：`@deepseek-ai/dsh-api-session-controller/lib/types/client/contract/sessions.d.ts`

```typescript
export interface ISessions {
  readonly list: ObservableSnapshot<SessionListState>;
  create(opts?: { workspaceId?: WorkspaceId; cwd?: string; sessionId?: SessionId }): Promise<SessionId>;
  open(id: SessionId): void;                                  // 选为当前 session
  binding(id: SessionId): SessionBinding | undefined;        // 拿到 SessionFace
  sessionOf(ctx: Context): SessionFace | undefined;          // agent-scoped ctx 取 face
  scope(id: SessionId): AgentContext | undefined;
  fork(opts: { sessionId: SessionId; atSeq?: number; increaseTitle?: boolean }): Promise<SessionId>;
  // ...
}
```

### 2.3 单个 Session 的行为动词（`ISession`）

来源：`.../contract/session.d.ts`

```typescript
export interface ISession {
  readonly sessionId: SessionId;
  readonly projections: ProjectionsFace;
  beginSubmission(input: BeginSubmissionInput): SubmissionHandle;   // requestId 回显
  prompt(content: PromptContentPart[], mode: 'queue' | 'steer', signal?: AbortSignal, requestId?: SessionRequestId): Promise<RemoteResult<{ accepted: true }>>;
  updateQueue(itemId: MessageId, action: QueueAction): Promise<RemoteResult<{ accepted: true }>>;
  cancel(): Promise<RemoteResult<{ accepted: true }>>;
  rename(title: string): Promise<RemoteResult<{ title: string; seq: SessionSeq }>>;
  loadOlder(): Promise<void>;                                       // 历史分页
  loadThrough(seq: SessionSeq): Promise<void>;                      // 轮次跳转加载
  command(line: string): Promise<RemoteResult<{ matched: boolean }>>;
}
// SessionFace = ISession & ObservableSnapshot<SessionSnapshot>  ← 既是动词集也是可观察状态
```

### 2.4 Session 事件流

来源：`.../contract/events.d.ts` + DSH 源码 `deepseek-harness/packages/core/session/src/types.ts`

DSH 的 session event 是 **turn/step 两级**（不是 stage）：

```typescript
interface SessionEventMap {
  'turn/start': { turn: number }
  'turn/end':   { turn: number; reason: TurnEndReason }
  'step/start': { turn: number; step: number }
  'step/end':   { turn: number; step: number }
  'user/message':       UserMessage
  'assistant/chunk':    { turn; step; chunk: StreamChunk }     // 流式 token
  'assistant/message':  { turn; step; message: AssistantMessage } // 组装完成的产出
  'tool/call':          { turn; step; callId; name; arguments }  // 工具调用
  'tool/result':        { turn; step; message: ToolResultMessage } // 工具结果
  'todo/write':         { todos: TodoItem[] }
  'request/header':     { header: EpochHeader; reason }
  'request/context':    RequestContext
  'session/end-seed':   Record<string, never>
}
```

follow 流帧形态：
```typescript
type SessionFollowFrame =
  | { type: 'snapshot'; header; cursor; records: SessionHistoryRecord[]; hasMore; projections }
  | SessionEventEntry                                                     // 增量事件
```

### 2.5 DSH 的 ask-human 机制（`ctx.userQuestions`）

来源：DSH 源码 `deepseek-harness/packages/interaction/`

- `ctx.userQuestions.registerProvider(provider)` — 注册 UI 端 provider
- `ctx.userQuestions.ask(request): Promise<AskUserQuestionAnswer>` — **同步阻塞**，tool 执行中 await 人类回答
- `tool-ask-user` 是 **model-facing tool**：模型调 `ask_user_question` → tool 内 `await ctx.userQuestions.ask()` → 人类回答 → tool 返回结果给模型
- `plan-mode` 的 `exit_plan_mode` 也走同一机制做 plan-review（approve/keep-planning）

### 2.6 DSH 不提供的能力（sky-axis 需自建）

| 能力 | DSH 现状 | sky-axis 对应 | 行动 |
|---|---|---|---|
| **SessionStage** | 无 stage 概念，只有 turn/step + goal 4 态 phase（active/paused/blocked/complete）+ plan-mode（bool） | 5 阶段 understand→plan→implement→verify→deliver + stageHistory | sky-axis 完全自建，持久化到 `mate.yaml`；用 `advance_stage` tool 显式驱动 |
| **结构化 Artifact 持久化** | 无；agent 产出全在 session event log（JSONL/SQLite） | `requirement.artifacts{}` KV + `outputs/` 落盘 | sky-axis 完全自建；ai-event-bridge 从 session log 提取 `assistant/message` 作为 artifact body |

---

## 3. 接入节点逐一映射（8 个节点）

### 节点 1 — 创建/绑定 Session（host 端，新增）

**触发**：需求详情页首次进入"AI 工作台" tab，或 understand 阶段首次需要 AI 介入。

**接入方式**：
- host 端 `src/index.ts:75` `inject` 增加 `'sessionController'`
- host service 新增 `ensureSession(requirementId)`：
  ```
  if (req.aiSessionId) return req.aiSessionId        // 已绑定
  const sessionId = await ctx.sessionController.create({
    workspaceId, cwd: workspacePath, agentPreset: 'sky-axis-collaborator'
  })
  // 写回 requirement.aiSessionId + aiState='running'
  ```
- **agentPreset 是关键**：DSH 的 `SessionCreateRequest` 支持 `agentPreset` 字段，sky-axis 需预先注册一个名为 `sky-axis-collaborator` 的 preset（系统提示词里写死 5 阶段协议 + stage contract 格式 + `advance_stage` tool 定义）。

**接入后效果**：用户打开 AI 工作台即拉起一个 DSH agent，`aiState` 从 `idle`→`running`，Stepper 第一阶段点亮。

---

### 节点 2 — 喂 prompt / 阶段推进（host 端 + client 端）

**触发**：understand 阶段开始；或 `advanceStage()` 从 plan→implement。

**接入方式**：
- **`advanceStageImpl`**（`controller.ts:1249`）→ host 端先写 `stageHistory`（收尾旧 entry + 追加新 entry），再调 `ctx.sessionController.prompt({ sessionId, mode:'queue', content:[{type:'text', text: 构造的阶段 prompt}] })`
- prompt 文本由 host 端按 stage contract 构造：塞入上游产物（spec.md / plan.md + tasks.json）作为上下文，要求 agent 产出该阶段 contract。
- **`steerSessionImpl`**（`controller.ts:1243`）→ 这条**走 client 端直调**：`ctx.sessions.binding(req.aiSessionId)?.session.prompt([{type:'text',text}], 'steer')`。DSH 的 `ISession.prompt(mode:'steer')` 语义就是"插入当前 running turn"，与 sky-axis steer 语义完全吻合，无需 host 中转，延迟最低。

**接入后效果**：
- 阶段推进时 agent 收到结构化 prompt 并开始产出；
- 用户在 SteerBar 打字 → 立即插入 agent 当前 turn（DSH steer 模式），不用等当前 turn 结束。

---

### 节点 3 — 事件流订阅 → SSE 桥接（host 端，新增 ai-event-bridge）

**这是最核心的新增件**。当前 sky-axis 的 SSE 流只有 put/deleted，接入后要补 8 个 AI 事件帧。

**接入方式**：
- host service 启动后，对每个有 `aiSessionId` 的 requirement 调 `ctx.sessionController.follow({ address:{kind:'session',sessionId}, signal }, signal)` 拿到 `AsyncIterable<SessionFollowFrame>`
- ai-event-bridge 把 DSH 事件翻译成 sky-axis SSE 帧：

| DSH SessionEvent | sky-axis SSE 帧 | 触发条件 |
|---|---|---|
| `turn/start` | `aiStateChanged` (running) | agent 开始响应 |
| `assistant/message`（含 tool-call pattern 完成 plan） | `stageChanged` + `artifactUpdated` | 检测到产物型 tool result |
| `tool/call` + `tool/result`（写文件/diff） | `artifactUpdated` (kind='patch') | task 产物落盘 |
| `todo/write` | （可选）映射到 task list 增量 | DSH 自带 todo，可与 TaskList 对齐 |
| `turn/end` (reason) | `aiStateChanged` (idle/errored) | turn 结束 |
| ask-human 挂起（见节点5） | `aiStateChanged` (awaiting-input) + `interventionAdded` | 阻塞等待 |

**接入后效果**：UI 不再是静态快照——Stepper 实时显示 agent 当前在哪个阶段、AiConductorPane 流式显示 agent 输出、产物卡片实时生成。这是把"mock 演示"变成"真 AI 工作台"的关键一步。

---

### 节点 4 — Task 级状态机对接（client 端）

**触发**：`startTask` / `redoTask` / `skipTask` / `acceptTask`。

**接入方式**：
- **`taskActionImpl`**（`controller.ts:1212`）→ client 端构造 task 专属 prompt（含 task.goal + task.acceptance + task.filesExpected），调 `ISession.prompt(mode:'queue')` 喂入。
- task 的 `in_progress`→`verifying`→`done/failed` 状态流转由 ai-event-bridge 驱动：agent 的 `tool/call`（跑测试/类型检查）对应 `verifying`，`tool/result` 成功对应 `done`。
- `retryCount` 由 bridge 累计，连续 2 次失败触发 `failed` → 弹 FailedTaskResolveModal（已实现）。

**接入后效果**：task list 的 8 态状态机真正活起来——点"开始"真起 AI，圆点实时变色，失败自动重试 + 介入弹窗。

---

### 节点 5 — 介入点 / ask-human 桥接（host 端，新增 UserQuestionProvider）

**这是接入里最巧妙的一环**。DSH 的 ask-human 是 **tool 内同步阻塞**（`ctx.userQuestions.ask()` 返回 Promise，tool await 它），sky-axis 的 intervention 是**异步队列 + SSE 推送**。两边要桥接。

**接入方式**：
- host 端注册一个 `UserQuestionProvider`：
  ```
  ctx.userQuestions.registerProvider({
    ask(request): Promise<Answer> {
      // 1. 把 DSH 的 question 翻译成 sky-axis InterventionItem
      //    (rpcId ← request 的 requestId)
      // 2. 写入 requirement.interventionQueue
      // 3. SSE 推 interventionAdded 帧
      // 4. 返回一个 Promise,resolve 时机 = client 回答
      //    (见节点6 respondIntervention 调用这个 Promise 的 resolver)
      // 5. 同时 aiState → 'awaiting-input'
    }
  })
  ```
- DSH agent 调 `ask_user_question` tool → tool 阻塞 → provider.ask() 触发 → sky-axis UI 弹介入 → 用户答 → resolve → tool 拿到答案继续。

**sky-axis 5 个介入点的映射**：

| sky-axis 介入点 | DSH 机制 | 桥接方式 |
|---|---|---|
| #3 应答（approval/question/review） | `userQuestions.ask()` | provider 桥接，rpcId 对齐 |
| #2 实时 steer | `ISession.prompt(mode:'steer')` | client 直调，不走 ask |
| #1 task list 调整 | 非 ask-human，是 prompt 注入 | advanceStageImpl 路径 |
| #4 失败 4 选 1 | 非 ask，是 sky-axis 自有状态机 | resolveFailedTaskImpl |
| #5 阶段 Gate | 非 ask，是 sky-axis 自有 | advanceStageImpl |

**接入后效果**：agent 主动提问时，sky-axis 右栏 InterventionQueuePane 实时弹出入队项，用户在 UI 答完后 agent 自动继续——`rpcId` 机制天然对齐（`protocol.ts:611` 的 TODO 注释可以消掉了）。

---

### 节点 6 — respondIntervention（client 端）

**触发**：用户在 InterventionRespondDrawer 点"批准/拒绝/回答"。

**接入方式**：
- **`respondInterventionImpl`**（`controller.ts:1237`）→ client 端拿到 `rpcId`，找到节点 5 里挂起的那个 Promise resolver，`resolve(answer)`。
- DSH 的 tool 拿到答案继续执行，ai-event-bridge 监到 `turn` 恢复 → `aiStateChanged` (running)。

**接入后效果**：用户应答 → agent 立即恢复，介入队列项移除，无需手动刷新。

---

### 节点 7 — rewind / drift（host 端）

**触发**：rewind Drawer 提交；drift 检测触发。

**接入方式**：
- **`rewindImpl`**（`controller.ts:1221`）→ host 端改 `stageHistory` 后，调 `ctx.sessionController.prompt(mode:'queue')` 喂入"回退指令 + 新 target stage 的 contract"，让 agent 在新上下文重跑。粒度 C 时可考虑 `sessionController.fork()` 从早期 turn 分叉（调研确认 fork 支持从 `atSeq` 切）。
- **`driftDetectImpl`**（`controller.ts:1229`）→ **semantic 层**：把 task.goal + agent 最近 patch 喂回 `ctx.sessionController.prompt()` 让同一 agent 自评，或调独立 LLM（开放问题 2 待定）。静态层（`filesExpected` 越界）+ 动态层（测试/lint）由 host 端直接跑，不需 session。

**接入后效果**：回退真正让 agent 重新生成（而非只改本地状态）；drift 分数从 mock 抖动变成真实评估。

---

### 节点 8 — artifact 提取（host 端）

**触发**：agent 产出 plan/patch/note。

**接入方式**：DSH **没有结构化 artifact 持久化**——agent 产出全在 session event log 里。ai-event-bridge 在监到 `assistant/message` 时，按 stage contract 解析内容：
- plan 阶段的 message → 提取为 `Artifact(kind='plan')`，body 写 tasks.json
- implement 阶段的 `tool/result`（diff）→ `Artifact(kind='patch')`
- 写入 `requirement.artifacts{}` + 可选落盘 `outputs/`（已实现，`src/host/artifact-writer.ts`）

**接入后效果**：StageWorkspacePane 的产物列表实时填充真实 AI 产物，不再是空壳。

---

## 4. 关键架构决策点（实施前需拍板）

调研中浮现 3 个设计岔路，影响接入形态：

### 决策 1 — client 直调 vs host 中转的分工边界

steer 这种低延迟、纯文本的操作，client 端 `ctx.sessions.binding().session.prompt('steer')` 最快。但 create/follow/cancel 必须在 host（因为要持久化 aiSessionId、要长连接 follow 流）。

- **建议**：steer + respondIntervention 走 client 直调，其余走 host 中转。
- **风险**：这要求 client 端 `ctx.sessions` 在当前部署已就绪——而 `src/client/index.ts:365-399` 的探测 effect 显示 0.1.2-rc.1 实测 gateway 未就绪。**需要先确认当前 DSH 版本 gateway 是否已修复**，否则 client 直调方案作废，全部走 host 中转。

### 决策 2 — stage 推进由谁判定

DSH 没有 stage 概念（只有 turn/step + goal 4 态 phase）。两条路：
- **(a) prompt 驱动**：每个 stage 的 prompt 里要求 agent 调用一个 `advance_stage` tool，bridge 监到 tool/call 即推进——主动、可控。
- **(b) 启发式**：bridge 监 `assistant/message` 内容模式推断阶段——被动、易错。

- **建议走 (a)**：在 agentPreset 的 system prompt 里定义 `advance_stage(to)` tool，让 agent 显式推进。这也让 sky-axis 的 stage 与 DSH 的 tool 语义对齐，审计链清晰。

### 决策 3 — agentPreset 的注册时机

sky-axis 现在的 `ai-not-configured` 错误码（`protocol.ts:888`）暗示已经预留了"preset 未注册"场景。preset 要么在 host apply 时注册，要么要求用户在 DSH 全局配置里预置。
- **建议** host apply 时自动注册，失败给明确 actionable 错误。

---

## 5. 渐进式接入路径（与现有 PR-A~E 迭代对齐）

| 阶段 | 内容 | 解锁的能力 |
|---|---|---|
| **接入 0** | host inject 补 `'sessionController'` + `ensureSession()` + agentPreset 注册 | 能创建 session，但 UI 还看不到流 |
| **接入 1** | ai-event-bridge：`follow()` → SSE 帧（先做 `aiStateChanged` + `artifactUpdated`） | UI 看到 agent 实时跑、产物实时出 |
| **接入 2** | `taskActionImpl` + `advanceStageImpl` 接 `prompt('queue')` | task 状态机 + 阶段推进真起作用 |
| **接入 3** | UserQuestionProvider + `respondInterventionImpl` | ask-human 闭环，介入点真活 |
| **接入 4** | `steerSessionImpl` 接 `prompt('steer')`（client 直调或 host 中转视决策 1） | 实时 steer |
| **接入 5** | `rewindImpl` + `driftDetectImpl`（semantic 层接 LLM） | 回退 + 真实 drift |

**接入 0-1 是最小可见闭环**（用户能看到 AI 真的在跑），建议作为下一个 PR。接入 3（介入点）是体验跃迁点，但依赖前面 1-2 先通。

---

## 6. sky-axis 现有代码与接入点的对应关系

| 现有代码位置 | 本文对应 | 接入动作 |
|---|---|---|
| `src/index.ts:75` host `inject` 数组 | §1 拓扑 host 端 | 增加 `'sessionController'` |
| `src/client/index.ts:177` client `inject` 数组 | §1 拓扑 client 端 | 已有 `'sessions'`，需确认 gateway 就绪 |
| `src/client/index.ts:365-399` sessions 探测 effect | §4 决策 1 | 探测结论决定 client 直调是否可行 |
| `src/client/index.ts:200-274` controller 装配 | §3 8 个节点 | 把 8 个 `*Impl` 逐一从 mock 切到真实调用 |
| `src/client/controller/sky-axis-controller.ts:1208-1263` 8 个 `*Impl` 注入点 | §3 节点 1-7 | 接入目标 |
| `src/protocol.ts:425-429` 5 阶段 schema | §2.6 自建 stage | sky-axis 自管，DSH 不介入 |
| `src/protocol.ts:611` InterventionItem.rpcId 注释 | §3 节点 5 | 接入后 TODO 可消除 |
| `src/protocol.ts:888` `ai-not-configured` 错误码 | §4 决策 3 | preset 注册失败的场景 |
| `src/protocol.ts:936-939` RequirementStreamEvent 8 帧 | §3 节点 3 | ai-event-bridge 要补的实现 |
| `src/host/artifact-writer.ts` | §3 节点 8 | 已实现，bridge 复用 |
| （新增）`src/host/ai-event-bridge.ts` | §3 节点 3 | follow 流 → SSE 帧翻译 |
| （新增）`src/host/session-service.ts` | §3 节点 1 | ensureSession + prompt 封装 |

---

## 7. 术语表

- **SessionController**：DSH host 端 `ctx.sessionController`，RPC 面，提供 create/prompt/follow/cancel/fork 等 session 生命周期动词。
- **ISessions**：DSH client 端 `ctx.sessions`，session 集合的 read + create/open/binding 面，暴露单个 SessionFace。
- **ISession**：单个 session 的行为动词集（prompt/updateQueue/cancel/loadOlder/loadThrough/command）+ 可观察状态（SessionSnapshot）。
- **SessionFace**：`ISession & ObservableSnapshot<SessionSnapshot>`，一个 session 的完整对外面。
- **SessionEvent**：DSH 的 turn/step 两级事件（turn/start、assistant/message、tool/call、tool/result 等）。
- **agentPreset**：DSH session 的预设配置（系统提示词 + tool 定义），`SessionCreateRequest.agentPreset` 字段指定。
- **UserQuestionProvider**：DSH ask-human 机制的 UI 端 provider，`ctx.userQuestions.registerProvider()` 注册，`ask()` 同步阻塞等人类回答。
- **ai-event-bridge**：sky-axis 新增的 host 端模块，把 DSH SessionEvent 翻译成 sky-axis RequirementStreamEvent SSE 帧。
- **stage contract**：sky-axis 每阶段产出的 schema 合约（understand→spec.md、plan→plan.md+tasks.json、implement→patches/ 等）。
- **rpcId**：DSH event/mux 的 rpc id，prompt 的 `requestId` 回显为 durable user source 的 `rpcId`——与 sky-axis `InterventionItem.rpcId` 天然对齐。

---

## 8. 核心总结（一句话）

**接入的本质是：把 sky-axis controller 里 8 个 mock `*Impl` 换成 DSH `sessionController` / `ISession` 的真实调用，并在 host 端补一个 ai-event-bridge 把 DSH 的 turn/step 事件流翻译成 sky-axis 的 stage/aiState SSE 帧。** DSH 提供了 prompt（含 steer 模式）、follow 流、ask-human（`userQuestions`）三件套，与 sky-axis 的 steerSession / 事件订阅 / 介入点天然对齐；不对齐的是 stage 模型（DSH 无 stage，需 sky-axis 自建 + 用 `advance_stage` tool 显式驱动）和 artifact 持久化（DSH 无结构化 artifact，需 bridge 从 session log 提取）。
