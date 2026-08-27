/**
 * Host loader entry for the hello plugin — runs in the DSH host process.
 *
 * Hello 是一个纯浏览器插件：按钮 + 弹窗完全在 client 侧渲染，host 侧
 * 无任何行为需要挂载。保留空 apply 以满足 bundle 的标准 loader 入口。
 */
import type { Context } from '@deepseek-ai/cordis'

/** Host 半区空实现（纯浏览器插件）。 */
export function apply(_ctx: Context): void {
  // Intentionally empty: hello has no host behavior.
}