/**
 * Hello 插件跨面共享契约（host + client 共用）。
 *
 * host 半区（Node 进程）注册的 webServer 路由与 client 半区 fetch 调用的
 * 路径字面量必须**唯一**地来自本文件，避免拼写漂移。响应 schema 用 zod
 * 校验（storage-domain 内部也是用 zod，所以校验器可以跨面共享 —— host
 * 用 `schema.parse(req)` 校验入参，client 用 `schema.parse(res)` 校验出参）。
 *
 * Phase 0 范围：ping / health 两个调试端点。
 * Phase 1+ 将追加 Requirement 相关的端点路径与 schema。
 */
import { z } from 'zod'

/* ── 端点路径 ── */

/** webServer 端点前缀（host 注册 + client fetch 同源）。 */
export const HELLO_API_PREFIX = '/api/hello'

/** 端点路径字面量（host 注册时用 path，client fetch 时用同一个字符串）。 */
export const HelloEndpoints = {
  /** 调试端点：返回当前时间戳与包名，验证双半区联通。 */
  ping: `${HELLO_API_PREFIX}/ping`,
  /** 健康检查：返回进程 uptime + API 前缀。 */
  health: `${HELLO_API_PREFIX}/health`,
} as const

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
  /** 当前 hello API 路径前缀（与 HELLO_API_PREFIX 一致，便于运行时校验）。 */
  apiPrefix: z.string(),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>

/* ── 统一响应包装（host 返回 + client 解析共用契约）── */

export interface ApiResponse<T> {
  ok: boolean
  data?: T
  error?: string
}