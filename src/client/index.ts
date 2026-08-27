/**
 * Hello 插件浏览器半区 —— 直接 DOM 挂 sidebar 主树 entry + 主列整页。
 *
 * 接入路径（不破禁）：
 * - sidebar 主树：用 mountSidebarEntry 把 'Hello' entry 挂在 New Session
 *   按钮之后，与 Chat / Skills 等 shell 内置 entry 同级。沿用 dsh-ssh
 *   的 sidebar-entry-core（vendored copy），自带 MutationObserver 自我
 *   修复。
 * - 主列整页：用 mountHelloPage 把容器 append 到 conversation 列，自己
 *   createRoot React 根，用 `<html>` 上的 `data-dsh-hello-active` 属性
 *   切换可见性；与 task-board / ssh 共享 `dsh-panel-activate` 协议避免
 *   互相打架。
 *
 * 旧的 sidebar.footer.action slot 注册已废弃（弹窗卡片形态被整页取代）。
 */
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
// 类型导入：拉取 locale 插件的 ctx.locale 合并
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createHelloController } from './hello-controller.ts'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { mountHelloPage } from './hello-page-mount.tsx'
import { en, zh, type HelloKey } from './locales.ts'
import type { SessionListReadSource } from './widgets/types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** hello 插件界面文案命名空间。 */
    'hello': HelloKey
  }
}

/** 本插件拥有的字典命名空间。 */
const NS = 'hello'

/** 插件运行所需的 client 服务（cordis 注入契约 —— 缺一个就拿不到对应 ctx 属性）。 */
export const inject = ['locale', 'sessions']

/**
 * 挂载 sidebar entry + 主列 page。
 *
 * 失败策略（沿用 dsh-task-board）：DOM 挂载错误只 console.error，绝
 * 不 throw —— DSH web shell 会在插件 apply 抛错时让整个 boot 失败，
 * 第三方插件不应把 GUI 拉下水。
 */
export function apply(ctx: ClientContext): void {
  // 1. 注册 zh / en 字典（effect 等待 locale 服务就绪）。
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'hello: dictionaries')

  // 2. 构造控制器 + sessions.list 只读面（apply 阶段同步可用）。
  const controller = createHelloController()
  const sessions = ctx.get('sessions') as unknown as ISessions
  const list: SessionListReadSource = {
    getSnapshot: () => sessions.list.getSnapshot(),
    subscribe: (fn) => sessions.list.subscribe(fn),
  }

  // 3. Sidebar 主树 entry —— DOM 直挂。
  //    mountSidebarEntry 内部自带 MutationObserver 等待 sidebar 渲染，
  //    同步调用即可。
  try {
    mountSidebarEntry(controller)
  } catch (error) {
    console.error('[dsh-hello] sidebar entry mount failed:', error)
  }

  // 4. 主列 page mount —— 在 effect 内执行，确保 locale.bind 在字典
  //    注册完成之后调用，t 函数能正确解析 key。
  ctx.effect(() => {
    const t = ctx.locale.bind(NS)
    let dispose: (() => void) | undefined
    try {
      dispose = mountHelloPage({ controller, sessions: list, t })
    } catch (error) {
      console.error('[dsh-hello] page mount failed:', error)
    }
    return () => {
      dispose?.()
    }
  }, 'hello: mount page')
}

// 包表面：cordis 加载所需的 apply + 命名空间 key 类型
export type { HelloKey }
export type { HelloController, HelloSnapshot } from './hello-controller.ts'
export { ENTRY_SELECTOR } from './sidebar-entry.ts'
export { HELLO_VIEW_SELECTOR } from './hello-page-mount.tsx'