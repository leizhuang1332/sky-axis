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
  /** 导入已存在的需求（Plan I）：改写 owner workspaceId,数据全保留。 */
  requirementImport: `${SKY_AXIS_API_PREFIX}/requirements/import`,
  /** SSE：DomainChanged 事件流（持久连接，client 用 EventSource）。 */
  requirementEvents: `${SKY_AXIS_API_PREFIX}/requirements/events`,
  /** 客户端拉取 workspace 元数据快照（sky-axis 专用 API,直接读 host 端缓存的 WorkspaceView,不直接代理 DSH workspaceController —— 避免 host 二次转发;客户端应优先用 useWorkspaces() hook）。 */
  workspaceList: `${SKY_AXIS_API_PREFIX}/workspaces`,

  /* ── 物料 CRUD（Phase 2.5）── */
  /** 6 section × 3 op = 18 个 exact route 的模式字面量（实际 host 注册时按 section 展开）。 */
  materialAdd:    `${SKY_AXIS_API_PREFIX}/materials/{section}/add`,
  materialUpload: `${SKY_AXIS_API_PREFIX}/materials/{section}/upload`,
  materialRemove: `${SKY_AXIS_API_PREFIX}/materials/{section}/remove`,

  /* ── 产物落盘（Phase 3.x：工作区目录结构改造 Sprint 4）── */
  /** 显式触发 artifact 落盘到 outputs/（默认不写 —— opt-in by client）。 */
  artifactWrite: `${SKY_AXIS_API_PREFIX}/artifacts/{kind}/write`,

  /* ── AI session（接入 0-1）── */
  /** 启动 AI session（POST ?requirementId=xxx；body = AiStartRequest，可选 initialPrompt）。 */
  aiStart: `${SKY_AXIS_API_PREFIX}/ai/start`,

  /* ── AI session（接入 2：任务动作 + 阶段推进）── */
  /** task 动作（start/accept/redo/skip）；POST，body = TaskActionRequest。
   *  host 端 start/redo 调 DSH prompt('queue', taskPrompt)；accept/skip 仅本地状态切换。 */
  aiTaskAction: `${SKY_AXIS_API_PREFIX}/ai/task/action`,
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

/**
 * 源码仓库 URL —— 用于 git clone 目标。**比 UrlSchema 宽松**:
 * 接受任何 git CLI 原生支持的 scheme + 简写形式。
 *
 * 为什么不用 UrlSchema:
 *   - UrlSchema 语义是「可在浏览器里点开的链接」(防 XSS/SSRF)。
 *   - 源码 URL 是 git CLI 消费,git 原生支持 SSH 简写和 git+前缀;
 *     强制 http/https 会让用户无法用 SSH key 关联内网 GitLab / 自建仓库。
 *   - PrdLink / DesignLink / ExternalLink 仍保留 UrlSchema —— 这些「点击即打开」
 *     的链接严格 http/https 是正确的。
 *
 * 接受:
 *   - http://host[:port]/path[.git]
 *   - https://host[:port]/path[.git]
 *   - ssh://[user@]host[:port]/path[.git]
 *   - git://host[:port]/path[.git]
 *   - git+https://... / git+ssh://...(npm/pip 风格前缀)
 *   - SCP 简写:[user@]host:path[.git]
 *
 * 拒绝:
 *   - file://, javascript:, data:, ftp://, mailto:, tel:, ws:, wss:
 *   - 空字符串 / 仅 git+ 前缀 / 仅 scheme 无 path / 含控制字符
 *   - 长度 > 2048
 *
 * 注意:zod 自带的 `.url()` 不能用 —— `new URL()` 不支持 SCP 简写
 *   (`git@github.com:foo/bar.git`),且能解析 `mailto:` 等非 git scheme。
 */
const SCP_SHORTHAND_RE =
  /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._-]+:[A-Za-z0-9._\-./]+$/

export const SourceRepoUrlSchema = z.string().min(1).max(2048).refine(
  (raw) => {
    const s = raw.trim()
    if (s === '') return false
    // 去 npm 风格 git+ 前缀(git+https://, git+ssh://, git+git@...)
    const stripped = s.startsWith('git+') ? s.slice(4) : s
    // 防御性:拒绝控制字符(防 log injection / null 字节)
    if (/[\x00-\x1f\x7f]/.test(stripped)) return false
    // SCP 简写分支:[user@]host:path(无 //)
    if (!stripped.includes('://')) {
      if (!SCP_SHORTHAND_RE.test(stripped)) return false
      const colonIdx = stripped.indexOf(':')
      const afterColon = stripped.slice(colonIdx + 1)
      // 拒绝 SSH refspec(如 `git@github.com:main`) —— 真正的路径必须含
      // '/' 或以 '.git' 结尾。这是与 git 文档一致的启发式:
      // refspec 通常是单 token,path 至少含一段目录分隔。
      const looksLikePath = afterColon.includes('/') || afterColon.endsWith('.git')
      if (!looksLikePath) return false
      return true
    }
    // 标准 URL 形式
    let u: URL
    try { u = new URL(stripped) } catch { return false }
    const proto = u.protocol
    if (proto !== 'http:' && proto !== 'https:' && proto !== 'ssh:' && proto !== 'git:') {
      return false
    }
    const path = u.pathname.replace(/^\/+/, '')
    if (path === '') return false
    return true
  },
  { message: 'invalid git URL: must be http(s)://, ssh://, git://, git+https://, git+ssh://, or [user@]host:path SCP shorthand' },
)
export type SourceRepoUrl = z.infer<typeof SourceRepoUrlSchema>

/** 用户标识 —— DSH workspace 用户 id；空字符串 = 系统/未知。 */
export const UserIdSchema = z.string().min(0).max(128)
export type UserId = z.infer<typeof UserIdSchema>

/* ── 6 个物料 section 子项 schema ── */

/** PRD 文档 —— 上传的产品 PRD 文件。
 *  Phase 2.5 新增 `path` required —— host 落盘相对路径（基 = workspace.path）。
 *  Sprint 3 演进（工作区目录结构改造）：落盘形态从
 *    `.sky-axis/${requirementId}/${section}/${id}-${sanitized-filename}`
 *  改为顶层
 *    `inputs/${sectionInputsDir}/${reqShortId}-${itemIdShort}-${sanitized-filename}`
 *    其中 `prdFiles` → `prd`，`attachments` → `attachment`。
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

/** 源码仓库 —— git URL + branch + 本地 clone 元数据。
 *
 * Phase 2.6「源码关联增强」增量字段（向后兼容）：
 *  - cloneStatus / localPath / clonedAt / cloneError：clone 生命周期追踪
 *  - displayName：用户在 AddSourceRepoForm 填的「英文名/拼音」，用于生成分支命名建议
 *
 * 旧记录（缺 cloneStatus）→ zod parse 时默认 'not-cloned'，UI 显「未本地化」徽标。
 *   这是 .default() —— 与策略 C「不写 silent default 兜底」的例外：clone 是软能力，
 *   旧 v2/v3 记录缺这字段不代表 schema 不一致，只是「未启用新功能」。
 */
export const SourceRepoSchema = z.object({
  id:           MaterialItemIdSchema,
  url:          SourceRepoUrlSchema,
  /** git branch / tag / commit ref；空字符串 = 默认分支（host 解析时回退）。 */
  branch:       z.string().max(255),
  /** last commit SHA（short 7 字符或 full 40 字符均可）；optional —— 未同步时为空。 */
  lastCommitSha: z.string().regex(/^[a-f0-9]{7,40}$/).optional(),
  /** 一句话描述（UI 副标题展示）。 */
  description:   z.string().max(500),
  addedAt:       z.string().datetime(),
  addedBy:       UserIdSchema,

  /* ── Phase 2.6 增量（clone 生命周期）── */
  /** 本地 clone 绝对路径（相对 workspacePath；绝对路径由 host 端 `${workspacePath}/${localPath}` 拼接）。
   *  clone 成功后写入；失败或未克隆时缺失。 */
  localPath:    z.string().min(1).max(1024).optional(),
  /** 首次成功 clone 时间（ISO）。 */
  clonedAt:     z.string().datetime().optional(),
  /** clone 生命周期状态（默认 'not-cloned' —— 旧记录兼容）。 */
  cloneStatus:  z.enum(['not-cloned', 'cloned', 'clone-failed']).default('not-cloned'),
  /** clone 失败时存 stderr 摘要（≤ 500 字符），UI 「重试」按钮旁展示。 */
  cloneError:   z.string().max(500).optional(),
  /** 用户英文/拼音名 —— 用于 UI 生成分支命名建议（`<displayName>/feat-<MMDD>-<titleSlug>`）。 */
  displayName:  z.string().max(64).optional(),
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
 *  Phase 2.5 新增 `path` required —— 同 PrdFileSchema。
 *  Sprint 3 演进：落盘形态改为 `inputs/attachment/${reqShortId}-${itemIdShort}-${filename}`，见 PrdFileSchema 注释。 */
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
 *   - url：PRD/Design/External 仍受限 http/https（UrlSchema,防 XSS/SSRF）；
 *        source repo 用 SourceRepoUrlSchema（接受 http/https/ssh/git + SCP 简写）
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
  url:           SourceRepoUrlSchema,
  branch:        z.string().min(1).max(255),    // Phase 2.6: 加 min(1) —— 同步 clone 时必须明确分支
  lastCommitSha: z.string().regex(/^[a-f0-9]{7,40}$/).optional(),
  description:   z.string().max(500),
  /** 用户英文/拼音名 —— Phase 2.6 早期版本要求 UI 输入用于生成分支建议;
   *  Phase 2.6 v2 改为「branch 输入框 placeholder 提示命名格式」,不再需要此字段。
   *  保留 sourceRepo record 上的 displayName 字段(向后兼容旧 KV 数据),但 request schema 不再要求 UI 提交。 */
  displayName:   z.string().max(64).optional(),
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
 * - reason：回退/异常的 free-text 原因（PR-C 新增，rewind 时由用户填的详情）。
 *   仅在 outcome 为 'rolled-back' 或 'errored' 时填。max 500 字。
 */
export const StageHistoryEntrySchema = z.object({
  stage: StageSchema,
  enteredAt: z.string().datetime(),
  leftAt: z.string().datetime().optional(),
  outcome: z.enum(['completed', 'manual', 'rolled-back', 'errored']).optional(),
  reason: z.string().max(500).optional(),
})
export type StageHistoryEntry = z.infer<typeof StageHistoryEntrySchema>

/* ── PR-C：rewind UI + drift 三层（迭代 4 + 5）── */

/**
 * Rewind 目标字面量 —— 决定 rewind 后落到哪个 stage / task。
 * - 'current-stage'：留在当前 stage（粒度 A，等价 task redo）
 * - 'task'：回退到指定 task（粒度 A，targetTaskId 必填）
 * - 'stage-prev'：回退到上一阶段（粒度 A）
 * - 'stage-{name}'：回退到指定 stage（粒度 A/B/C 决定回退多远）
 */
export const RewindTargetSchema = z.enum([
  'current-stage',
  'task',
  'stage-prev',
  'stage-understand',
  'stage-plan',
  'stage-implement',
  'stage-verify',
  'stage-deliver',
])
export type RewindTarget = z.infer<typeof RewindTargetSchema>

/**
 * Rewind 原因字面量 —— design §2.2 三类触发器 + 5 种 reason。
 * - verify-failed：自动触发（CI 测试失败）
 * - plan-drift：半自动触发（drift 语义层超阈值）
 * - goal-misaligned：手动 / 半自动（方向错了）
 * - human-request：手动（用户主动）
 * - auto-detected-issue：自动（drift 静态 / 动态层检测）
 */
export const RewindReasonSchema = z.enum([
  'verify-failed',
  'plan-drift',
  'goal-misaligned',
  'human-request',
  'auto-detected-issue',
])
export type RewindReason = z.infer<typeof RewindReasonSchema>

/**
 * Rewind 粒度字面量 —— design §5.5 三档粒度。
 * - A：单任务重做 / 当前 stage 内回退 —— 保留其它 task / stage 产物
 * - B：当前 task 回退到 plan stage —— 当前 stage 内其它 task 可选保留
 * - C：整个 requirement 回退到 understand stage —— 所有 stage 产物清空，保留 materials
 */
export const RewindGranularitySchema = z.enum(['A', 'B', 'C'])
export type RewindGranularity = z.infer<typeof RewindGranularitySchema>

/**
 * Rewind 请求（POST /requirements/rewind 入参）—— discriminated union by target。
 * - target='task'：必须传 targetTaskId
 * - target='stage-*'：可选 granularity（A=只回退该 stage / B=回退到 plan / C=回退到 understand）
 *   注意：granularity 与 target 不完全独立 —— host 端按组合解读；client UI 默认
 *   granularity 由 trigger 预填（stage-go-back → A / task-rewind → A）
 */
export const RewindRequestSchema = z.discriminatedUnion('target', [
  z.object({
    target: z.literal('current-stage'),
    reason: RewindReasonSchema,
    reasonDetail: z.string().max(500).optional(),
    granularity: RewindGranularitySchema.default('A'),
    options: z.object({
      preserveDownstream: z.boolean().default(false),
      draftNewPlan: z.boolean().default(false),
    }).default(() => ({ preserveDownstream: false, draftNewPlan: false })),
  }),
  z.object({
    target: z.literal('task'),
    targetTaskId: z.string().min(1).max(64),
    reason: RewindReasonSchema,
    reasonDetail: z.string().max(500).optional(),
    granularity: RewindGranularitySchema.default('A'),
    options: z.object({
      preserveDownstream: z.boolean().default(false),
      draftNewPlan: z.boolean().default(false),
    }).default(() => ({ preserveDownstream: false, draftNewPlan: false })),
  }),
  z.object({
    target: z.enum(['stage-prev', 'stage-understand', 'stage-plan', 'stage-implement', 'stage-verify', 'stage-deliver']),
    reason: RewindReasonSchema,
    reasonDetail: z.string().max(500).optional(),
    granularity: RewindGranularitySchema.default('A'),
    options: z.object({
      preserveDownstream: z.boolean().default(false),
      draftNewPlan: z.boolean().default(false),
    }).default(() => ({ preserveDownstream: false, draftNewPlan: false })),
  }),
])
export type RewindRequest = z.infer<typeof RewindRequestSchema>

/**
 * Drift 检测层字面量 —— design §5.3 三层检测。
 * - static：触动文件是否在 task.filesExpected 内
 * - dynamic：测试 / 类型 / lint 是否过
 * - semantic：LLM-as-judge 对比 patch 与 goal
 */
export const DriftLayerSchema = z.enum(['static', 'dynamic', 'semantic'])
export type DriftLayer = z.infer<typeof DriftLayerSchema>

/**
 * Drift 检测结果（per-layer / per-task / per-stage 共用此 schema）。
 * - layer：哪一层
 * - score：0-1 综合分
 * - detectedAt：检测时刻
 * - sourceTaskId：触发 drift 的 task id（可选 —— stage 级快照可能不含）
 * - note：一行说明（mock 用，LLM 真接入后为 judge 评语）
 */
export const DriftScoreSchema = z.object({
  layer: DriftLayerSchema,
  score: z.number().min(0).max(1),
  detectedAt: z.string().datetime(),
  sourceTaskId: z.string().min(1).max(64).optional(),
  note: z.string().max(200).optional(),
})
export type DriftScore = z.infer<typeof DriftScoreSchema>

/**
 * Drift 检测请求（POST /requirements/drift/detect 入参）—— host 端按 layer 跑检测，
 * 可指定 taskId 限定只检测某 task。layer='all' 时 host 内部逐 layer 调用并合并。
 */
export const DriftDetectRequestSchema = z.object({
  layer: z.enum(['static', 'dynamic', 'semantic', 'all']).default('all'),
  taskId: z.string().min(1).max(64).optional(),
})
export type DriftDetectRequest = z.infer<typeof DriftDetectRequestSchema>

/** Drift 检测响应 —— 返回一组 per-layer 分数。 */
export const DriftDetectResponseSchema = z.object({
  requirementId: RequirementIdSchema,
  scores: z.array(DriftScoreSchema).min(1).max(8),
  /** 整 stage 综合分（max of 3 layer）；client 渲染 DriftCard 用。 */
  overall: z.number().min(0).max(1),
  detectedAt: z.string().datetime(),
})
export type DriftDetectResponse = z.infer<typeof DriftDetectResponseSchema>

/**
 * 介入队列项 —— AI 等待人类介入的事件。
 * - kind: 'approval' | 'question' | 'review'
 *   - approval：tool 调用的权限确认（run shell / write file 等）
 *   - question：AI 主动询问（多选 / 单选 / 文本）
 *   - review：阶段性 review 请求（产出的 plan / patch 让人审）
 * - rpcId：DSH event/mux 的 rpc id（client 调 `ctx.apiProxy.respond`时回传 —— 0.1.2 改走 session controller,见 TODO）
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
  /* PR-D 增量：标记已应答；已 resolved 的项目从队列移除（host 端负责）。
     optional —— 旧记录无此字段视为未 resolved（client UI 过滤逻辑兜底）。 */
  resolved: z.boolean().optional(),
})
export type InterventionItem = z.infer<typeof InterventionItemSchema>

/**
 * 阶段产物键值条目 —— 每阶段 AI 产生的 plan / patch / note / log / report。
 * - kind：产物种类（决定图标 + 默认渲染器）
 * - title：UI 标题（如「实现方案 v2」「3 个文件的 diff」）
 * - createdAt：产生时间
 * - body：产物正文（markdown / patch / 日志文本）
 * - meta：可选附加元数据（如 patch 的 path / commit sha / report 的 metric）
 *
 * Sprint 4 演进（工作区目录结构改造）：加 `path?` 字段 —— 落盘到 outputs/ 的相对路径
 * （基 = workspace.path），形态 `outputs/${kind}/${reqShortId}-${artifactId8}-${slug}.md`。
 * optional —— 旧 v3 record 无 path，DSH backend 仍合法；新增落盘行为时由 host 写入。
 */
export const ArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['plan', 'patch', 'note', 'log', 'report']),
  title: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  body: z.string().max(200_000),
  meta: z.record(z.string(), z.unknown()).optional(),
  path: z.string().min(1).max(1024).optional(),
})
export type Artifact = z.infer<typeof ArtifactSchema>

/** Artifact kind 字面量联合（5 选 1，单独 export 便于 route/UI 复用）。 */
export const ArtifactKindSchema = z.enum(['plan', 'patch', 'note', 'log', 'report'])
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>

/**
 * WriteArtifact 请求（Sprint 4）：client 显式触发 host 落盘。
 *
 * 设计：默认 **不写** —— 当前 AI 事件流不会调这个 endpoint，行为与 Sprint 3 之前一致。
 * 未来产品决定开启时，client 在合适的时机调一次即可（同一份 artifact 可以多次写，
 * host 每次都覆盖；不会污染 KV —— artifact 主体在 KV 是 source of truth）。
 */
export const WriteArtifactRequestSchema = z.object({
  requirementId: RequirementIdSchema,
  artifact: ArtifactSchema,
})
export type WriteArtifactRequest = z.infer<typeof WriteArtifactRequestSchema>

/** WriteArtifact 响应：返回落盘后的 artifact（含新写入的 path 字段）。 */
export const WriteArtifactResponseSchema = z.object({
  ok: z.literal(true),
  artifact: ArtifactSchema,
})
export type WriteArtifactResponse = z.infer<typeof WriteArtifactResponseSchema>

/* ── 任务列表（Phase 1.0：5 阶段意图工作台改造）── */

/**
 * 单个 task 的状态机 —— 8 态，覆盖 implement/verify 阶段的子循环。
 *
 * - pending       已规划未执行
 * - in_progress   AI 正在生成 patch
 * - verifying     跑测试 / 类型检查 / lint
 * - done          verify 通过，写入产物
 * - failed        verify 不通过，未达重做上限
 * - rolled_back   任务级回退触发
 * - blocked       等人类介入
 * - skipped       用户决定跳过
 *
 * 设计要点：
 *   - 8 态正交完备，UI 只需做 status → dotClass  /  → rowAction 的映射
 *   - 与阶段 outcome 语义不重叠（阶段 outcome 在 stageHistory；task status 在 task.subHistory）
 *   - 字段名刻意避免歧义："rolled_back"（蛇形，下划线）+ "in_progress"（蛇形）保持
 *     与 DSH host / controller 现有命名（status / aiState / priority）一致
 */
export const TaskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'verifying',
  'done',
  'failed',
  'rolled_back',
  'blocked',
  'skipped',
])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

/** task 级 mini history 条目 —— 类比 stageHistory，但粒度是单任务。 */
export const TaskSubHistoryEntrySchema = z.object({
  status: TaskStatusSchema,
  enteredAt: z.string().datetime(),
  leftAt: z.string().datetime().optional(),
  outcome: z.enum(['completed', 'manual', 'rolled-back', 'errored']).optional(),
})
export type TaskSubHistoryEntry = z.infer<typeof TaskSubHistoryEntrySchema>

/**
 * 单个 task —— Plan 阶段产物 tasks.json 的元素。
 *
 * 字段语义：
 *   - id            任务 id（client 用 `crypto.randomUUID()` 生成；host 端保证同 requirement 内唯一）
 *   - title         一句话标题（列表行主标题）
 *   - goal          一句话目标（列表行副标题，max 500 字）
 *   - acceptance    验收标准列表（UI 复选框；drift 静态层会逐项 check）
 *   - dependencies  依赖其它 task id（UI 灰显未满足依赖的 task）
 *   - filesExpected 预期触碰的文件路径（drift 静态层比对实际 diff）
 *   - status        当前状态（见 TaskStatusSchema）
 *   - subHistory    状态流转审计链（task 级 outcome）
 *   - artifactRefs  关联的产物 id 列表（指向 requirement.artifacts 中的条目）
 *   - retryCount    重做计数（auto-rewind 阈值用：连续 N 次仍失败 → 弹人工介入）
 *   - lastDriftScore 上次偏差分数（0-1，语义层 LLM-as-judge 输出；超 0.6 触发人类介入）
 *   - enteredAt     该任务首次进入 pending 的时间
 */
export const TaskSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  goal: z.string().max(500),
  acceptance: z.array(z.string().min(1).max(500)).max(20),
  dependencies: z.array(z.string().min(1).max(64)).max(20),
  filesExpected: z.array(z.string().min(1).max(512)).max(50),
  status: TaskStatusSchema,
  subHistory: z.array(TaskSubHistoryEntrySchema),
  artifactRefs: z.array(z.string().min(1).max(64)).max(20),
  retryCount: z.number().int().nonnegative().max(99),
  lastDriftScore: z.number().min(0).max(1).optional(),
  enteredAt: z.string().datetime(),
})
export type Task = z.infer<typeof TaskSchema>

/**
 * TaskList —— Plan 阶段产物的容器，由 host 端序列化后写入 requirement.artifacts
 * （kind='plan' + meta.isTaskList=true）。
 *
 * 当前 Phase 1（UI 骨架重构）暂未由 host 端落盘，由 client 在 StageWorkspacePane 用
 * mock 数据展示。Phase 3 真实接入时，host 在 Plan stage 完成时生成 tasks.json，
 * 通过 put artifact 推给 client。
 */
export const TaskListSchema = z.object({
  tasks: z.array(TaskSchema),
  /** Plan 阶段产物的生成时间。 */
  producedAt: z.string().datetime(),
  /** Plan 阶段对应的 stage（便于审计：哪个 stage 产生的 task list）。 */
  producedAtStage: StageSchema,
})
export type TaskList = z.infer<typeof TaskListSchema>

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
    /** 答案 payload —— 由 host 包成 ClientResponse envelope 调 session controller respond（0.1.2 改名,见 TODO）。 */
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

/* ── 接入 2：task 动作请求 ── */

/**
 * task 动作请求（POST /ai/task/action，body）。
 *
 * 4 种 action 语义：
 *   - start：pending → in_progress；host 调 DSH prompt('queue', taskPrompt)
 *   - accept：in_progress/verifying/failed → done；仅本地状态切换（手动接受）
 *   - redo：failed/rolled_back → in_progress；host 调 DSH prompt('queue', redoPrompt)
 *   - skip：pending/in_progress/failed → skipped；仅本地状态切换
 *
 * controller 层乐观更新已带 dedup（runTaskMutation 内部 transition dedup）；
 * host 端在 updateRequirements mutator 内部用 read-modify-write 锁原子切换状态。
 */
export const TaskActionRequestSchema = z.object({
  requirementId: RequirementIdSchema,
  taskId: z.string().min(1).max(64),
  action: z.enum(['start', 'accept', 'redo', 'skip']),
})
export type TaskActionRequest = z.infer<typeof TaskActionRequestSchema>

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

/* ── 入参：导入已存在的需求（Plan I）── */

/**
 * 导入已存在的需求请求体。**workspaceId 必填** —— caller 的当前 DSH workspace
 * uuid;host 解析到 path 后,把该 path 上唯一 req 的 workspaceId 改成这个值。
 *
 * 用法：DSH 删 + 重建同路径工作区后,用户进入 sky-axis 选这个 workspace →
 * 检测到 path 上已有 req → 弹"导入?"提示 → 调本接口。
 */
export const ImportRequirementSchema = z.object({
  workspaceId: WorkspaceIdSchema,
})
export type ImportRequirement = z.infer<typeof ImportRequirementSchema>

/* ── 存储实体 ── */

/**
 * KV 存储的 requirement 记录。id/status/时间戳由 host 在 create 时填入；
 * workspaceId 是当前 owning DSH uuid —— Plan I 起在 import 时可变（owner 切换,
 * 场景：DSH 工作区删 + 重建同路径）。其他字段不变,材质/产物/prd 完整保留。
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
 * - workspace-not-found：workspaceId 不在当前 follow 流 baseline / cache 中
 * - requirement-not-found：要删除/获取的 id 不存在
 * - invalid-record：KV 中已存的记录 schema 校验失败（极少见，理论上 domain open 时就拦住了）
 * - internal-error：未捕获异常
 *
 * Phase 1.2 增量（AI 协作工作台相关）：
 * - ai-not-configured：sky-axis-collaborator agentPreset 未在 DSH 注册 / 平台能力缺失
 * - ai-session-missing：操作的 requirement 还没启动 AI session（先调 /ai/start）
 * - ai-event-failed：session controller events.mux() 或 respond 失败(0.1.2,原 ctx.apiProxy)
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
  // ── 接入 2 新增：task 动作相关 ──
  /** taskId 不在 requirement 的 plan artifact 里（可能 plan 还没产出 / taskId 拼错）。 */
  'task-not-found',
  // ── Phase 2.5 新增 ──
  /** material CRUD：itemId 不在指定 section 内（可能已被删除）。 */
  'material-not-found',
  // ── Step 3 新增：client 上传 XHR 兜底错误（abort / timeout / 网络异常）。 */
  'network-error',
  // ── Phase 2.6 新增：源码关联 git clone 错误。 */
  /** 宿主机无 git 二进制（plugin 启动探测失败 → 该需求降级为「只记录不 clone」）。 */
  'git-not-installed',
  /** git clone 命令退出码非 0（网络 / 权限 / 协议错误）。 */
  'git-clone-failed',
  /** git checkout -b 创建分支失败（clone 成功但指定分支不存在且无法创建）。 */
  'git-checkout-failed',
  /** destDir 逃逸 workspacePath（路径穿越防护触发）。 */
  'git-sandbox-violation',
  /** git clone / checkout 超过 5 分钟硬超时。 */
  'git-timeout',
  /** 同一 requirement 重复关联相同 canonical URL（HTTPS / SSH 视为同一 repo）。 */
  'source-repo-duplicate',
  // ── Phase 2.6 v2.1 新增 ──
  /** destDir 已含 `.git/` 但不是完整 git repo（典型：上次 clone 异常终止残留）。
   *  与 `git-clone-failed` 的区别：本错误说明 clone 阶段根本没发生,问题在
   *  上一次的中间状态。UI 应提示用户检查并手动清理 destDir。 */
  'git-clone-incomplete',
  // ── Workspace 1:1 不变量新增 ──
  /** 该 workspace 已有关联 requirement（1 个 workspace = 1 个需求空间；任何 status 都算占位）。
   *  要新建需求必须先删除旧需求（或换 workspace）。 */
  'workspace-already-has-requirement',
  // ── Sprint 4 新增：artifact 落盘沙箱 ──
  /** artifact 落盘路径逃逸 `${workspacePath}/outputs/`（路径穿越防护触发）。
   *  与 `git-sandbox-violation` 同语义不同来源 —— 各自独立的路径沙箱。 */
  'artifact-sandbox-violation',
  // ── Sprint 5 新增：YAML-as-SoT(需求数据搬到 mate.yaml) ──
  /** mate.yaml YAML 解析失败 / zod schema 不匹配 —— 通常是外部工具改坏了文件。 */
  'yaml-parse-failed',
  /** flock(.lock)获取失败 / 超时(默认 5s) —— 锁被占,客户端可重试。 */
  'yaml-lock-timeout',
  /** atomic write(rename .tmp)失败 —— 通常是磁盘满 / 权限错。 */
  'yaml-write-failed',
  /** one-shot 数据迁移失败(storage domain → mate.yaml 过程中失败)。
   *  host 启动 console.error 列出 workspace path,允许 webServer 继续启动,用户手动处理。 */
  'migration-failed',
  // ── Plan I 新增：path-1:1 强绑定 ──
  /** 同一 workspace path 已有关联 requirement(Plan I 起 1:1 不变量改在 path 层)。
   *  跨 DSH workspace 共享同一 path 上限 1 个 req;新建会被拒,提示走 import 流程。 */
  'requirement-already-exists-at-path',
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
