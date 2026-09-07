/**
 * sky-axis host 半区 webServer 路由 —— AI artifact 落盘（Sprint 4）。
 *
 * 路由表（kind × 1 op = 5 个 exact route）：
 *   POST /api/sky-axis/artifacts/plan/write    → 落盘 plan 类 artifact
 *   POST /api/sky-axis/artifacts/patch/write   → 落盘 patch 类 artifact
 *   POST /api/sky-axis/artifacts/note/write    → 落盘 note 类 artifact
 *   POST /api/sky-axis/artifacts/log/write     → 落盘 log 类 artifact
 *   POST /api/sky-axis/artifacts/report/write  → 落盘 report 类 artifact
 *
 * path 模板来自 protocol.SkyAxisEndpoints.artifactWrite（含 `{kind}` 占位）；
 * webServer.kind = 'exact' 要求字面量路径 —— 所以展开成 5 条 exact route，
 * 与 `makeRequirementRoutes` / `makeMaterialRoutes` 同样的 pattern。
 *
 * body：WriteArtifactRequest（requirementId + artifact）。
 *   - 不再从 query 取 requirementId —— WriteArtifactRequestSchema 把
 *     requirementId 设计在 body 内；query 仅用 kind 路由分发。
 *
 * 复用 host/requirement-service.ts 的 RequirementHostService.writeArtifact()，
 * 错误统一走 translateError。SkyAxisArtifactError 的
 * 'artifact-sandbox-violation' 已在 protocol.ts SKY_AXIS_ERROR_CODES 注册,
 * mapStatus → 403。
 *
 * **默认不写**（Sprint 4 决策 2）：
 *   - 当前 client / controller 未接入这 5 条路由,所以这 5 条路由目前
 *     等价于「不可达」,AI 事件流仍走 KV-only 路径,与 Sprint 3 之前完全一致。
 *   - 未来产品决定开启时,在合适的 AI 事件时机调一次即可;**不需要改 host 代码**。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  ArtifactKindSchema,
  SKY_AXIS_API_PREFIX,
  WriteArtifactRequestSchema,
  WriteArtifactResponseSchema,
  type ApiError,
  type WriteArtifactRequest,
} from '../../protocol.ts'
import { type RequirementHostService } from '../requirement-service.ts'
import { readJsonBody, translateError, zodParseOrThrow } from './requirements.ts'

/** webServer 注册的 route shape（与 requirements.ts / materials.ts 一致）。 */
interface Route {
  kind: 'exact'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** 写 artifact body 的上限：256KB（protocol.ArtifactSchema body 上限 200_000 字符 ≈ 200KB；这里留 buffer）。 */
const ARTIFACT_BODY_LIMIT_BYTES = 256 * 1024

/**
 * sky-axis host artifact 路由工厂。接收 RequirementHostService 实例，返回所有路由的
 * 列表供 webServer.register() 批量注册（与 makeRequirementRoutes 同样的 pattern）。
 */
export function makeArtifactRoutes(service: RequirementHostService): Route[] {
  const routes: Route[] = []
  for (const kind of ArtifactKindSchema.options) {
    routes.push({
      kind: 'exact',
      path: `${SKY_AXIS_API_PREFIX}/artifacts/${kind}/write`,
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
          const raw = await readJsonBody(req, ARTIFACT_BODY_LIMIT_BYTES)
          const input = zodParseOrThrow(WriteArtifactRequestSchema, raw) as WriteArtifactRequest
          // 防御：request 里声明的 kind 必须与 path 里的一致（防 caller 把 plan
          // artifact 投到 patch path）。ArtifactSchema 没 kind 字段,这里靠
          // path 注入 kind —— 调用 service 之前赋上,避免 service 内部重新推算。
          const artifactWithKind = { ...input.artifact, kind }
          const updated = await service.writeArtifact(input.requirementId, artifactWithKind)
          const payload = WriteArtifactResponseSchema.parse({
            ok: true as const,
            artifact: updated.artifacts[input.artifact.id] ?? artifactWithKind,
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

/** 写 JSON 响应的 helper（与 requirements.ts.jsonResponse 同形态,本地复制避免依赖死循环）。 */
function jsonResponse(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}