/**
 * RequirementDetailPage 的 mock 数据（Phase 1 演示版）。
 *
 * Phase 1 没有真实 task list 落盘（host 尚未把 Plan 阶段产物写到 .sky-axis/${id}/artifacts/）。
 * 这里给 RequirementDetailPage 喂一份静态 mock，让 UI 骨架能完整跑起来。
 *
 * 关键点：
 *   - mock 工厂只读，由 view 层在 useMemo 中调用
 *   - 数据形态必须与 controller 的 RequirementTaskList 完全一致
 *   - Phase 3 接 artifact 系统后，删除此文件 + 改 view 改为 controller 投影
 *
 * 选 implement 阶段演示是为了看到 rolled_back / 失败 / 重做的真实状态组合，
 * 让 AI 工作台 PR-A 验收能从一张截图讲完整的故事。
 */
import type { RequirementTask, RequirementTaskList } from '../../controller/sky-axis-controller.ts'

/** 生成一个稳定的 ISO 时间戳（不依赖 Date.now，便于 snapshot 测试）。 */
function iso(offsetMinutes: number): string {
  return new Date(Date.UTC(2026, 8, 9, 10, 0, 0) + offsetMinutes * 60_000).toISOString()
}

const TASK_1: RequirementTask = {
  id: 'T-implement-001',
  title: 'OAuth 回调处理器',
  goal: '接收 GitHub OAuth code，换 token，写入 session storage',
  acceptance: [
    'POST /api/auth/callback/github 接受 ?code=xxx&state=yyy',
    'code 校验通过后调 GitHub /access_token，5xx 重试 3 次',
    'token 加密后写入 sessionStorage（key=dsh-session）',
  ],
  dependencies: [],
  filesExpected: ['src/server/auth/oauth-callback.ts', 'src/client/auth/session.ts'],
  status: 'done',
  subHistory: [
    { status: 'in_progress', enteredAt: iso(-180), leftAt: iso(-160), outcome: 'completed' },
    { status: 'verifying',   enteredAt: iso(-160), leftAt: iso(-150), outcome: 'completed' },
    { status: 'done',        enteredAt: iso(-150) },
  ],
  artifactRefs: ['art-001'],
  retryCount: 0,
  lastDriftScore: 0.05,
  enteredAt: iso(-180),
}

const TASK_2: RequirementTask = {
  id: 'T-implement-002',
  title: '权限中间件',
  goal: '校验登录态 + scope 路由守卫',
  acceptance: [
    '中间件读取 sessionStorage 中 token，缺失则 302 /login',
    'scope 不匹配返回 403 JSON',
    '导出 requireScope("repo") 高阶函数',
  ],
  dependencies: ['T-implement-001'],
  filesExpected: ['src/server/middleware/auth.ts', 'src/server/middleware/scope.ts'],
  status: 'rolled_back',
  subHistory: [
    { status: 'in_progress', enteredAt: iso(-150), leftAt: iso(-130), outcome: 'rolled-back' },
    { status: 'rolled_back', enteredAt: iso(-130), outcome: 'rolled-back' },
  ],
  artifactRefs: ['art-002'],
  retryCount: 2,
  lastDriftScore: 0.72,
  enteredAt: iso(-150),
}

const TASK_3: RequirementTask = {
  id: 'T-implement-003',
  title: '登出端点',
  goal: '清 sessionStorage 并发 204',
  acceptance: [
    'POST /api/auth/logout 返回 204',
    '前端清 sessionStorage.dsh-session 后跳首页',
    '幂等：未登录调用也返回 204',
  ],
  dependencies: ['T-implement-001'],
  filesExpected: ['src/server/auth/logout.ts'],
  status: 'in_progress',
  subHistory: [
    { status: 'in_progress', enteredAt: iso(-30), outcome: undefined },
  ],
  artifactRefs: [],
  retryCount: 0,
  lastDriftScore: 0.12,
  enteredAt: iso(-30),
}

const TASK_4: RequirementTask = {
  id: 'T-implement-004',
  title: 'Token 刷新策略',
  goal: 'access_token 临近过期自动 refresh',
  acceptance: [
    'access_token < 5min 过期时静默 refresh',
    'refresh 失败则强制重新登录',
  ],
  dependencies: ['T-implement-001', 'T-implement-003'],
  filesExpected: ['src/client/auth/refresh.ts'],
  status: 'pending',
  subHistory: [],
  artifactRefs: [],
  retryCount: 0,
  enteredAt: iso(0),
}

const TASK_5: RequirementTask = {
  id: 'T-implement-005',
  title: '登录页 UI',
  goal: 'OAuth provider 列表 + 「GitHub 登录」按钮',
  acceptance: [
    '未登录访问受保护路由 → 跳 /login',
    '登录页展示 3 个 provider 卡片 + 「GitHub 登录」按钮',
    '点击 GitHub 按钮跳转 oauth start URL',
  ],
  dependencies: [],
  filesExpected: ['src/client/page/LoginPage.tsx'],
  status: 'pending',
  subHistory: [],
  artifactRefs: [],
  retryCount: 0,
  enteredAt: iso(0),
}

/** implement 阶段的 mock task list（演示 rolled_back / in_progress / pending 组合）。 */
export function mockImplementTaskList(): RequirementTaskList {
  return {
    tasks: [TASK_1, TASK_2, TASK_3, TASK_4, TASK_5],
    producedAt: iso(-200),
    producedAtStage: 'plan',
  }
}

/** understand 阶段的 mock —— 全 done，作为「已完成阶段」示例。 */
export function mockUnderstandTaskList(): RequirementTaskList {
  return {
    tasks: [
      {
        id: 'T-understand-001',
        title: '需求歧义扫描',
        goal: '提取 PRD 中的模糊表述并生成澄清问题',
        acceptance: [
          '识别 6 类歧义（actor / edge case / metric / scope / data / format）',
          '每条歧义生成 1 个 yes/no 澄清问题',
        ],
        dependencies: [],
        filesExpected: [],
        status: 'done',
        subHistory: [
          { status: 'in_progress', enteredAt: iso(-300), leftAt: iso(-260), outcome: 'completed' },
          { status: 'verifying',   enteredAt: iso(-260), leftAt: iso(-250), outcome: 'completed' },
          { status: 'done',        enteredAt: iso(-250) },
        ],
        artifactRefs: ['art-u1'],
        retryCount: 0,
        enteredAt: iso(-300),
      },
      {
        id: 'T-understand-002',
        title: '代码上下文检索',
        goal: '定位与本次需求相关的现有模块',
        acceptance: [
          '识别 ≥3 个相关模块',
          '每个模块列出 entry point + 公共 API',
        ],
        dependencies: [],
        filesExpected: [],
        status: 'done',
        subHistory: [
          { status: 'in_progress', enteredAt: iso(-250), leftAt: iso(-230), outcome: 'completed' },
          { status: 'done',        enteredAt: iso(-230) },
        ],
        artifactRefs: ['art-u2'],
        retryCount: 0,
        enteredAt: iso(-250),
      },
      {
        id: 'T-understand-003',
        title: '澄清问答汇总',
        goal: '把澄清问答整理成 spec.md 草稿',
        acceptance: [
          '输出 spec.md（含目标 / 验收 / 风险）',
          'spec.md 通过 controller 上传 .sky-axis/${id}/spec.md',
        ],
        dependencies: ['T-understand-001'],
        filesExpected: ['.sky-axis/{id}/spec.md'],
        status: 'done',
        subHistory: [
          { status: 'in_progress', enteredAt: iso(-220), leftAt: iso(-200), outcome: 'completed' },
          { status: 'done',        enteredAt: iso(-200) },
        ],
        artifactRefs: ['art-u3'],
        retryCount: 0,
        enteredAt: iso(-220),
      },
    ],
    producedAt: iso(-200),
    producedAtStage: 'understand',
  }
}

/** plan 阶段的 mock —— 大部分 done + 一次回退，展示 Stepper rewind dots。 */
export function mockPlanTaskList(): RequirementTaskList {
  return {
    tasks: [
      {
        id: 'T-plan-001',
        title: '候选方案 A',
        goal: 'Spring Security OAuth2 client',
        acceptance: ['方案描述完整', '风险标注', '测试策略标注'],
        dependencies: [],
        filesExpected: [],
        status: 'done',
        subHistory: [
          { status: 'in_progress', enteredAt: iso(-200), leftAt: iso(-190), outcome: 'completed' },
          { status: 'done',        enteredAt: iso(-190) },
        ],
        artifactRefs: ['art-p1'],
        retryCount: 0,
        enteredAt: iso(-200),
      },
      {
        id: 'T-plan-002',
        title: '候选方案 B',
        goal: '自研轻量 OAuth client',
        acceptance: ['方案描述完整', '风险标注', '测试策略标注'],
        dependencies: [],
        filesExpected: [],
        status: 'done',
        subHistory: [
          { status: 'in_progress', enteredAt: iso(-190), leftAt: iso(-180), outcome: 'completed' },
          { status: 'done',        enteredAt: iso(-180) },
        ],
        artifactRefs: ['art-p2'],
        retryCount: 0,
        enteredAt: iso(-190),
      },
      {
        id: 'T-plan-003',
        title: '选定方案',
        goal: '对比 A/B 后选定，记入 task list',
        acceptance: ['决策依据', 'plan.md 落地'],
        dependencies: ['T-plan-001', 'T-plan-002'],
        filesExpected: ['.sky-axis/{id}/plan.md'],
        status: 'rolled_back',
        subHistory: [
          { status: 'in_progress', enteredAt: iso(-180), leftAt: iso(-170), outcome: 'rolled-back' },
          { status: 'rolled_back', enteredAt: iso(-170), outcome: 'rolled-back' },
        ],
        artifactRefs: [],
        retryCount: 1,
        enteredAt: iso(-180),
      },
    ],
    producedAt: iso(-170),
    producedAtStage: 'plan',
  }
}

/** 据 requirement.id + current stage 返回对应 mock。Phase 3 接 artifact 系统后删除。 */
export function pickMockTaskList(stage: 'understand' | 'plan' | 'implement' | 'verify' | 'deliver'): RequirementTaskList | null {
  switch (stage) {
    case 'understand': return mockUnderstandTaskList()
    case 'plan':       return mockPlanTaskList()
    case 'implement':  return mockImplementTaskList()
    case 'verify':
    case 'deliver':    return null  // verify/deliver 阶段还没做，演示时不展示 task list
  }
}

/** 全部 stage 的 mock task list（Stepper meta 用）。
 *  verify / deliver 阶段没 mock → 列表里就不出现，Stepper 那边用 undefined 触发「不显示」。 */
export function allMockTaskLists(): Record<'understand' | 'plan' | 'implement', RequirementTaskList> {
  return {
    understand: mockUnderstandTaskList(),
    plan:       mockPlanTaskList(),
    implement:  mockImplementTaskList(),
  }
}

/** 从 RequirementTaskList 汇总出 Stepper meta。
 *  独立成函数，方便未来 controller 投影时复用同样逻辑。 */
export function summarizeForStepper(list: RequirementTaskList | null): {
  taskDone: number
  taskTotal: number
  rewindCount: number
  rolledBackCount: number
} {
  if (list === null) return { taskDone: 0, taskTotal: 0, rewindCount: 0, rolledBackCount: 0 }
  return {
    taskDone: list.tasks.filter(t => t.status === 'done').length,
    taskTotal: list.tasks.length,
    rewindCount: list.tasks.filter(t => t.subHistory.some(h => h.outcome === 'rolled-back')).length,
    rolledBackCount: list.tasks.filter(t => t.status === 'rolled_back').length,
  }
}

/* ── drift 快照 mock（Phase 1 占位，Phase 3 接真实 drift 检测器）── */

export interface DriftSnapshot {
  /** 0-1 综合分（max of 3 layer）。 */
  overall: number
  /** 静态层：声明产物文件 vs 实际 git 变更不匹配率。 */
  staticLayer: number
  /** 动态层：lint + typecheck + 测试失败归一分。 */
  dynamicLayer: number
  /** 语义层：LLM-as-judge 偏差分。 */
  semanticLayer: number
  /** 检测时刻。 */
  detectedAt: string
  /** 触发 drift 的 task id（optional）。 */
  sourceTaskId: string | null
}

/** 据 stage 返回对应 mock drift 快照。
 *  implement 阶段有意做高（演示需关注/回退路径），其它阶段较低。 */
export function mockDriftSnapshot(stage: 'understand' | 'plan' | 'implement' | 'verify' | 'deliver'): DriftSnapshot | null {
  switch (stage) {
    case 'understand':
      return { overall: 0.08, staticLayer: 0.0, dynamicLayer: 0.05, semanticLayer: 0.10, detectedAt: iso(-200), sourceTaskId: null }
    case 'plan':
      return { overall: 0.18, staticLayer: 0.05, dynamicLayer: 0.0,  semanticLayer: 0.22, detectedAt: iso(-170), sourceTaskId: 'T-plan-003' }
    case 'implement':
      return { overall: 0.72, staticLayer: 0.45, dynamicLayer: 0.62, semanticLayer: 0.72, detectedAt: iso(-25),  sourceTaskId: 'T-implement-002' }
    case 'verify':
    case 'deliver':
      return null
  }
}

/* ── Task action mock impl（PR-B 演示）── */

import type {
  RequirementEntry,
  RequirementError,
  UploadHandle,
} from '../../controller/sky-axis-controller.ts'

/** Task action impl 的函数签名（局部导出，避免从 controller.ts 二次导入）。
 *  与 createSkyAxisController deps.taskActionImpl 完全一致。 */
export type MockTaskActionImpl = (input: {
  requirementId: string
  taskId: string
  action: 'start' | 'accept' | 'redo' | 'skip'
}) => UploadHandle

/** 创建一个 100% 成功的 mock task action impl（无延迟、ok=true）。 */
export function mockTaskActionOk(): MockTaskActionImpl {
  return ({ action, requirementId: _reqId, taskId: _taskId }) => ({
    promise: Promise.resolve({ ok: true as const, action }),
    abort: () => {},
  })
}

/** 创建一个始终失败的 mock impl（用于演示失败回滚路径）。 */
export function mockTaskActionFail(
  code: 'internal-error' | 'task-not-found' | 'invalid-state' = 'internal-error',
  detail = 'mock failure',
): MockTaskActionImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail } }),
    abort: () => {},
  })
}

/** 创建一个可注入延迟 + 可编程响应的 mock impl（用于 e2e 演示「点击 → loading → 完成」）。 */
export function mockTaskActionProgrammable(
  responder: (input: { action: 'start' | 'accept' | 'redo' | 'skip'; requirementId: string; taskId: string }) =>
    { ok: true; item?: RequirementEntry } | { ok: false; error: RequirementError },
  delayMs = 200,
): MockTaskActionImpl {
  return (input) => {
    let aborted = false
    const promise = new Promise<{ ok: true; item?: RequirementEntry } | { ok: false; error: RequirementError }>((resolve) => {
      setTimeout(() => {
        if (aborted) return
        resolve(responder(input))
      }, delayMs)
    })
    const handle: UploadHandle = {
      promise,
      abort: () => { aborted = true },
    }
    return handle
  }
}

/* ── Rewind mock impl（PR-C / 迭代 4）── */

import type {
  RewindRequest,
} from '../../controller/sky-axis-controller.ts'

/** Rewind impl 的函数签名（局部导出，避免从 controller.ts 二次导入）。
 *  与 createSkyAxisController deps.rewindImpl 完全一致。 */
export type MockRewindImpl = (input: {
  requirementId: string
  request: RewindRequest
}) => UploadHandle

/** 创建一个 100% 成功的 mock rewind impl（无延迟、ok=true）。 */
export function mockRewindOk(): MockRewindImpl {
  return () => ({
    promise: Promise.resolve({ ok: true as const }),
    abort: () => {},
  })
}

/** 创建一个始终失败的 mock rewind impl。 */
export function mockRewindFail(
  code: 'rewind-target-invalid' | 'rewind-granularity-conflict' | 'internal-error' = 'internal-error',
  detail = 'mock rewind failure',
): MockRewindImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail } }),
    abort: () => {},
  })
}

/** 创建一个可注入延迟 + 可编程响应的 mock rewind impl。 */
export function mockRewindProgrammable(
  responder: (input: { requirementId: string; request: RewindRequest }) =>
    { ok: true; item?: RequirementEntry } | { ok: false; error: RequirementError },
  delayMs = 200,
): MockRewindImpl {
  return (input) => {
    let aborted = false
    const promise = new Promise<{ ok: true; item?: RequirementEntry } | { ok: false; error: RequirementError }>((resolve) => {
      setTimeout(() => {
        if (aborted) return
        resolve(responder(input))
      }, delayMs)
    })
    const handle: UploadHandle = {
      promise,
      abort: () => { aborted = true },
    }
    return handle
  }
}

/* ── Drift detect mock impl（PR-C / 迭代 5）── */

import type { DriftLayer } from '../../controller/sky-axis-controller.ts'

/** Drift detect impl 的函数签名（局部导出）。 */
export type MockDriftDetectImpl = (input: {
  requirementId: string
  layer: DriftLayer | 'all'
  taskId?: string
}) => UploadHandle

/** 创建一个 100% 成功的 mock drift detect impl。 */
export function mockDriftDetectOk(): MockDriftDetectImpl {
  return () => ({
    promise: Promise.resolve({ ok: true as const }),
    abort: () => {},
  })
}

/** 创建一个始终失败的 mock drift detect impl。 */
export function mockDriftDetectFail(
  code: 'drift-detector-unavailable' | 'drift-no-source-task' | 'internal-error' = 'internal-error',
  detail = 'mock drift failure',
): MockDriftDetectImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail } }),
    abort: () => {},
  })
}

/* ── PR-D / 迭代 6：5 个介入点 mock impl ── */

import type {
  AdjustTaskListPatch,
  FailedTaskResolveDecision,
  RequirementStage,
} from '../../controller/sky-axis-controller.ts'

/** Mock #3 respondIntervention impl 的函数签名（局部导出）。 */
export type MockRespondInterventionImpl = NonNullable<
  Parameters<typeof createSkyAxisControllerMockDepsType>[0]['respondInterventionImpl']
>
/** Mock #2 steerSession impl 的函数签名。 */
export type MockSteerSessionImpl = NonNullable<
  Parameters<typeof createSkyAxisControllerMockDepsType>[0]['steerSessionImpl']
>
/** Mock #5 advanceStage impl 的函数签名。 */
export type MockAdvanceStageImpl = NonNullable<
  Parameters<typeof createSkyAxisControllerMockDepsType>[0]['advanceStageImpl']
>
/** Mock #1 adjustTaskList impl 的函数签名。 */
export type MockAdjustTaskListImpl = NonNullable<
  Parameters<typeof createSkyAxisControllerMockDepsType>[0]['adjustTaskListImpl']
>
/** Mock #4 resolveFailedTask impl 的函数签名。 */
export type MockResolveFailedTaskImpl = NonNullable<
  Parameters<typeof createSkyAxisControllerMockDepsType>[0]['resolveFailedTaskImpl']
>

/* 占位类型 —— 用于上面 NonNullable<Parameters<...>> 的目标签名推导。
   实际运行时不需要此函数存在；纯类型工具。 */
declare function createSkyAxisControllerMockDepsType(input: {
  respondInterventionImpl?: (input: { requirementId: string; rpcId: string; answer: unknown }) => UploadHandle
  steerSessionImpl?: (input: { requirementId: string; text: string }) => UploadHandle
  advanceStageImpl?: (input: { requirementId: string; toStage: RequirementStage }) => UploadHandle
  adjustTaskListImpl?: (input: { requirementId: string; patch: AdjustTaskListPatch }) => UploadHandle
  resolveFailedTaskImpl?: (input: {
    requirementId: string
    taskId: string
    decision: FailedTaskResolveDecision
  }) => UploadHandle
}): void

/* #3 respondIntervention */
export function mockRespondInterventionOk(): MockRespondInterventionImpl {
  return () => ({
    promise: Promise.resolve({ ok: true as const }),
    abort: () => {},
  })
}
export function mockRespondInterventionFail(
  code:
    | 'intervention-not-found'
    | 'intervention-already-resolved'
    | 'internal-error' = 'internal-error',
  detail = 'mock respond failure',
): MockRespondInterventionImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail } }),
    abort: () => {},
  })
}
export function mockRespondInterventionProgrammable(
  responder: (input: { requirementId: string; rpcId: string; answer: unknown }) =>
    { ok: true; item?: RequirementEntry } | { ok: false; error: RequirementError },
  delayMs = 200,
): MockRespondInterventionImpl {
  return (input) => {
    let aborted = false
    const promise = new Promise<{ ok: true; item?: RequirementEntry } | { ok: false; error: RequirementError }>((resolve) => {
      setTimeout(() => {
        if (aborted) return
        resolve(responder(input))
      }, delayMs)
    })
    return { promise, abort: () => { aborted = true } }
  }
}

/* #2 steerSession */
export function mockSteerSessionOk(): MockSteerSessionImpl {
  return () => ({
    promise: Promise.resolve({ ok: true as const }),
    abort: () => {},
  })
}
export function mockSteerSessionFail(
  code: 'steer-text-empty' | 'internal-error' = 'internal-error',
  detail = 'mock steer failure',
): MockSteerSessionImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail } }),
    abort: () => {},
  })
}

/* #5 advanceStage */
export function mockAdvanceStageOk(): MockAdvanceStageImpl {
  return () => ({
    promise: Promise.resolve({ ok: true as const }),
    abort: () => {},
  })
}
export function mockAdvanceStageFail(
  code: 'stage-advance-invalid' | 'internal-error' = 'internal-error',
  detail = 'mock advance failure',
): MockAdvanceStageImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail } }),
    abort: () => {},
  })
}

/* #1 adjustTaskList */
export function mockAdjustTaskListOk(): MockAdjustTaskListImpl {
  return () => ({
    promise: Promise.resolve({ ok: true as const }),
    abort: () => {},
  })
}
export function mockAdjustTaskListFail(
  code: 'internal-error' = 'internal-error',
  detail = 'mock adjust failure',
): MockAdjustTaskListImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail } }),
    abort: () => {},
  })
}

/* #4 resolveFailedTask */
export function mockResolveFailedTaskOk(): MockResolveFailedTaskImpl {
  return () => ({
    promise: Promise.resolve({ ok: true as const }),
    abort: () => {},
  })
}
export function mockResolveFailedTaskFail(
  code: 'task-not-resolvable' | 'internal-error' = 'internal-error',
  detail = 'mock resolve failure',
): MockResolveFailedTaskImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail } }),
    abort: () => {},
  })
}