/**
 * Host loader entry —— hello 插件 host 半区入口。
 *
 * Phase 0：注册两个调试端点（ping / health）验证双半区联通。
 *   - inject = ['webServer']：cordis 会等 webServer 服务先初始化
 *   - mountOnce 包裹：跨 module 实例（npm copy / repository link）共享同一
 *     「已挂载集合」，防止重复注册 routes / settings / system-prompt sections
 *
 * 现有 client 半区（src/client/index.ts）保持不变 —— 它仍负责 sidebar 挂载
 * 与中心列整页渲染，与本文件并行工作。Phase 0 不引入任何 UI 改动，验证现有
 * 行为不受 host 半区新增影响。
 *
 * 后续 Phase 1+ 将追加：
 *   - RequirementHostService（注入 ctx.storageDomain 真持久化）
 *   - list / create / get / remove / events（SSE）路由
 *   - shared/protocol.ts 扩展 Requirement schema
 */
import type { Context } from '@deepseek-ai/cordis'
// 仅作类型合并：声明 ctx.webServer 可用
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mountOnce } from './host/shared/mount-once.ts'
import { HelloPingService } from './host/ping-service.ts'
import {
  HelloEndpoints,
  type PingResponse,
  type HealthResponse,
} from './protocol.ts'

/** 显式依赖 webServer 服务（cordis 会等该服务先初始化）。 */
export const inject = ['webServer']

/** 写 JSON 响应的 helper（host routes 复用）。 */
function jsonResponse(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

export const apply = mountOnce('@deepseek-ai/dsh-client-ui-hello', (ctx: Context): void => {
  const svc = new HelloPingService()
  // eslint-disable-next-line no-console
  console.info('[dsh-hello] host apply: ready (Phase 0: ping + health)')

  ctx.effect(() => {
    const disposers: (() => void)[] = [
      ctx.webServer.register({
        kind: 'exact',
        path: HelloEndpoints.ping,
        handler: (req: IncomingMessage, res: ServerResponse): void => {
          if (req.method !== 'GET') {
            jsonResponse(res, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          jsonResponse(res, 200, svc.ping() satisfies PingResponse)
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: HelloEndpoints.health,
        handler: (req: IncomingMessage, res: ServerResponse): void => {
          if (req.method !== 'GET') {
            jsonResponse(res, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          jsonResponse(res, 200, svc.health() satisfies HealthResponse)
        },
      }),
    ]
    return () => {
      for (const d of disposers) d()
    }
  }, 'hello: register ping/health routes')
})