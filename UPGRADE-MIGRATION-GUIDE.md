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

## 参考

- 审计报告:[`tmp/0.1.1rc1-to-0.1.2rc1/UPGRADE-ADAPTATION.md`](tmp/0.1.1rc1-to-0.1.2rc1/UPGRADE-ADAPTATION.md)
- Facade 详细对比:[`tmp/facade-scan.md`](tmp/facade-scan.md)
- 0.1.2 真实类型(已 pack 解压到 `tmp/b/`):
  - [`tmp/b/api-workspace-controller/package/lib/types/index.d.ts`](tmp/b/api-workspace-controller/package/lib/types/index.d.ts) — `WorkspaceController` 完整 API
  - [`tmp/b/client-ui-workspace/package/lib/types/client/index.d.ts`](tmp/b/client-ui-workspace/package/lib/types/client/index.d.ts) — `useWorkspaces` hook 来源
  - [`tmp/b/client-ui-session/package/lib/types/client/index.d.ts`](tmp/b/client-ui-session/package/lib/types/client/index.d.ts) — `useSession` / `useProjection` hook 来源
  - [`tmp/b/web-app/package/cordis.patch.yml`](tmp/b/web-app/package/cordis.patch.yml) — shipped web profile 浏览器侧行清单(看 ui-* row 真实配置)