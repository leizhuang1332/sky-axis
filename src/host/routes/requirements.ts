/**
 * hello host 半区 webServer 路由 —— Requirement CRUD + SSE。
 *
 * 路由表（与 protocol.ts HelloEndpoints 字面量一一对应）：
 *   GET    /api/hello/requirements          → list（JSON）
 *   POST   /api/hello/requirements/create   → create（JSON in / out）
 *   DELETE /api/hello/requirements/delete   → remove（query ?id=xxx）
 *   GET    /api/hello/requirements/events   → SSE 事件流
 *   GET    /api/hello/workspaces            → workspace 列表快照（client 降级用）
 *
 * 模式：参考 dsh-task-board host-routes —— 每个 handler 先 await service.ready()
 * 等 domain open 完成，再调业务方法；错误用统一 translateError() 翻译成
 * ApiError JSON 响应。
 *
 * 信任模型：host 与 client 同源（webServer 路由在 DSH 主进程上，client
 * 在浏览器 fetch 同 origin），所以不需要 loopback / token 校验。**不**
 * 暴露给公网 —— DSH 是本地 GUI 工具，不存在公网部署场景。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  HelloEndpoints,
  NewRequirementSchema,
  RequirementIdSchema,
  type ApiError,
  type HelloErrorCode,
  type Requirement,
  type WorkspaceSummary,
} from '../../protocol.ts'
import { HelloHostError, type RequirementHostService, fetchWorkspaces } from '../requirement-service.ts'

/** webServer 注册的 route shape（参考 dsh-host-webserver 公开类型）。 */
interface Route {
  kind: 'exact'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** 写 JSON 响应的 helper。 */
function jsonResponse(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** 写 SSE 响应的 helper（text/event-stream + chunked）。 */
function sseResponse(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.write(': hello requirement event stream open\n\n')
}

/** 把 HelloHostError → ApiError 响应。 */
function translateError(res: ServerResponse, error: unknown): void {
  if (error instanceof Error && 'code' in error) {
    const helloErr = error as HelloHostError
    const status = mapStatus(helloErr.code)
    const body: ApiError = { ok: false, error: helloErr.code as HelloErrorCode, detail: helloErr.message }
    jsonResponse(res, status, body)
    return
  }
  // 未捕获异常 → internal-error
  const message = error instanceof Error ? error.message : String(error)
  jsonResponse(res, 500, { ok: false, error: 'internal-error', detail: message } satisfies ApiError)
}

/** HelloErrorCode → HTTP status code。 */
function mapStatus(code: HelloErrorCode): number {
  switch (code) {
    case 'validation-failed':       return 400
    case 'workspace-not-found':
    case 'requirement-not-found':   return 404
    case 'workspace-list-failed':   return 502
    case 'invalid-record':          return 500
    case 'internal-error':          return 500
  }
}

/** 安全读 body（限制 64KB，避免恶意大 body OOM host 进程）。 */
const BODY_LIMIT_BYTES = 64 * 1024
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > BODY_LIMIT_BYTES) {
        reject(new HelloHostError('validation-failed', `request body exceeds ${BODY_LIMIT_BYTES} bytes`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (raw.trim() === '') {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (e) {
        reject(new HelloHostError('validation-failed', `invalid JSON: ${e instanceof Error ? e.message : String(e)}`))
      }
    })
    req.on('error', reject)
  })
}

/** zod safeParse 失败的统一包装。 */
function zodParseOrThrow<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { issues?: unknown } } }, input: unknown, errorCode: HelloErrorCode = 'validation-failed'): T {
  const result = schema.safeParse(input)
  if (!result.success) {
    const issueText = JSON.stringify(result.error.issues ?? result.error, null, 0).slice(0, 500)
    throw new HelloHostError(errorCode, `zod parse failed: ${issueText}`)
  }
  return result.data
}

/** 解析 query 参数。 */
function getQueryParam(req: IncomingMessage, name: string): string | undefined {
  const url = req.url
  if (url === undefined) return undefined
  const queryIndex = url.indexOf('?')
  if (queryIndex === -1) return undefined
  const search = new URLSearchParams(url.slice(queryIndex + 1))
  return search.get(name) ?? undefined
}

/**
 * hello host 路由工厂。接收 RequirementHostService 实例，返回所有路由的
 * 列表供 webServer.register() 批量注册。
 */
export function makeRequirementRoutes(service: RequirementHostService): Route[] {
  return [
    /* ── GET /requirements ── */
    {
      kind: 'exact',
      path: HelloEndpoints.requirements,
      handler: async (_req, res) => {
        try {
          const items = await service.list()
          jsonResponse(res, 200, { ok: true, items })
        } catch (error) {
          translateError(res, error)
        }
      },
    },

    /* ── POST /requirements/create ── */
    {
      kind: 'exact',
      path: HelloEndpoints.requirementCreate,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          jsonResponse(res, 405, { ok: false, error: 'validation-failed', detail: 'method-not-allowed' } satisfies ApiError)
          return
        }
        try {
          const raw = await readJsonBody(req)
          const input = zodParseOrThrow(NewRequirementSchema, raw)
          const item = await service.create(input)
          jsonResponse(res, 200, { ok: true, item })
        } catch (error) {
          translateError(res, error)
        }
      },
    },

    /* ── DELETE /requirements/delete?id=xxx ── */
    {
      kind: 'exact',
      path: HelloEndpoints.requirementDelete,
      handler: async (req, res) => {
        if (req.method !== 'DELETE') {
          jsonResponse(res, 405, { ok: false, error: 'validation-failed', detail: 'method-not-allowed' } satisfies ApiError)
          return
        }
        try {
          const idRaw = getQueryParam(req, 'id')
          if (idRaw === undefined || idRaw === '') {
            throw new HelloHostError('validation-failed', 'missing required query param: id')
          }
          const id = zodParseOrThrow(RequirementIdSchema, idRaw)
          const deleted = await service.remove(id)
          if (!deleted) {
            throw new HelloHostError('requirement-not-found', `requirement '${idRaw}' does not exist`)
          }
          jsonResponse(res, 200, { ok: true, id })
        } catch (error) {
          translateError(res, error)
        }
      },
    },

    /* ── GET /requirements/events (SSE) ── */
    {
      kind: 'exact',
      path: HelloEndpoints.requirementEvents,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          jsonResponse(res, 405, { ok: false, error: 'validation-failed', detail: 'method-not-allowed' } satisfies ApiError)
          return
        }
        sseResponse(res)
        const writeEvent = (operation: 'put' | 'deleted', payload: unknown): void => {
          res.write(`event: ${operation}\ndata: ${JSON.stringify(payload)}\n\n`)
        }
        const unsubscribe = service.subscribeDomainChanges((event) => {
          if (event.operation === 'put') {
            writeEvent('put', event.item)
          } else {
            writeEvent('deleted', { id: event.id })
          }
        })
        // 心跳保活（每 25s 一条注释行，防代理 / 浏览器超时）
        const heartbeat = setInterval(() => {
          res.write(': heartbeat\n\n')
        }, 25_000)
        req.on('close', () => {
          clearInterval(heartbeat)
          unsubscribe()
        })
      },
    },

    /* ── GET /workspaces（client 降级方案用）── */
    {
      kind: 'exact',
      path: HelloEndpoints.workspaceList,
      handler: async (_req, res) => {
        try {
          const items = await fetchWorkspaces(service.apiProxy)
          const summaries: WorkspaceSummary[] = items.map(item => ({
            id: item.id,
            title: item.title,
            path: item.path,
          }))
          jsonResponse(res, 200, { ok: true, items: summaries })
        } catch (error) {
          translateError(res, error)
        }
      },
    },
  ]
}
