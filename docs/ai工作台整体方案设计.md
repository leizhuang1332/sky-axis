# AI 工作台整体方案设计

> 范围：sky-axis 需求详情页「AI 工作台」tab 的阶段流程、任务拆分、回退循环机制。
> 读者：sky-axis 插件维护者、DSH 集成方、未来参与 AI 工作台实现的同学。
> 状态：设计讨论稿（v1），尚未进入编码实现。

---

## 0. 背景与动机

sky-axis 当前详情页已实现 5 阶段流水线 UI：

```
Understand → Plan → Implement → Verify → Deliver
```

- Stepper + 三列布局（[AiConductorPane](../src/client/page/sections/AiConductorPane.tsx) / [StageWorkspacePane](../src/client/page/sections/StageWorkspacePane.tsx) / [InterventionQueuePane](../src/client/page/sections/InterventionQueuePane.tsx)）已落地
- `RequirementEntry` 在 schema 层已带 `stage / stageHistory / aiState / interventionQueue / artifacts / branch / materials` 等 5 阶段相关字段
- 但**流水线是单线的**，AI 一旦跑偏或测试失败，目前缺少自动检测和回退机制，所有按钮要么 disabled、要么是手动 action

真实开发是**网状循环**而非直线——verify 失败要回到 implement、implement 偏离要回到 plan、需求理解错了要回到 understand。本文回答 5 个核心问题：

1. 现有 5 阶段是否够用、是否现代
2. 流程如何闭环、中间问题如何回退
3. 阶段之间如何交接
4. 如何拆分任务
5. 实现阶段如何按任务执行，任务方向偏移如何介入

---

## 1. 现有 5 阶段评估

### 1.1 现代对照

| 框架 / 工具 | 阶段划分 | 关键差异 |
| --- | --- | --- |
| **sky-axis 当前** | understand → plan → implement → verify → deliver | 单线 5 阶段 |
| **GitHub Spec Kit** | Constitution → Spec → Plan → Tasks → Implement | "规约"独立成第一类产物；Tasks 是显式中间层 |
| **BMAD-METHOD** | Business → Model → Architecture → Development | 前期需求/建模比实现更重 |
| **Cursor Plan Mode** | Plan → Apply（带 re-plan loop） | 没有显式 verify/deliver，靠测试反馈 |
| **Devin** | Plan → Code → Test → Iterate | 阶段循环 + 浏览器自验证 |
| **Aider / Claude Code** | Files → Architect → Code → Test | 单一 repo 级循环，不分阶段 |

**共识观察**：
- **前期投资在加重**：spec / plan 不再是 AI 自己想，而是结构化产物
- **Tasks 是显式一层**：plan 完了 → 拆任务 → 按任务跑（不是一把梭）
- **循环是默认行为**：不是直走，是边走边回到 plan / understand
- **Verify 不是终点**：测试反馈随时可能触发重做

### 1.2 现有 5 阶段的优点

- 与 DSH `SessionStage` 模型对齐
- UI 已实现，Stepper 可视化直观
- `stageHistory` 已带 outcome 审计：`completed / manual / rolled-back / errored`
- schema 已支持 `advance` action + `intent: 'next' | 'prev' | 'manual'`

### 1.3 现有 5 阶段的不足

| 不足 | 表现 |
| --- | --- |
| **粒度过粗** | "Implement" 是最大桶，里面 1~N 个任务，每个任务都有自己的小循环 |
| **缺少 Tasks 层** | plan 阶段没要求产出 task list，AI 实现时"想一个干一个" |
| **没有 re-plan 触发器** | `intent: 'prev'` 是手动操作，verify 失败不能自动驱动 |
| **Understand 内无循环** | 多轮澄清、AI 反问、回查都靠 prompt 临时拼，不是状态机 |
| **Deliver 之后断开** | 上线观测、灰度回滚、线上事故都没纳入循环 |
| **回退目标靠人记** | "我应该回 plan 还是 understand？"是隐式判断 |

### 1.4 设计决策

**保留 5 阶段名 + 引入 2 个补充维度**：

1. **任务维度（task list）**：plan 阶段后强制拆任务，每个任务有自己的 mini-stage
2. **状态机维度**：阶段不只是 forward，明确支持 rewind / redo / skip / fork

5 阶段名不变，但在每个阶段内部都允许"在自身循环"，而不是把它当成一笔直线推进。

---

## 2. 闭环与回退机制

### 2.1 当前现状

`[src/protocol.ts](../src/protocol.ts)` 里已经预留：

- `StageHistoryEntry.outcome` 含 `rolled-back` / `errored`
- `AiActionRequest` 的 `advance` action 带 `intent: 'prev'`
- `stageHistory` 数组本身可追加 → 形成审计链

但缺一个东西：**回退是手动操作，且回退目标靠人记**。

### 2.2 回退决策三元组

把"回退"从单点动作升级为带上下文的决策：

```
rewind(target, reason, options)
  target:  'current-stage' | 'task:<id>' | 'stage:<name>' | 'understand'
  reason:  'verify-failed' | 'plan-drift' | 'goal-misaligned' | 'human-request' | 'auto-detected-issue'
  options: { preserveDownstream: bool, draftNewPlan: bool, ... }
```

### 2.3 三类回退触发器

| 触发源 | 触发条件 | 默认动作 |
| --- | --- | --- |
| **自动（机器检测）** | verify 测试失败 / 类型错误 / lint 不过 | 重做当前任务 → 若连续 2 次仍失败，回退到 plan |
| **半自动（AI 自评）** | implement diff 与 task.goal 偏差分数超阈值 | 弹"重做 / 改 plan / 接受"三选一让用户拍 |
| **手动（人类）** | 用户主动点回退 / 中途 steer | 用户指定 target + reason，写入 stageHistory |

### 2.4 outcome 不需要新值

现有 `completed / manual / rolled-back / errored` 4 个值足够。回退时把**新 stageHistory 条目**追加，旧条目保留为审计链——这正是 `stageHistory` 已经设计好的行为。

---

## 3. 阶段间交接契约

### 3.1 当前是隐式的

AI 上下文一锅端，靠 prompt 把上游 artifact 塞进去。没有 schema 约束。

### 3.2 引入 Stage Contract

每个阶段产出一个**类型化产物**，且产物的 schema 是显式合约：

| 阶段 | 产出（contract） | 必含字段 |
| --- | --- | --- |
| Understand | `spec.md` | goal / non-goals / open-questions / decisions |
| Plan | `plan.md` + `tasks.json` | 方案 / 风险 / **task 列表** |
| Implement | `patches/` (per task) | 每个 task 一份 diff + commit |
| Verify | `verify-report.md` | 测试结果 / lint / 类型 / 自评 |
| Deliver | `delivery.md` | CI 状态 / MR 链接 / 部署信息 |

**关键约束**：

- 上游 contract 不可变（immutable），要改就回退到上游阶段生成新版
- 每个阶段开始前构造 `stageEntryContext` = `{ 上游产物 + materials }`
- 阶段完成前跑 `stageAcceptanceCheck`（最小校验：plan 阶段产物至少 N 个 task；verify 必须有测试结果）

### 3.3 跟现有 `artifacts{}` 的关系

`artifacts{}` 是 runtime 状态（KV 持久化的，运行时 push 增量）。
**stage contract** 是 schema 层概念（决定每个 stage 必产什么）。

建议：把 stage contract 当作 `artifacts{}` 的 schema 约束——每个 stage 必产某类 artifact。`spec.md` 对应 `Artifact.kind = 'note'`（带 title=`"Specification"` 约定），`tasks.json` 对应 `Artifact.kind = 'plan'`。

---

## 4. 任务拆分模型

### 4.1 当前没有 TaskList

`artifacts{}` 里能塞 `kind: 'plan'` 的产物，但产物**内部**没有强制的 task list 结构。

### 4.2 建议新增 TaskList schema

```ts
type TaskStatus =
  | 'pending' | 'in_progress' | 'verifying'
  | 'done' | 'failed' | 'rolled_back' | 'blocked' | 'skipped'

type Task = {
  id: string
  title: string
  goal: string                          // 一句话目标
  acceptance: string[]                  // 验收标准（可执行的）
  dependencies: TaskId[]                // 依赖其它 task
  filesExpected: string[]               // 预期触碰的文件（drift 检测用）
  branch?: string                       // 可选：每个 task 单独分支
  status: TaskStatus
  subHistory: { enteredAt, leftAt?, outcome? }[]   // task 级 mini history
  artifactRefs: ArtifactId[]            // 关联的产物（patch / verify report）
  retryCount: number                    // 重做计数（用于 auto-rewind 阈值）
  lastDriftScore?: number               // 上次偏差分数
}
```

### 4.3 Tasks 在 UI 上的呈现

`StageWorkspacePane` 中列展示当前 stage 的 task list，每个 task 一行：

- 状态圆点（pending / 进行中 / 完成 / 失败 / 回退）
- 标题 + goal 摘要
- 操作按钮：查看产物 / 重做 / 回退 / 跳到下一步

### 4.4 Tasks 与 Materials 的关系

- **`materials{}` 是 requirement 级**（一份需求一组物料）
- **`tasks[]` 是 stage 级**（每个 stage 拆一组任务，verify 也拆任务）
- **`artifacts{}` 是 task 级**——每个 task 关联自己的产物

---

## 5. 单任务级 loop（核心问题）

### 5.1 设计原则

**任务的循环 ≠ 阶段循环**。阶段是 requirement 级，任务是 task 级。两层循环正交：

```
Requirement 阶段机（粗粒度）:
  Understand → Plan → Implement[+] → Verify → Deliver
                       ↑______________|
                         任意阶段都可 rewind

Task 子阶段机（细粒度，在 Implement / Verify 内部）:
  pending → in_progress → verifying → done
              ↑__________|
                单任务重做
```

### 5.2 单个 Task 的 mini-pipeline

| Task 子阶段 | 内容 | 触发 |
| --- | --- | --- |
| `pending` | 已规划未执行 | plan 阶段产出 |
| `in_progress` | AI 正在生成 patch | 用户 / AI 点开始 |
| `verifying` | 跑测试 / 类型检查 / lint | patch 生成完自动进入 |
| `done` | verify 通过，写入产物 | 自动 |
| `failed` | verify 不通过，未达重做上限 | 自动 |
| `rolled_back` | 任务级回退触发 | 手动 / drift 触发 |
| `blocked` | 等人类介入 | AI 自己识别 / 用户手动 |
| `skipped` | 用户决定跳过 | 手动 |

### 5.3 drift 检测的三层

| 层 | 检测方式 | 阈值 |
| --- | --- | --- |
| **静态** | 触动文件是否在 `filesExpected[]` 内 | 触动越界文件 → 警告 |
| **动态** | 测试 / 类型 / lint 是否过 | 不过 → failed |
| **语义** | LLM-as-judge：对比 patch 与 goal | 偏差分 > 0.6 → 弹人类介入 |

### 5.4 人类介入点（5 个）

| 介入点 | 触发场景 | 用户可见 UI |
| --- | --- | --- |
| **任务开始前** | plan 阶段产出的 task list 是否同意 | StageWorkspace 顶部"采纳 / 调整 task list" |
| **任务执行中** | AI 在干的事偏离方向 | "暂回 / 调整 instruction / 中止" |
| **任务完成后** | 是否接受该 task 的产物 | "接受 / 重做 / 改 plan" |
| **任务失败后** | 连续 N 次重做仍失败 | "重做 / 改 plan / 跳过 / 中止" 四选一 |
| **阶段完成后** | 是否进入下一阶段 | StageGate 弹"进入下一阶段" |

### 5.5 单任务能否回退到 understand 阶段？

**答：能，但不直接**。回退粒度有三档：

| 粒度 | 范围 | 保留 | 场景 |
| --- | --- | --- | --- |
| **A：当前 task 重做** | 单个 task 的 patch + verify | 其它 task 的产物 | 实现有偏差、测试不过、改一行就能修 |
| **B：当前 task 回退到 plan** | 当前 task 销毁 + 当前 stage 内其它 task 也回退（可选） | 上游 stage 产物（understand / plan） | 这个 task 的 goal 错了，需要重新规划 |
| **C：整个 requirement 回退到 understand** | 所有 task、所有 stage 产物全部销毁 | materials（物料） | 需求理解错了，要推倒重来 |

**设计决策**：默认走粒度 A；粒度 B 弹确认；粒度 C 要求用户输入原因 + 二次确认。

---

## 6. 回退粒度决策表

| 场景 | 推荐粒度 | UI 行为 |
| --- | --- | --- |
| 单 task 测试没过 | A | 自动重试 1 次，2 次仍失败 → 弹"重做 / 改 plan / 跳过" |
| 单 task 实现与 goal 偏差大 | A 或 B | 弹用户选择 |
| 整个 stage 范围内多个 task 失败 | B | 弹"回退到 plan 重新拆任务" |
| 用户改了 materials 导致理解过时 | C（部分） | 弹"已变物料，是否回退到 understand 重做？" |
| 需求方向错了 | C | 二次确认 + reason 输入 |
| 用户中途 steer | A 或 B | "插话模式"暂存 steer，task 完成后弹"是否采纳新方向" |

---

## 7. 落地路径（渐进式，避免大爆炸）

| 阶段 | 内容 | UI 增量 |
| --- | --- | --- |
| **3.0 — 任务模型层** | 加 TaskList schema；plan 阶段产物里强制带 tasks.json | StageWorkspacePane 显示 task list 静态展示 |
| **3.1 — 任务级状态机** | TaskStatus 8 态；subHistory；任务级 accept / redo 按钮 | task 行带圆点 + 操作 |
| **3.2 — drift 检测** | 三层 drift（静态 / 动态 / 语义）接入 | 偏差分数显示 + 介入弹窗 |
| **3.3 — 自动 rewind** | verify 失败自动重做；连续失败触发回退弹窗 | Toast 通知 + 弹窗选择 |
| **3.4 — 介入体验** | 5 个介入点全部 UI 化 | 弹窗 + 表单 + reason 输入 |
| **3.5 — Deliver 后循环** | 上线观测 + 灰度回滚 | 新增 deliver 后阶段 |

---

## 8. 核心设计总结（一句话）

**把"5 阶段流水线"升级为"5 阶段需求机 + N 任务子机"，两层循环正交；引入任务级 drift 检测和粒度分档的回退机制，让 AI 的每一次偏移都先被检测、再被弹窗选择，而不是被无视继续走完流水线。**

---

## 9. 已决策项（架构层）

| # | 决策点 | 选择 | 影响 |
| --- | --- | --- | --- |
| **Q1** | AI 工作台是否提到 sidebar 一级 view | **A：保持嵌套在需求详情页** | detail page 内的 tab header 仍是 `物料 / AI 工作台`；sidebar 5 entry 稳定不变 |
| **Q2** | 三栏比例 | **25 / 50 / 25（保持）** | 中列内部上下分（task list 30% + 当前 task 内容 70%）解决"50% 偏紧" |
| **Q3** | task list 是否独立 view | **嵌入到 workbench tab 内** | 不新增 sidebar entry；task list 在中列 stage 内容之上 |
| **额外** | Understand 阶段产物名 | **`spec.md`** | 与 §3.2 stage contract 表对齐；`Artifact.kind = 'note'` + `title = "Specification"` |

**Q1+Q2+Q3 联合结论**：UI 架构局部重构、不推翻。三栏骨架与 tab 结构保留；中列内部纵向布局；右列 drawer + 中心 modal 组合处理新增交互。

## 10. 开放问题（待决策）

1. **Task 与 Branch 的关系**：每个 task 一个独立分支，还是所有 task 共用一个 work branch？
2. **drift 语义层的 LLM-as-judge**：用哪个模型？跟 AI session 同模型还是固定更强的评估模型？
3. **粒度 C 的 audit**：回退到 understand 是否要保留"原理解"快照？保留多久？
4. **Deliver 后阶段**：要不要纳入本次设计，还是单独一个 v2 设计？
5. **plan 阶段的 task 拆分边界**：拆到多细？粒度 A 是"一个文件"还是"一个 PR"？
6. **多人协作**：两个人同时改一个 task 怎么办？目前 schema 没有 collaborator 字段
7. **跨 requirement 复用 task**：相同 pattern 的 task list 是否要支持模板化？

---

## 11. 迭代实施计划（详细）

在 §7 高层「落地路径」基础上展开。下面是**每个迭代的具体改动映射**、**PR 切分**、**依赖关系**。

### 11.1 迭代清单

| 迭代 | 标题 | schema 改动 | UI 改动 | 工作量 |
| --- | --- | --- | --- | --- |
| **1** | UI 骨架重构 | 无 | [Stepper.tsx](../src/client/ui/Stepper.tsx) 增强（节点下方 task 进度 + rewind 历史小点）；[StageWorkspacePane.tsx](../src/client/page/sections/StageWorkspacePane.tsx) 上下分 30/70；[AiConductorPane.tsx](../src/client/page/sections/AiConductorPane.tsx) 加 drift 占位卡 | 1 天 |
| **2** | TaskList 接入 | [protocol.ts](../src/protocol.ts) 新增 `TaskList` schema；`Artifact.kind = 'plan'` 承载 tasks.json | StageWorkspacePane 上 30% 渲染真实 task list + 静态展示 | 2 天 |
| **3** | 任务级状态机 | protocol.ts 新增 `TaskStatus` enum + `Task.subHistory`；[sky-axis-controller.ts](../src/client/controller/sky-axis-controller.ts) 加 `setTaskStatus / redoTask / skipTask` | task 行带状态圆点 + 操作按钮（start / redo / skip） | 2 天 |
| **4** | rewind UI | controller 加 `rewind(target, reason, options)` 方法 | 新增 [RightDrawer.tsx](../src/client/ui/) 组件（target picker + reason textarea + 确认）；conductor 按钮接通 | 2 天 |
| **5** | drift 检测三层 | protocol.ts 加 `DriftScore` 字段（per task + per stage）；controller 接 LLM-as-judge 钩子 | conductor drift 卡片展开；task 行 drift badge | 3 天（要接 LLM） |
| **6** | 5 个介入点 UI 化 | controller 接入各介入点 API | [Modal.tsx](../src/client/ui/)（失败 4 选 1 / 阶段 Gate 阻塞弹窗）+ RightDrawer（task list 调整）+ 同页底栏（steer 暂存） | 3 天 |
| **7** | stageHistory 时间线入口 | 无（已存在） | detail header 加 🔍 按钮展开审计 timeline（rewind 历史可视化） | 1 天 |

**总工作量估算**：~14 天（≈ 3 周）

### 11.2 依赖与可并行性

- **迭代 1 与 2 必须串行**：1 是 UI 骨架，2 才填数据
- **迭代 4（rewind）与 5（drift）可以并行**：两者互不依赖 schema
- **迭代 6（介入点）依赖 3、4、5**：是把前 3 个能力暴露给人类的 UI 总装
- **迭代 7 独立**，可放最后做

### 11.3 推荐 PR 切分

```
PR-A: 迭代 1 + 2 → 骨架 + TaskList 数据接入
PR-B: 迭代 3      → 任务级状态机
PR-C: 迭代 4 + 5  → rewind + drift（可拆成 PR-C1 / PR-C2 两个 PR）
PR-D: 迭代 6      → 介入点 UI
PR-E: 迭代 7      → audit timeline
```

### 11.4 执行优先级

**优先 PR-A**——它是后续所有迭代的 UI 容器，先把"中列上下分 30/70"和"Stepper 增强"定下来，后续插入 task list / drift / rewind 都是"填空"，不会反复改布局。

### 11.5 完成定义（DoD）

每个 PR 合并前必须满足：

- [ ] `pnpm run typecheck` 通过
- [ ] `pnpm run test` 通过（新增的 schema / state machine 必须有单元测试）
- [ ] 至少 1 个手动验收场景（按 user-story 走通）
- [ ] 若新增 i18n key，zh / en 双语字典同步
- [ ] 若新增 CSS class，仅用 `var(--dsw-alias-*)` 令牌，不写死颜色或尺寸
- [ ] 本地 `pnpm run build` 产出 `lib/client.js` 体积增长 < 30KB（gzip 前）
- [ ] 若新增 host route，写入 `SkyAxisEndpoints` + zod schema（不拼字面量）

### 11.6 风险登记

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 0.1.2 DSH session controller 接口尚未稳定 | 迭代 5/6 可能改 API | 用 adapter 模式封一层，避免直接耦合 |
| LLM-as-judge 选型未定 | 迭代 5 阻塞 | 漂移评估模型与执行模型解耦，先做"占位 judge" |
| git branch 与 task 映射方案未定 | 迭代 3/4 联动 | 推迟到 PR-C 再决策，迭代 1-2 不依赖 |
| `artifacts{}` 单文件过大 | KV 性能 | 任务级产物分文件；超过 200KB 走 `outputs/` 落盘 |

---

## 附录 A：与现有代码的对应关系

| 现有代码 | 本文对应 |
| --- | --- |
| [protocol.ts §StageSchema](../src/protocol.ts) | §1 阶段定义 |
| [protocol.ts §StageHistoryEntrySchema](../src/protocol.ts) | §2.4 outcome |
| [protocol.ts §AiActionRequestSchema](../src/protocol.ts) | §2.2 rewind target |
| [sky-axis-controller.ts §SkyAxisSnapshot](../src/client/controller/sky-axis-controller.ts) | §4 TaskStatus（待扩展） |
| [RequirementDetailPage.tsx](../src/client/page/views/RequirementDetailPage.tsx) | §5.4 介入点 |
| [AiConductorPane.tsx](../src/client/page/sections/AiConductorPane.tsx) | §5.4 任务执行控制按钮 |
| [StageWorkspacePane.tsx](../src/client/page/sections/StageWorkspacePane.tsx) | §4.3 task 列表渲染 |
| [InterventionQueuePane.tsx](../src/client/page/sections/InterventionQueuePane.tsx) | §5.4 任务级介入 |

## 附录 B：术语表

- **stage contract**：阶段产出物的 schema 合约
- **drift**：实现偏离 task.goal 的程度
- **rewind**：回退动作（区别于"重做"，rewind 是回到上游、重做是当前层再来）
- **粒度 A/B/C**：本文 §5.5 定义的三档回退粒度
- **stageEntryContext**：阶段开始时构造的输入 bundle（前序产物 + materials）
- **迭代（Iteration）**：本文 §11 中 1-7 编号的实施单元
- **PR 切分**：将多迭代合并到一个可独立 review/merge 的 pull request
- **DoD（Definition of Done）**：完成定义，§11.5 列出每 PR 合并前的硬性检查项