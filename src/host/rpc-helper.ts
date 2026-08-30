/**
 * sky-axis 插件 host 半区调 DSH apiProxy 的 RPC envelope helper。
 *
 * 模式：参考 dsh-task-board host-runner 的 `request()` —— 同步构造
 * RpcRequest<{ rpcId, payload }>。apiProxy 内部用 rpcId 做关联，不需要
 * 全局唯一 UUID；sky-axis 用 `${packageName}-${counter}` 即可，便于日志
 * 排错（rpcId 一眼能看出是 sky-axis 发的）。
 */
import type { RpcId } from '@deepseek-ai/dsh-host-apiproxy'
import { randomUUID } from 'node:crypto'

/** sky-axis 半区包名（rpcId namespace 前缀，与 protocol.ts HOST_PACKAGE 同源）。 */
const PACKAGE_TAG = 'sky-axis'

let counter = 0

/**
 * 构造一个 RpcRequest。`payload` 类型由调用点 narrow（每个 api method 有
 * 自己的 payload 类型）。
 *
 * 注意：cordis ctx 是进程单例，但 sky-axis 的 host apply 也只执行一次（受
 * mountOnce 保护），所以这个 counter 模块级状态安全。如果未来 sky-axis 支
 * 持多 host instance 并发 apply，需要改成 WeakMap/instance scope。
 */
export function skyAxisRequest<T>(payload: T): { rpcId: RpcId; payload: T } {
  counter += 1
  return { rpcId: `${PACKAGE_TAG}-${counter}-${randomUUID()}` as RpcId, payload }
}
