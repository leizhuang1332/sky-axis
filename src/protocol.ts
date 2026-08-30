/**
 * Hello 插件跨面共享契约（host + client 共用）。
 *
 * host 半区（Node 进程）注册的 webServer 路由与 client 半区 fetch 调用的
 * 路径字面量必须**唯一**地来自本文件，避免拼写漂移。响应 schema 用 zod
 * 校验（storage-domain 内部也是用 zod，所以校验器可以跨面共享 —— host
 * 用 `schema.parse(req)` 校验入参，client 用 `schema.parse(res)` 校验出参）。
 *
 * 设计要点：
 *   - workspaceId 是 schema 层强制约束（NewRequirementSchema.workspaceId
 *     无 default、min(1)、brand），不是 UI 层软约束 —— host 路由 zod parse
 *     自动拒绝缺字段
 *   - hello **不**冗余存 workspace 元数据（path/title/createdAt），仅存
 *     workspaceId 这个 FK；展示标题时 client 通过 ctx.workspaces.list 实时
 *     join，避免 workspace rename 后两边数据不一致
 *   - ID 用 `${ISO}-${rand6}`（秒级时间戳 + 6 位随机后缀）—— 可排序、碰撞
 *     概率极低；客户端列表用 `localeCompare` 排序天然有序
 */
import { z } from 'zod'

/* ── 端点路径 ── */

/** webServer 端点前缀（host 注册 + client fetch 同源）。 */
export const HELLO_API_PREFIX = '/api/hello'

/** 端点路径字面量（host 注册时用 path，client fetch 时用同一个字符串）。 */
export const HelloEndpoints = {
  /** 调试端点：返回当前时间戳与包名，验证双半区联通。 */
  ping: `${HELLO_API_PREFIX}/ping`,
  /** 健康检查：返回进程 uptime + API 前缀。 */
  health: `${HELLO_API_PREFIX}/health`,

  /* ── Requirement CRUD（Phase 1）── */
  /** 列出全部需求（client 首屏渲染用）。 */
  requirements: `${HELLO_API_PREFIX}/requirements`,
  /** 新建需求（POST body = NewRequirementSchema）。 */
  requirementCreate: `${HELLO_API_PREFIX}/requirements/create`,
  /** 删除需求（DELETE ?id=xxx）。 */
  requirementDelete: `${HELLO_API_PREFIX}/requirements/delete`,
  /** SSE：DomainChanged 事件流（持久连接，client 用 EventSource）。 */
  requirementEvents: `${HELLO_API_PREFIX}/requirements/events`,
  /** 客户端拉取 workspace 元数据快照（hello 专用 API，不直接代理 DSH apiProxy —— 避免 host 二次转发；客户端应优先用 ctx.workspaces.list）。 */
  workspaceList: `${HELLO_API_PREFIX}/workspaces`,
} as const

/* ── 共享子 schema ── */

/**
 * workspaceId brand —— 与 DSH IWorkspaces 的 WorkspaceId 同源（Branded<'WorkspaceId'>），
 * 在 hello 插件内部用 zod brand 表达，避免 brand 字面量字符串漂移。
 * 客户端必须从 ctx.workspaces.list 拿到真实 id 再传入；UI 选择器只暴露有效 id。
 */
export const WorkspaceIdSchema = z.string().min(1).brand<'WorkspaceId'>()
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>

/** 需求优先级（4 档）。 */
export const RequirementPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent'])
export type RequirementPriority = z.infer<typeof RequirementPrioritySchema>

/** 需求状态（4 态）。 */
export const RequirementStatusSchema = z.enum(['open', 'in_progress', 'done', 'cancelled'])
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>

/**
 * 需求 ID 格式：ISO 时间戳秒 + 6 位 base36 随机后缀（[a-z0-9]{6}）。
 * 例：`2026-08-30T12:34:56.789Z-x9k2p4`。可 localeCompare 排序。
 */
export const REQUIREMENT_ID_RE = /^\d{4}-\d{2}-\d{2}T.+-[a-z0-9]{6}$/
export const RequirementIdSchema = z.string().regex(REQUIREMENT_ID_RE)
export type RequirementId = z.infer<typeof RequirementIdSchema>

/* ── 入参：新建需求 ── */

/**
 * 新建需求请求体。**workspaceId 必填**（schema 层强制），无 default。
 * host 路由在解析时如缺该字段 → 400；UI 端在提交前 disable submit 按钮
 * 提前拦截，避免无效请求。
 */
export const NewRequirementSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  title: z.string().min(1).max(120),
  description: z.string().max(4000).optional(),
  priority: RequirementPrioritySchema.default('normal'),
  tags: z.array(z.string().min(1).max(32)).max(20).default([]),
})
export type NewRequirement = z.infer<typeof NewRequirementSchema>

/* ── 存储实体 ── */

/**
 * KV 存储的 requirement 记录。id/status/时间戳由 host 在 create 时填入；
 * workspaceId 创建后不可变（要换工作区 = 删了重建，避免产物目录归属混乱）。
 */
export const RequirementSchema = z.object({
  id: RequirementIdSchema,
  workspaceId: WorkspaceIdSchema,
  title: z.string().min(1).max(120),
  description: z.string().max(4000),
  priority: RequirementPrioritySchema,
  status: RequirementStatusSchema,
  tags: z.array(z.string().min(1).max(32)).max(20),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type Requirement = z.infer<typeof RequirementSchema>

/* ── Workspace 元数据（client 列表展示用）── */

/**
 * 客户端用到的 workspace 摘要（来自 ctx.workspaces.list.items 投影）。
 * host 端不持有副本 —— 仅在 workspaceList 端点透传一份快照供
 * 降级场景（client 注入失败）使用。
 */
export const WorkspaceSummarySchema = z.object({
  id: WorkspaceIdSchema,
  /** 展示标题（DSH 的 title 字段，空时回退到 path basename）。 */
  title: z.string(),
  /** 真实目录路径（host 端产物落盘根目录；client 仅展示，**不**参与文件 IO）。 */
  path: z.string(),
})
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>

/* ── 响应 schema ── */

/** ping 响应：客户端可借此验证双半区是否联通。 */
export const PingResponseSchema = z.object({
  ok: z.literal(true),
  /** ISO 时间戳。 */
  ts: z.string(),
  /** 包名（来自 host 半区）。 */
  host: z.string(),
})
export type PingResponse = z.infer<typeof PingResponseSchema>

/** health 响应：返回 host 半区进程级元信息。 */
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  /** 进程启动至今毫秒数。 */
  uptimeMs: z.number().int().nonnegative(),
  /** 当前 hello API 路径前缀（与 HELLO_API_PREFIX 一致，便于运行时校验）。 */
  apiPrefix: z.string(),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>

/** 列表响应：当前域内全部需求。 */
export const RequirementsListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(RequirementSchema),
})
export type RequirementsListResponse = z.infer<typeof RequirementsListResponseSchema>

/** 单条创建/获取响应。 */
export const RequirementResponseSchema = z.object({
  ok: z.literal(true),
  item: RequirementSchema,
})
export type RequirementResponse = z.infer<typeof RequirementResponseSchema>

/** workspace 列表响应（host 端透传快照，client 降级方案用）。 */
export const WorkspacesListResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(WorkspaceSummarySchema),
})
export type WorkspacesListResponse = z.infer<typeof WorkspacesListResponseSchema>

/** SSE 事件帧（每帧一个 DomainChanged 事件）。 */
export const RequirementEventSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('put'),
    item: RequirementSchema,
  }),
  z.object({
    operation: z.literal('deleted'),
    id: RequirementIdSchema,
  }),
])
export type RequirementEvent = z.infer<typeof RequirementEventSchema>

/* ── 统一响应包装 + 错误码 ── */

/**
 * 主机端 API 错误码（client 据此分桶提示用户）。
 * - validation-failed：入参 zod parse 失败 / HTTP 方法不匹配 / body 超限
 * - workspace-not-found：workspaceId 不在 DSH 当前 workspace 列表中
 * - workspace-list-failed：apiProxy.workspace.list RPC 返回 RpcResult 失败
 * - requirement-not-found：要删除/获取的 id 不存在
 * - invalid-record：KV 中已存的记录 schema 校验失败（极少见，理论上 domain open 时就拦住了）
 * - internal-error：未捕获异常
 */
export const HELLO_ERROR_CODES = [
  'validation-failed',
  'workspace-not-found',
  'workspace-list-failed',
  'requirement-not-found',
  'invalid-record',
  'internal-error',
] as const
export type HelloErrorCode = typeof HELLO_ERROR_CODES[number]

export interface ApiError {
  ok: false
  error: HelloErrorCode
  /** 详细错误信息（zod issue 列表 / 内部错误堆栈摘要）。 */
  detail?: string
}

/** 通用响应包装：成功载荷携带 data，失败载荷携带 error + detail。 */
export type ApiResponse<T> =
  | { ok: true; data: T }
  | ApiError
