/**
 * sky-axis 插件 client 半区 —— 与 host 半区 Requirement HTTP API 通信的 fetch helper。
 *
 * 协议：所有调用同源（DSH 主进程 webServer 路由），无需 token / 跨域配置。
 * 响应 schema 用 protocol.ts 的 zod schemas 校验（host 端写入时也用同一套
 * schema，保证跨面契约一致）。
 *
 * 设计：
 *   - 一个轻量 `RequirementClient` 类，构造接收 `baseUrl`（默认 `/api/sky-axis`）
 *   - 每个方法返回 `Result<T, SkyAxisError>` 而非 throw —— 让 UI 层显式分支
 *     错误码（参考 task-board 的 `RpcResult<T>` 风格）
 *   - SSE 客户端：`subscribeEvents()` 返回 EventSource + 订阅 put/deleted 事件
 */
import { z } from 'zod'
import {
  AddDesignLinkRequestSchema,
  AddExternalLinkRequestSchema,
  AddPrdLinkRequestSchema,
  AddSourceRepoRequestSchema,
  SKY_AXIS_API_PREFIX,
  NewRequirementSchema,
  ImportRequirementSchema,
  RequirementSchema,
  RequirementsListResponseSchema,
  RequirementResponseSchema,
  RemoveMaterialResponseSchema,
  WorkspacesListResponseSchema,
  type AddDesignLinkRequest,
  type AddExternalLinkRequest,
  type AddPrdLinkRequest,
  type AddSourceRepoRequest,
  type ImportRequirement,
  type MaterialSection,
  type SkyAxisErrorCode,
  type NewRequirement,
  type Requirement,
  type RequirementId,
  type WorkspaceSummary,
} from '../../protocol.ts'

/** 统一返回类型：成功载荷或带错误码的失败（避免 throw 打断 UI 流程）。 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: SkyAxisErrorCode; detail?: string }

/** 上传进度事件（浏览器 XMLHttpRequest ProgressEvent 抽象）。 */
export interface UploadProgress { loaded: number; total: number }

/** 上传选项（可全部省略以维持 fetch 形态）。 */
export interface UploadOptions {
  /** 进度回调；浏览器至少触发两次（0/0 起步 + 100% 收尾）。 */
  onProgress?: (p: UploadProgress) => void
  /** 取消信号：signal.aborted 时立即 abort。 */
  signal?: AbortSignal
  /** 超时（默认 5 分钟）。0 表示不超时。 */
  timeoutMs?: number
}

/** 上传句柄：承载 promise + abort，与 fetch 习惯保持一致扩展。 */
export interface UploadHandle {
  promise: Promise<Result<Requirement>>
  abort: () => void
}

/** 上传超时默认值：5 分钟（100MB 在良好网络下也足够）。 */
export const DEFAULT_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000

/** sky-axis API 错误响应（host 端 SkyAxisHostError → translateError 产出）。 */
const ApiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  detail: z.string().optional(),
})

async function parseJson<T>(res: Response, schema: z.ZodType<T>): Promise<Result<T>> {
  let raw: unknown
  try {
    raw = await res.json()
  } catch (e) {
    // 非 JSON 响应体（典型：网关 502 返回 HTML）
    if (!res.ok) return { ok: false, code: 'internal-error', detail: `HTTP ${res.status} (non-JSON body)` }
    return { ok: false, code: 'internal-error', detail: `failed to parse JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  // host 真实行为：translateError 用 mapStatus() 把 SkyAxisErrorCode 翻译成
  // 400 / 404 / 500 等 HTTP status code，**响应体仍是 `{ ok: false, error, detail }`**。
  // 所以无论 res.ok 与否，都先尝试 ApiErrorSchema 解析，让 error code 正确透传。
  const parsed = ApiErrorSchema.safeParse(raw)
  if (parsed.success) {
    return { ok: false, code: parsed.data.error as SkyAxisErrorCode, detail: parsed.data.detail }
  }
  if (!res.ok) {
    return { ok: false, code: 'internal-error', detail: `HTTP ${res.status} (non-ApiError body)` }
  }
  const ok = schema.safeParse(raw)
  if (!ok.success) {
    return { ok: false, code: 'internal-error', detail: `response schema mismatch: ${JSON.stringify(ok.error.issues).slice(0, 500)}` }
  }
  return { ok: true, value: ok.data }
}

/** sky-axis 半区 Requirement CRUD + workspace fetch 客户端。 */
export class RequirementClient {
  constructor(private readonly baseUrl: string = SKY_AXIS_API_PREFIX) {}

  /** 拉取全部需求。 */
  async list(): Promise<Result<Requirement[]>> {
    const res = await fetch(`${this.baseUrl}/requirements`, { method: 'GET', credentials: 'same-origin' })
    const parsed = await parseJson(res, RequirementsListResponseSchema)
    if (!parsed.ok) return parsed
    return { ok: true, value: parsed.value.items }
  }

  /** 新建一条需求。host 端会校验 workspace 真实存在。 */
  async create(input: NewRequirement): Promise<Result<Requirement>> {
    // 客户端预校验：防止提交明显错误（host 仍会兜底校验）
    const check = NewRequirementSchema.safeParse(input)
    if (!check.success) {
      return { ok: false, code: 'validation-failed', detail: `input invalid: ${JSON.stringify(check.error.issues).slice(0, 300)}` }
    }
    const res = await fetch(`${this.baseUrl}/requirements/create`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(check.data),
    })
    const parsed = await parseJson(res, RequirementResponseSchema)
    if (!parsed.ok) return parsed
    // RequirementResponseSchema 已内嵌校验 item 是合法 Requirement；这里直接取。
    return { ok: true, value: parsed.value.item }
  }

  /**
   * Plan I：把 path 上已有的 requirement 重新归属到当前 DSH workspace。
   *
   * 场景：DSH 工作区删除 + 重建同路径 —— sky-axis 数据保留,
   * 仅切换 owner uuid。改写 req.workspaceId + updatedAt,其他字段不动。
   *
   * 失败语义：
   *   - path 上无 requirement → host 抛 'requirement-not-found'
   *   - path 上已有 req 但试图再次 create → 'requirement-already-exists-at-path'
   *   - DSH workspace 不可解析 → 'workspace-not-found'
   *
   * UI 侧应在弹窗阶段就检测 `takenByWorkspaceId` 并引导 import,而不是
   * 直接调 create 后接错误兜底 —— 这里只是兜底通道。
   */
  async import(input: ImportRequirement): Promise<Result<Requirement>> {
    // 客户端预校验：防止提交明显错误（host 仍会兜底校验）
    const check = ImportRequirementSchema.safeParse(input)
    if (!check.success) {
      return { ok: false, code: 'validation-failed', detail: `input invalid: ${JSON.stringify(check.error.issues).slice(0, 300)}` }
    }
    const res = await fetch(`${this.baseUrl}/requirements/import`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(check.data),
    })
    const parsed = await parseJson(res, RequirementResponseSchema)
    if (!parsed.ok) return parsed
    return { ok: true, value: parsed.value.item }
  }

  /** 删除一条需求。 */
  async remove(id: RequirementId): Promise<Result<{ id: RequirementId }>> {
    const res = await fetch(`${this.baseUrl}/requirements/delete?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    })
    return parseJson(res, z.object({ ok: z.literal(true), id: RequirementSchema.shape.id }))
  }

  /** 拉取 workspace 元数据快照（client 注入失败时的降级方案）。 */
  async listWorkspaces(): Promise<Result<WorkspaceSummary[]>> {
    const res = await fetch(`${this.baseUrl}/workspaces`, { method: 'GET', credentials: 'same-origin' })
    const parsed = await parseJson(res, WorkspacesListResponseSchema)
    if (!parsed.ok) return parsed
    return { ok: true, value: parsed.value.items }
  }

  /* ── Phase 2.5：物料 CRUD ── */

  /**
   * 上传一个 PRD 文件（multipart）。file.content 是 File / Blob。
   * 100MB 上限由 host busboy `limits.fileSize` 兜底；客户端应预校验避免发大请求。
   *
   * 返回 `UploadHandle`（不再是裸 Promise）—— UI 可通过 `handle.promise` await
   * 结果，或调 `handle.abort()` 主动取消（浏览器刷新 / 关闭弹窗时也可调）。
   * progress 由 `opts.onProgress` 上报，文件开始流式写入时立即触发 0/0、
   * 然后随 chunk 推进。
   */
  uploadPrdFile(
    requirementId: RequirementId,
    file: { content: Blob; filename: string; mimeType: string; size: number },
    uploadedBy?: string,
    opts: UploadOptions = {},
  ): UploadHandle {
    return this.uploadFile('prdFiles', requirementId, file, uploadedBy, opts)
  }

  /** 上传一个附件（multipart）。同 uploadPrdFile。 */
  uploadAttachment(
    requirementId: RequirementId,
    file: { content: Blob; filename: string; mimeType: string; size: number },
    uploadedBy?: string,
    opts: UploadOptions = {},
  ): UploadHandle {
    return this.uploadFile('attachments', requirementId, file, uploadedBy, opts)
  }

  private uploadFile(
    section: Extract<MaterialSection, 'prdFiles' | 'attachments'>,
    requirementId: RequirementId,
    file: { content: Blob; filename: string; mimeType: string; size: number },
    uploadedBy: string | undefined,
    opts: UploadOptions,
  ): UploadHandle {
    // fetch + FormData 无法报告 upload progress —— 唯一办法是 XMLHttpRequest。
    // 我们仍解析响应体为 zod 校验过的 Requirement，保留 Result<T> 返回形态。
    const xhr = new XMLHttpRequest()
    const promise = new Promise<Result<Requirement>>((resolve) => {
      xhr.open(
        'POST',
        `${this.baseUrl}/materials/${section}/upload?requirementId=${encodeURIComponent(requirementId)}`,
        true,
      )
      xhr.withCredentials = true
      xhr.responseType = 'text'
      xhr.timeout = opts.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS
      xhr.upload.onprogress = (e): void => {
        if (!e.lengthComputable) return
        opts.onProgress?.({ loaded: e.loaded, total: e.total })
      }
      xhr.onload = (): void => {
        const res = new Response(xhr.response, {
          status: xhr.status,
          headers: { 'content-type': 'application/json' },
        })
        void parseJson(res, RequirementResponseSchema).then((p) => {
          if (!p.ok) return resolve(p)
          resolve({ ok: true, value: p.value.item })
        })
      }
      xhr.onerror = (): void =>
        resolve({ ok: false, code: 'network-error', detail: 'XMLHttpRequest network error' })
      xhr.onabort = (): void =>
        resolve({ ok: false, code: 'network-error', detail: 'upload aborted' })
      xhr.ontimeout = (): void =>
        resolve({
          ok: false,
          code: 'network-error',
          detail: `upload timeout after ${xhr.timeout}ms`,
        })

      const form = new FormData()
      form.append('file', file.content, file.filename)
      if (uploadedBy !== undefined) form.append('uploadedBy', uploadedBy)
      xhr.send(form)
    })
    const abort = (): void => {
      // 已完成 / 已失败 / 已 abort —— xhr.abort() 再次调用无副作用
      try { xhr.abort() } catch { /* noop */ }
    }
    if (opts.signal !== undefined) {
      if (opts.signal.aborted) {
        abort()
      } else {
        opts.signal.addEventListener('abort', abort, { once: true })
      }
    }
    return { promise, abort }
  }

  /** 添加一个 PRD 链接（JSON）。返回 UploadHandle —— 与上传类方法对齐。 */
  addPrdLink(
    requirementId: RequirementId,
    input: AddPrdLinkRequest,
    addedBy?: string,
    opts: UploadOptions = {},
  ): UploadHandle {
    return this.addJson('prdLinks', requirementId, input, addedBy, AddPrdLinkRequestSchema, opts)
  }

  /**
   * 添加一个源码仓库（JSON + 同步 git clone）。
   *
   * Phase 2.6 行为变化：clone 是长操作（5min 超时）—— 返回 `UploadHandle`，
   * UI 可通过 `handle.abort()` 在用户关闭弹窗 / 刷新时取消。
   * 信号合并：caller 传入 `signal` 与内部 `timeoutMs` 任一触发都 abort fetch + host clone 进程。
   */
  addSourceRepo(
    requirementId: RequirementId,
    input: AddSourceRepoRequest,
    addedBy?: string,
    opts: UploadOptions = {},
  ): UploadHandle {
    // 客户端预校验 —— host 仍会兜底
    const check = AddSourceRepoRequestSchema.safeParse(input)
    if (!check.success) {
      return this.failedHandle('validation-failed', `input invalid: ${JSON.stringify(check.error.issues).slice(0, 300)}`)
    }
    // schema 传 undefined:addSourceRepo 已在外部 pre-checked;addJson 跳过预校验。
    return this.addJson('sourceRepos', requirementId, check.data, addedBy, undefined, opts)
  }

  /** 添加一个设计稿链接（JSON）。 */
  addDesignLink(
    requirementId: RequirementId,
    input: AddDesignLinkRequest,
    addedBy?: string,
    opts: UploadOptions = {},
  ): UploadHandle {
    return this.addJson('designLinks', requirementId, input, addedBy, AddDesignLinkRequestSchema, opts)
  }

  /** 添加一个外部链接（JSON）。 */
  addExternalLink(
    requirementId: RequirementId,
    input: AddExternalLinkRequest,
    addedBy?: string,
    opts: UploadOptions = {},
  ): UploadHandle {
    return this.addJson('externalLinks', requirementId, input, addedBy, AddExternalLinkRequestSchema, opts)
  }

  private addJson<S extends Exclude<MaterialSection, 'prdFiles' | 'attachments'>>(
    section: S,
    requirementId: RequirementId,
    input: unknown,
    addedBy: string | undefined,
    schema: z.ZodType | undefined,
    opts: UploadOptions = {},
  ): UploadHandle {
    // 可选预校验:addSourceRepo 已在外面 pre-checked,这里跳过;
    //   其他 3 个 addPrdLink / addDesignLink / addExternalLink 在此统一校验。
    if (schema !== undefined) {
      const check = schema.safeParse(input)
      if (!check.success) {
        return this.failedHandle('validation-failed', `input invalid: ${JSON.stringify(check.error.issues).slice(0, 300)}`)
      }
      input = check.data
    }
    const body: Record<string, unknown> = {
      ...(input as Record<string, unknown>),
      addedBy: addedBy ?? '',
    }

    // 合并 caller signal + 内部超时 signal —— 任意一个触发都 abort fetch + 后端 clone 进程
    const innerController = new AbortController()
    const mergedSignal = innerController.signal
    const timer = opts.timeoutMs !== undefined && opts.timeoutMs > 0
      ? setTimeout(() => innerController.abort(new Error(`addJson timeout after ${opts.timeoutMs}ms`)), opts.timeoutMs)
      : undefined

    const promise = (async (): Promise<Result<Requirement>> => {
      try {
        const res = await fetch(
          `${this.baseUrl}/materials/${section}/add?requirementId=${encodeURIComponent(requirementId)}`,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: mergedSignal,
          },
        )
        const parsed = await parseJson(res, RequirementResponseSchema)
        return parsed.ok
          ? { ok: true, value: parsed.value.item }
          : parsed
      } catch (e) {
        // AbortError / TypeError('Failed to fetch') → 统一映射为 network-error,
        //   UI 显示「请求被取消」或「网络异常」即可,不必区分具体原因。
        const message = e instanceof Error ? e.message : String(e)
        return { ok: false, code: 'network-error', detail: message }
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    })()

    const abort = (): void => {
      try { innerController.abort(new Error('caller aborted')) } catch { /* noop */ }
    }
    if (opts.signal !== undefined) {
      if (opts.signal.aborted) {
        abort()
      } else {
        opts.signal.addEventListener('abort', abort, { once: true })
      }
    }

    return { promise, abort }
  }

  /** 立即返回失败的 UploadHandle —— 用于 zod 预校验失败这种「不值得发请求」的场景。 */
  private failedHandle(code: SkyAxisErrorCode, detail: string): UploadHandle {
    return {
      promise: Promise.resolve({ ok: false, code, detail }),
      abort: () => undefined,
    }
  }

  /** 删除一个物料项（任意 section）。 */
  async removeMaterial(
    requirementId: RequirementId,
    section: MaterialSection,
    itemId: string,
  ): Promise<Result<{ id: string; item: Requirement }>> {
    const res = await fetch(
      `${this.baseUrl}/materials/${section}/remove?requirementId=${encodeURIComponent(requirementId)}&itemId=${encodeURIComponent(itemId)}`,
      { method: 'DELETE', credentials: 'same-origin' },
    )
    const parsed = await parseJson(res, RemoveMaterialResponseSchema)
    if (!parsed.ok) return parsed
    return { ok: true, value: { id: parsed.value.id, item: parsed.value.item } }
  }
}

/** SSE 事件类型（与 host 端 writeEvent 格式对齐）。 */
export interface RequirementPutEvent { item: Requirement }
export interface RequirementDeletedEvent { id: RequirementId }
export type RequirementStreamEvent =
  | { operation: 'put'; item: Requirement }
  | { operation: 'deleted'; id: RequirementId }

/**
 * 订阅 Requirement 变更事件流（SSE）。返回 EventSource + disposer。
 * host 端 25s 心跳；连接断开由 EventSource 自动重连。
 */
export function subscribeRequirementEvents(
  onEvent: (event: RequirementStreamEvent) => void,
  baseUrl: string = SKY_AXIS_API_PREFIX,
): { source: EventSource; dispose: () => void } {
  const source = new EventSource(`${baseUrl}/requirements/events`, { withCredentials: true })
  const handlePut = (e: MessageEvent<string>): void => {
    try {
      const parsed = RequirementSchema.safeParse(JSON.parse(e.data))
      if (parsed.success) onEvent({ operation: 'put', item: parsed.data })
    } catch {
      // ignore malformed event
    }
  }
  const handleDeleted = (e: MessageEvent<string>): void => {
    try {
      const data = JSON.parse(e.data) as { id?: unknown }
      if (typeof data.id === 'string') onEvent({ operation: 'deleted', id: data.id as RequirementId })
    } catch {
      // ignore
    }
  }
  source.addEventListener('put', handlePut as EventListener)
  source.addEventListener('deleted', handleDeleted as EventListener)
  return {
    source,
    dispose: () => {
      source.removeEventListener('put', handlePut as EventListener)
      source.removeEventListener('deleted', handleDeleted as EventListener)
      source.close()
    },
  }
}
