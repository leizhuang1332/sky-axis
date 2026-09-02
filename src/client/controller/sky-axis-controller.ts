/**
 * SkyAxis 控制器 —— 纯状态机（无 DOM / 无 React）。
 *
 * 状态面（SkyAxisSnapshot）：
 *   - pageOpen: 主列整页是否打开
 *   - viewKey:  当前选中的内部视图（仅在 pageOpen=true 时有意义）
 *   - sidebarCollapsed: 内部 sidebar 是否折叠
 *   - requirements: 需求列表（来自 host 持久化 + SSE 推送）
 *   - requirementOptions.workspaces: workspace 选项（来自 ctx.workspaces 订阅）
 *   - requirementsLoading: 列表是否在 fetch 中
 *   - requirementsError: 最近一次失败原因（用于 UI 提示）
 *   - selectedRequirementId: 当前打开的需求详情 id（详情路由）；
 *                            非 null 时 viewArea 整体渲染 RequirementDetailPage
 *   - detailLoading: 单条详情 fetch 中（与 requirementsLoading 区分开）
 *   - detailError: 单条详情最近失败原因
 *
 * 关键不变式：
 *   - 打开页面（openPage）时强制 viewKey 重置为 'home'
 *   - 关闭页面（closePage）时保留 viewKey（与 dsh-shell「保留用户视图」习惯一致）
 *   - setView 仅在 pageOpen=true 时生效
 *   - 折叠状态与 pageOpen 完全独立
 *   - requirements 与 workspaces 改动必触发 notify（引用必变，React 重渲染）
 *   - selectedRequirementId 与 viewKey 互相独立：开详情不切 viewKey（让「团队 →
 *     详情 → 返回」自然回「团队」），closeDetail 不切 viewKey（让「需求列表
 *     → 详情 → 返回」自然回「需求列表」）
 *
 * 实现方式：单一可变 snapshot + Set<listener>。subscribe 返回 unsubscribe；
 * getSnapshot 返回引用，每次状态变化时构造新 snapshot 对象。
 */

/** sky-axis 内部视图 key。
 *  'personal' 是 sidebar「个人 → 概览」二级子项对应的视图（PersonalView）；
 *  'requirements' 是 sidebar「个人 → 需求列表」二级子项对应的视图。 */
export type SkyAxisViewKey = 'home' | 'team' | 'personal' | 'requirements' | 'reports' | 'settings'

/** 详情页内 tab key —— Phase 1.13 增量：
 *  - 'materials'  需求物料（PRD/源码/设计稿/附件/外部链接）
 *  - 'workbench'  AI 工作台（5 阶段 stepper + 三列布局）
 *  默认进入详情页时为 'workbench'（保留 Phase 1 行为）；
 *  closeDetail 时清掉 tabKey（回到默认），openDetail 时重置默认。 */
export type DetailTabKey = 'materials' | 'workbench'

/** workspace 摘要（client UI 展示用）。 */
export interface WorkspaceOption {
  /** workspaceId（与 ctx.workspaces.list.items[i].workspaceId 同源）。 */
  id: string
  /** 展示标题（title 为空时回退到 path basename）。 */
  title: string
  /** 真实目录路径（仅供调试展示；client 不参与文件系统 IO）。 */
  path: string
}

/** 控制器公开依赖 —— client.fetch + ctx.workspaces 投影。 */
export interface RequirementOption {
  id: string
  title: string
  path: string
}

/** controller 暴露给订阅者的快照。 */
export interface SkyAxisSnapshot {
  pageOpen: boolean
  viewKey: SkyAxisViewKey
  /** sidebar 是否折叠（默认 false = 展开）。与 pageOpen 独立持久：
   *  关掉 sky-axis 再打开仍保留折叠状态，符合 sidebar 用户偏好习惯。 */
  sidebarCollapsed: boolean
  /** sidebar「个人」分组是否展开（默认 true = 展开）。独立于 pageOpen / sidebarCollapsed：
   *  - 关掉 sky-axis 再打开仍保留展开偏好（用户偏好持久）
   *  - sidebar 折叠态（icon rail）下二级菜单不可见，本字段不影响可见性
   *  - 5 个视图 entry 里只有「个人」带子菜单，其它 entry 无二级目录 */
  personalExpanded: boolean
  /** 全部需求（按 id 倒序，最新在前）。 */
  requirements: readonly RequirementEntry[]
  /** workspace 选项（来自 ctx.workspaces.list 推送；空数组表示当前无 workspace）。 */
  workspaces: readonly RequirementOption[]
  /** 列表 / CRUD 进行中状态。 */
  requirementsLoading: boolean
  /** 最近一次 CRUD / SSE 失败原因（null = 无错误）。UI 用来显示 toast 或 inline 提示。 */
  requirementsError: RequirementError | null
  /* ── Phase 1.2：详情页路由 ── */
  /** 当前打开的详情页 requirement id；null = 没打开详情（显示当前 viewKey 视图）。
   *  与 viewKey 互相独立 —— 详情页全屏占满 viewArea，sidebar 仍可见但 entry 不高亮。 */
  selectedRequirementId: string | null
  /** 单条详情 GET 进行中状态（与 requirementsLoading 区分：列表加载 vs 详情加载）。 */
  detailLoading: boolean
  /** 单条详情最近失败原因（null = 无错误）。 */
  detailError: RequirementError | null
  /* ── Phase 1.13：详情内 tab 路由 ── */
  /** 详情页内 tab key（'materials' 需求物料 / 'workbench' AI 工作台）。
   *  与 selectedRequirementId 解耦：tab 切换不切详情路由；
   *  closeDetail → 重新 openDetail 时重置为 'workbench' 默认值。 */
  detailTabKey: DetailTabKey
}

/** 5 阶段开发意图工作流的阶段 key —— 与 protocol.ts StageSchema 一一对应。
 *  controller 镜像 type 与 host schema 保持同名字面量；修改时同步。 */
export type RequirementStage = 'understand' | 'plan' | 'implement' | 'verify' | 'deliver'

/** AI session 顶层状态 —— 与 protocol.ts AiStateSchema 一一对应。 */
export type RequirementAiState = 'idle' | 'running' | 'paused' | 'awaiting-input' | 'errored'

/** 介入队列项镜像（client bundle 不依赖 protocol.ts zod）。 */
export interface RequirementInterventionItem {
  id: string
  kind: 'approval' | 'question' | 'review'
  rpcId: string
  summary: string
  createdAt: string
  /** 原 JSON 帧内容，复杂问答表单读此字段渲染。 */
  payload: unknown
}

/** 阶段产物镜像。 */
export interface RequirementArtifact {
  id: string
  kind: 'plan' | 'patch' | 'note' | 'log' | 'report'
  title: string
  createdAt: string
  body: string
  meta?: Record<string, unknown>
}

/** 阶段流转历史条目镜像。 */
export interface RequirementStageHistoryEntry {
  stage: RequirementStage
  enteredAt: string
  leftAt?: string
  outcome?: 'completed' | 'manual' | 'rolled-back' | 'errored'
}

/* ── 物料镜像 type（Phase 2.1）── */

/** 物料基础原语镜像 —— 与 host schema 同字段子集。 */
export interface RequirementMaterialItemBase {
  id: string
}

/** PRD 文档镜像。 */
export interface RequirementPrdFile extends RequirementMaterialItemBase {
  filename: string
  mimeType: string
  size: number
  uploadedAt: string
  uploadedBy: string
  /** Phase 2.5 落盘相对路径（基 = workspace.path）；UI 不展示。 */
  path: string
}

/** PRD 链接镜像。 */
export interface RequirementPrdLink extends RequirementMaterialItemBase {
  url: string
  title: string
  source: 'yuque' | 'notion' | 'confluence' | 'feishu' | 'custom'
  addedAt: string
  addedBy: string
}

/** 源码仓库镜像。 */
export interface RequirementSourceRepo extends RequirementMaterialItemBase {
  url: string
  branch: string
  lastCommitSha?: string
  description: string
  addedAt: string
  addedBy: string
  // ── Phase 2.6 源码关联 clone 生命周期 ──
  /** 本地 clone 路径（相对 workspaceRoot）。克隆成功后才有。 */
  localPath?: string
  /** 首次成功 clone 时间（ISO）。 */
  clonedAt?: string
  /** clone 状态: cloned / clone-failed / not-cloned(默认)。 */
  cloneStatus?: 'not-cloned' | 'cloned' | 'clone-failed'
  /** clone 失败时的 stderr 摘要。 */
  cloneError?: string
  /** 用户英文/拼音名 —— 用于 UI 生成分支建议。 */
  displayName?: string
}

/** 设计稿链接镜像。 */
export interface RequirementDesignLink extends RequirementMaterialItemBase {
  url: string
  kind: 'figma' | 'sketch' | 'image' | 'embed'
  title: string
  thumbnailUrl?: string
  addedAt: string
  addedBy: string
}

/** 附件镜像。 */
export interface RequirementAttachment extends RequirementMaterialItemBase {
  filename: string
  mimeType: string
  size: number
  uploadedAt: string
  uploadedBy: string
  /** Phase 2.5 落盘相对路径（基 = workspace.path）；UI 不展示。 */
  path: string
}

/** 外部链接镜像。 */
export interface RequirementExternalLink extends RequirementMaterialItemBase {
  url: string
  title: string
  kind: 'api-doc' | 'meeting' | 'research' | 'incident' | 'other'
  description: string
  addedAt: string
  addedBy: string
}

/** 物料完整结构镜像（6 section 全部 required）。 */
export interface RequirementMaterials {
  prdFiles: RequirementPrdFile[]
  prdLinks: RequirementPrdLink[]
  sourceRepos: RequirementSourceRepo[]
  designLinks: RequirementDesignLink[]
  attachments: RequirementAttachment[]
  externalLinks: RequirementExternalLink[]
}

/* ── Phase 2.5：物料 CRUD 镜像 type（client 不依赖 protocol.ts zod）── */

/** 6 个物料 section 的字面量（与 host schema 同源）。 */
export type RequirementMaterialSection =
  | 'prdFiles'
  | 'prdLinks'
  | 'sourceRepos'
  | 'designLinks'
  | 'attachments'
  | 'externalLinks'

/** AddPrdLink 入参镜像。 */
export interface AddPrdLinkInput {
  url: string
  title: string
  source: RequirementPrdLink['source']
}

/** AddSourceRepo 入参镜像。 */
export interface AddSourceRepoInput {
  url: string
  branch: string
  lastCommitSha?: string
  description: string
  /** Phase 2.6：用户英文/拼音名 —— 用于 UI 生成分支建议。 */
  displayName?: string
}

/** AddDesignLink 入参镜像。 */
export interface AddDesignLinkInput {
  url: string
  kind: RequirementDesignLink['kind']
  title: string
  thumbnailUrl?: string
}

/** AddExternalLink 入参镜像。 */
export interface AddExternalLinkInput {
  url: string
  title: string
  kind: RequirementExternalLink['kind']
  description: string
}

/** 上传文件时携带的元数据。 */
export interface UploadFileInput {
  content: Blob
  filename: string
  mimeType: string
  size: number
}

/** 上传进度事件（与 client/api/requirement-client.ts 的 UploadProgress 同形）。 */
export interface UploadProgress { loaded: number; total: number }

/** 上传选项：进度回调 + 取消信号 + 超时。 */
export interface UploadOptions {
  onProgress?: (p: UploadProgress) => void
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * 上传句柄：
 *   - `promise`：服务端最终结果
 *   - `abort()`：主动取消（浏览器刷新 / 关闭弹窗 / 用户点取消）
 *
 * 注意 promise 总是 resolve（不会 reject）；abort 后 resolve 成
 * `{ ok: false, error: { code: 'network-error', detail: 'upload aborted' } }`。
 *
 * `item` 字段仅在 JSON add 路径携带（用 server record 立即覆盖整条）；
 * upload 路径不携带 item，由 SSE put 事件同步到 snapshot。
 */
export interface UploadHandle {
  promise: Promise<{ ok: boolean; item?: RequirementEntry; error?: RequirementError }>
  abort: () => void
}

/** 物料总数（client 镜像版本 —— 不依赖 protocol.ts zod，保持 client bundle 体积最小）。 */
export function countRequirementMaterials(m: RequirementMaterials): number {
  return (
    m.prdFiles.length
    + m.prdLinks.length
    + m.sourceRepos.length
    + m.designLinks.length
    + m.attachments.length
    + m.externalLinks.length
  )
}

/** 极简 Requirement 镜像（与 host Requirement schema 同字段子集）。
 *  此处重定义而非直接 import 是为了 client bundle 不依赖 protocol.ts 的 zod
 *  schema（让 client 体积更小）。host 端 schema 仍为权威源。
 *
 *  Phase 2.1 完美主义（Strategy C）：
 *    - 所有字段 **required**（不 optional、不依赖 silent default 兜底）
 *    - 旧 v1 记录若缺字段 → zod parse 失败 → 视为 invalid-record（fail loud）
 *    - Phase 2.1 升 DSH backend version: 2，旧数据被 backend 直接 reject
 *    - loadDetail 收到的 record 必须 100% 完整，否则写 detailError */
export interface RequirementEntry {
  id: string
  workspaceId: string
  title: string
  description: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: 'open' | 'in_progress' | 'done' | 'cancelled'
  tags: string[]
  createdAt: string
  updatedAt: string
  /* ── 5 阶段开发意图工作台（全部 required）── */
  stage: RequirementStage
  stageHistory: RequirementStageHistoryEntry[]
  aiState: RequirementAiState
  aiSessionId: string | null
  aiLastActivityAt: string | null
  interventionQueue: RequirementInterventionItem[]
  artifacts: Record<string, RequirementArtifact>
  branch: string | null
  /* ── 需求物料（Phase 2.1 新增 required）── */
  materials: RequirementMaterials
}

/** CRUD / SSE 错误（轻量版，client UI 展示用）。 */
export interface RequirementError {
  code:
    | 'validation-failed'
    | 'workspace-not-found'
    | 'workspace-list-failed'
    | 'requirement-not-found'
    | 'invalid-record'
    | 'internal-error'
    | 'network-error'
    | 'workspace-create-failed'
    /* ── Phase 1.2 新增（AI / 详情 / 产物 / 阶段错误码）── */
    | 'ai-not-configured'
    | 'ai-session-missing'
    | 'ai-event-failed'
    | 'artifact-not-found'
    | 'stage-invalid'
    /* ── Phase 2.5 新增（物料 CRUD）── */
    | 'material-not-found'
    /* ── Phase 2.6 新增（源码关联 git 操作）── */
    | 'git-not-installed'
    | 'git-clone-failed'
    | 'git-checkout-failed'
    | 'git-sandbox-violation'
    | 'git-timeout'
    /* ── Phase 2.6 v2 新增（同一 requirement 重复关联同 repo）── */
    | 'source-repo-duplicate'
    /* ── Phase 2.6 v2.1 新增（destDir 含半成品 git 残留）── */
    | 'git-clone-incomplete'
    /* ── Workspace 1:1 不变量新增（同一 workspace 已有关联 requirement）── */
    | 'workspace-already-has-requirement'
  detail?: string
}

/** Requirement 流事件（SSE）。
 *  Phase 1 仅保留 2 个基本操作（与 host 端 SSE 帧对齐）；
 *  Phase 2/3 扩展为 8 个（stageChanged / aiStateChanged / interventionAdded /
 *  interventionRemoved / artifactUpdated / aiError），详见 Plan §2.3。 */
export type RequirementStreamEvent =
  | { operation: 'put'; item: RequirementEntry }
  | { operation: 'deleted'; id: string }

/** controller 公开 API。 */
export interface SkyAxisController {
  /** 订阅状态变化，返回 unsubscribe。 */
  subscribe(listener: () => void): () => void
  /** 读取当前快照（引用稳定，仅在状态变化时切新对象）。 */
  getSnapshot(): SkyAxisSnapshot
  /** pageOpen === true（避免 React 端每次解构判断）。 */
  isPageOpen(): boolean
  /** 打开主列页面（幂等）；同时把 viewKey 重置为 'home'。 */
  openPage(): void
  /** 关闭主列页面（幂等）；保留 viewKey 不变。 */
  closePage(): void
  /** openPage / closePage 翻转。 */
  togglePage(): void
  /** 切换内部视图（仅在 pageOpen=true 时生效）。 */
  setView(view: SkyAxisViewKey): void
  /** 当前视图（pageOpen=false 时返回上次保留值）。 */
  getView(): SkyAxisViewKey
  /** 切换 sidebar 收起 / 展开（与 pageOpen 独立，可任意时机调用）。 */
  toggleSidebar(): void
  /** sidebar 是否折叠（避免 React 端每次解构判断）。 */
  isSidebarCollapsed(): boolean
  /** 切换 sidebar「个人」分组的二级菜单展开 / 收起（与 pageOpen、sidebarCollapsed 独立）。 */
  togglePersonalExpanded(): void
  /** sidebar「个人」分组是否展开。 */
  isPersonalExpanded(): boolean

  /* ── Requirement CRUD ── */

  /** 推送 workspace 选项（来自 ctx.workspaces.list 订阅；空数组 = 当前无 workspace）。 */
  setWorkspaces(items: readonly RequirementOption[]): void

  /** 拉取全部需求（host list 路由）。失败时设置 requirementsError。 */
  loadRequirements(): Promise<void>

  /** 新建一条需求（host create 路由）。成功后 SSE 会推 put 事件回来，
   *  controller 内部根据 SSE 事件更新列表；本方法返回的 promise 在
   *  HTTP 响应完成时 resolve，UI 可用来关闭 modal。 */
  createRequirement(input: {
    workspaceId: string
    title: string
    description?: string
    priority?: RequirementEntry['priority']
    tags?: string[]
  }): Promise<{ ok: boolean; id?: string; error?: RequirementError }>

  /** 删除一条需求（host delete 路由）。成功后 SSE 推 deleted 事件。 */
  deleteRequirement(id: string): Promise<{ ok: boolean; error?: RequirementError }>

  /** 处理 SSE 事件（来自 subscribeRequirementEvents 回调）。 */
  handleStreamEvent(event: RequirementStreamEvent): void

  /* ── Phase 1.2：详情页路由 ── */

  /** 打开详情页（幂等）。
   *  - 设 selectedRequirementId；**不**改 viewKey（让「列表 → 详情 → 返回」自然回列表）
   *  - 自动触发 loadDetail 拉最新数据
   *  - id 不存在时：清 selectedRequirementId + 写 detailError
   */
  openDetail(id: string): void

  /** 关闭详情页（幂等）。
   *  - selectedRequirementId = null；**不**改 viewKey
   *  - Phase 1.13：detailTabKey 也重置为 'workbench'（默认）
   */
  closeDetail(): void

  /** 当前打开的详情 requirement id（无则 null）。 */
  getSelectedRequirementId(): string | null

  /** 拉取单条详情（host get 路由）；可选 —— openDetail 已自动触发。 */
  loadDetail(id: string): Promise<void>

  /* ── Workspace 1:1 不变量（client UX 加速层）── */

  /** 取指定 workspace 已关联的 requirement（若有）。无则 undefined。
   *  UI 用它判断「新建需求」弹窗里某个 workspace 是否已被占用，
   *  避免提交后才被 host 拒绝；这是 UX 加速，不替代 host 权威校验。 */
  getRequirementByWorkspace(workspaceId: string): RequirementEntry | undefined

  /* ── Phase 1.13：详情内 tab 切换 ── */

  /** 切换详情页内 tab（'materials' 需求物料 / 'workbench' AI 工作台）。
   *  - 幂等：相同 tab 不触发 notify
   *  - selectedRequirementId === null 时 no-op（无详情可切）
   *  - 不切 viewKey（保留「列表 → 详情 → 返回」语义） */
  setDetailTab(tab: DetailTabKey): void

  /** 当前详情 tab key。 */
  getDetailTab(): DetailTabKey

  /* ── Phase 2.5：物料 CRUD ── */

  /** 上传一个 PRD 文件（multipart）。乐观插入 tempItem，成功后被服务端 record 替换。
   *
   * 返回 `UploadHandle`（不是裸 Promise）：
   *   - form 可 await `handle.promise` 等最终 ok/error
   *   - form 也可调 `handle.abort()` 主动取消（页面刷新 / 关闭弹窗）
   *   - 进度通过 `opts.onProgress` 上报；signal 透传到 XHR
   *
   * 乐观更新策略保持不变 —— controller 内部仍走 runMaterialMutation 骨架。
   */
  addPrdFile(requirementId: string, file: UploadFileInput, uploadedBy?: string, opts?: UploadOptions): UploadHandle

  /** 上传一个附件（multipart）。同 addPrdFile。 */
  addAttachment(requirementId: string, file: UploadFileInput, uploadedBy?: string, opts?: UploadOptions): UploadHandle

  /** 添加一个 PRD 链接（JSON）。同步返回 UploadHandle（abort 兜底为 noop）。 */
  addPrdLink(requirementId: string, payload: AddPrdLinkInput, addedBy?: string): UploadHandle

  /** 添加一个源码仓库（JSON）。 */
  addSourceRepo(requirementId: string, payload: AddSourceRepoInput, addedBy?: string, opts?: UploadOptions): UploadHandle

  /** 添加一个设计稿链接（JSON）。 */
  addDesignLink(requirementId: string, payload: AddDesignLinkInput, addedBy?: string): UploadHandle

  /** 添加一个外部链接（JSON）。 */
  addExternalLink(requirementId: string, payload: AddExternalLinkInput, addedBy?: string): UploadHandle

  /** 删除一个物料项（任意 section）。同步返回 UploadHandle（abort 兜底为 noop）。 */
  removeMaterial(requirementId: string, section: RequirementMaterialSection, itemId: string): UploadHandle
}

/**
 * 创建 sky-axis 控制器实例。
 *
 * @param loadImpl - 拉取列表的实现（由调用方注入 RequirementClient.list）
 * @param createImpl - 新建需求的实现（注入 RequirementClient.create）
 * @param deleteImpl - 删除需求的实现（注入 RequirementClient.remove）
 * @param detailImpl - 拉取单条详情的实现（Phase 2 接 host get 路由；Phase 1 可选）
 */
export function createSkyAxisController(deps: {
  loadImpl?: () => Promise<{ ok: boolean; items?: RequirementEntry[]; error?: RequirementError }>
  createImpl?: (input: {
    workspaceId: string
    title: string
    description?: string
    priority?: RequirementEntry['priority']
    tags?: string[]
  }) => Promise<{ ok: boolean; item?: RequirementEntry; error?: RequirementError }>
  deleteImpl?: (id: string) => Promise<{ ok: boolean; error?: RequirementError }>
  /** Phase 1.2 增量：单条详情 GET（host /requirements/get?id=...）。 */
  detailImpl?: (id: string) => Promise<{ ok: boolean; item?: RequirementEntry; error?: RequirementError }>
  /* ── Phase 2.5：物料 CRUD deps ── */
  /** JSON add：4 种 section（prdLinks / sourceRepos / designLinks / externalLinks）。
   *
   * 返回 UploadHandle（abort 兜底 noop）；item 字段携带 server record
   * 立即替换整条。
   */
  addMaterialImpl?: (input:
    | { section: 'prdLinks'; requirementId: string; payload: AddPrdLinkInput; addedBy: string }
    | { section: 'sourceRepos'; requirementId: string; payload: AddSourceRepoInput; addedBy: string; opts?: UploadOptions }
    | { section: 'designLinks'; requirementId: string; payload: AddDesignLinkInput; addedBy: string }
    | { section: 'externalLinks'; requirementId: string; payload: AddExternalLinkInput; addedBy: string }
  ) => UploadHandle
  /** Multipart upload：2 种 section（prdFiles / attachments）。
   *
   * 返回 `UploadHandle` 而非裸 Promise —— controller 需要把 abort 暴露给
   * form 组件，让用户能主动取消（页面刷新 / 关闭弹窗）。client api 层
   * 用 XMLHttpRequest 提供 onProgress + signal 能力。
   */
  uploadMaterialImpl?: (input:
    | { section: 'prdFiles'; requirementId: string; file: UploadFileInput; uploadedBy: string; opts?: UploadOptions }
    | { section: 'attachments'; requirementId: string; file: UploadFileInput; uploadedBy: string; opts?: UploadOptions }
  ) => UploadHandle
  /** DELETE 移除：6 section 共用。返回 UploadHandle（abort 兜底 noop）。 */
  removeMaterialImpl?: (requirementId: string, section: RequirementMaterialSection, itemId: string) => UploadHandle
} = {}): SkyAxisController {
  let snapshot: SkyAxisSnapshot = {
    pageOpen: false,
    viewKey: 'home',
    sidebarCollapsed: false,
    personalExpanded: true, // 默认展开二级菜单：首次进入即可看见「个人 → 需求列表」入口
    requirements: [],
    workspaces: [],
    requirementsLoading: false,
    requirementsError: null,
    // ── Phase 1.2 详情页路由初始状态 ──
    selectedRequirementId: null,
    detailLoading: false,
    detailError: null,
    // ── Phase 1.13 详情内 tab 路由初始状态 ──
    detailTabKey: 'workbench',
  }
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const l of listeners) l()
  }

  /**
   * 把 host Requirement / error 投影到 client 类型（避免 protocol.ts zod schema
   * 进入 client bundle）。Phase 2.1 完美主义：传入对象必须包含所有 required 字段，
   * 缺字段的旧记录不在此处投影 —— 由 caller（loadDetail / handleStreamEvent）
   * 在 parse 失败时显式 fail loud。
   */
  const projectItem = (item: {
    id: string; workspaceId: string; title: string; description: string;
    priority: RequirementEntry['priority']; status: RequirementEntry['status'];
    tags: string[]; createdAt: string; updatedAt: string;
    stage: RequirementStage; stageHistory: RequirementStageHistoryEntry[];
    aiState: RequirementAiState; aiSessionId: string | null;
    aiLastActivityAt: string | null; interventionQueue: RequirementInterventionItem[];
    artifacts: Record<string, RequirementArtifact>; branch: string | null;
    materials: RequirementMaterials;
  }): RequirementEntry => item

  const projectError = (code: RequirementError['code'], detail?: string): RequirementError =>
    detail === undefined ? { code } : { code, detail }

  /**
   * 物料添加类 mutation 的共用骨架：
   *   1. 用乐观更新把 tempItem 临时塞进 snapshot（UI 立刻可见）
   *   2. 调用 impl（注入的 fetch / XHR 实现，统一返回 UploadHandle）
   *   3. 成功：用服务端真实 record 替换整条（tempItem 自动消失）
   *   4. 失败（result.ok === false）：仅回滚 `requirements` 字段，
   *      保留 `workspaces` / `selectedRequirementId` / `error` / `loading` 等
   *      —— 否则「上传前抓拍的空 workspaces」会把后续推送的工作区清掉
   *   5. 异常（promise reject）：同上，仅回滚 requirements
   *
   * 同步返回 `UploadHandle`：form 拿到 `handle.promise` await 结果，
   * 也可在上传中调 `handle.abort()` 主动取消。
   *
   * @param callImpl 返回 UploadHandle；JSON add 的 abort 兜底为 noop
   * @param patchWithTempItem 在 requirement 上应用乐观修改（把 tempItem 加到正确 section）
   */
  const runMaterialMutation = (
    requirementId: string,
    _tempId: string,
    callImpl: () => UploadHandle,
    patchWithTempItem: (req: RequirementEntry) => RequirementEntry,
    now: string,
  ): UploadHandle => {
    // 只快照 requirements 字段 —— 不快照整个 snapshot（保留 workspaces 等）。
    const beforeRequirements = snapshot.requirements
    let aborted = false
    const rollback = (): void => {
      snapshot = { ...snapshot, requirements: beforeRequirements }
      notify()
    }
    // 乐观插入 —— UI 立刻可见 tempItem
    snapshot = {
      ...snapshot,
      requirements: snapshot.requirements.map(r =>
        r.id === requirementId ? patchWithTempItem({ ...r, updatedAt: now }) : r
      ),
    }
    notify()

    let handle: UploadHandle
    try {
      handle = callImpl()
    } catch (e) {
      rollback()
      return {
        promise: Promise.resolve({
          ok: false as const,
          error: projectError('network-error', e instanceof Error ? e.message : String(e)),
        }),
        abort: () => { aborted = true },
      }
    }

    // 用 promise.then 在后台处理回滚/替换 —— 立即返回 handle 给 caller。
    handle.promise.then((result) => {
      if (aborted) return
      if (result.ok) {
        // 注：上传类 Result 没有 item 字段（仅 ok/error），成功即视为完成；
        // 服务端会通过 SSE 推 put 事件，下游订阅会同步到 snapshot。
        // JSON add 类的 Result 带 item：用 server record 立即覆盖整条，
        // 比等 SSE put 更及时。
        if (result.item !== undefined) {
          snapshot = {
            ...snapshot,
            requirements: snapshot.requirements.map(rr => rr.id === requirementId ? result.item! : rr),
          }
          notify()
        }
      } else {
        rollback()
      }
    }).catch((e: unknown) => {
      if (aborted) return
      rollback()
      // eslint-disable-next-line no-console
      console.warn('[sky-axis] material mutation rejected:', e)
    })

    return {
      promise: handle.promise,
      abort: () => {
        aborted = true
        handle.abort()
      },
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot() {
      return snapshot
    },
    isPageOpen() {
      return snapshot.pageOpen
    },
    openPage() {
      if (snapshot.pageOpen) return
      snapshot = { ...snapshot, pageOpen: true, viewKey: 'home' }
      notify()
    },
    closePage() {
      if (!snapshot.pageOpen) return
      snapshot = { ...snapshot, pageOpen: false }
      notify()
    },
    togglePage() {
      snapshot = snapshot.pageOpen
        ? { ...snapshot, pageOpen: false }
        : { ...snapshot, pageOpen: true, viewKey: 'home' }
      notify()
    },
    setView(view) {
      if (!snapshot.pageOpen) return
      if (snapshot.viewKey === view) return
      snapshot = { ...snapshot, viewKey: view }
      notify()
    },
    getView() {
      return snapshot.viewKey
    },
    toggleSidebar() {
      snapshot = { ...snapshot, sidebarCollapsed: !snapshot.sidebarCollapsed }
      notify()
    },
    isSidebarCollapsed() {
      return snapshot.sidebarCollapsed
    },
    togglePersonalExpanded() {
      snapshot = { ...snapshot, personalExpanded: !snapshot.personalExpanded }
      notify()
    },
    isPersonalExpanded() {
      return snapshot.personalExpanded
    },

    /* ── Requirement CRUD ── */

    setWorkspaces(items) {
      // 浅引用比较：items 内容可能变（rename），每次都换引用让 React 重渲染
      snapshot = { ...snapshot, workspaces: [...items] }
      notify()
    },

    async loadRequirements() {
      if (deps.loadImpl === undefined) return
      snapshot = { ...snapshot, requirementsLoading: true, requirementsError: null }
      notify()
      try {
        const result = await deps.loadImpl()
        if (result.ok && result.items !== undefined) {
          snapshot = {
            ...snapshot,
            requirements: [...result.items].sort((a, b) => b.id.localeCompare(a.id)),
            requirementsLoading: false,
          }
        } else if (!result.ok) {
          snapshot = { ...snapshot, requirementsLoading: false, requirementsError: result.error ?? projectError('internal-error') }
        }
      } catch (e) {
        snapshot = { ...snapshot, requirementsLoading: false, requirementsError: projectError('network-error', e instanceof Error ? e.message : String(e)) }
      }
      notify()
    },

    async createRequirement(input) {
      if (deps.createImpl === undefined) {
        return { ok: false, error: projectError('internal-error', 'createImpl not injected') }
      }
      try {
        const result = await deps.createImpl(input)
        if (result.ok && result.item !== undefined) {
          // 乐观更新：不等 SSE 立即把新项塞到列表顶部
          const item = projectItem(result.item)
          snapshot = {
            ...snapshot,
            requirements: [item, ...snapshot.requirements.filter(r => r.id !== item.id)],
            requirementsError: null,
          }
          notify()
          return { ok: true, id: item.id }
        }
        // createImpl 返回失败：把错误写回 snapshot 让 UI 能展示（toast / inline）
        const err = result.error ?? projectError('internal-error')
        snapshot = { ...snapshot, requirementsError: err }
        notify()
        return { ok: false, error: err }
      } catch (e) {
        const err = projectError('network-error', e instanceof Error ? e.message : String(e))
        snapshot = { ...snapshot, requirementsError: err }
        notify()
        return { ok: false, error: err }
      }
    },

    async deleteRequirement(id) {
      if (deps.deleteImpl === undefined) {
        return { ok: false, error: projectError('internal-error', 'deleteImpl not injected') }
      }
      try {
        const result = await deps.deleteImpl(id)
        if (result.ok) {
          // 乐观更新：本地立刻移除；SSE 推 deleted 事件时去重处理
          snapshot = { ...snapshot, requirements: snapshot.requirements.filter(r => r.id !== id), requirementsError: null }
          notify()
          return { ok: true }
        }
        // 删除失败：写错误到 snapshot 让 UI 可见
        const err = result.error ?? projectError('internal-error')
        snapshot = { ...snapshot, requirementsError: err }
        notify()
        return { ok: false, error: err }
      } catch (e) {
        const err = projectError('network-error', e instanceof Error ? e.message : String(e))
        snapshot = { ...snapshot, requirementsError: err }
        notify()
        return { ok: false, error: err }
      }
    },

    handleStreamEvent(event) {
      if (event.operation === 'put') {
        const exists = snapshot.requirements.some(r => r.id === event.item.id)
        const next = exists
          ? snapshot.requirements.map(r => r.id === event.item.id ? event.item : r)
          : [event.item, ...snapshot.requirements]
        snapshot = { ...snapshot, requirements: next.sort((a, b) => b.id.localeCompare(a.id)) }
      } else {
        snapshot = { ...snapshot, requirements: snapshot.requirements.filter(r => r.id !== event.id) }
      }
      notify()
    },

    /* ── Phase 1.2：详情页路由 ── */

    openDetail(id) {
      // 幂等：相同 id 已在详情页 → no-op（避免重复触发 loadDetail）
      if (snapshot.selectedRequirementId === id) return
      // 关闭当前详情错误状态（避免旧错误残留）
      const isNew = snapshot.selectedRequirementId !== id
      // Phase 1.13：打开新详情时重置 tab 为默认 'workbench'，
      //   不让上个需求的 tab 偏好串到新需求
      snapshot = {
        ...snapshot,
        selectedRequirementId: id,
        detailError: null,
        detailTabKey: 'workbench',
      }
      notify()
      // 打开后自动拉详情（detailImpl 在 Phase 2 由 client/index.ts 注入）
      if (isNew) {
        void this.loadDetail(id)
      }
    },

    closeDetail() {
      if (snapshot.selectedRequirementId === null && snapshot.detailError === null && snapshot.detailTabKey === 'workbench') return
      // Phase 1.13：closeDetail 重置 tab 回 'workbench' 默认，避免下次 openDetail
      // 时残留上次的 'materials' 偏好
      snapshot = {
        ...snapshot,
        selectedRequirementId: null,
        detailError: null,
        detailTabKey: 'workbench',
      }
      notify()
    },

    getSelectedRequirementId() {
      return snapshot.selectedRequirementId
    },

    setDetailTab(tab) {
      // 无详情时不切（防止外部状态污染）
      if (snapshot.selectedRequirementId === null) return
      // 幂等：相同 tab 不触发 notify
      if (snapshot.detailTabKey === tab) return
      snapshot = { ...snapshot, detailTabKey: tab }
      notify()
    },

    getDetailTab() {
      return snapshot.detailTabKey
    },

    async loadDetail(id) {
      // 本地优先：列表里已有完整 record 直接复用（openDetail 触发的初次拉取，列表刚加载完的场景）
      //   Phase 2.1 完美主义：所有字段都是 required（host create() 已写完整），无需再检查 stage 等字段是否存在
      const local = snapshot.requirements.find(r => r.id === id)
      if (local !== undefined) {
        // 列表里有完整 record（host 已写默认值 + materials），无需重复 GET
        // 这里什么也不做 —— openDetail 已经把 selectedRequirementId 设上，
        // UI 端会从 snapshot.requirements 找到该 id 并渲染。
        return
      }
      // 缺 detailImpl（Phase 1 demo）：纯本地模式兜底，不写错误干扰 UI
      //   - 本地有数据 → 直接 return（已在上面 short-circuit）
      //   - 本地无数据 → 写 requirement-not-found 错误（防御，正常情况不会发生）
      if (deps.detailImpl === undefined) {
        snapshot = {
          ...snapshot,
          detailError: projectError(
            'requirement-not-found',
            `requirement ${id} not in local cache and detailImpl not injected`,
          ),
        }
        notify()
        return
      }
      snapshot = { ...snapshot, detailLoading: true, detailError: null }
      notify()
      try {
        const result = await deps.detailImpl(id)
        if (result.ok && result.item !== undefined) {
          const item = projectItem(result.item)
          // 合并到列表（如果列表里没有这条 —— 比如列表还没加载完就 openDetail）
          const exists = snapshot.requirements.some(r => r.id === item.id)
          const nextList = exists
            ? snapshot.requirements.map(r => r.id === item.id ? item : r)
            : [item, ...snapshot.requirements]
          snapshot = {
            ...snapshot,
            requirements: nextList.sort((a, b) => b.id.localeCompare(a.id)),
            detailLoading: false,
          }
        } else if (!result.ok) {
          snapshot = {
            ...snapshot,
            detailLoading: false,
            detailError: result.error ?? projectError('internal-error'),
          }
        }
      } catch (e) {
        snapshot = {
          ...snapshot,
          detailLoading: false,
          detailError: projectError('network-error', e instanceof Error ? e.message : String(e)),
        }
      }
      notify()
    },

    /* ── Workspace 1:1 不变量（client UX 加速层）── */

    getRequirementByWorkspace(workspaceId) {
      // 直接遍历 snapshot.requirements —— 1 对 1 不变量下每个 workspaceId 最多 1 条；
      // 理论存在 N 条时（历史脏数据）也只返回第一条，UI 的红框警示会另说。
      return snapshot.requirements.find(r => r.workspaceId === workspaceId)
    },

    /* ── Phase 2.5：物料 CRUD（乐观更新 + SSE put 兜底）── */

    addPrdFile(requirementId, file, uploadedBy = '', opts) {
      if (deps.uploadMaterialImpl === undefined) {
        return {
          promise: Promise.resolve({ ok: false as const, error: projectError('internal-error', 'uploadMaterialImpl not injected') }),
          abort: () => {},
        }
      }
      const now = new Date().toISOString()
      const tempId = crypto.randomUUID()
      const tempItem: RequirementPrdFile = {
        id: tempId, filename: file.filename, mimeType: file.mimeType,
        size: file.size, uploadedAt: now, uploadedBy,
        path: '', // temp —— 服务端 record 会覆盖；UI 不展示 path
      }
      return runMaterialMutation(
        requirementId,
        tempId,
        () => deps.uploadMaterialImpl!({ section: 'prdFiles', requirementId, file, uploadedBy, opts }),
        (req: RequirementEntry) => ({ ...req, materials: { ...req.materials, prdFiles: [...req.materials.prdFiles, tempItem] } }),
        now,
      )
    },

    addAttachment(requirementId, file, uploadedBy = '', opts) {
      if (deps.uploadMaterialImpl === undefined) {
        return {
          promise: Promise.resolve({ ok: false as const, error: projectError('internal-error', 'uploadMaterialImpl not injected') }),
          abort: () => {},
        }
      }
      const now = new Date().toISOString()
      const tempId = crypto.randomUUID()
      const tempItem: RequirementAttachment = {
        id: tempId, filename: file.filename, mimeType: file.mimeType,
        size: file.size, uploadedAt: now, uploadedBy,
        path: '',
      }
      return runMaterialMutation(
        requirementId,
        tempId,
        () => deps.uploadMaterialImpl!({ section: 'attachments', requirementId, file, uploadedBy, opts }),
        (req: RequirementEntry) => ({ ...req, materials: { ...req.materials, attachments: [...req.materials.attachments, tempItem] } }),
        now,
      )
    },

    addPrdLink(requirementId, payload, addedBy = '') {
      if (deps.addMaterialImpl === undefined) {
        return {
          promise: Promise.resolve({ ok: false as const, error: projectError('internal-error', 'addMaterialImpl not injected') }),
          abort: () => {},
        }
      }
      const now = new Date().toISOString()
      const tempId = crypto.randomUUID()
      const tempItem: RequirementPrdLink = {
        id: tempId, url: payload.url, title: payload.title, source: payload.source,
        addedAt: now, addedBy,
      }
      return runMaterialMutation(
        requirementId,
        tempId,
        () => deps.addMaterialImpl!({ section: 'prdLinks', requirementId, payload, addedBy }),
        (req: RequirementEntry) => ({ ...req, materials: { ...req.materials, prdLinks: [...req.materials.prdLinks, tempItem] } }),
        now,
      )
    },

    addSourceRepo(requirementId, payload, addedBy = '', opts) {
      if (deps.addMaterialImpl === undefined) {
        return {
          promise: Promise.resolve({ ok: false as const, error: projectError('internal-error', 'addMaterialImpl not injected') }),
          abort: () => {},
        }
      }
      const now = new Date().toISOString()
      const tempId = crypto.randomUUID()
      // Phase 2.6 乐观更新：把 displayName 一起塞进 tempItem，UI 立刻能看到；
      //   cloneStatus 暂定 'cloned'（host 端真成功会推 SSE 覆盖回真实值）；
      //   若 host 失败,runMaterialMutation 会自动 rollback。
      const tempItem: RequirementSourceRepo = {
        id: tempId, url: payload.url, branch: payload.branch,
        lastCommitSha: payload.lastCommitSha, description: payload.description,
        addedAt: now, addedBy,
        displayName: payload.displayName,
        cloneStatus: 'cloned',
      }
      return runMaterialMutation(
        requirementId,
        tempId,
        () => deps.addMaterialImpl!({ section: 'sourceRepos', requirementId, payload, addedBy, opts }),
        (req: RequirementEntry) => ({ ...req, materials: { ...req.materials, sourceRepos: [...req.materials.sourceRepos, tempItem] } }),
        now,
      )
    },

    addDesignLink(requirementId, payload, addedBy = '') {
      if (deps.addMaterialImpl === undefined) {
        return {
          promise: Promise.resolve({ ok: false as const, error: projectError('internal-error', 'addMaterialImpl not injected') }),
          abort: () => {},
        }
      }
      const now = new Date().toISOString()
      const tempId = crypto.randomUUID()
      const tempItem: RequirementDesignLink = {
        id: tempId, url: payload.url, kind: payload.kind, title: payload.title,
        thumbnailUrl: payload.thumbnailUrl,
        addedAt: now, addedBy,
      }
      return runMaterialMutation(
        requirementId,
        tempId,
        () => deps.addMaterialImpl!({ section: 'designLinks', requirementId, payload, addedBy }),
        (req: RequirementEntry) => ({ ...req, materials: { ...req.materials, designLinks: [...req.materials.designLinks, tempItem] } }),
        now,
      )
    },

    addExternalLink(requirementId, payload, addedBy = '') {
      if (deps.addMaterialImpl === undefined) {
        return {
          promise: Promise.resolve({ ok: false as const, error: projectError('internal-error', 'addMaterialImpl not injected') }),
          abort: () => {},
        }
      }
      const now = new Date().toISOString()
      const tempId = crypto.randomUUID()
      const tempItem: RequirementExternalLink = {
        id: tempId, url: payload.url, title: payload.title, kind: payload.kind,
        description: payload.description,
        addedAt: now, addedBy,
      }
      return runMaterialMutation(
        requirementId,
        tempId,
        () => deps.addMaterialImpl!({ section: 'externalLinks', requirementId, payload, addedBy }),
        (req: RequirementEntry) => ({ ...req, materials: { ...req.materials, externalLinks: [...req.materials.externalLinks, tempItem] } }),
        now,
      )
    },

    removeMaterial(requirementId, section, itemId) {
      if (deps.removeMaterialImpl === undefined) {
        return {
          promise: Promise.resolve({ ok: false as const, error: projectError('internal-error', 'removeMaterialImpl not injected') }),
          abort: () => {},
        }
      }
      const beforeRequirements = snapshot.requirements
      const now = new Date().toISOString()
      // 乐观移除：找到 section 数组，filter 掉该 itemId
      snapshot = {
        ...snapshot,
        requirements: snapshot.requirements.map(r => {
          if (r.id !== requirementId) return r
          const list = r.materials[section] as Array<{ id: string }>
          return { ...r, materials: { ...r.materials, [section]: list.filter(it => it.id !== itemId) }, updatedAt: now }
        }),
      }
      notify()
      let handle: UploadHandle
      try {
        handle = deps.removeMaterialImpl!(requirementId, section, itemId)
      } catch (e) {
        snapshot = { ...snapshot, requirements: beforeRequirements }
        notify()
        return {
          promise: Promise.resolve({ ok: false as const, error: projectError('network-error', e instanceof Error ? e.message : String(e)) }),
          abort: () => {},
        }
      }
      let aborted = false
      handle.promise.then((result) => {
        if (aborted) return
        if (result.ok && result.item !== undefined) {
          // 服务端返回整 requirement（含完整 materials），用 server record 覆盖
          snapshot = { ...snapshot, requirements: snapshot.requirements.map(rr => rr.id === requirementId ? result.item! : rr) }
          notify()
        } else {
          // 仅回滚 requirements 字段，保留 workspaces 等
          snapshot = { ...snapshot, requirements: beforeRequirements }
          notify()
        }
      }).catch((e: unknown) => {
        if (aborted) return
        snapshot = { ...snapshot, requirements: beforeRequirements }
        notify()
        // eslint-disable-next-line no-console
        console.warn('[sky-axis] removeMaterial rejected:', e)
      })
      return {
        promise: handle.promise,
        abort: () => { aborted = true; handle.abort() },
      }
    },
  }
}
