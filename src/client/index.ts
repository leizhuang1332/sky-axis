/**
 * SkyAxis 插件浏览器半区 —— 直接 DOM 挂 sidebar 主树 entry + 主列整页。
 *
 * 接入路径（不破禁）：
 * - sidebar 主树：用 mountSidebarEntry 把 'SkyAxis' entry 挂在 New Session
 *   按钮之后，与 Chat / Skills 等 shell 内置 entry 同级。沿用 dsh-ssh
 *   的 sidebar-entry-core（vendored copy），自带 MutationObserver 自我
 *   修复。
 * - 主列整页：用 mountSkyAxisPage 把容器 append 到 conversation 列，自己
 *   createRoot React 根，用 `<html>` 上的 `data-sky-axis-active` 属性
 *   切换可见性；与 task-board / ssh 共享 `dsh-panel-activate` 协议避免
 *   互相打架。
 *
 * Phase 1 增量：
 *   - inject 加 'workspaces'：订阅 ctx.workspaces.list → controller.setWorkspaces
 *   - 创建 RequirementClient（fetch host 半区 Requirement CRUD）
 *   - 注入 client/createSkyAxisController 的 loadImpl / createImpl / deleteImpl
 *   - subscribeRequirementEvents → controller.handleStreamEvent
 *   - controller.loadRequirements() 拉初始列表
 *
 * 旧的 sidebar.footer.action slot 注册已废弃（弹窗卡片形态被整页取代）。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// 类型导入：拉取 locale 插件的 ctx.locale 合并
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { RequirementClient, subscribeRequirementEvents } from './api/requirement-client.ts'
import { createSkyAxisController, type RequirementOption } from './controller/sky-axis-controller.ts'
import { mountSidebarEntry } from './mount/sidebar-entry.ts'
import { mountSkyAxisPage } from './mount/sky-axis-page-mount.tsx'
import { en, zh, type SkyAxisKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** sky-axis 插件界面文案命名空间。 */
    'sky-axis': SkyAxisKey
  }
}

/** 本插件拥有的字典命名空间。 */
const NS = 'sky-axis'

/**
 * DSH workspace 平台能力透传 —— 由 `apply(ctx)` 期间填充。
 *
 * 设计动机：让 UI（NewRequirementModal）能直接复用 dsh-client-runtime
 * 暴露的 `ctx.workspaces.pickDirectory()` / `ctx.workspaces.create()`，
 * 不在 sky-axis 内部拼装任何路径/目录/IO 逻辑。
 *
 *   - `pickDirectory`：弹原生目录选择器；用户取消时 resolve `null`。
 *   - `createWorkspace`：用选中路径调 DSH 平台创建 workspace。
 *     DSH 失败时 throw `WorkspaceCreateError`，本 helper 捕获后
 *     映射成 `{ ok: false, error: { code, detail } }` 形态给 UI；
 *     成功后 ctx.workspaces.list 会自动推送新 snapshot，UI 不需要手动刷新。
 */
interface WorkspaceOps {
  pickDirectory: () => Promise<string | null>
  createWorkspace: (input: { path: string }) => Promise<{
    ok: boolean
    id?: string
    title?: string
    error?: { code: 'workspace-create-failed'; detail?: string }
  }>
}

let workspaceOps: WorkspaceOps | undefined

/**
 * 组件 mount 时读取 `workspaceOps`（由 apply(ctx) 期间填入）。
 * 早期 mount / apply 尚未跑完时返回 undefined —— modal 在该场景下
 * 隐藏「+ 创建工作区」入口，保留纯选择形态。
 */
function getWorkspaceOps(): WorkspaceOps | undefined {
  return workspaceOps
}

/**
 * 插件运行所需的 client 服务（cordis 注入契约 —— 缺一个就拿不到对应 ctx 属性）。
 * - 'locale'     UI 文案
 * - 'workspaces' 工作区列表（订阅 ctx.workspaces.list）
 * - 'slots'      已被 sidebar-entry.ts 隐式使用
 *
 * 注意：不再 inject sessions，因为新仪表板不订阅会话数据。
 */
export const inject = ['locale', 'workspaces', 'slots']

/**
 * 挂载 sidebar entry + 主列 page + 装配 requirement 控制器。
 *
 * 失败策略（沿用 dsh-task-board）：DOM 挂载错误只 console.error，绝
 * 不 throw —— DSH web shell 会在插件 apply 抛错时让整个 boot 失败，
 * 第三方插件不应把 GUI 拉下水。
 */
export function apply(ctx: ClientContext): void {
  // 1. 注册 zh / en 字典（effect 等待 locale 服务就绪）。
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sky-axis: dictionaries')

  // 2. Requirement HTTP client（同源 fetch /api/sky-axis/...）。
  const reqClient = new RequirementClient()

  // 3. 构造控制器，注入 host fetch impl。
  const controller = createSkyAxisController({
    loadImpl: async () => {
      const r = await reqClient.list()
      if (r.ok) {
        return { ok: true, items: r.value.map(item => ({
          id: item.id,
          workspaceId: item.workspaceId,
          title: item.title,
          description: item.description,
          priority: item.priority,
          status: item.status,
          tags: item.tags,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })) }
      }
      return { ok: false, error: { code: r.code, detail: r.detail } }
    },
    createImpl: async (input) => {
      const r = await reqClient.create({
        workspaceId: input.workspaceId as never,
        title: input.title,
        description: input.description ?? '',
        priority: input.priority ?? 'normal',
        tags: input.tags ?? [],
      })
      if (r.ok) {
        return { ok: true, item: {
          id: r.value.id,
          workspaceId: r.value.workspaceId,
          title: r.value.title,
          description: r.value.description,
          priority: r.value.priority,
          status: r.value.status,
          tags: r.value.tags,
          createdAt: r.value.createdAt,
          updatedAt: r.value.updatedAt,
        } }
      }
      return { ok: false, error: { code: r.code, detail: r.detail } }
    },
    deleteImpl: async (id) => {
      const r = await reqClient.remove(id as never)
      if (r.ok) return { ok: true }
      return { ok: false, error: { code: r.code, detail: r.detail } }
    },
  })

  // 4. Sidebar 主树 entry —— DOM 直挂。
  try {
    mountSidebarEntry(controller)
  } catch (error) {
    console.error('[sky-axis] sidebar entry mount failed:', error)
  }

  // 5. 主列 page mount —— 在 effect 内执行，确保 locale.bind 在字典
  //    注册完成之后调用，t 函数能正确解析 key。
  ctx.effect(() => {
    const t = ctx.locale.bind(NS)
    let dispose: (() => void) | undefined
    try {
      dispose = mountSkyAxisPage({ controller, t })
    } catch (error) {
      console.error('[sky-axis] page mount failed:', error)
    }
    return () => {
      dispose?.()
    }
  }, 'sky-axis: mount page')

  // 6. 订阅 ctx.workspaces.list → controller.setWorkspaces
  ctx.effect(() => {
    const pushWorkspaces = (): void => {
      const items = ctx.workspaces.list.getSnapshot().items
      const opts: RequirementOption[] = items.map(item => ({
        id: item.workspaceId as unknown as string,
        title: item.title !== '' ? item.title : basename(item.path),
        path: item.path,
      }))
      controller.setWorkspaces(opts)
    }
    pushWorkspaces()
    const dispose = ctx.workspaces.list.subscribe(pushWorkspaces)
    return () => { dispose() }
  }, 'sky-axis: subscribe workspaces')

  // 6.5 填充 workspaceOps —— 把 DSH 平台能力透传给 UI（NewRequirementModal）。
  //     平台创建成功后会自动通过 ctx.workspaces.list 推送新 snapshot，
  //     上面的 pushWorkspaces effect 自动把新 workspace 注入 controller。
  workspaceOps = {
    pickDirectory: () => ctx.workspaces.pickDirectory(),
    createWorkspace: async (input) => {
      try {
        const view = await ctx.workspaces.create({ path: input.path })
        return {
          ok: true,
          id: view.workspaceId as unknown as string,
          title: view.title,
        }
      } catch (e) {
        return {
          ok: false,
          error: {
            code: 'workspace-create-failed',
            detail: e instanceof Error ? e.message : String(e),
          },
        }
      }
    },
  }

  // 7. 订阅 SSE 事件流 → controller.handleStreamEvent
  ctx.effect(() => {
    const sub = subscribeRequirementEvents((event) => {
      if (event.operation === 'put') {
        controller.handleStreamEvent({
          operation: 'put',
          item: {
            id: event.item.id,
            workspaceId: event.item.workspaceId,
            title: event.item.title,
            description: event.item.description,
            priority: event.item.priority,
            status: event.item.status,
            tags: event.item.tags,
            createdAt: event.item.createdAt,
            updatedAt: event.item.updatedAt,
          },
        })
      } else {
        controller.handleStreamEvent({ operation: 'deleted', id: event.id as string })
      }
    })
    return () => { sub.dispose() }
  }, 'sky-axis: subscribe requirement events')

  // 8. 初次拉取列表（在 effect 启动后跑，确保 workspaces 已经首推过一次）
  ctx.effect(() => {
    void controller.loadRequirements()
    return () => {}
  }, 'sky-axis: load requirements (initial)')
}

/** 简单 basename（避免再引 node:path）。 */
function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}

// 包表面：cordis 加载所需的 apply + 命名空间 key 类型
export type { SkyAxisKey }
export type {
  SkyAxisController,
  SkyAxisSnapshot,
  SkyAxisViewKey,
  RequirementEntry,
  RequirementStreamEvent,
  RequirementError,
} from './controller/sky-axis-controller.ts'
export { ENTRY_SELECTOR } from './mount/sidebar-entry.ts'
export { SKY_AXIS_VIEW_SELECTOR } from './mount/sky-axis-page-mount.tsx'
export { getWorkspaceOps }
export type { WorkspaceOps }
