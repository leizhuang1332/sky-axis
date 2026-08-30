/**
 * Hello 跨包运行时不变量（invariant companion）。
 *
 * 契约：
 *   - host apply 必须用 mountOnce 包裹（`src/host/shared/mount-once.ts`），
 *     保证 cordis 多 fiber / 多 module 实例场景下唯一挂载
 *   - inject 数组必须包含 'webServer'（host 半区依赖 webServer 服务）
 *   - shared/protocol.ts 的端点路径字面量与 host routes 注册的 path 必须
 *     一一对应 —— 任何漂移会导致 client fetch 命中 404
 *
 * 占位 apply：invariant 检查门禁只识别 lib/invariant.js 存在即可，hello
 * 不持有任何跨包运行时不变量需要主动检查。
 */
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Provides no assertions: the plugin owns no cross-package runtime invariants to actively check. */
export function apply(): void {}