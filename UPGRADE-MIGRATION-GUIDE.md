# `@leizhuang/sky-axis` 升级到 DSH 0.1.2-rc.1 迁移指南

> 配套审计报告：[`tmp/0.1.1rc1-to-0.1.2rc1/UPGRADE-ADAPTATION.md`](tmp/0.1.1rc1-to-0.1.2rc1/UPGRADE-ADAPTATION.md)
> 详细 facade 对比：[`tmp/facade-scan.md`](tmp/facade-scan.md)

## TL;DR

本次升级分两部分,**均已完成**:
- **§1 host 半区** —— ✅ `ApiProxy` 引用清零,改走 `ctx.workspaceController.follow(signal)` 流订阅;
  `src/host/rpc-helper.ts` 整体删除(`RpcId` 类型 0.1.2 不再 export,无 caller)
- **§2 client 半区** —— ✅ `workspaceOps` 模块变量改成 React Context(`WorkspaceOpsProvider` 透传,
  modal 用 `useWorkspaceOps()` 消费);**workspace 数据流仍走 cordis effect**(`ctx.workspaces.list.subscribe`
  → `controller.setWorkspaces`)—— React `useWorkspaces()` hook 只能给 slot 组件用,
  sky-axis 独立 `createRoot` 树拿不到(详见 §2)

`pnpm install` 后 `pnpm run typecheck` / `pnpm run build` 不应再有 §1 / §2 语义错误。
如还报错,大概率是 `pnpm install` 没完成 / lockfile 没更新。

## 已完成

### §1 host 半区(本次 sprint)

| 文件 | 改动 |
|---|---|
| `src/host/requirement-service.ts` | `ApiProxy` 字段 → `workspaceController: WorkspaceController`;`workspacePathCache: Map<id,string>` → `workspaceViewCache: Map<id,WorkspaceView>`;新增 `startWorkspaceFollow()` / `consumeWorkspaceFollow()` / `applyWorkspaceFollowFrame()`;新增 `whenBaselineReady()`(首帧 promise)+ `getWorkspaceViews()`(同步 cache 读);`resolveWorkspacePath` cache miss 不再主动 refresh,直接抛 `workspace-not-found`;`resolveWorkspacePathFromCache` / `resolveAllWorkspacePaths` 简化为纯 cache;`fetchWorkspaces` 函数删除;`close()` 增加 `followAbortController.abort()` |
| `src/host/routes/requirements.ts` | `GET /workspaces` 端点改读 `service.getWorkspaceViews()`(同步 cache),不再发 RPC;移除 `fetchWorkspaces` import |
| `src/index.ts` | 启动 bootstrap 改为 `await reqSvc.whenBaselineReady()` 拿首帧 baseline,然后遍历 `WorkspaceView[]` 跑 ensureMeta + ensureInputsLayout + fs-watch + migration + refresh;新增独立 effect 调 `reqSvc.startWorkspaceFollow()`(流订阅);routes effect 不再重复 close service(由独立 effect 负责,LIFO 保证 close 在 routes 之后);删除 `skyAxisRequest` import(再无用处) |
| `src/host/rpc-helper.ts` | **整文件删除** —— `RpcId` 类型 0.1.2 不再从 `@deepseek-ai/dsh-api-remotes` 导出(已 grep 确认),且 `skyAxisRequest` 没有任何 caller |
| `src/host/workspace-meta.ts` | 注释:`apiProxy.workspace.list 返回的字段` → `WorkspaceView 字段` |
| `src/protocol.ts` | 注释 `workspaceList` 端点:由「不代理 DSH apiProxy」改为「不代理 DSH workspaceController」;错误码注释删 `workspace-list-failed`(再无 RPC 调用) |

### §2 client 半区(本次 sprint)

| 文件 | 改动 |
|---|---|
| `src/client/shared/workspace-context.tsx` | **新建**:`WorkspaceOps` interface + `WorkspaceOpsProvider` + `useWorkspaceOps()` hook;`WorkspaceOps` 是原 0.1.1 接口的 1:1 镜像(pickDirectory + createWorkspace),modal 内部逻辑不需要改 |
| `src/client/index.ts` | 删除模块级 `workspaceOps` 变量 + `getWorkspaceOps()` 函数;新增 `buildWorkspaceOps(ctx)` 桥接 `ctx.uiWorkspace.pickDirectory` + `ctx.remote.workspace.create`;effect 5(mount page) 构造 `workspaceOps = buildWorkspaceOps(ctx)` 传给 `mountSkyAxisPage`;**effect 6(workspace 数据流)保持 cordis `ctx.workspaces.list.subscribe → controller.setWorkspaces`** —— 仅投影改为新 `WorkspaceView` 字段(`{id, title, path}`);新增 `import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'`(让 TS 看到 `ctx.workspaces: IWorkspaces` augment);`inject` 数组保留 `'workspaces'`;`export { getWorkspaceOps }` 删除,`export type { WorkspaceOps }` 改为从 `./shared/workspace-context.tsx` 转发 |
| `src/client/mount/sky-axis-page-mount.tsx` | `MountSkyAxisOptions` 新增 `workspaceOps: WorkspaceOps`;React 树用 `<WorkspaceOpsProvider value={workspaceOps}>` 包最外层 |
| `src/client/page/SkyAxisPage.tsx` | **仅 1 行改动**:`useState(getWorkspaceOps)` 删除;modal 渲染处删 `workspaceOps={workspaceOps}` prop;workspace 数据流**仍**从 controller snapshot 读(`workspaces` 字段由 effect 6 推入,三个 child 组件接口不变) |
| `src/client/page/sections/NewRequirementModal.tsx` | `import { useWorkspaceOps } from '../../shared/workspace-context.tsx'`;`props.workspaceOps?: WorkspaceOps` 删除,改为函数体内 `const workspaceOps = useWorkspaceOps()`;`workspaceOps === undefined` 守卫全部删除;按钮外层 `{workspaceOps !== undefined && (...)}` 改为直接渲染 |

### 自动可改部分(上一轮已完成)

| 文件 | 改动 |
|---|---|
| `package.json` | bump `@deepseek-ai/cordis` peer `^4.0.1` → `^4.0.2`;删 `@deepseek-ai/dsh-client-runtime`、`@deepseek-ai/dsh-host-apiproxy`;增 `@deepseek-ai/dsh-api-{remotes,session-controller,workspace-controller}`、`@deepseek-ai/dsh-client-ui-{session,workspace}`;`dsh.engines.dsh` 改 `>=0.1.2-rc.1`;`dsh.bundle.client.inject` 换为 `dsh-client-ui-session` + `dsh-client-ui-workspace`;`version` 0.1.0 → 0.1.1 |
| `shared/tsdown.client.ts` | 删 `RUNTIME_STORE_EXEMPTION`(0.1.2 完成 store rehoming TODO);`INLINE_SAFE` 正则 `host-apiproxy` → `api-[a-z0-9]+(?:-[a-z0-9]+)*`;`mobileBundle` 的 `resolveId` 同源替换 |
| `src/index.ts` | 删 `dsh-host-apiproxy` 的 ambient augmentation(包不存在),改 `dsh-api-workspace-controller`;`inject` 数组 `apiProxy` → `workspaceController` |
| `src/client/index.ts` | `ClientContext` 来源从 `dsh-client-runtime/client` 改为 `cordis.Context` 别名 + 4 个 ui-* 包 import 让 TS 看到 ctx 属性合并 |

## §1 host 半区:`ctx.apiProxy.workspace.list(req)` → `ctx.workspaceController.follow(signal)` 流

> **✅ 本节已实现** —— `pnpm install` 后 §1 不应再有 typecheck 错误。

### 0.1.1 形态(一次性 RPC + 60s TTL 缓存)

```ts
const response = await this.apiProxy.workspace.list(skyAxisRequest({}))
// response.result.ok / response.result.value.items / response.result.error
```

### 0.1.2 形态(流订阅 + 事件驱动增量)

实际实现的 `WorkspaceFollowFrame` 形状(来自 `@deepseek-ai/dsh-api-workspace-controller` 的 `types.d.ts`):

```ts
export type WorkspaceFollowFrame =
  | { readonly type: 'baseline'; readonly value: WorkspaceBaseline }
  | { readonly type: 'upsert';   readonly workspace: WorkspaceView }
  | { readonly type: 'remove';   readonly workspaceId: WorkspaceId }
  | { readonly type: 'order';    readonly workspaceIds: readonly WorkspaceId[] }
  | { readonly type: 'archived'; readonly archivedSessionIds: readonly SessionId[] }

export interface WorkspaceBaseline {
  readonly items: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly SessionId[]
}

export interface WorkspaceView {
  readonly workspaceId: WorkspaceId
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly SessionId[]
  readonly createdAt: string
  readonly updatedAt: string
}
```

最终 `requirement-service.ts` 实现:

```ts
private applyWorkspaceFollowFrame(frame: WorkspaceFollowFrame): void {
  switch (frame.type) {
    case 'baseline': {
      const fresh = new Map<SkyAxisWorkspaceId, WorkspaceView>()
      for (const item of frame.value.items) {
        fresh.set(item.workspaceId as unknown as SkyAxisWorkspaceId, item)
      }
      this.workspaceViewCache = fresh
      this.baselineReady.resolve(this.snapshotViews())  // 触发 whenBaselineReady()
      return
    }
    case 'upsert': {
      this.workspaceViewCache.set(frame.workspace.workspaceId as unknown as SkyAxisWorkspaceId, frame.workspace)
      return
    }
    case 'remove': {
      this.workspaceViewCache.delete(frame.workspaceId as unknown as SkyAxisWorkspaceId)
      return
    }
    case 'order':
    case 'archived':
      return  // 顺序变更 / archived session 不影响 workspaceId → view 映射
  }
}
```

### 改动清单(已完成)

1. **`src/host/requirement-service.ts`**:
   - 删 `WORKSPACE_CACHE_TTL_MS = 60_000` 常量、`workspaceCacheLoadedAt` 字段
   - 删 `refreshWorkspacePathCache()` 方法
   - 改 `workspacePathCache: Map<id,string>` → `workspaceViewCache: Map<id,WorkspaceView>`(存全量 view 给 routes 用)
   - 新增 `startWorkspaceFollow()`(fire-and-forget 启动消费循环)、`consumeWorkspaceFollow(signal)`(带 retry 的 async generator 消费器)、`applyWorkspaceFollowFrame(frame)`(5 种 frame 类型 switch)
   - 新增 `whenBaselineReady()` —— 首帧 baseline 到达时 resolve 的 promise,启动 bootstrap 用
   - 新增 `getWorkspaceViews()` —— 同步读 cache 给 routes 透传用
   - 新增 `followAbortController: AbortController` —— close() 时 abort 内部流
   - `resolveWorkspacePath` cache miss 不再主动 refresh,直接抛 `workspace-not-found`(baseline 还没到的极罕见情况也走这条;调用方重试可拿到)
   - 重命名构造函数第二参数 `apiProxy` → `workspaceController`
2. **`src/host/requirement-service.ts#fetchWorkspaces`** —— **已删除**。`GET /workspaces` 改读 `service.getWorkspaceViews()`。
3. **`src/host/routes/requirements.ts`** —— `GET /workspaces` 改读 `service.getWorkspaceViews()`(同步),不再发 RPC;不再 import `fetchWorkspaces`。
4. **`src/index.ts`**:
   - `inject` 改成 `['webServer', 'workspaceController', 'storageDomain']`
   - 新增独立 effect 调 `reqSvc.startWorkspaceFollow()`(LIFO dispose 顺序保证它在 routes effect 之前启动,close 在 routes 之后)
   - 启动 bootstrap IIFE 改为 `await reqSvc.whenBaselineReady()` 拿首帧,遍历 `WorkspaceView[]` 跑 ensureMeta / ensureInputsLayout / fs-watch / migration / refresh
   - 路由 effect 内部不再 `void reqSvc.close()`(由独立 effect 负责)
   - 删除 `skyAxisRequest` import(再无 RPC 调用需要它)
5. **`src/host/rpc-helper.ts`、`src/host/workspace-meta.ts`、`src/protocol.ts`** —— 文档注释从「apiProxy.workspace.list」改为「workspaceController.follow / WorkspaceView」

### 验证

- `pnpm run typecheck` 在 §1 范围内应无错误(`Cannot find name 'ApiProxy'` / `Property 'workspaceController' does not exist on type 'Context'` 已清零)
- `pnpm run test` 中无 `requirement-service` 套件(grep 验证)—— 现有 13 个测试都不直接 mock `apiProxy`,只是通过 `readAllRequirements` 等内部 API 工作,无需更新
- 启动后 `GET /workspaces` 应返回当前全部 workspace(可能为空数组如果 baseline 还没到;前端应优先用 `useWorkspaces()` hook 取实时数据)

## §2 client 半区:workspaceOps 平台能力从模块变量 → React Context

> **✅ 本节已实现** —— `pnpm install` 后 §2 不应再有 typecheck 错误。
>
> 设计动机(0.1.1 → 0.1.2 形态对比)、实现细节、验证清单见下。

### 0.1.1 形态(模块级变量 + cordis effect 订阅)

```ts
// platform capability —— 模块级变量
let workspaceOps: WorkspaceOps | undefined
export function getWorkspaceOps(): WorkspaceOps | undefined { return workspaceOps }

// workspace 数据流 —— cordis effect
ctx.effect(() => {
  const pushWorkspaces = () => {
    const items = ctx.workspaces.list.getSnapshot().items
    controller.setWorkspaces(items.map(toOption))
  }
  pushWorkspaces()
  const dispose = ctx.workspaces.list.subscribe(pushWorkspaces)
  return () => dispose()
}, 'sky-axis: subscribe workspaces')

// modal 通过同步变量读 workspaceOps
const [ops] = useState(() => getWorkspaceOps())
```

### 0.1.2 形态(platform capability 走 React Context;workspace 数据流**仍**走 cordis effect)

**workspaceOps 平台能力**(新增 React Context):

```tsx
// src/client/shared/workspace-context.tsx
const WorkspaceOpsContext = createContext<WorkspaceOps | null>(null)
export function WorkspaceOpsProvider({ value, children }: Props) { ... }
export function useWorkspaceOps(): WorkspaceOps { /* Provider 缺失 throw */ }
```

```tsx
// src/client/page/sections/NewRequirementModal.tsx —— modal 直接 hook 取值
const workspaceOps = useWorkspaceOps()  // Provider 必先于子树 mount,无 undefined 守卫
```

**workspace 数据流**(保持 cordis effect):

```ts
// src/client/index.ts —— effect 6
ctx.effect(() => {
  const list = (ctx.workspaces as unknown as {
    list: { getSnapshot(): { items: ReadonlyArray<{ workspaceId: unknown; title: string; path: string }> }
            subscribe(listener: () => void): () => void }
  }).list
  const push = () => controller.setWorkspaces(list.getSnapshot().items.map((w) => ({
    id: w.workspaceId as unknown as string,
    title: w.title,
    path: w.path,
  })))
  push()
  const dispose = list.subscribe(push)
  return () => { dispose() }
}, 'sky-axis: subscribe workspaces')
```

### 关键决策:为什么 workspace 数据流**不**改用 React `useWorkspaces()` hook

`useWorkspaces` 是 `@deepseek-ai/dsh-client-ui-workspace/client` 通过 `declare module '@deepseek-ai/dsh-client-ui-slots' { interface GlobalStandardProps { useWorkspaces: SnapshotSelectorHook<WorkspaceSnapshot> } }` augment 出来的"全局 React hook"。**但它不是任何包的 named export**(`grep -n 'useWorkspaces'` 在 0.1.2 所有 ui-* / api-* 包的 `.d.ts` / `.js` 里都没有 `export { useWorkspaces }`),它只能由 framework slot dispatcher 通过 `ctx.slots.provideRoot({ hooks: { workspaces: workspaces.list } })` 注册成 React context,再在 `renderSlot(...)` 派发的 slot 组件里取到。

sky-axis 走的是独立 `createRoot` React 树(`mountSkyAxisPage` 自己 root,挂在 conversation 列),**不接 framework slot context**,直接 `useWorkspaces()` 会 throw / 返回 undefined。这就是为什么 §2 实施过程中我先把数据流改 hook 化,实测 typecheck fail + 运行时无 context,回滚到 cordis effect 路径 —— 这与 §1 host 半区 `workspaceController.follow(signal)` 设计对称(都是事件驱动流,都不用中间 React 层)。

`workspaceOps` 平台能力(`pickDirectory` / `createWorkspace`)没有这个限制 —— 它是普通方法桥接(`ctx.uiWorkspace.pickDirectory()` + `ctx.remote.workspace.create()`),不依赖 framework slot context,改走 React Context 完全 OK,且实际收益明显(modal 不再需要 prop drilling)。

### 改动清单(已完成)

1. **`src/client/shared/workspace-context.tsx`** —— **新建**:
   - `WorkspaceOps` interface(与 0.1.1 接口 1:1 镜像,pickDirectory 返回 `Promise<string | null>`,createWorkspace 返回 `Promise<{ok, id?, title?, error?}>`)
   - `WorkspaceOpsContext = createContext<WorkspaceOps | null>(null)`
   - `WorkspaceOpsProvider` 接收 `value: WorkspaceOps` + `children: ReactNode`
   - `useWorkspaceOps()` —— Provider 缺失时 throw,要求子树必须在 Provider 内
2. **`src/client/index.ts`**:
   - 加 `import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'`(让 TS 看到 `ctx.workspaces: IWorkspaces` augment;0.1.2 这个 ctx 属性来自 `@deepseek-ai/dsh-api-workspace-controller/client`,**不是** `@deepseek-ai/dsh-client-runtime`)
   - 删除模块级 `workspaceOps` 变量 + `getWorkspaceOps()` 函数(以及它的 `export { getWorkspaceOps }` 与旧的 `export type { WorkspaceOps }`)
   - `inject` 数组保留 `'workspaces'`(因为仍走 cordis effect 订阅)
   - 添加 `buildWorkspaceOps(ctx: Context): WorkspaceOps` —— 桥接 `ctx.uiWorkspace.pickDirectory` + `ctx.remote.workspace.create`;`RemoteResult<T>` 的 `{ok: false, error: {code?, message?}}` 映射为 sky-axis 的 `{code: 'workspace-create-failed', detail: error.message ?? error.code}`
   - effect 5(mount page) 构造 `workspaceOps = buildWorkspaceOps(ctx)`,传给 `mountSkyAxisPage({ controller, t, workspaceOps })`
   - effect 6(workspace 数据流)保持 `ctx.workspaces.list.subscribe → controller.setWorkspaces`,仅投影改为新 `WorkspaceView` 字段(`{id, title, path}`)
   - `export type { WorkspaceOps } from './shared/workspace-context.tsx'` —— 转发类型保持外部 import 路径兼容
3. **`src/client/mount/sky-axis-page-mount.tsx`**:
   - `MountSkyAxisOptions` 新增 `workspaceOps: WorkspaceOps` 字段
   - 函数体解构 `{ controller, t, workspaceOps } = opts`
   - `root.render(<WorkspaceOpsProvider value={workspaceOps}><SkyAxisPage ... /></WorkspaceOpsProvider>)` —— Provider 包最外层,modal 任意深度都能 `useWorkspaceOps()` 消费
4. **`src/client/page/SkyAxisPage.tsx`** —— **仅 1 行改动**:
   - 删 `import { getWorkspaceOps, type WorkspaceOps } from '../index.ts'` —— workspaceOps 不再从这里 import,modal 自己 hook 取
   - 删 `const [workspaceOps] = useState<WorkspaceOps | undefined>(() => getWorkspaceOps())`
   - modal 渲染处删 `workspaceOps={workspaceOps}` prop
   - 注释里说明"workspaceOps 由 modal 通过 `useWorkspaceOps()` 自取,此处不再持有"
   - **没动** workspace 数据流 —— 仍由 cordis effect 6 推入 controller,`snapshot.workspaces` 字段保持 `readonly RequirementOption[]`(`SkyAxisSidebar hasWorkspace` / `RequirementsView workspaces` / `RequirementDetailPage workspaces` 三个 child 接口不变)
5. **`src/client/page/sections/NewRequirementModal.tsx`**:
   - 删 `import type { WorkspaceOps } from '../../index.ts'`
   - 加 `import { useWorkspaceOps } from '../../shared/workspace-context.tsx'`
   - props interface 删 `workspaceOps?: WorkspaceOps` 字段
   - props 解构删 `workspaceOps`
   - 函数体内 `const workspaceOps = useWorkspaceOps()`
   - `handleCreateWorkspace` 守卫 `if (workspaceOps === undefined || creatingWorkspace)` 改为 `if (creatingWorkspace)`(hook 永远返回非 null,Provider 缺失会 throw 而不是给 undefined)
   - 「+ 创建工作区」按钮外层 `{workspaceOps !== undefined && (...)}` 改为直接渲染(外层少一层条件,渲染位置不变)
6. **`src/host/rpc-helper.ts`** —— **删除**:
   - 0.1.2 把 `RpcId` 类型从 `@deepseek-ai/dsh-host-apiproxy` 搬走,但新 `@deepseek-ai/dsh-api-remotes` 没有重新 export;helper 文件没有任何 caller(`grep skyAxisRequest src/` 只剩自引用),整文件删除避免 typecheck 报 TS2305

### 验证

- `pnpm run typecheck` 在 §2 范围内应无错误(关键点:`@deepseek-ai/dsh-api-workspace-controller/client` 的 declare module 让 TS 看到 `ctx.workspaces: IWorkspaces`;`ctx.uiWorkspace` 由 `dsh-client-ui-workspace/client` augment;`ctx.remote.workspace` 由 `dsh-api-workspace-controller` augment —— 三个 import type 都到位)
- `pnpm run build` 应成功 —— `WorkspaceOpsProvider` 在 React 树最外层,modal 子树任意深度都能拿到
- 浏览器侧打开 sky-axis 页面 → workspace 下拉框应该出现 DSH 当前全部 workspace(`ctx.workspaces.list.subscribe` 流订阅 → controller.setWorkspaces → snapshot.workspaces → Sidebar hasWorkspace / RequirementsView workspaces)
- 创建 workspace(用 dsh 自带 picker)→ 新 workspace 应自动出现(`createWorkspace` → Remote unary → Host 端 `workspaceController` 推流 → client `ctx.workspaces.list` invalidation → 重新 push)
- 删除 workspace → 下拉框自动移除

## §3 排查清单

跑 `pnpm install` 后逐项验证:

1. `pnpm install --ignore-scripts`(Windows 上第一次可能慢,建议 WSL 或后台跑)
2. `pnpm run typecheck` —— 应**没有** §1 / §2 的语义错误,也没有 import 路径错误
3. `pnpm run test` —— `requirement-service` 套件如改 mock,需重新生成
4. `pnpm run build` —— `tsdown` 应该成功(store exemption 已删、INLINE_SAFE 已对齐 0.1.2)

如 IDE 报"找不到模块 `@deepseek-ai/dsh-api-workspace-controller`"或"`useWorkspaces` 找不到",说明 `pnpm install` 没完成或者 lockfile 没更新。

## §4 回滚预案

如果前端同事没时间迁移,需要先在 DSH 0.1.1-rc.1 跑 sky-axis 0.1.1:

```sh
git revert HEAD~N..HEAD  # 视具体 commit 数
# 或
pnpm install @deepseek-ai/dsh@0.1.1-rc.1 @deepseek-ai/dsh-client-runtime@0.1.1-rc.2 @deepseek-ai/dsh-host-apiproxy@0.1.1-rc.2 @deepseek-ai/cordis@^4.0.1
# 然后把 package.json#dsh.engines.dsh 改回 >=0.1.1-rc.1
# 把 inject 改回 [@deepseek-ai/dsh-client-runtime]
```

升级的语义断点全部受控,git revert + 改 2 行 package.json 即可降级到 0.1.1。

## §5 相关 sprint 跟踪

- 已有 TODO 列表(IDE 全局搜 `TODO(webload/`):
  - `TODO(webload/store-rehome)` — **0.1.2 已完成,本升级干掉**
  - `TODO(webload/api-proxy-migration)` — §1 范围,**已实现** —— `requirement-service.ts` 改为 follow 流订阅
  - `TODO(webload/workspace-hook-migration)` — §2 范围,client 半区 workspaceOps 走 React Context,**部分实现** —— 实际只能迁移"平台能力"(pickDirectory / createWorkspace)到 `WorkspaceOpsProvider` + `useWorkspaceOps()`;workspace **数据流**保留 cordis `ctx.workspaces.list.subscribe` 路径,因为 `useWorkspaces()` hook 是 framework slot-only API(详见 §2 关键决策)
- §1 / §2 完成后未释放的 0.1.2 工作:
  - `ctx.apiProxy.respond`(session controller respond) — `protocol.ts:405,482`、`InterventionQueuePane.tsx:10`、`protocol.ts:702` 仍引用,等 session controller sprint 单独迁移

## §6 Path-stable identity(Plan H)

### 背景

DSH plugin ≤ 0.1.1 把 `workspace.id`(DSH uuid)当作 on-disk 身份,写入 `mate.yaml` 并由 `ensureMeta` 严格 cross-check。DSH 删 + 重建同路径工作区是合法操作(DSH 给新 uuid),但 sky-axis 把这当数据完整性破坏,抛:

```
workspace meta conflict for <path>:
mate.yaml workspace.id (4ead1602-...) does not match
requested workspaceId (58766308-...) — workspace identity changed
```

修复策略:**sky-axis 的 on-disk 身份与 DSH uuid 解耦。`path` 是身份,DSH uuid 是 informational only**。

### Schema 变更

- [`src/host/workspace-meta.ts:60-70`](src/host/workspace-meta.ts#L60-L70) `WorkspaceSectionSchema.id` 改 `z.string().min(1).optional()`
- [`src/host/workspace-meta.ts:113-138`](src/host/workspace-meta.ts#L113-L138) `defaultWorkspaceMeta` 接受 optional `workspaceId`,不传时不写 `id` 字段
- [`src/host/workspace-meta.ts:317-403`](src/host/workspace-meta.ts#L317-L403) `ensureMeta` 签名 `workspaceId` 改 optional;**移除** line 358-364 的 id 严格 cross-check;refresh 分支保留/覆盖 id 的逻辑改为 `nextId = opts.workspaceId ?? existing.id`

### 行为变化

| 场景                                | Before Plan H              | After Plan H                |
|-------------------------------------|----------------------------|-----------------------------|
| path + id 都匹配                     | OK                         | OK                          |
| **path 匹配 + id 不同(uuid 轮换)**   | **throw cross-check-failed** | **OK(自动覆盖或保留)**       |
| path 不一致(mate.yaml 被拷到别的目录) | throw cross-check-failed   | throw cross-check-failed(不变)|

### 数据迁移

**无操作**。`workspace.id` 改为 zod `.optional()` 后,旧 mate.yaml(含 id 字段)继续 parse,无需任何改动文件。新默认 write 不写 id(除非 caller 显式传);已有 `workspace.id` 字段在 refresh 分支会被保留(若 caller 不传新 id)。

### caller 影响

- [`src/host/requirement-service.ts:1427-1478`](src/host/requirement-service.ts#L1427-L1478) `ensureWorkspaceBootstrap` 行为自动跟随 `ensureMeta` —— DSH uuid 轮换不再抛错,仅 path mismatch 抛 `yaml-write-failed`(错误文案改为 `workspace meta path conflict`)
- [`src/index.ts:240-264`](src/index.ts#L240-L264) 启动 effect 不变,继续传 `workspaceId` 给 `ensureMeta`(作为 informational trace)
- `Requirement.workspaceId` 字段不变 —— 继续记录创建时的 DSH uuid,客户端 UI 分组逻辑(`SkyAxisPage.tsx:139`、`RequirementsList.tsx:67-69`)照常工作
- `resolveWorkspacePath(workspaceId)` 缓存 miss 仍抛 `workspace-not-found`(见已知 follow-up)

### 单元测试变更

[`tests/workspace-meta.test.ts`](tests/workspace-meta.test.ts):

- 删除 `cross-check fail:workspaceId 不一致 → throws cross-check-failed`(原 line 205-212):行为不再可达
- 新增 6 个 `Plan H: path is the on-disk identity` 测试用例:
  1. `id mismatch 不再抛错` —— 新 uuid 覆盖旧 uuid
  2. `caller 不传 id 时保留已有 id`
  3. `caller 不传 id + 旧 mate.yaml 无 id → 也不写 id`
  4. `schema 容忍旧 mate.yaml 有 id 字段(向后兼容读)`
  5. `schema 容忍 v1 mate.yaml 无 workspace.id`
  6. `defaultWorkspaceMeta` 双向(传/不传 workspaceId)
- 首次调用测试新增 Plan H 变体(不传 id → YAML 中无 id)

测试结果:`workspace-meta.test.ts` 26 passed / 1 failed(后者是 Windows 平台 `chmod 0o000` 不阻止读,pre-existing 平台限制,与本改动无关)。

### 已知 follow-up(不在 §6 范围)

- **`resolveWorkspacePath` 缓存 miss fallback** —— DSH 删 + 重建后,旧 uuid 不在 `workspaceViewCache` 里,host 仍抛 `workspace-not-found`。短期靠"DSH 'baseline' 帧到达后再操作"规避;长期做"扫描 baseline paths 的 mate.yaml 找 orphan"或"DSH 提供 path-stable id(Plan K)"
- **UI 层 archived-orphaned 角标** —— 老需求(uuid-A)在新工作区下显示为"工作区已删除"占位符。后续可加 archived-orphaned badge 提示用户
- **DSH 提供 path-stable id(Plan K)** —— 如果 DSH 后续给 `workspace.id = hash(path)`,可以回填 `requirement.workspaceId` 让 uuid 重新稳定

## §7 导入需求 + path-1:1 强绑定(Plan I)

### 背景

Plan H 把 DSH uuid 解耦后,留下一个真实场景没法覆盖:**DSH 工作区删除 → 同路径重建(新 uuid) → 用户想再打开之前的需求**。

旧实现下,旧需求留在 mate.yaml 里(数据保留 OK),但 `requirement.workspaceId` 仍指向已删除的 DSH uuid,新的 DSH 工作区又没法"认领"它 —— 用户实际只能再开一份空需求,旧的就成了 archive 孤儿。

Plan I 解决这个闭环:**1:1 不变量从 `workspaceId → req` 收紧到 `workspacePath → req`,并引入"导入"主动动作把旧 req 重新归属到新 DSH workspace**。

### 核心改动

**Schema 变更** ([`src/protocol.ts`](src/protocol.ts)):

- 新增 `requirement-already-exists-at-path` 错误码(HTTP 409)—— host 端 path-based 1:1 冲突时抛
- 新增 `ImportRequirementSchema = { workspaceId: WorkspaceIdSchema }` —— 仅传 workspaceId(plan 由 host 端 `resolveWorkspacePath` 推导)
- 新增 `SkyAxisEndpoints.requirementImport = /api/sky-axis/requirements/import`
- `RequirementSchema.workspaceId` 注释从「immutable」改为「Plan I 起 import 时可变(owner 切换)」

**Host 服务端** ([`src/host/requirement-service.ts`](src/host/requirement-service.ts)):

- `create()` 的 1:1 校验从 `findRequirementByWorkspace(workspaceId)` 改为 `findExistingRequirementAtPath(workspacePath)` —— 同一 path 已有 req 时拒绝并提示走 import
- file lock 内做 TOCTOU 二次 check(防并发 race)
- 新增 `importRequirement(workspacePath, currentWorkspaceId)`:
  - path 上无 req → 抛 `requirement-not-found`
  - path 上 ≥ 2 req(强约束被破坏) → 抛 `invalid-record`,提示人工清理
  - path 上 1 req → 改写 `workspaceId = currentWorkspaceId` + 刷新 `updatedAt`,其他字段(标题/描述/PRD/附件/源码仓库/产物/AI 状态)**全保留**
  - 同步更新 `requirementWorkspaceIndex` + 发 `DomainChanged { op: 'put' }` 事件 → SSE 推到 client

**Host 路由** ([`src/host/routes/requirements.ts`](src/host/routes/requirements.ts)):

- 新增 `POST /api/sky-axis/requirements/import` 路由
- `mapStatus` 加 `requirement-already-exists-at-path → 409` case

**Client 传输层** ([`src/client/api/requirement-client.ts`](src/client/api/requirement-client.ts)):

- 新增 `import(input: ImportRequirement): Promise<Result<Requirement>>` —— 对称 `create()`,客户端 zod 预校验 + POST fetch

**Controller** ([`src/client/controller/sky-axis-controller.ts`](src/client/controller/sky-axis-controller.ts)):

- 接口加 `importRequirement({ workspaceId })`
- deps 加 `importImpl`,`createSkyAxisController` factory 由 caller 注入
- 错误码联合加 `requirement-already-exists-at-path`
- `importRequirement` 实现:乐观更新 `snapshot.requirements`(按 id 替换,避免误删同时存在的 placeholder / 跨 workspace 历史 view)→ 返回 `{ ok, id }`

**UI 智能切换** ([`src/client/page/sections/NewRequirementModal.tsx`](src/client/page/sections/NewRequirementModal.tsx)):

- 双触发检测切到「导入模式」:
  1. **主动**:`takenByWorkspaceId.get(selectedWorkspaceId)` 命中(同 uuid 已占)
  2. **兜底**:submit 后 host 返 `requirement-already-exists-at-path`(DSH uuid 变了,takenByWorkspaceId 按 uuid 索引抓不到,但 host 端 path-based 1:1 检查会拦下)
- 「导入模式」UI 变化:
  - 标题改 `requirement.import.title`(导入已存在的需求)
  - 顶部 warning banner(若 `taken` 命中,展示需求标题 + 创建时间;否则展示通用提示)
  - 表单字段全 disabled(workspace / title / description / priority / tags)
  - 「创建」按钮改「导入」按钮(type=button + onClick,不走 form submit)
- 「导入模式」点击 → parent(SkyAxisPage)调 `controller.importRequirement` → 成功后关闭 modal + 跳详情页

**i18n** ([`src/client/locales.ts`](src/client/locales.ts)):

- 新增 zh + en 文案:导入模式标题、检测 banner、帮助说明、按钮文案、错误码翻译

### 行为变化

**老用户视角(0.1.1)**:
- DSH 工作区 A 创建需求 R1 → 一切正常
- DSH 删 A → sky-axis 数据保留(Plan H 行为)
- DSH 在同路径创建工作区 B(uuid-B ≠ uuid-A)
- 用户进 sky-axis 点「+ 新建需求」→ 看到一个干净的弹窗,能填表,提交 → **创建第二条需求 R2**(workspaceId=B),R1 留在 mate.yaml 里成孤儿

**新用户视角(0.1.2 + Plan I)**:
- 同上前 4 步
- 用户进 sky-axis 点「+ 新建需求」→ **弹窗顶部黄色 banner**:
  > 此工作区已有需求「R1」(创建于 2026-09-08T03:21:00Z)。是否导入?
  - 表单字段全 disabled
  - 按钮文案「创建」→「导入」
- 用户点「导入」→ 改写 R1.workspaceId=B + updatedAt 刷新,R1 的 PRD/附件/源码仓库/产物/AI 状态/branch 全部保留
- 弹窗关闭,自动跳 R1 详情页 → 用户继续正常工作

### 数据迁移

**无需迁移**。Plan I 不动旧数据:
- 老 1:1 不变量下产生的「同 uuid 占位」需求自然兼容(Plan H 已经把 uuid 解耦了)
- 老「DSH 删 + 重建」产生的孤儿需求(path 已占位)→ 用户主动走 import 流程认领
- 极端情况:同一 path 已存在 ≥ 2 个需求(强约束被破坏,Plan H 之前的脏数据) → `importRequirement` 抛 `invalid-record`,UI 提示「数据异常,请联系管理员清理」(后续可加 UI 引导人工 del 一条)

### caller 影响

**外部 caller**: 无 —— error code 是新增,旧有 code 没改名;`RequirementSchema.workspaceId` 注释放宽(从「immutable」→「可变」),但 zod schema 没改,旧客户端可以正常读写。

**内部 caller**:
- `workspace-uniqueness.ts` 的 `findRequirementByWorkspace` 仍保留(给 `findDuplicateWorkspaceGroups` 诊断用),只是 `create()` 不再调它
- `sky-axis-controller.ts#createRequirement` 失败时,新错误码 `requirement-already-exists-at-path` 自动透传到 `submitError`,无需 controller 层特殊处理

### 单元测试变更

- 新增 4 个 `RequirementClient.import` 测试用例:
  1. 成功:返回 item + 路径是 `/import`
  3. 客户端预校验失败:workspaceId 空串 → `validation-failed` 不发 fetch
  4. 服务端抛 `requirement-not-found` → 透传 code(DSH 工作区路径上无 req)
  5. 服务端抛 `invalid-record` → 透传 code(数据脏)
- 新增 3 个 `findExistingRequirementAtPath` 测试用例:
  1. path 上无 req(mate.yaml 不存在)→ 返回 undefined
  2. path 上有 1 条 req → 返回该 req
  3. path 上有 ≥ 2 条 req(强约束被破坏)→ 返回第一条(由 caller 报错 / 人工清理)
- `protocol.test.ts`: `SKY_AXIS_ERROR_CODES` 计数 26 → 27,稳定集合新增 `requirement-already-exists-at-path`

### 已知 follow-up(不在 §7 范围)

- **批量化导入** —— 一次导入一个 path 的 req。后续如需支持「一个 DSH 工作区包含多个老 workspace 的需求」再加
- **跨 path 迁移** —— 改 path 需要物理移动 `.sky-axis/` 目录,放后续
- **DSH shell 级别的「自动 re-attach workspace」** —— DSH 重建时自动调 sky-axis import;目前 DSH 不知 sky-axis 存在,留接口扩展点
- **UI 上的「老需求在新工作区下显示」角标(archived-orphaned)** —— Plan H follow-up #2 简化掉:Plan I 把"导入"做成主动动作,角标可后续简化

## 参考

- 审计报告:[`tmp/0.1.1rc1-to-0.1.2rc1/UPGRADE-ADAPTATION.md`](tmp/0.1.1rc1-to-0.1.2rc1/UPGRADE-ADAPTATION.md)
- Facade 详细对比:[`tmp/facade-scan.md`](tmp/facade-scan.md)
- 0.1.2 真实类型(已 pack 解压到 `tmp/b/`):
  - [`tmp/b/api-workspace-controller/package/lib/types/index.d.ts`](tmp/b/api-workspace-controller/package/lib/types/index.d.ts) — `WorkspaceController` 完整 API
  - [`tmp/b/client-ui-workspace/package/lib/types/client/index.d.ts`](tmp/b/client-ui-workspace/package/lib/types/client/index.d.ts) — `useWorkspaces` hook 来源
  - [`tmp/b/client-ui-session/package/lib/types/client/index.d.ts`](tmp/b/client-ui-session/package/lib/types/client/index.d.ts) — `useSession` / `useProjection` hook 来源
  - [`tmp/b/web-app/package/cordis.patch.yml`](tmp/b/web-app/package/cordis.patch.yml) — shipped web profile 浏览器侧行清单(看 ui-* row 真实配置)