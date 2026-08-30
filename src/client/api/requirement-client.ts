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
  RequirementSchema,
  RequirementsListResponseSchema,
  RequirementResponseSchema,
  RemoveMaterialResponseSchema,
  WorkspacesListResponseSchema,
  type AddDesignLinkRequest,
  type AddExternalLinkRequest,
  type AddPrdLinkRequest,
  type AddSourceRepoRequest,
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

  /** 添加一个 PRD 链接（JSON）。 */
  async addPrdLink(
    requirementId: RequirementId,
    input: AddPrdLinkRequest,
    addedBy?: string,
  ): Promise<Result<Requirement>> {
    return await this.addJson('prdLinks', requirementId, input, addedBy, AddPrdLinkRequestSchema)
  }

  /** 添加一个源码仓库（JSON）。 */
  async addSourceRepo(
    requirementId: RequirementId,
    input: AddSourceRepoRequest,
    addedBy?: string,
  ): Promise<Result<Requirement>> {
    return await this.addJson('sourceRepos', requirementId, input, addedBy, AddSourceRepoRequestSchema)
  }

  /** 添加一个设计稿链接（JSON）。 */
  async addDesignLink(
    requirementId: RequirementId,
    input: AddDesignLinkRequest,
    addedBy?: string,
  ): Promise<Result<Requirement>> {
    return await this.addJson('designLinks', requirementId, input, addedBy, AddDesignLinkRequestSchema)
  }

  /** 添加一个外部链接（JSON）。 */
  async addExternalLink(
    requirementId: RequirementId,
    input: AddExternalLinkRequest,
    addedBy?: string,
  ): Promise<Result<Requirement>> {
    return await this.addJson('externalLinks', requirementId, input, addedBy, AddExternalLinkRequestSchema)
  }

  private async addJson<S extends Exclude<MaterialSection, 'prdFiles' | 'attachments'>>(
    section: S,
    requirementId: RequirementId,
    input: unknown,
    addedBy: string | undefined,
    schema: z.ZodType,
  ): Promise<Result<Requirement>> {
    const check = schema.safeParse(input)
    if (!check.success) {
      return { ok: false, code: 'validation-failed', detail: `input invalid: ${JSON.stringify(check.error.issues).slice(0, 300)}` }
    }
    const body: Record<string, unknown> = {
      ...(check.data as Record<string, unknown>),
      addedBy: addedBy ?? '',
    }
    const res = await fetch(
      `${this.baseUrl}/materials/${section}/add?requirementId=${encodeURIComponent(requirementId)}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
    const parsed = await parseJson(res, RequirementResponseSchema)
    if (!parsed.ok) return parsed
    return { ok: true, value: parsed.value.item }
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
