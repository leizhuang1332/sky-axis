/**
 * Hello ping/health 业务实现（host 半区）。
 *
 * Phase 0 范围：仅返回进程元信息，验证 webServer 路由 + client fetch 链路通联。
 * 无持久化、无副作用，方便调试：
 *   - ping：每次返回当前时间戳，确认 host 进程在响应
 *   - health：返回进程 uptime + API 前缀，确认服务注册成功
 *
 * Phase 1+ 将由 RequirementHostService 取代（注入 ctx.storageDomain 真持久化）。
 */
import type { HealthResponse, PingResponse } from '../protocol.ts'
import { HELLO_API_PREFIX } from '../protocol.ts'

/** 当前包名常量（host 半区硬编码，与 package.json 的 name 字段保持一致）。 */
const HOST_PACKAGE = '@deepseek-ai/dsh-client-ui-hello'

export class HelloPingService {
  /** 进程启动时刻（用于 uptime 计算）。 */
  private readonly startedAt = Date.now()

  /** ping：返回当前 ISO 时间戳 + 包名。 */
  ping(): PingResponse {
    return {
      ok: true,
      ts: new Date().toISOString(),
      host: HOST_PACKAGE,
    }
  }

  /** health：返回进程 uptime + API 前缀。 */
  health(): HealthResponse {
    return {
      ok: true,
      uptimeMs: Date.now() - this.startedAt,
      apiPrefix: HELLO_API_PREFIX,
    }
  }
}