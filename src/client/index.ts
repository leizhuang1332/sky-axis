/**
 * Hello 插件浏览器半区 —— 注册 sidebar footer trigger（'sidebar.footer.action'
 * 列表槽位），点击弹出多功能 hello 面板（hello world + 实时时钟 + 当前
 * session 名 + 随机名言）。文案通过 ctx.locale.register 注册，支持中英。
 *
 * 出口约定（包级规则）：/client 表面只导出 cordis 加载所需的 apply/inject
 * 以及类型，不导出 React 组件实现细节。
 */
import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
// 类型导入：拉取 locale 插件的 ctx.locale 合并
import type {} from '@deepseek-ai/dsh-client-locale/client'
// 类型导入：拉取 ui-sidebar 的 SlotMap 合并（'sidebar.footer.action' 槽位）
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { HelloButton } from './HelloButton.tsx'
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

/** footer.action 列表槽位内的唯一占用者 id。 */
const ENTRY_ID = 'hello'

/** 插件运行所需的 client 服务。 */
export const inject = ['slots', 'locale', 'sessions']

/**
 * 注册 hello 字典与 sidebar footer trigger。
 * @param ctx - 客户端根 context。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'hello: dictionaries')

  // sidebar footer 触发器。sidebar shell 声明 'sidebar.footer.action'
  // （kind: 'list' —— 多个占用者可共享席位）；通过 slots.inject 在声明
  // 可用后再注册。组件 prop 由 sidebar 在 renderSlot 时注入（wide 标志
  // 与 locale 字典 t），再加本插件注入的 sessions.list 只读面。
  ctx.slots.inject('sidebar.footer.action', () => {
    // 显式声明 sessions 的出口类型，与 dsh-session-id 同样的做法。
    const sessions = ctx.get('sessions') as unknown as ISessions
    const list: SessionListReadSource = {
      getSnapshot: () => sessions.list.getSnapshot(),
      subscribe: (fn) => sessions.list.subscribe(fn),
    }
    return ctx.slots.register({
      name: 'sidebar.footer.action',
      id: ENTRY_ID,
      locale: NS,
      inject: () => ({ list }),
    }, HelloButton)
  })
}

export type { HelloButtonProps } from './HelloButton.tsx'
export type { HelloKey } from './locales.ts'
export type { SessionListReadSource } from './widgets/types.ts'