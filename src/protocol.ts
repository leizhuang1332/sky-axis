/**
 * SkyAxis 插件跨面共享契约（host + client 共用）。
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
 *   - sky-axis **不**冗余存 workspace 元数据（path/title/createdAt），仅存
 *     workspaceId 这个 FK；展示标题时 client 通过 ctx.workspaces.list 实时
 *     join，避免 workspace rename 后两边数据不一致
 *   - ID 用 `${ISO}-${rand6}`（秒级时间戳 + 6 位随机后缀）—— 可排序、碰撞
 *     概率极低；客户端列表用 `localeCompare` 排序天然有序
 */
import { z } from 'zod'

/* ── 端点路径 ── */

/** webServer 端点前缀（host 注册 + client fetch 同源）。 */
export const SKY_AXIS_API_PREFIX = '/api/sky-axis'

/** 端点路径字面量（host 注册时用 path，client fetch 时用同一个字符串）。 */
export const SkyAxisEndpoints = {
  /** 调试端点：返回当前时间戳与包名，验证双半区联通。 */
  ping: `${SKY_AXIS_API_PREFIX}/ping`,
  /** 健康检查：返回进程 uptime + API 前缀。 */
  health: `${SKY_AXIS_API_PREFIX}/health`,

  /* ── Requirement CRUD（Phase 1）── */
  /** 列出全部需求（client 首屏渲染用）。 */
  requirements: `${SKY_AXIS_API_PREFIX}/requirements`,
  /** 新建需求（POST body = NewRequirementSchema）。 */
  requirementCreate: `${SKY_AXIS_API_PREFIX}/requirements/create`,
  /** 删除需求（DELETE ?id=xxx）。 */
  requirementDelete: `${SKY_AXIS_API_PREFIX}/requirements/delete`,
  /** SSE：DomainChanged 事件流（持久连接，client 用 EventSource）。 */
  requirementEvents: `${SKY_AXIS_API_PREFIX}/requirements/events`,
  /** 客户端拉取 workspace 元数据快照（sky-axis 专用 API，不直接代理 DSH apiProxy —— 避免 host 二次转发；客户端应优先用 ctx.workspaces.list）。 */
  workspaceList: `${SKY_AXIS_API_PREFIX}/workspaces`,

  /* ── 物料 CRUD（Phase 2.5）── */
  /** 6 section × 3 op = 18 个 exact route 的模式字面量（实际 host 注册时按 section 展开）。 */
  materialAdd:    `${SKY_AXIS_API_PREFIX}/materials/{section}/add`,
  materialUpload: `${SKY_AXIS_API_PREFIX}/materials/{section}/upload`,
  materialRemove: `${SKY_AXIS_API_PREFIX}/materials/{section}/remove`,
} as const

/* ── 共享子 schema ── */

/**
 * workspaceId brand —— 与 DSH IWorkspaces 的 WorkspaceId 同源（Branded<'WorkspaceId'>），
 * 在 sky-axis 插件内部用 zod brand 表达，避免 brand 字面量字符串漂移。
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

/* ── 需求物料（Phase 2.1：详情页「需求物料」tab 数据建模）── */

/**
 * 物料基础原语 —— 6 个 section 共用的原子类型。
 * - MaterialItemId：物料项主键，UUID v4（client 用 `crypto.randomUUID()`）
 * - Url：仅允许 http/https，禁止 javascript:/file:/data: 等危险 scheme
 * - UserId：DSH workspace 用户 id，空字符串 = 系统/未知
 */

/** 物料项主键 —— UUID v4 字符串。同一 section 内 id 全局唯一。 */
export const MaterialItemIdSchema = z.string().uuid()
export type MaterialItemId = z.infer<typeof MaterialItemIdSchema>

/** URL —— 必须 http/https 协议（防 XSS / SSRF）。 */
export const UrlSchema = z.string().url().refine(
  (u) => {
    try {
      const proto = new URL(u).protocol
      return proto === 'http:' || proto === 'https:'
    } catch {
      return false
    }
  },
  { message: 'only http/https URLs are allowed' },
)
export type Url = z.infer<typeof UrlSchema>

/** 用户标识 —— DSH workspace 用户 id；空字符串 = 系统/未知。 */
export const UserIdSchema = z.string().min(0).max(128)
export type UserId = z.infer<typeof UserIdSchema>

/* ── 6 个物料 section 子项 schema ── */

/** PRD 文档 —— 上传的产品 PRD 文件。
 *  Phase 2.5 新增 `path` required —— host 落盘相对路径（基 = workspace.path），
 *  形态：`.sky-axis/${requirementId}/${section}/${id}-${sanitized-filename}`。
 *  required 是 fail loud 决策 —— 旧 v2 record 无 path，DSH backend 升 v3 直接 reject。 */
export const PrdFileSchema = z.object({
  id:         MaterialItemIdSchema,
  filename:   z.string().min(1).max(255),
  mimeType:   z.string().min(1).max(127),
  /** 字节数（0 也合法 —— 空文件）。 */
  size:       z.number().int().nonnegative(),
  uploadedAt: z.string().datetime(),
  uploadedBy: UserIdSchema,
  path:       z.string().min(1).max(1024),
})
export type PrdFile = z.infer<typeof PrdFileSchema>

/** PRD 链接 —— 在线 PRD 文档（语雀/Notion/Confluence/飞书/自定义）。 */
export const PrdLinkSchema = z.object({
  id:      MaterialItemIdSchema,
  url:     UrlSchema,
  title:   z.string().min(1).max(200),
  /** 来源平台 —— 决定 UI 图标 + 提取标题策略。 */
  source:  z.enum(['yuque', 'notion', 'confluence', 'feishu', 'custom']),
  addedAt: z.string().datetime(),
  addedBy: UserIdSchema,
})
export type PrdLink = z.infer<typeof PrdLinkSchema>

/** 源码仓库 —— git URL + branch + 可选 last commit SHA。 */
export const SourceRepoSchema = z.object({
  id:           MaterialItemIdSchema,
  url:          UrlSchema,
  /** git branch / tag / commit ref；空字符串 = 默认分支（host 解析时回退）。 */
  branch:       z.string().max(255),
  /** last commit SHA（short 7 字符或 full 40 字符均可）；optional —— 未同步时为空。 */
  lastCommitSha: z.string().regex(/^[a-f0-9]{7,40}$/).optional(),
  /** 一句话描述（UI 副标题展示）。 */
  description:   z.string().max(500),
  addedAt:       z.string().datetime(),
  addedBy:       UserIdSchema,
})
export type SourceRepo = z.infer<typeof SourceRepoSchema>

/** 设计稿链接 —— Figma / Sketch / 图片 / embed。 */
export const DesignLinkSchema = z.object({
  id:           MaterialItemIdSchema,
  url:          UrlSchema,
  kind:         z.enum(['figma', 'sketch', 'image', 'embed']),
  title:        z.string().min(1).max(200),
  /** 缩略图 URL —— optional，异步生成中或失败时为空。 */
  thumbnailUrl: UrlSchema.optional(),
  addedAt:      z.string().datetime(),
  addedBy:      UserIdSchema,
})
export type DesignLink = z.infer<typeof DesignLinkSchema>

/** 附件 —— 任意文件（图片 / PDF / 文档 / 压缩包等）。
 *  schema 与 PrdFile 一致 —— 但业务语义不同（PRD 是产品需求文档，附件是补充材料），
 *  保持分开便于未来各自扩展字段。
 *  Phase 2.5 新增 `path` required —— 同 PrdFileSchema。 */
export const AttachmentSchema = z.object({
  id:         MaterialItemIdSchema,
  filename:   z.string().min(1).max(255),
  mimeType:   z.string().min(1).max(127),
  size:       z.number().int().nonnegative(),
  uploadedAt: z.string().datetime(),
  uploadedBy: UserIdSchema,
  path:       z.string().min(1).max(1024),
})
export type Attachment = z.infer<typeof AttachmentSchema>

/** 外部链接 —— API 文档 / 会议纪要 / 调研报告 / 故障复盘 / 其他。 */
export const ExternalLinkSchema = z.object({
  id:          MaterialItemIdSchema,
  url:         UrlSchema,
  title:       z.string().min(1).max(200),
  kind:        z.enum(['api-doc', 'meeting', 'research', 'incident', 'other']),
  /** 一句话摘要（UI 列表副标题）。 */
  description: z.string().max(500),
  addedAt:     z.string().datetime(),
  addedBy:     UserIdSchema,
})
export type ExternalLink = z.infer<typeof ExternalLinkSchema>

/**
 * 需求物料 —— 详情页「需求物料」tab 的完整数据结构。
 *
 * 完美主义原则（Phase 2.1 Strategy C）：
 *   - **6 个 section 全部 required**（不 optional）—— 每条 requirement 物料结构 100% 完整
 *   - **不用 zod `.default()`** —— host create() 显式调用 `emptyMaterials()` 工厂函数
 *   - **loadDetail 收到缺字段视为 invalid-record**（fail loud）—— 不写 silent default 兜底
 *   - **不写 migration script** —— DSH backend 无原生迁移 API（version mismatch 直接全废），
 *     项目未上线不存在需要兼容的旧数据，升级时通过 DSH backend `version: 2` 体现 schema 演进
 *
 * UI 拓扑：
 *   - PRD 文档 / PRD 链接  → AI「理解」阶段优先读
 *   - 源码关联             → AI「实现」阶段优先读
 *   - 设计稿 / 附件 / 外部链接 → AI 任意阶段按需读
 *
 * 写入路径（Phase 2.5 待实现）：
 *   - PRD 文档 / 附件：multipart upload → host `/api/sky-axis/materials/upload`
 *   - 其余 4 section：JSON POST → host `/api/sky-axis/materials/{section}/add`
 */
export const MaterialsSchema = z.object({
  prdFiles:      z.array(PrdFileSchema),
  prdLinks:      z.array(PrdLinkSchema),
  sourceRepos:   z.array(SourceRepoSchema),
  designLinks:   z.array(DesignLinkSchema),
  attachments:   z.array(AttachmentSchema),
  externalLinks: z.array(ExternalLinkSchema),
})
export type Materials = z.infer<typeof MaterialsSchema>

/**
 * 构造一个空物料结构（host create() / controller 工厂用）。
 * 每个 section 都是空数组 —— 显式构造，避免 host 端漏写。
 */
export function emptyMaterials(): Materials {
  return {
    prdFiles:      [],
    prdLinks:      [],
    sourceRepos:   [],
    designLinks:   [],
    attachments:   [],
    externalLinks: [],
  }
}

/** 物料总数（用于 tab header 徽标 / 详情页统计行）。 */
export function countMaterials(m: Materials): number {
  return (
    m.prdFiles.length
    + m.prdLinks.length
    + m.sourceRepos.length
    + m.designLinks.length
    + m.attachments.length
    + m.externalLinks.length
  )
}

/* ── 物料 CRUD（Phase 2.5）── */

/** 6 个物料 section 的字面量联合 —— host routes 按此枚举展开 18 个 exact 路由。 */
export const MaterialSectionSchema = z.enum([
  'prdFiles', 'prdLinks', 'sourceRepos', 'designLinks', 'attachments', 'externalLinks',
])
export type MaterialSection = z.infer<typeof MaterialSectionSchema>

/**
 * 4 个 JSON add 请求 schema —— 故意省略服务端生成字段
 * （id / addedAt / addedBy / uploadedBy / path）。
 * 字段语义：
 *   - url：受限 http/https（UrlSchema）
 *   - title / description：长度上限的字符串
 *   - source / kind：受控枚举（避免脏数据污染 UI 图标 / 提取策略）
 */
export const AddPrdLinkRequestSchema = z.object({
  url:    UrlSchema,
  title:  z.string().min(1).max(200),
  source: z.enum(['yuque', 'notion', 'confluence', 'feishu', 'custom']),
})
export type AddPrdLinkRequest = z.infer<typeof AddPrdLinkRequestSchema>

export const AddSourceRepoRequestSchema = z.object({
  url:           UrlSchema,
  branch:        z.string().max(255),
  lastCommitSha: z.string().regex(/^[a-f0-9]{7,40}$/).optional(),
  description:   z.string().max(500),
})
export type AddSourceRepoRequest = z.infer<typeof AddSourceRepoRequestSchema>

export const AddDesignLinkRequestSchema = z.object({
  url:          UrlSchema,
  kind:         z.enum(['figma', 'sketch', 'image', 'embed']),
  title:        z.string().min(1).max(200),
  thumbnailUrl: UrlSchema.optional(),
})
export type AddDesignLinkRequest = z.infer<typeof AddDesignLinkRequestSchema>

export const AddExternalLinkRequestSchema = z.object({
  url:         UrlSchema,
  title:       z.string().min(1).max(200),
  kind:        z.enum(['api-doc', 'meeting', 'research', 'incident', 'other']),
  description: z.string().max(500),
})
export type AddExternalLinkRequest = z.infer<typeof AddExternalLinkRequestSchema>

/**
 * PrdFile / Attachment 上传的 multipart metadata 校验 schema。
 * size 上限 100MB —— 大于该值应走客户端预校验 + busboy `limits.fileSize` 兜底。 */
export const UploadedFileMetadataSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  size:     z.number().int().nonnegative().max(100 * 1024 * 1024),
})
export type UploadedFileMetadata = z.infer<typeof UploadedFileMetadataSchema>

/* ── 详情页扩展（Phase 1.2：开发意图工作台 schema）── */

/**
 * 5 阶段开发意图工作流的阶段 key。
 * - understand：理解（找歧义 / 搜代码 / 澄清问题）
 * - plan：规划（多方案 / 风险 / 测试策略）
 * - implement：实现（按方案生成代码 / commit）
 * - verify：验证（跑测试 / review）
 * - deliver：交付（跟踪 CI / 合并 / 部署）
 *
 * 阶段流转由 host ai-event-bridge 推 SSE `stageChanged` 帧驱动；client
 * 通过 controller.handleStreamEvent 更新 snapshot。手动推进 / 回退走
 * AiActionRequest 的 `advance` action。
 */
export const StageSchema = z.enum(['understand', 'plan', 'implement', 'verify', 'deliver'])
export type Stage = z.infer<typeof StageSchema>

/** 所有 Stage 值的有序列表 —— Stepper 渲染时按此顺序显示。 */
export const STAGE_ORDER: readonly Stage[] = ['understand', 'plan', 'implement', 'verify', 'deliver']

/** 5 阶段的中文显示顺序（与 STAGE_ORDER 一一对应，便于 UI 索引）。 */
export const STAGE_LABEL_KEYS: readonly string[] = [
  'requirement.detail.stage.understand.label',
  'requirement.detail.stage.plan.label',
  'requirement.detail.stage.implement.label',
  'requirement.detail.stage.verify.label',
  'requirement.detail.stage.deliver.label',
] as const

/**
 * AI session 顶层状态。
 * - idle：未启动 / 已结束
 * - running：正在运转，UI 持续展示流式输出
 * - paused：用户主动暂停（host 已 cancel current session）
 * - awaiting-input：等待人类介入（approval/question/steer）
 * - errored：AI session 异常 / preset 未注册 / 平台能力缺失
 */
export const AiStateSchema = z.enum(['idle', 'running', 'paused', 'awaiting-input', 'errored'])
export type AiState = z.infer<typeof AiStateSchema>

/**
 * 阶段流转历史条目 —— 用于阶段面板展示「何时进入、何时离开、什么结局」。
 * - outcome: 'completed' | 'manual' | 'rolled-back' | 'errored'
 *   - completed：AI 自然完成该阶段
 *   - manual：用户手动「暂回上阶段」标记为 manual
 *   - rolled-back：上一阶段被回退到此阶段（保留审计链）
 *   - errored：该阶段异常退出
 */
export const StageHistoryEntrySchema = z.object({
  stage: StageSchema,
  enteredAt: z.string().datetime(),
  leftAt: z.string().datetime().optional(),
  outcome: z.enum(['completed', 'manual', 'rolled-back', 'errored']).optional(),
})
export type StageHistoryEntry = z.infer<typeof StageHistoryEntrySchema>

/**
 * 介入队列项 —— AI 等待人类介入的事件。
 * - kind: 'approval' | 'question' | 'review'
 *   - approval：tool 调用的权限确认（run shell / write file 等）
 *   - question：AI 主动询问（多选 / 单选 / 文本）
 *   - review：阶段性 review 请求（产出的 plan / patch 让人审）
 * - rpcId：DSH event/mux 的 rpc id（client 调 `ctx.apiProxy.respond` 时回传）
 * - summary：UI 列表展示用的一句话摘要
 * - createdAt：入队时间（用于排序）
 * - payload：原 JSON 帧内容，UI 渲染复杂问答表单时读取
 */
export const InterventionItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['approval', 'question', 'review']),
  rpcId: z.string().min(1),
  summary: z.string().min(1).max(500),
  createdAt: z.string().datetime(),
  payload: z.unknown(),
})
export type InterventionItem = z.infer<typeof InterventionItemSchema>

/**
 * 阶段产物键值条目 —— 每阶段 AI 产生的 plan / patch / note / log / report。
 * - kind：产物种类（决定图标 + 默认渲染器）
 * - title：UI 标题（如「实现方案 v2」「3 个文件的 diff」）
 * - createdAt：产生时间
 * - body：产物正文（markdown / patch / 日志文本）
 * - meta：可选附加元数据（如 patch 的 path / commit sha / report 的 metric）
 */
export const ArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['plan', 'patch', 'note', 'log', 'report']),
  title: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  body: z.string().max(200_000),
  meta: z.record(z.string(), z.unknown()).optional(),
})
export type Artifact = z.infer<typeof ArtifactSchema>

/**
 * AI 操作请求（POST /ai/action 入参）—— discriminated union by action。
 * - pause / resume / cancel：session 控制
 * - steer：实时插入文本到 running session
 * - respond：应答 approval/question（必填 rpcId + answer）
 * - advance：手动推进 / 回退阶段（必填 toStage）
 */
export const AiActionRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('cancel') }),
  z.object({ action: z.literal('steer'), text: z.string().min(1).max(4000) }),
  z.object({
    action: z.literal('respond'),
    rpcId: z.string().min(1),
    /** 答案 payload —— 由 host 包成 ClientResponse envelope 调 ctx.apiProxy.respond。 */
    answer: z.unknown(),
  }),
  z.object({
    action: z.literal('advance'),
    toStage: StageSchema,
    /** 'next' / 'prev' / 自定义 —— UI 显示文案用，host 可不读 */
    intent: z.enum(['next', 'prev', 'manual']).default('manual'),
  }),
])
export type AiActionRequest = z.infer<typeof AiActionRequestSchema>

/** AI 启动请求（POST /ai/start 入参）—— Phase 2 实现。Phase 1 schema 先行。 */
export const AiStartRequestSchema = z.object({
  /** 初始 prompt 文本（任务描述 / 触发 AI 的第一句话）。 */
  initialPrompt: z.string().min(1).max(8000).optional(),
})
export type AiStartRequest = z.infer<typeof AiStartRequestSchema>

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
 *
 * 完美主义原则（Phase 2.1 Strategy C）：
 *   - **所有字段 required**（不 optional、不依赖 zod `.default()` 兜底业务逻辑）
 *   - **host service.create() 显式调用 `defaultRequirementFields()` 工厂函数** 写完整结构
 *   - **DSH backend `version: 2`** 体现 schema 演进（旧数据直接 reject，无 migration script）
 *   - **loadDetail 收到缺字段视为 invalid-record**（fail loud）—— 不写 silent default
 *   - **不写 migration script** —— DSH backend 无原生迁移 API（version mismatch 直接全废），
 *     项目未上线无包袱；升级时通过 DSH `version` 数字演进，dev 一次性清盘 storage 介质即可
 *
 * 字段语义：
 *   - stage / stageHistory / aiState / aiSessionId / aiLastActivityAt：
 *     5 阶段开发意图工作台相关（Phase 1.2 引入，Phase 2.1 改为 required）
 *   - interventionQueue：等待人类介入的项（approval/question/review）
 *   - artifacts：阶段产物键值表（artifactId → Artifact）
 *   - branch：工作分支（git），未指定时 null
 *   - materials：需求物料完整结构（Phase 2.1 新增）
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

  /* ── 5 阶段开发意图工作台（Phase 1.2 引入，Phase 2.1 升级为 required）── */
  /** 当前阶段（5 选 1）。 */
  stage: StageSchema,
  /** 阶段流转历史（可审计、可回退）。 */
  stageHistory: z.array(StageHistoryEntrySchema),
  /** AI session 顶层状态。 */
  aiState: AiStateSchema,
  /** 绑定的 agent session id；未启动时 null。 */
  aiSessionId: z.string().nullable(),
  /** 最近 session/event 时间戳；UI「AI 在 5s 前活跃」用；未启动 null。 */
  aiLastActivityAt: z.string().datetime().nullable(),
  /** 等待人类介入的项（approval/question/review）。 */
  interventionQueue: z.array(InterventionItemSchema),
  /** 阶段产物键值表（artifactId → Artifact）。 */
  artifacts: z.record(z.string(), ArtifactSchema),
  /** 工作分支（git）；未指定时 null。 */
  branch: z.string().nullable(),

  /* ── 需求物料（Phase 2.1 新增，required）── */
  /** 物料完整结构（6 section 全部 required）。 */
  materials: MaterialsSchema,
})
export type Requirement = z.infer<typeof RequirementSchema>

/**
 * 构造 requirement 默认扩展字段（host create() / controller 工厂用）。
 * 所有字段显式填值 —— **不依赖 zod parse-time default**。
 *
 * 使用：
 *   const extended = defaultRequirementFields({ now, input })
 *   const requirement: Requirement = { id, workspaceId, title, ...input, createdAt: now, updatedAt: now, ...extended }
 */
export function defaultRequirementFields(opts: {
  now: string
  input: {
    workspaceId: WorkspaceId
    title: string
    description?: string
    priority: RequirementPriority
    tags: string[]
  }
}): Pick<Requirement,
  'description' | 'stage' | 'stageHistory' | 'aiState' | 'aiSessionId' |
  'aiLastActivityAt' | 'interventionQueue' | 'artifacts' | 'branch' | 'materials'
> {
  return {
    description:       opts.input.description ?? '',
    stage:             'understand',
    stageHistory:      [{ stage: 'understand', enteredAt: opts.now }],
    aiState:           'idle',
    aiSessionId:       null,
    aiLastActivityAt:  null,
    interventionQueue: [],
    artifacts:         {},
    branch:            null,
    materials:         emptyMaterials(),
  }
}

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
  /** 当前 sky-axis API 路径前缀（与 SKY_AXIS_API_PREFIX 一致，便于运行时校验）。 */
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

/** 删除物料响应 —— 返回被删 itemId + 删除后的完整 requirement（让 client 走 SSE put 通道前也能拿到最新值）。 */
export const RemoveMaterialResponseSchema = z.object({
  ok:   z.literal(true),
  id:   MaterialItemIdSchema,
  item: RequirementSchema,
})
export type RemoveMaterialResponse = z.infer<typeof RemoveMaterialResponseSchema>

/* ── 统一响应包装 + 错误码 ── */

/**
 * 主机端 API 错误码（client 据此分桶提示用户）。
 * - validation-failed：入参 zod parse 失败 / HTTP 方法不匹配 / body 超限
 * - workspace-not-found：workspaceId 不在 DSH 当前 workspace 列表中
 * - workspace-list-failed：apiProxy.workspace.list RPC 返回 RpcResult 失败
 * - requirement-not-found：要删除/获取的 id 不存在
 * - invalid-record：KV 中已存的记录 schema 校验失败（极少见，理论上 domain open 时就拦住了）
 * - internal-error：未捕获异常
 *
 * Phase 1.2 增量（AI 协作工作台相关）：
 * - ai-not-configured：sky-axis-collaborator agentPreset 未在 DSH 注册 / 平台能力缺失
 * - ai-session-missing：操作的 requirement 还没启动 AI session（先调 /ai/start）
 * - ai-event-failed：ctx.apiProxy.events.mux() 或 respond 失败
 * - artifact-not-found：getArtifact 取的 artifactId 不存在
 * - stage-invalid：advance 请求的 toStage 与当前 stage 不兼容（如跳跃前进）
 */
export const SKY_AXIS_ERROR_CODES = [
  'validation-failed',
  'workspace-not-found',
  'workspace-list-failed',
  'requirement-not-found',
  'invalid-record',
  'internal-error',
  // ── Phase 1.2 新增 ──
  'ai-not-configured',
  'ai-session-missing',
  'ai-event-failed',
  'artifact-not-found',
  'stage-invalid',
  // ── Phase 2.5 新增 ──
  /** material CRUD：itemId 不在指定 section 内（可能已被删除）。 */
  'material-not-found',
] as const
export type SkyAxisErrorCode = typeof SKY_AXIS_ERROR_CODES[number]

export interface ApiError {
  ok: false
  error: SkyAxisErrorCode
  /** 详细错误信息（zod issue 列表 / 内部错误堆栈摘要）。 */
  detail?: string
}

/** 通用响应包装：成功载荷携带 data，失败载荷携带 error + detail。 */
export type ApiResponse<T> =
  | { ok: true; data: T }
  | ApiError
