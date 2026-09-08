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
 *   - 创建 RequirementClient（fetch host 半区 Requirement CRUD）
 *   - 注入 client/createSkyAxisController 的 loadImpl / createImpl / importImpl / deleteImpl
 *   - subscribeRequirementEvents → controller.handleStreamEvent
 *   - controller.loadRequirements() 拉初始列表
 *
 * Phase 2 §2 迁移（0.1.2）：
 *   - workspace 数据流:cordis effect 订阅 `ctx.workspaces.list` → React 组件层
 *     用 `useWorkspaces()` 全局 hook(`@deepseek-ai/dsh-client-ui-workspace/client`)
 *   - workspace 平台能力(pickDirectory / create):模块级 `workspaceOps` 变量
 *     → React Context(`WorkspaceOpsProvider` 在 mountSkyAxisPage 里包),
 *     modal 用 `useWorkspaceOps()` hook 消费
 *   - inject 数组去掉 `'workspaces'`(由 useWorkspaces 替代)
 *
 * 旧的 sidebar.footer.action slot 注册已废弃（弹窗卡片形态被整页取代）。
 */
import type { Context } from '@deepseek-ai/cordis'
// 类型导入:拉取各 client-ui-* 插件的 ctx 声明合并
//
// 0.1.2 迁移说明(dsh-upgrade-audit 报告 §2.1 / §4.4):
//   - 原 `@deepseek-ai/dsh-client-runtime/client` 整体被删
//   - `ClientContext` 在 0.1.1 里就是 `cordis.Context` 的 alias(只是名字长)
//   - 0.1.2 把原本集中在 dsh-client-runtime 的 `declare module '@deepseek-ai/cordis'`
//     块拆到各 ui-* 包 + api-* 包 —— `ctx.uiWorkspace` 由 `dsh-client-ui-workspace/client`
//     augment,`ctx.workspaces` 由 `dsh-api-workspace-controller/client` augment
//     (注意 `ctx.workspaces` 0.1.2 仍然存在,只是来源变了;type 用 `IWorkspaces`)
//   - `useWorkspaces()` 全局 hook 由 `dsh-client-ui-workspace/client` 通过
//     `declare module '@deepseek-ai/dsh-client-ui-slots' { GlobalStandardProps.useWorkspaces }`
//     提供 —— 但它**只能**在 slot 组件里用(framework 通过 `renderSlot` 注入);
//     sky-axis 走的是独立 `createRoot` React 树,无法直接消费,仍走
//     `ctx.workspaces.list.subscribe` cordis effect 路径,与 §1 host 半区
//     `workspaceController.follow(signal)` 对称
//   - 这里 import 各 ui-* / api-* 入口,让 TS 看到对应的 ctx 属性
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** 0.1.2:ClientContext 退化为 cordis.Context 别名(由各 ui-* 包的
 *  declare module 合并 ctx 属性)。原 0.1.1 的 dsh-client-runtime/client
 *  把所有声明合并集中放在一处,0.1.2 拆到 4-5 个包里。 */
export type ClientContext = Context
import { RequirementClient, subscribeRequirementEvents } from './api/requirement-client.ts'
import { createSkyAxisController, type UploadHandle } from './controller/sky-axis-controller.ts'
import { mountSidebarEntry } from './mount/sidebar-entry.ts'
import { mountSkyAxisPage } from './mount/sky-axis-page-mount.tsx'
import { en, zh, type SkyAxisKey } from './locales.ts'
import type { WorkspaceOps } from './shared/workspace-context.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** sky-axis 插件界面文案命名空间。 */
    'sky-axis': SkyAxisKey
  }
}

/** 本插件拥有的字典命名空间。 */
const NS = 'sky-axis'

/**
 * 把 client `Result<T>` 包装成 controller `UploadHandle`（abort 兜底 noop）。
 * 用于 JSON add / removeMaterial 这类没有进度 / 取消语义的 mutation。
 *
 * 入参用 `Promise<unknown>`：reqClient 各个方法的成功载荷 schema 各异
 * （AddPrdLinkRequest / Requirement / { item: Requirement }），不强行统一；
 * 调用方在 `.then` 里各自负责 item 字段映射（removeMaterial 路径）或
 * 直接透传（addMaterialImpl 路径 → 已含 item 字段）。
 */
function wrapPromise(p: Promise<unknown>, abort?: () => void): UploadHandle {
  return {
    promise: p.then((r) => {
      const v = r as {
        ok?: boolean
        code?: string
        detail?: string
        value?: unknown
        item?: unknown
      }
      if (v.ok === true) {
        // removeMaterial: v.item 是 Requirement；addMaterial: v.value 是 Requirement
        const item = v.item !== undefined ? v.item : v.value
        return { ok: true as const, item: item as never }
      }
      return {
        ok: false as const,
        error: {
          code: (v.code ?? 'internal-error') as never,
          detail: v.detail,
        },
      }
    }),
    // JSON add / removeMaterial 路径不提供 abort —— 内部 fetch 已自带
    //   timeoutMs + signal 合并(见 requirement-client.ts addJson),5min
    //   到点自动 reject;upload 路径必须传真 abort(XHR.abort)。
    abort: abort ?? (() => {}),
  }
}

/**
 * 构造 sky-axis 给 UI 用的 WorkspaceOps 桥接。
 *
 * 0.1.2:workspace **数据**改由全局 `useWorkspaces()` hook 订阅(sky-axis 走 cordis effect
 * 路径,理由见 `inject` 注释)。这里只负责桥接两个**平台能力**:
 *   - `pickDirectory` → `ctx.uiWorkspace.pickDirectory()`(UiWorkspace service,
 *     自动处理取消返回 null)
 *   - `createWorkspace` → `ctx.remote.workspace.create({ path })`(Typert
 *     Remote,流订阅自动推送 upsert 给 `ctx.workspaces.list`)
 *
 * 失败映射:Typert Remote 返回 `RemoteResult<T>` 形态(`{ ok: true, value }`
 * / `{ ok: false, error }`),sky-axis 沿用 0.1.1 的 `{ code: 'workspace-create-failed' }`
 * 错误形态 —— modal 不需要改。
 *
 * 实现细节 —— **lazy 桥接**(关键):
 *   不在 buildWorkspaceOps 内部立即访问 `ctx.uiWorkspace` / `ctx.remote`,
 *   而是闭包持有 ctx,在 modal 真的调 pickDirectory / createWorkspace 时才取。
 *   这样即使 cordis effect 启动顺序把 sky-axis apply 排在 ui-workspace / dsh-api-remotes
 *   之前 —— 或者 `ctx.uiWorkspace` 暂时为 undefined(例如 cordis service 还没注册)
 *   —— 也不会在启动期抛 "cannot get property 'X' without inject"。
 *   真正调用时取,那时 service 已就绪。inject 数组里仍保留 `'uiWorkspace'` / `'remote'`
 *   让 cordis 启动时按依赖排序,确保这两个 service 优先注册。
 */
function buildWorkspaceOps(ctx: Context): WorkspaceOps {
  // 窄类型:`ctx.uiWorkspace` 与 `ctx.remote` 都是各 ui-* / typert 包
  // augment 出来的,这里只挑需要的两个方法,避免静态拉全套 Remote 类型。
  const getUiWorkspace = (): { pickDirectory(): Promise<string | null> } => (
    ctx as unknown as { uiWorkspace: { pickDirectory(): Promise<string | null> } }
  ).uiWorkspace
  const getRemoteWorkspace = (): {
    create(input: { path: string }): Promise<
      | { ok: true; value: { workspace: { workspaceId: string; title: string }; created: boolean } }
      | { ok: false; error: { code?: string; message?: string } }
    >
  } => (
    ctx as unknown as {
      remote: {
        workspace: {
          create(input: { path: string }): Promise<
            | { ok: true; value: { workspace: { workspaceId: string; title: string }; created: boolean } }
            | { ok: false; error: { code?: string; message?: string } }
          >
        }
      }
    }
  ).remote.workspace
  return {
    pickDirectory: () => getUiWorkspace().pickDirectory(),
    createWorkspace: async (input) => {
      const result = await getRemoteWorkspace().create(input)
      if (result.ok) {
        return {
          ok: true,
          id: result.value.workspace.workspaceId as unknown as string,
          title: result.value.workspace.title,
        }
      }
      return {
        ok: false,
        error: {
          code: 'workspace-create-failed',
          detail: result.error.message ?? result.error.code,
        },
      }
    },
  }
}

/**
 * 插件运行所需的 client 服务（cordis 注入契约 —— 缺一个就拿不到对应 ctx 属性）。
 * - 'locale'       UI 文案
 * - 'slots'        已被 sidebar-entry.ts 隐式使用
 * - 'workspaces'   0.1.2:client 半区仍然存在 `ctx.workspaces: IWorkspaces`,
 *                  `workspaces.list: WorkspaceSource`(`getSnapshot()` + `subscribe()`);
 *                  sky-axis 在 cordis effect 内订阅 → push 给 controller。
 *                  React `useWorkspaces()` 全局 hook 只能在 slot 组件里用,
 *                  独立 createRoot 树拿不到,故走 cordis 路径。
 * - 'uiWorkspace'  0.1.2:`ctx.uiWorkspace: UiWorkspace`(由 `dsh-client-ui-workspace/client` 注册),
 *                  `pickDirectory()` 在 modal 里被调 —— 必须 inject,否则 cordis 抛
 *                  "cannot get property 'uiWorkspace' without inject"。
 * - 'remote'       0.1.2:`ctx.remote.workspace.create()` 走 Typert Remote,
 *                  Remote 由 `dsh-api-remotes` apply 注册到 `ctx.remote` —— 必须 inject,
 *                  否则 cordis 同样抛 "cannot get property 'remote' without inject"。
 * - 不 inject sessions —— 新仪表板不订阅会话数据。
 */
export const inject = ['locale', 'slots', 'workspaces', 'uiWorkspace', 'remote']

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
  //    Phase 2.1 完美主义：host 返回的 record 已 100% 完整（含 materials 等所有 required 字段），
  //    直接 spread 投影，无需逐字段拷贝 —— 避免漏字段风险。
  const controller = createSkyAxisController({
    loadImpl: async () => {
      const r = await reqClient.list()
      if (r.ok) {
        return { ok: true, items: r.value.map(item => ({ ...item })) }
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
        return { ok: true, item: { ...r.value } }
      }
      return { ok: false, error: { code: r.code, detail: r.detail } }
    },
    importImpl: async (input) => {
      // Plan I：把 path 上已有的 requirement 重新归属到当前 DSH workspace。
      // 仅传 workspaceId —— path 由 host 端 resolveWorkspacePath 推导。
      const r = await reqClient.import({ workspaceId: input.workspaceId as never })
      if (r.ok) {
        return { ok: true, item: { ...r.value } }
      }
      return { ok: false, error: { code: r.code, detail: r.detail } }
    },
    deleteImpl: async (id) => {
      const r = await reqClient.remove(id as never)
      if (r.ok) return { ok: true }
      return { ok: false, error: { code: r.code, detail: r.detail } }
    },
    // Phase 2.5：物料 CRUD 三个新 impl（与 controller 的 7 mutation 方法对接）
    //
    // 所有 impl 同步返回 UploadHandle（JSON add / removeMaterial 的 abort
    // 是 noop；upload 类直接透传 XHR 句柄）。controller 通过 UploadHandle
    // 拿到 abort 暴露给 UI。
    addMaterialImpl: (input) => {
      // ⚠️ 必须经 wrapPromise 把 `Result<Requirement>`(= {ok, code, detail})
      //   适配成 controller 的 `{ok, item?, error?}` 形态 —— 失败路径需要
      //   `error` 字段 form 才能 setError 显示。Phase 2.6 注释「透传即可」
      //   想错了,直接透传会让 r.error 永远是 undefined。
      switch (input.section) {
        case 'prdLinks':
          return wrapPromise(reqClient.addPrdLink(input.requirementId as never, input.payload, input.addedBy).promise)
        case 'sourceRepos':
          // Phase 2.6:source repo clone 是长操作,opts(signal/timeout/onProgress)必须透传,
          //   form 才能在用户关闭弹窗 / 刷新时真正取消 host 端 clone 进程。
          return wrapPromise(reqClient.addSourceRepo(input.requirementId as never, input.payload, input.addedBy, input.opts ?? {}).promise)
        case 'designLinks':
          return wrapPromise(reqClient.addDesignLink(input.requirementId as never, input.payload, input.addedBy).promise)
        case 'externalLinks':
          return wrapPromise(reqClient.addExternalLink(input.requirementId as never, input.payload, input.addedBy).promise)
      }
    },
    uploadMaterialImpl: (input) => {
      // 同上,upload 路径同样需要 wrapPromise 适配失败形态 —— 上传失败时
      // form 也依赖 `r.error` 显示错误条(否则 UI 静默)。abort 透传 XHR
      // 真实句柄,用户点取消能真正中断浏览器上传。
      const handle = input.section === 'prdFiles'
        ? reqClient.uploadPrdFile(input.requirementId as never, input.file, input.uploadedBy, input.opts ?? {})
        : reqClient.uploadAttachment(input.requirementId as never, input.file, input.uploadedBy, input.opts ?? {})
      return wrapPromise(handle.promise, handle.abort)
    },
    removeMaterialImpl: (reqId, section, itemId) => {
      const promise = reqClient.removeMaterial(reqId as never, section, itemId as never)
      return wrapPromise(promise.then(r => {
        if (r.ok) return { ok: true as const, item: { ...r.value.item } }
        return { ok: false as const, error: { code: r.code, detail: r.detail } }
      }))
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
  //
  // 0.1.2 迁移:平台能力(pickDirectory / createWorkspace)从模块级变量改成 React Context;
  //   `buildWorkspaceOps(ctx)` 在 effect 期间一次性构造 WorkspaceOps 桥接
  //   (持有 `ctx.uiWorkspace.pickDirectory` + `ctx.remote.workspace.create`),
  //   通过 `mountSkyAxisPage` 传给 React 根,Provider 再下发到 modal。
  //   workspace **数据流**没走 Context —— 仍由 effect 6 订阅
  //   `ctx.workspaces.list: WorkspaceSource` 推给 controller(理由:见效果 6 注释)。
  //   见 UPGRADE-MIGRATION-GUIDE.md §2。
  ctx.effect(() => {
    const t = ctx.locale.bind(NS)
    let dispose: (() => void) | undefined
    try {
      const workspaceOps = buildWorkspaceOps(ctx)
      dispose = mountSkyAxisPage({ controller, t, workspaceOps })
    } catch (error) {
      console.error('[sky-axis] page mount failed:', error)
    }
    return () => {
      dispose?.()
    }
  }, 'sky-axis: mount page')

  // 6. 订阅 workspace 流(`ctx.workspaces.list`)→ controller.setWorkspaces
  //
  // 0.1.2 决策记录:考虑过改用 React `useWorkspaces()` 全局 hook(由
  //   `dsh-client-ui-workspace/client` 的 `declare module '@deepseek-ai/dsh-client-ui-slots'`
  //   augment 暴露),但实测那个 hook **只能**在 framework slot 组件里用 —— slot dispatcher
  //   通过 `ctx.slots.provideRoot({ hooks: { workspaces: ... } })` 把 HostObservable
  //   注册成 React context,只有 `renderSlot(...)` 派发的 slot 组件能拿到 hook。
  //   sky-axis 走的是独立 `createRoot` React 树(mountSkyAxisPage 自己 root),
  //   没接 framework 的 slot context,直接 `useWorkspaces()` 会 throw / 返回 undefined。
  //   故仍走 cordis effect 路径 —— 与 §1 host 半区 `workspaceController.follow(signal)`
  //   对称。0.1.2 的 `IWorkspaces.list: WorkspaceSource` 提供 `getSnapshot()` +
  //   `subscribe()`,接口与 0.1.1 完全兼容;只是 `items` 元素类型从旧 `Workspace`
  //   换成新 `WorkspaceView`,这里投影成 `RequirementOption[]` 喂 controller。
  ctx.effect(() => {
    // 窄类型:`ctx.workspaces.list` 是 IWorkspaces 的 readonly 字段,这里只取
    //   list(WorkspaceSource)做投影,避免静态拉全套 IWorkspaces 方法类型。
    const list = (ctx.workspaces as unknown as {
      list: {
        getSnapshot(): { items: ReadonlyArray<{ workspaceId: unknown; title: string; path: string }> }
        subscribe(listener: () => void): () => void
      }
    }).list
    const push = (): void => {
      controller.setWorkspaces(
        list.getSnapshot().items.map((w) => ({
          id: w.workspaceId as unknown as string,
          title: w.title,
          path: w.path,
        })),
      )
    }
    push()
    const dispose = list.subscribe(push)
    return () => { dispose() }
  }, 'sky-axis: subscribe workspaces')

  // 7. 订阅 SSE 事件流 → controller.handleStreamEvent
  ctx.effect(() => {
    const sub = subscribeRequirementEvents((event) => {
      if (event.operation === 'put') {
        // Phase 2.1 完美主义：host 推送的 record 已 100% 完整，直接 spread 投影
        controller.handleStreamEvent({
          operation: 'put',
          item: { ...event.item },
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

// 包表面：cordis 加载所需的 apply + 命名空间 key 类型
//
// 0.1.2 迁移说明:`getWorkspaceOps` + `WorkspaceOps` 不再从这里导出 ——
// 它们已经搬到 `src/client/shared/workspace-context.tsx`(React Context),
// modal 通过 `useWorkspaceOps()` hook 消费。`WorkspaceOps` 类型本身
// 在新模块里 export,这里用 `export type { WorkspaceOps }` 转发以保持
// 旧 import 路径的兼容性(只是 NewRequirementModal 内部不再需要)。
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
export type { WorkspaceOps } from './shared/workspace-context.tsx'
