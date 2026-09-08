/**
 * sky-axis host 半区 webServer 路由 —— 物料 CRUD（Phase 2.5）。
 *
 * 路由表（6 section × 3 op = 18 个 exact route）：
 *   POST   /api/sky-axis/materials/prdFiles/upload       → multipart 上传 PRD 文档
 *   POST   /api/sky-axis/materials/prdLinks/add          → JSON 添加 PRD 链接
 *   POST   /api/sky-axis/materials/sourceRepos/add       → JSON 添加源码仓库
 *   POST   /api/sky-axis/materials/designLinks/add       → JSON 添加设计稿
 *   POST   /api/sky-axis/materials/attachments/upload    → multipart 上传附件
 *   POST   /api/sky-axis/materials/externalLinks/add     → JSON 添加外部链接
 *   DELETE /api/sky-axis/materials/{section}/remove      → 删除（query ?requirementId=...&itemId=...）
 *
 * 复用 host/requirement-service.ts 的公共方法（7 个 addXxx + removeMaterial），
 * 错误统一走 translateError 翻译成 ApiError JSON 响应。
 *
 * 上传走 busboy 解析 multipart（见 readMultipartBody）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import Busboy from 'busboy'
import {
  AddDesignLinkRequestSchema,
  AddExternalLinkRequestSchema,
  AddPrdLinkRequestSchema,
  AddSourceRepoRequestSchema,
  MaterialItemIdSchema,
  MaterialSectionSchema,
  RequirementIdSchema,
  RequirementResponseSchema,
  RemoveMaterialResponseSchema,
  SKY_AXIS_API_PREFIX,
  UploadedFileMetadataSchema,
  type AddDesignLinkRequest,
  type AddExternalLinkRequest,
  type AddPrdLinkRequest,
  type AddSourceRepoRequest,
  type ApiError,
  type MaterialSection,
} from '../../protocol.ts'
import { SkyAxisHostError, type RequirementHostService } from '../requirement-service.ts'
import {
  getQueryParam,
  jsonResponse,
  translateError,
  zodParseOrThrow,
} from './requirements.ts'

/** webServer 注册的 route shape（与 requirements.ts 一致）。 */
interface Route {
  kind: 'exact'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** JSON add 类 section。 */
const JSON_ADD_SECTIONS = new Set<MaterialSection>([
  'prdLinks', 'sourceRepos', 'designLinks', 'externalLinks',
])
/** Multipart upload 类 section。 */
const UPLOAD_SECTIONS = new Set<MaterialSection>(['prdFiles', 'attachments'])

/** Multipart upload 上限：100MB。 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

/**
 * 读取 multipart body —— busboy 实现。
 *   - 只接受 multipart/form-data content type
 *   - busboy limits: fileSize = maxBytes / files: 1 / fields: 5
 *   - 累计 bytes 超 maxBytes → 抛 validation-failed（busboy 'limit' 事件触发）
 *   - 多个 file field → 拒绝（Phase 2.5 不支持多文件）
 *   - 返回 { filename, mimeType, size, content: Buffer, fields: Record }
 *
 * busboy 流式处理：数据量大也不阻塞 Node event loop（不会卡 SSE 心跳）。
 */
export async function readMultipartBody(req: IncomingMessage, maxBytes: number): Promise<{
  filename: string
  mimeType: string
  size: number
  content: Buffer
  fields: Record<string, string>
}> {
  const contentType = req.headers['content-type']
  if (contentType === undefined || !contentType.toLowerCase().includes('multipart/form-data')) {
    throw new SkyAxisHostError(
      'validation-failed',
      `expected multipart/form-data, got ${String(contentType)}`,
    )
  }
  return await new Promise((resolve, reject) => {
    // busboy 1.6.0 在没有 defParamCharset 时 Content-Disposition 参数走
    // `nullDecoder`（latin1 直通）→ UTF-8 多字节序列（如中文）解码成乱码。
    // 设 `utf8` 后：
    //   1) 客户端发 `filename="中文.docx"` → multipart.js 用 utf8 decoder 解码
    //   2) 客户端发 RFC 5987 `filename*=UTF-8''%E4%B8%AD...` → busboy 优先用 filename*
    //      再回落到 filename 的 defParamCharset —— 也正确
    const bb = Busboy({
      headers: req.headers,
      defParamCharset: 'utf8',
      limits: { fileSize: maxBytes, files: 1, fields: 5 },
    })
    let captured: {
      filename: string
      mimeType: string
      chunks: Buffer[]
      size: number
    } | undefined
    const fields: Record<string, string> = {}
    let settled = false

    bb.on('field', (name: string, val: string): void => {
      fields[name] = val
    })
    bb.on('file', (_fieldname: string, fileStream: NodeJS.ReadableStream, info: { filename?: string; mimeType?: string }): void => {
      if (captured !== undefined) {
        if (!settled) {
          settled = true
          reject(new SkyAxisHostError('validation-failed', 'multiple files in upload not allowed'))
          req.destroy()
        }
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      fileStream.on('data', (chunk: Buffer): void => {
        size += chunk.length
        chunks.push(chunk)
      })
      fileStream.on('limit', (): void => {
        if (!settled) {
          settled = true
          reject(new SkyAxisHostError('validation-failed', `upload exceeds ${maxBytes} bytes`))
          req.destroy()
        }
      })
      fileStream.on('end', (): void => {
        if (settled) return
        captured = {
          filename: info.filename ?? '',
          mimeType: info.mimeType ?? 'application/octet-stream',
          chunks,
          size,
        }
      })
    })
    bb.on('close', (): void => {
      if (settled) return
      if (captured === undefined) {
        settled = true
        reject(new SkyAxisHostError('validation-failed', 'no file in multipart body'))
        return
      }
      settled = true
      resolve({
        filename: captured.filename,
        mimeType: captured.mimeType,
        size: captured.size,
        content: Buffer.concat(captured.chunks),
        fields,
      })
    })
    bb.on('error', (err: Error): void => {
      if (settled) return
      settled = true
      reject(new SkyAxisHostError('validation-failed', `multipart parse error: ${err.message}`))
    })
    // 底层 socket 'error'（如 ECONNRESET / EPIPE）—— aborted 只覆盖 client 显式
    // cancel；TCP reset 走 'error'。没监听 → Node 把 'error' 当 unhandledException，
    // 把整个 DSH 进程拖死。与同模块 readJsonBody 一致。
    req.on('error', (err: Error): void => {
      if (settled) return
      settled = true
      reject(new SkyAxisHostError('validation-failed', `request stream error: ${err.message}`))
    })
    req.on('aborted', (): void => {
      if (settled) return
      settled = true
      reject(new SkyAxisHostError('validation-failed', 'request aborted'))
    })
    req.pipe(bb)
  })
}

/**
 * sky-axis host 物料路由工厂。接收 RequirementHostService 实例，返回所有路由的
 * 列表供 webServer.register() 批量注册（与 makeRequirementRoutes 同样的 pattern）。
 */
export function makeMaterialRoutes(service: RequirementHostService): Route[] {
  const routes: Route[] = []
  for (const section of MaterialSectionSchema.options) {
    const sectionPath = `${SKY_AXIS_API_PREFIX}/materials/${section}`

    /* ── JSON add（4 sections）── */
    if (JSON_ADD_SECTIONS.has(section)) {
      const jsonSection = section as Exclude<MaterialSection, 'prdFiles' | 'attachments'>
      routes.push({
        kind: 'exact',
        path: `${sectionPath}/add`,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            jsonResponse(res, 405, {
              ok: false,
              error: 'validation-failed',
              detail: 'method-not-allowed',
            } satisfies ApiError)
            return
          }
          try {
            const reqIdRaw = getQueryParam(req, 'requirementId')
            if (reqIdRaw === undefined) {
              throw new SkyAxisHostError('validation-failed', 'missing required query param: requirementId')
            }
            const reqId = zodParseOrThrow(RequirementIdSchema, reqIdRaw)
            const raw = await readJsonBodyForAdd(req, jsonSection)
            const addedBy = readAddedBy(raw)
            const updated = await invokeJsonAdd(service, jsonSection, reqId, req, raw, addedBy)
            jsonResponse(res, 200, { ok: true, item: updated })
          } catch (error) {
            translateError(res, error)
          }
        },
      })
    }

    /* ── Multipart upload（2 sections）── */
    if (UPLOAD_SECTIONS.has(section)) {
      const fileSection = section as Extract<MaterialSection, 'prdFiles' | 'attachments'>
      routes.push({
        kind: 'exact',
        path: `${sectionPath}/upload`,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            jsonResponse(res, 405, {
              ok: false,
              error: 'validation-failed',
              detail: 'method-not-allowed',
            } satisfies ApiError)
            return
          }
          try {
            const reqIdRaw = getQueryParam(req, 'requirementId')
            if (reqIdRaw === undefined) {
              throw new SkyAxisHostError('validation-failed', 'missing required query param: requirementId')
            }
            const reqId = zodParseOrThrow(RequirementIdSchema, reqIdRaw)
            const file = await readMultipartBody(req, MAX_UPLOAD_BYTES)
            zodParseOrThrow(UploadedFileMetadataSchema, {
              filename: file.filename,
              mimeType: file.mimeType,
              size: file.size,
            })
            const uploadedBy = file.fields['uploadedBy'] ?? ''
            const updated = await invokeFileAdd(service, fileSection, reqId, file, uploadedBy)
            jsonResponse(res, 200, { ok: true, item: updated })
          } catch (error) {
            translateError(res, error)
          }
        },
      })
    }

    /* ── DELETE remove（6 sections 都有）── */
    routes.push({
      kind: 'exact',
      path: `${sectionPath}/remove`,
      handler: async (req, res) => {
        if (req.method !== 'DELETE') {
          jsonResponse(res, 405, {
            ok: false,
            error: 'validation-failed',
            detail: 'method-not-allowed',
          } satisfies ApiError)
            return
        }
        try {
          const reqIdRaw = getQueryParam(req, 'requirementId')
          const itemIdRaw = getQueryParam(req, 'itemId')
          if (reqIdRaw === undefined || itemIdRaw === undefined) {
            throw new SkyAxisHostError(
              'validation-failed',
              'missing required query params: requirementId/itemId',
            )
          }
          const reqId = zodParseOrThrow(RequirementIdSchema, reqIdRaw)
          const itemId = zodParseOrThrow(MaterialItemIdSchema, itemIdRaw)
          const updated = await service.removeMaterial(reqId, section, itemId)
          const payload = zodParseOrThrow(RemoveMaterialResponseSchema, {
            ok: true,
            id: itemId,
            item: updated,
          })
          jsonResponse(res, 200, payload)
        } catch (error) {
          translateError(res, error)
        }
      },
    })
  }
  return routes
}

/* ── 内部 helper ── */

/** 读 JSON body（不复用 requirements.ts 的 readJsonBody，避免循环依赖）。 */
async function readJsonBodyForAdd(req: IncomingMessage, _section: MaterialSection): Promise<unknown> {
  // 复用 requirements.ts 的 readJsonBody 行为 —— 直接调，保持单一来源
  // 通过动态 import 避免循环依赖（materials.ts import requirements.ts，requirements.ts 不 import materials.ts）
  const { readJsonBody } = await import('./requirements.ts')
  return await readJsonBody(req)
}

/** 从 raw body 读 addedBy（client 可选字段，缺则空串）。 */
function readAddedBy(raw: unknown): string {
  if (raw === null || typeof raw !== 'object') return ''
  const r = raw as Record<string, unknown>
  return typeof r.addedBy === 'string' ? r.addedBy : ''
}

/** 调用 host service 的 JSON add 方法（按 section 选 schema + service method）。 */
async function invokeJsonAdd(
  service: RequirementHostService,
  section: Exclude<MaterialSection, 'prdFiles' | 'attachments'>,
  reqId: ReturnType<typeof RequirementIdSchema.parse>,
  req: IncomingMessage,
  raw: unknown,
  addedBy: string,
): Promise<unknown> {
  switch (section) {
    case 'prdLinks': {
      const payload = zodParseOrThrow(AddPrdLinkRequestSchema, raw) as AddPrdLinkRequest
      return await service.addPrdLink(reqId, payload, addedBy)
    }
    case 'sourceRepos': {
      const payload = zodParseOrThrow(AddSourceRepoRequestSchema, raw) as AddSourceRepoRequest
      // Plan K:把 HTTP 请求的 close/aborted 事件桥到 git clone 子进程。
      //   用户关 tab / 刷新 / 网络断 → req 触发 'close' → 立刻 abort signal
      //   → git-service 内部监听 signal.abort → SIGTERM git 进程,
      //   不再跑满 5min。
      const ac = new AbortController()
      req.once('close', () => ac.abort(new Error('client disconnected')))
      return await service.addSourceRepo(reqId, payload, addedBy, { signal: ac.signal })
    }
    case 'designLinks': {
      const payload = zodParseOrThrow(AddDesignLinkRequestSchema, raw) as AddDesignLinkRequest
      return await service.addDesignLink(reqId, payload, addedBy)
    }
    case 'externalLinks': {
      const payload = zodParseOrThrow(AddExternalLinkRequestSchema, raw) as AddExternalLinkRequest
      return await service.addExternalLink(reqId, payload, addedBy)
    }
  }
}

/** 调用 host service 的 file upload 方法（按 section 选 service method）。 */
async function invokeFileAdd(
  service: RequirementHostService,
  section: Extract<MaterialSection, 'prdFiles' | 'attachments'>,
  reqId: ReturnType<typeof RequirementIdSchema.parse>,
  file: { content: Buffer; filename: string; mimeType: string; size: number },
  uploadedBy: string,
): Promise<unknown> {
  if (section === 'prdFiles') {
    return await service.addPrdFile(reqId, { ...file, uploadedBy })
  }
  return await service.addAttachment(reqId, { ...file, uploadedBy })
}

/* ── 类型 re-export（保持模块边界清晰）── */
export type { Route }
export { RequirementResponseSchema }