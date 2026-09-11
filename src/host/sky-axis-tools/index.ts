/**
 * sky-axis-tools —— sky-axis 注入到 DSH 宿主的 cordis plugin。
 *
 * 接入 2 新增件。负责把 sky-axis 专属 tool（advance_stage）注册到 DSH ctx.tools，
 * 让 sky-axis-collaborator preset 跑出来的 agent 可调。
 *
 * 调用方式（host apply 时）：
 *   ```typescript
 *   ctx.plugin(SkyAxisTools)        // cordis 标准 plugin 注册
 *   // 或更轻量（不引入新 plugin）：
 *   // ctx.tools.register(advanceStageTool)
 *   ```
 *
 * 选哪种？
 *   - 用 ctx.plugin(SkyAxisTools)：cordis lifecycle 标准写法，dispose 时自动注销 tool
 *   - 直接 register：更轻，但不会自动 dispose（DSH 进程退出时一起回收）
 *
 * 接入 2 选 ctx.plugin（标准写法）。dispose 时 ctx.tools.register 返回的 unregister
 * 函数会被 cordis effect 自动调。
 */
import type { Context } from '@deepseek-ai/cordis'
import { advanceStageTool } from './advance-stage.ts'

/**
 * ctx.tools 不在 cordis Context 类型上 —— 通过类型 escape 取运行时 service。
 * DSH host 注入 ctx.tools: ToolRuntime（[dsh-tools/lib/types/index.d.ts:602](../../node_modules/.pnpm/@deepseek-ai+dsh-tools@0.1._39d2674c82de6d29148a728ff0282af8/node_modules/@deepseek-ai/dsh-tools/lib/types/index.d.ts#L602)）。
 */
type ToolsLike = { register: (def: unknown) => () => void }

/**
 * sky-axis-tools cordis plugin。
 *
 * apply 函数体只做一件事：ctx.tools.register(advanceStageTool)。
 * dispose 由 cordis 自动管理：register 返回的 unregister 函数被 cordis effect 调度。
 */
export const SkyAxisTools = {
  apply(ctx: Context): void {
    const tools = (ctx as unknown as { tools?: ToolsLike }).tools
    if (tools === undefined) {
      console.warn('[sky-axis:tools] ctx.tools unavailable, advance_stage tool NOT registered')
      return
    }
    const unregister = tools.register(advanceStageTool)
    console.info('[sky-axis:tools] advance_stage tool registered (global, system-prompt-gated)')
    void unregister
  },
}