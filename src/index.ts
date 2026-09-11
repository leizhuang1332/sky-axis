/**
 * Host loader entry —— sky-axis 插件 host 半区入口。
 *
 * Phase 0：注册两个调试端点（ping / health）验证双半区联通。
 * Phase 1：注册 Requirement CRUD + SSE 路由，host 端持久化到 storage domain，
 *          校验 workspace 真实存在并预创建产物根目录。
 *
 * 装配流程：
 *   1. 构造 RequirementHostService —— 后台异步打开 storage domain
 *   2. ctx.effect 内注册 webServer routes（list / create / delete / SSE / workspaces）
 *   3. 注册 ping / health 调试端点（保留 Phase 0）
 *   4. effect disposer 清理 routes + 关闭 service
 *
 * Sprint 2 增量（工作区目录结构改造）：
 *   - 启动期异步遍历 workspace 列表 → ensureMeta() 写 `.sky-axis/mate.yaml`
 *     - 失败 console.warn，不阻塞 webServer
 *
 * 现有 client 半区（src/client/index.ts）保持不变 —— 它仍负责 sidebar 挂载
 * 与中心列整页渲染，与本文件并行工作。Phase 1 引入持久化与 workspace 集成。
 *
 * 后续 Phase 2+ 将追加：
 *   - list 分页 / 索引
 *   - 需求-会话绑定（让 LLM 在 sky-axis workspace 内执行任务）
 *   - 产物上传接口
 */
import type { Context } from '@deepseek-ai/cordis'
// 类型合并：声明 ctx.webServer / ctx.workspaceController / ctx.storageDomain 可用
//
// 0.1.2 迁移说明(dsh-upgrade-audit 报告 §2.2):
//   - `@deepseek-ai/dsh-host-apiproxy` 整体被拆为 controller 包,
//     没有对应的 ambient module augmentation 可 import —— 各 controller
//     自带 `declare module '@deepseek-ai/cordis'` 块,只要 import 它们的入口
//     类型即可让 TS 看到 ctx.workspaceController 等
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mountOnce } from './host/shared/mount-once.ts'
import { SkyAxisPingService } from './host/ping-service.ts'
import { RequirementHostService } from './host/requirement-service.ts'
import { makeRequirementRoutes } from './host/routes/requirements.ts'
import { makeMaterialRoutes } from './host/routes/materials.ts'
import { makeArtifactRoutes } from './host/routes/artifacts.ts'
import {
  ensureMeta,
  WorkspaceMetaError,
} from './host/workspace-meta.ts'
import { ensureInputsLayout } from './host/requirement-service.ts'
import { createFsWatcherManager, type FsWatcherManager } from './host/fs-watcher-manager.ts'
import { migrateLegacyRequirements } from './host/migration/requirement-migration.ts'
import {
  SkyAxisEndpoints,
  type PingResponse,
  type HealthResponse,
  type WorkspaceId as SkyAxisWorkspaceId,
} from './protocol.ts'

/**
 * 显式依赖 webServer / workspaceController / storageDomain 服务
 * （cordis 会等这些服务先初始化）。
 *
 * 0.1.2 迁移说明(dsh-upgrade-audit 报告 §2.2 / §4.4):
 *   - `apiProxy` row id 在 0.1.2 已不存在 —— 原 ApiProxy 聚合服务被拆为
 *     `@deepseek-ai/dsh-api-session-controller` / `dsh-api-workspace-controller`
 *     / `dsh-api-settings-controller` 等独立 controller,session / settings /
 *     workspace 命令面分别接管各自的 ctx 属性
 *   - sky-axis 当前唯一用到的 host-side api 是 workspace 相关(list /
 *     解析 workspaceId),换成 `workspaceController` 即可
 *   - `storageDomain` 在 0.1.2 仍然存在(报告 §4.7 —— 类型导出与运行时
 *     完全兼容),继续保留
 *   - 启动 bootstrap 改等 `reqSvc.whenBaselineReady()` 拿首帧 baseline(由
 *     `startWorkspaceFollow()` 订阅 `ctx.workspaceController.follow(signal)` 流驱动)
 *     详见 UPGRADE-MIGRATION-GUIDE.md §1
 */
/**
 * 接入 0 前置探测：临时加 `'sessionController'` 用于一次性探测 host 端
 * ctx.sessionController 就绪情况（DSH 框架是否已注册 SessionController host provider）。
 * ⚠️ 与 client 端 `ctx.sessions` 不同——sessionController 是 host 半区 service，
 *   static inject 含 agentDefaultModel/agents/llm/typert 等 9 个框架级服务，
 *   就绪门槛更高。探测 effect 全程 try/catch，trap 不传播进主流程。
 *   探测结论决定接入 0（ensureSession + agentPreset 注册）能否动手。
 *   详见 docs/ai工作台接入dsh-agent-session-架构预览.md §3 节点1 + §5 接入0。
 */
export const inject = ['webServer', 'workspaceController', 'storageDomain', 'sessionController']

/**
 * sky-axis 插件自身版本（写入 `.sky-axis/mate.yaml` 的 skyAxis.version 字段）。
 *
 * Sprint 2 决策：hardcode 同步 package.json 的 `version` 字段。后续若要做
 * 自动化注入（vite define / tsdown banner），改这一处常量即可。
 */
const SKY_AXIS_PLUGIN_VERSION = '0.1.0'

/** 写 JSON 响应的 helper（host routes 复用）。 */
function jsonResponse(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * 进程级 safety net —— 把崩溃日志化、不让 DSH 进程被我们拖死。
 *
 * DSH 是单进程宿主（一个 Node 进程跑所有插件 + GUI 壳），
 * sky-axis 的任何未捕获 promise rejection / 异常若不带 listener，
 * 会顺着 Node 默认行为把整个 host 拉死。**只 console.error，不
 * `process.exit()`** —— 退出权限属于 DSH 宿主，本插件无权决定。
 *
 * 用 module-level guard 防 mountOnce 重入导致重复注册。
 */
let safetyNetInstalled = false
function installSafetyNet(): void {
  if (safetyNetInstalled) return
  safetyNetInstalled = true
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('[sky-axis] uncaughtException at', new Date().toISOString(), err)
  })
  process.on('unhandledRejection', (reason) => {
    // eslint-disable-next-line no-console
    console.error('[sky-axis] unhandledRejection at', new Date().toISOString(), reason)
  })
}

export const apply = mountOnce('@leizhuang/sky-axis', (ctx: Context): void => {
  installSafetyNet()
  const pingSvc = new SkyAxisPingService()
  // eslint-disable-next-line no-console
  console.info('[sky-axis] host apply: pid=' + process.pid + ' ready (Phase 2.5 + safety-net)')

  // 接入 0 前置探测：一次性探 ctx.sessionController 是否就绪（不进主流程）。
  //   依据 docs/ai工作台接入dsh-agent-session-架构预览.md §3 节点1 + §5 接入0：
  //   sessionController 是 host 半区 service，static inject 含 9 个框架级服务
  //   (agentDefaultModel/agents/llm/typert/...)，就绪门槛比 client ctx.sessions 高。
  //   全程 try/catch + 独立 effect，trap 不传播；只读探测（不调 create/prompt——
  //   写操作会真起 session）。探测结论决定 ensureSession + agentPreset 能否动手。
  ctx.effect(() => {
    const tag = '[sky-axis:probe:sessionController]'
    try {
      const sc = (ctx as unknown as {
        sessionController?: {
          create?: (req?: unknown) => Promise<unknown>
          list?: (req?: unknown) => Promise<unknown>
        }
      }).sessionController
      if (sc === undefined) {
        // eslint-disable-next-line no-console
        console.info(tag, 'ctx.sessionController = undefined (DSH 框架未注册 host provider)')
        return () => {}
      }
      // eslint-disable-next-line no-console
      console.info(tag, 'ctx.sessionController 存在，keys =', Object.keys(sc))
      // 只读探 list（冷读，不建 session）；create 是写操作，不在此探。
      void (async () => {
        try {
          const res = await sc.list?.({})
          // eslint-disable-next-line no-console
          console.info(tag, 'sessionController.list() ok → host 端 session 就绪，接入 0 可动手。result =', res)
        } catch (e) {
          // eslint-disable-next-line no-console
          console.info(tag, 'sessionController.list() 失败（框架级服务未全就绪?）:', (e as Error).message)
        }
      })()
    } catch (e) {
      // 若抛 "cannot get property 'sessionController' without inject" → inject 未生效
      // eslint-disable-next-line no-console
      console.info(tag, 'ctx.sessionController 探测抛错（cordis trap? inject 未生效?）:', (e as Error).message)
    }
    return () => {}
  }, 'sky-axis: probe sessionController (one-shot)')

  // 接入 0 前置探测 #2：一次性探 ctx.agentPresets 是否可用（不进主流程）。
  //   agent 调查结论：DSH 的 agentPreset 是文件系统驱动的（目录= preset，
  //   agent.cordis.yml = 组合文件），注册中心是 ctx.agentPresets，但
  //   sky-axis 既没显式依赖 dsh-agent-presets 包，也没 cordis composition
  //   mount 它。本探测确认 DSH 宿主运行时是否已 mount 该 plugin。
  //   - 用 ctx.get('agentPresets')（同 DSH 内部 composeAgent 的访问方式），
  //     不走属性访问（避免不在 inject 数组时的 cordis Proxy trap）。
  //   - 只读探 list()（列出 shipped preset）；不调 copy/remove（写操作）。
  //   探测结论决定 sky-axis-collaborator preset 的注册路径：
  //     - ctx.agentPresets = undefined → create 走 fallback（无自定义 preset）
  //       → 接入 0 可先用 fallback 起步，preset 注册后续解决
  //     - ctx.agentPresets 存在 → 看有无 sky-axis-collaborator，没有则走 copy('standard',...)
  ctx.effect(() => {
    const tag = '[sky-axis:probe:agentPresets]'
    try {
      // ctx.get() 不受 inject 数组约束（cordis root ctx 的 service registry 直查），
      // 比 ctx.agentPresets 属性访问更安全。
      const ap = (ctx as unknown as {
        get?: (name: string) => unknown
      }).get?.('agentPresets') as {
        list?: () => Promise<unknown>
        resolve?: (id?: string) => Promise<unknown>
        defaultId?: string
      } | undefined
      if (ap === undefined) {
        // eslint-disable-next-line no-console
        console.info(tag, 'ctx.agentPresets = undefined (dsh-agent-presets 未 mount) → create 将走 fallback，接入 0 可先无 preset 起步')
        return () => {}
      }
      // eslint-disable-next-line no-console
      console.info(tag, 'ctx.agentPresets 存在，defaultId =', ap.defaultId, '，keys =', Object.keys(ap))
      void (async () => {
        try {
          const res = await ap.list?.()
          // eslint-disable-next-line no-console
          console.info(tag, 'agentPresets.list() ok，可用 preset =', res)
        } catch (e) {
          // eslint-disable-next-line no-console
          console.info(tag, 'agentPresets.list() 失败:', (e as Error).message)
        }
      })()
    } catch (e) {
      // eslint-disable-next-line no-console
      console.info(tag, 'ctx.agentPresets 探测抛错:', (e as Error).message)
    }
    return () => {}
  }, 'sky-axis: probe agentPresets (one-shot)')

  // 接入 0 前置探测 #3：agent 框架级服务（agentDefaultModel / agents / llm）。
  //   端到端验证发现：DGH sessionController 已能接收 create 调用，但内部 ctx.agents.create
  //   会调 agentDefaultModel.currentSelection() —— 如果宿主没注册 agentDefaultModel（或
  //   provider 未配置），create 可能永远不 resolve，导致 POST /ai/start 空白。
  //   用 ctx.get()（cordis root ctx service registry）依次探测 3 个服务：
  //     - agentDefaultModel: get currentSelection 是否能拿到 {provider, model}
  //     - agents: service 是否注册（不能直接创 session，但能探 keys）
  //     - llm: provider 注册表（不查具体 provider，只查 service 在不在）
  //   探测结论直接打印到控制台，作为「30s 超时后该告诉用户什么」的依据。
  ctx.effect(() => {
    const tag = '[sky-axis:probe:agent-framework]'
    try {
      const ctxGet = (ctx as unknown as { get?: (name: string) => unknown }).get
      if (ctxGet === undefined) {
        console.info(tag, 'ctx.get() unavailable, skipping agent framework probe')
        return () => {}
      }
      // (a) agentDefaultModel —— create session 真正依赖的服务
      const adm = ctxGet('agentDefaultModel') as
        | { currentSelection?: () => { provider?: string; model?: string } }
        | undefined
      if (adm === undefined) {
        console.info(tag, 'ctx.agentDefaultModel = undefined → create session 会挂起（无 model provider）')
      } else {
        try {
          const sel = adm.currentSelection?.()
          console.info(tag, 'ctx.agentDefaultModel 存在，currentSelection =', sel)
          if (sel === undefined || (sel.provider === undefined && sel.model === undefined)) {
            console.info(tag, '⚠️  agentDefaultModel.currentSelection() 返回空 → LLM provider 未配置')
          }
        } catch (e) {
          console.info(tag, 'agentDefaultModel.currentSelection() 抛错:', (e as Error).message)
        }
      }
      // (b) agents —— session 实例的 runtime 容器
      const agents = ctxGet('agents') as { get?: (id: string) => unknown } | undefined
      if (agents === undefined) {
        console.info(tag, 'ctx.agents = undefined → create 会失败 (RemoteError: agents service not registered)')
      } else {
        console.info(tag, 'ctx.agents 存在，keys =', Object.keys(agents))
      }
      // (c) llm —— provider 注册表
      const llm = ctxGet('llm') as { list?: () => Promise<unknown> | unknown; resolve?: (id: string) => unknown } | undefined
      if (llm === undefined) {
        console.info(tag, 'ctx.llm = undefined → no provider registry')
      } else {
        console.info(tag, 'ctx.llm 存在，keys =', Object.keys(llm))
        try {
          const list = llm.list?.()
          if (list instanceof Promise) {
            void list.then((res) => console.info(tag, 'llm.list() ok →', res)).catch((e: Error) =>
              console.info(tag, 'llm.list() 失败:', e.message),
            )
          } else if (list !== undefined) {
            console.info(tag, 'llm.list() =', list)
          }
        } catch (e) {
          console.info(tag, 'llm.list() 抛错:', (e as Error).message)
        }
      }
    } catch (e) {
      console.info(tag, '探测抛错（cordis trap?）:', (e as Error).message)
    }
    return () => {}
  }, 'sky-axis: probe agent framework (one-shot)')

  // 业务服务:Sprint 5 起不再依赖 storage domain,数据走 `<workspace>/.sky-axis/mate.yaml`
  //
  // 0.1.2 迁移:`ctx.apiProxy` 已不存在;原 ApiProxy 聚合服务拆为多个 controller,
  // sky-axis 当前只需要 workspace 相关,这里直接传 `ctx.workspaceController`。
  // service 内部 cache 由 `startWorkspaceFollow()` 订阅的 follow 流维护。
  //
  // 接入 0-1：第三参数 ctx.sessionController —— ensureSession 用它 create DSH
  //   session（standard preset）。inject 数组已含 'sessionController'（见文件头）。
  const reqSvc = new RequirementHostService(ctx, ctx.workspaceController, ctx.sessionController)
  const requirementRoutes = makeRequirementRoutes(reqSvc)
  // Phase 2.5：物料 CRUD 路由（18 个 exact route，6 section × 3 op）
  const materialRoutes = makeMaterialRoutes(reqSvc)
  // Sprint 4：artifact 落盘路由（5 个 exact route，1 op × 5 kind）
  //   - 默认不写：当前 client / controller 未接入,等价于不可达
  const artifactRoutes = makeArtifactRoutes(reqSvc)

  // Sprint 5：fs-watch 监听所有 workspace 的 `.sky-axis/mate.yaml` 变更。
  // - 单 manager 跨多个 workspace(去重)
  // - effect disposer 时 stopAll
  const watcherMgr: FsWatcherManager = createFsWatcherManager()

  // 0.1.2:在 effect 内启动 follow 流订阅 —— 必须在 routes 注册之后立即
  // 启动,这样 routes effect 内嵌的 IIFE 等 `whenBaselineReady()` 才能
  // 拿到首帧。effect dispose 时 `reqSvc.close()` 会 abort 内部流。
  //
  // 注意:这里不传 signal 给 startWorkspaceFollow —— service 内部持有
  // 一个 AbortController,effect dispose 时通过 `reqSvc.close()` 间接
  // 触发 abort,避免把 effect signal 直接暴露给 service 内部细节。
  ctx.effect(() => {
    reqSvc.startWorkspaceFollow()
    return () => {
      void reqSvc.close()
    }
  }, 'sky-axis: subscribe workspace follow stream')

  ctx.effect(() => {
    const disposers: (() => void)[] = [
      ctx.webServer.register({
        kind: 'exact',
        path: SkyAxisEndpoints.ping,
        handler: (req: IncomingMessage, res: ServerResponse): void => {
          if (req.method !== 'GET') {
            jsonResponse(res, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          jsonResponse(res, 200, pingSvc.ping() satisfies PingResponse)
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: SkyAxisEndpoints.health,
        handler: (req: IncomingMessage, res: ServerResponse): void => {
          if (req.method !== 'GET') {
            jsonResponse(res, 405, { ok: false, error: 'method-not-allowed' })
            return
          }
          jsonResponse(res, 200, pingSvc.health() satisfies HealthResponse)
        },
      }),
    ]
    for (const route of requirementRoutes) {
      disposers.push(ctx.webServer.register(route))
    }
    for (const route of materialRoutes) {
      disposers.push(ctx.webServer.register(route))
    }
    for (const route of artifactRoutes) {
      disposers.push(ctx.webServer.register(route))
    }

    // Phase 2.6 v2：host 启动后等 storage domain ready,扫一遍历史孤儿目录清理
    //   - 不阻塞 webServer 注册(以上 routes 已挂上,addSourceRepo 可立刻接收)
    //   - 失败 console.warn,不影响主流程
    void (async (): Promise<void> => {
      const result = await reqSvc.cleanupOrphanRepos()
      if (result.removed.length > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[sky-axis] startup orphan cleanup: scanned=${result.scanned} removed=${result.removed.length}`,
          result.removed,
        )
      }
    })()

    // 1:1 workspace-requirement 不变量自检 —— 检测升级前产生的脏数据
    //   - 仅 console.error 列出冲突,不抛、不删（数据完整性责任归用户）
    //   - UI 层 (RequirementsList) 会按 workspace 分组时自动展示红框警示
    void (async (): Promise<void> => {
      const violations = await reqSvc.findDuplicateWorkspaceRequirements()
      if (violations.length > 0) {
        // eslint-disable-next-line no-console
        console.error(
          `[sky-axis] workspace-requirement 1:1 invariant violated: ${violations.length} workspaces have >1 requirement`,
          violations.map(group => ({
            workspaceId: group[0]?.workspaceId ?? '<unknown>',
            requirements: group.map(r => ({ id: r.id, title: r.title, status: r.status })),
          })),
        )
      }
    })()

    // Sprint 2：启动期异步遍历 workspace 列表 → ensureMeta() 写 `.sky-axis/mate.yaml`
    // Sprint 3 增量：同一遍历中 mkdir inputs/{prd,attachment} 空目录占位，
    //   保证 UI 上传物料时 lazy mkdir 不需要处理「目录不存在」分支。
    //   - 不阻塞 webServer 注册(ensureMeta 失败 console.warn 不抛)
    //   - 失败分两类：
    //       a) `missing` 之外（invalid / cross-check-failed / io-failed）→ 提示用户手动修
    //       b) workspace-list 自身失败 → 跳过本轮,下次启动再试
    //
    // Sprint 5 接线:ensureMeta 成功后:
    //   1. fs-watcher-manager.watch 该 workspace,onChange 桥接到 reqSvc.onWorkspaceMateYamlChanged
    //   2. migration:把 storage domain 残留记录搬到 mate.yaml(只跑一次)
    //   3. refresh snapshots:让 fs.watch diff 有 baseline
    //
    // 0.1.2 迁移:workspace 列表不再由一次性 RPC 拉取,改由
    // `reqSvc.startWorkspaceFollow()` 订阅 `ctx.workspaceController.follow(signal)` 流;
    // 首帧 baseline 到达后 `whenBaselineReady()` resolve。本 IIFE 等这个 promise,
    // 取到 WorkspaceView[] 后再做 ensureMeta + fs-watch 等耗时操作。
    // 流订阅本身在 routes 注册之后立刻启动(下一个独立 effect),
    // 这样 baseline 到的瞬间 bootstrap 即可启动,不必额外 await routes。
    void (async (): Promise<void> => {
      const views = await reqSvc.whenBaselineReady()
      const now = new Date().toISOString()
      const bootstrappedPaths: string[] = []
      let succeeded = 0
      let failed = 0
      for (const view of views) {
        const workspaceId = view.workspaceId as unknown as SkyAxisWorkspaceId
        try {
          // Plan H:workspaceId 是 informational —— 写入 mate.yaml.workspace.id
          // 作为日志/调试 trace;不同 uuid 但同 path 不会让 ensureMeta 抛错。
          // path 是 on-disk 唯一身份。
          await ensureMeta(view.path, {
            workspaceId,
            workspaceTitle: view.title !== '' ? view.title : '',
            skyAxisVersion: SKY_AXIS_PLUGIN_VERSION,
            now,
          })
          // Sprint 3：mkdir inputs/{prd,attachment} —— 复用用户已有目录(决策 3)
          await ensureInputsLayout(view.path)
          bootstrappedPaths.push(view.path)
          succeeded += 1
        } catch (e) {
          failed += 1
          const code = e instanceof WorkspaceMetaError ? e.code : 'unknown'
          // eslint-disable-next-line no-console
          console.warn(
            `[sky-axis] ensureMeta failed for workspace ${workspaceId} (${view.path}): ` +
            `${code}: ${(e as Error).message}`,
          )
        }
      }
      if (succeeded > 0 || failed > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[sky-axis] workspace bootstrap: succeeded=${succeeded} failed=${failed} ` +
          `(mate.yaml + inputs/)`,
        )
      }

      // 2. fs-watcher-manager:对每个 bootstrapped workspace 监听 mate.yaml
      //    onChange 桥接到 reqSvc 触发 diff emit;created/modified/deleted/reconnected 都处理
      const watchDisposers: (() => void)[] = []
      for (const wsPath of bootstrappedPaths) {
        const unsub = watcherMgr.watch(wsPath, {
          onChange: (event) => {
            if (event.kind === 'modified') {
              // 外部(非 sky-axis)修改了 mate.yaml → diff 同步 emit
              void reqSvc.onWorkspaceMateYamlChanged(wsPath).catch(e => {
                // eslint-disable-next-line no-console
                console.warn(`[sky-axis] fs.watch diff(${wsPath}) failed:`, e)
              })
            } else if (event.kind === 'deleted') {
              // .sky-axis/ 目录被 rm -rf → 视为该 workspace 全部 requirement 消失
              reqSvc.onWorkspaceMetaDeleted(wsPath)
            }
            // created / reconnected 不需要 emit(空 section / 已经同步)
          },
          onError: (err) => {
            // eslint-disable-next-line no-console
            console.warn(`[sky-axis] fs-watcher error for ${wsPath}:`, err)
          },
        })
        watchDisposers.push(unsub)
      }
      // 把 watch disposers 收进 disposers(让 effect disposer 清理)
      disposers.push(() => {
        for (const d of watchDisposers) d()
        watcherMgr.stopAll()
      })

      // 3. migration:storage domain → mate.yaml 一次性搬迁
      try {
        const mig = await migrateLegacyRequirements(ctx, reqSvc)
        if (mig.migrated > 0 || mig.failed > 0 || mig.duplicates > 0 || mig.skipped !== '') {
          // eslint-disable-next-line no-console
          console.info(
            `[sky-axis] legacy migration: migrated=${mig.migrated} ` +
            `failed=${mig.failed} duplicates=${mig.duplicates} ` +
            `remainingInStorage=${mig.remainingInStorage}` +
            (mig.skipped !== '' ? ` skipped=${mig.skipped}` : ''),
          )
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[sky-axis] legacy migration aborted:', e)
      }

      // 4. refresh per-workspace snapshot —— 让 fs.watch 首次 diff 有 baseline
      //    (本进程自写入的 req 不被误判为外部修改)
      try {
        await reqSvc.refreshRequirementSnapshots()
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[sky-axis] refreshRequirementSnapshots failed:', e)
      }

      // 5. 接入 0-1：bootstrap 恢复 AI session follow 流。
      //    场景：host 重启（DSH 升级 / crash 恢复）时，已绑定 aiSessionId 的
      //    requirement 需要重新挂 follow 流，否则 session 在跑但 sky-axis 收不到
      //    turn 事件 → aiState 停在 'running' 不再更新。
      //    幂等：startFollow 内部用 followControllers Map 去重；session 已结束
      //    的 follow 流会自然 return，consumeSessionFollow 兜底置 idle。
      //    只恢复 aiState='running' 的 requirement —— idle 的说明上次 turn 已结束，
      //    无需挂流（下次用户点启动会重新 ensureSession + startFollow）。
      try {
        const requirements = await reqSvc.list()
        const runningReqs = requirements.filter(r => r.aiSessionId !== undefined && r.aiSessionId !== null && r.aiState === 'running')
        for (const r of runningReqs) {
          try {
            reqSvc.startFollow(r.id)
            // eslint-disable-next-line no-console
            console.info('[sky-axis] bootstrap: restored follow for requirement', r.id, 'session', r.aiSessionId)
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[sky-axis] bootstrap: startFollow failed for requirement', r.id, ':', (e as Error).message)
          }
        }
        if (runningReqs.length > 0) {
          // eslint-disable-next-line no-console
          console.info('[sky-axis] bootstrap: restored follow for', runningReqs.length, 'running AI session(s)')
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[sky-axis] bootstrap: AI session follow restore failed:', e)
      }
    })()

    return () => {
      for (const d of disposers) d()
      // reqSvc.close() 现在由独立的 'sky-axis: subscribe workspace follow stream' effect
      // 负责 —— 它在 routes effect 之前启动(LIFO dispose 顺序保证 close 在 routes 之后),
      // 这里省略避免重复调用。
    }
  }, 'sky-axis: register ping/health/requirements routes')
})
