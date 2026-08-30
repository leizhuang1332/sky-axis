/**
 * Host loader entry —— sky-axis 插件 host 半区入口。
 *
 * Phase 0：注册两个调试端点（ping / health）验证双半区联通。
 * Phase 1：注册 Requirement CRUD + SSE 路由，host 端持久化到 storage domain，
 *          校验 workspace 真实存在并预创建产物根目录。
 *
 * 装配流程：
 *   1. 构造 RequirementHostService —— 后台异步打开 storage domain
 *   2. ctx.effect 内注册 webServer routes（list / create / delete / SSE / workspaces）
 *   3. 注册 ping / health 调试端点（保留 Phase 0）
 *   4. effect disposer 清理 routes + 关闭 service
 *
 * 现有 client 半区（src/client/index.ts）保持不变 —— 它仍负责 sidebar 挂载
 * 与中心列整页渲染，与本文件并行工作。Phase 1 引入持久化与 workspace 集成。
 *
 * 后续 Phase 2+ 将追加：
 *   - list 分页 / 索引
 *   - 需求-会话绑定（让 LLM 在 sky-axis workspace 内执行任务）
 *   - 产物上传接口
 */
import type { Context } from '@deepseek-ai/cordis'
// 类型合并：声明 ctx.webServer / ctx.apiProxy / ctx.storageDomain 可用
import type {} from '@deepseek-ai/dsh-host-apiproxy'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mountOnce } from './host/shared/mount-once.ts'
import { SkyAxisPingService } from './host/ping-service.ts'
import { RequirementHostService } from './host/requirement-service.ts'
import { makeRequirementRoutes } from './host/routes/requirements.ts'
import { makeMaterialRoutes } from './host/routes/materials.ts'
import {
  SkyAxisEndpoints,
  type PingResponse,
  type HealthResponse,
} from './protocol.ts'

/** 显式依赖 webServer / apiProxy / storageDomain 服务（cordis 会等这些服务先初始化）。 */
export const inject = ['webServer', 'apiProxy', 'storageDomain']

/** 写 JSON 响应的 helper（host routes 复用）。 */
function jsonResponse(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export const apply = mountOnce('@leizhuang/sky-axis', (ctx: Context): void => {
  const pingSvc = new SkyAxisPingService()
  // eslint-disable-next-line no-console
  console.info('[sky-axis] host apply: ready (Phase 1: ping + health + requirements CRUD)')

  // 业务服务：构造时启动 storage domain 异步初始化，effect 退出时关闭
  const reqSvc = new RequirementHostService(ctx, ctx.apiProxy, ctx.storageDomain)
  const requirementRoutes = makeRequirementRoutes(reqSvc)
  // Phase 2.5：物料 CRUD 路由（18 个 exact route，6 section × 3 op）
  const materialRoutes = makeMaterialRoutes(reqSvc)

  ctx.effect(() => {
    const disposers: (() => void)[] = [
      ctx.webServer.register({
        kind: 'exact',
        path: SkyAxisEndpoints.ping,
        handler: (req: IncomingMessage, res: ServerResponse): void => {
          if (req.method !== 'GET') {
            jsonResponse(res, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          jsonResponse(res, 200, pingSvc.ping() satisfies PingResponse)
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: SkyAxisEndpoints.health,
        handler: (req: IncomingMessage, res: ServerResponse): void => {
          if (req.method !== 'GET') {
            jsonResponse(res, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          jsonResponse(res, 200, pingSvc.health() satisfies HealthResponse)
        },
      }),
    ]
    for (const route of requirementRoutes) {
      disposers.push(ctx.webServer.register(route))
    }
    for (const route of materialRoutes) {
      disposers.push(ctx.webServer.register(route))
    }
    return () => {
      for (const d of disposers) d()
      void reqSvc.close()
    }
  }, 'sky-axis: register ping/health/requirements routes')
})
