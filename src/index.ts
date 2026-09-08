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
// 类型合并：声明 ctx.webServer / ctx.apiProxy / ctx.storageDomain 可用
import type {} from '@deepseek-ai/dsh-host-apiproxy'
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
import { skyAxisRequest } from './host/rpc-helper.ts'
import { createFsWatcherManager, type FsWatcherManager } from './host/fs-watcher-manager.ts'
import { migrateLegacyRequirements } from './host/migration/requirement-migration.ts'
import {
  SkyAxisEndpoints,
  type PingResponse,
  type HealthResponse,
  type WorkspaceId as SkyAxisWorkspaceId,
} from './protocol.ts'

/** 显式依赖 webServer / apiProxy / storageDomain 服务（cordis 会等这些服务先初始化）。 */
export const inject = ['webServer', 'apiProxy', 'storageDomain']

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

  // 业务服务：Sprint 5 起不再依赖 storage domain,数据走 `<workspace>/.sky-axis/mate.yaml`
  const reqSvc = new RequirementHostService(ctx, ctx.apiProxy)
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
    void (async (): Promise<void> => {
      const response = await ctx.apiProxy.workspace.list(skyAxisRequest({}))
      if (!response.result.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[sky-axis] workspace list failed; skipping mate.yaml bootstrap: ` +
          `${response.result.error.code}: ${response.result.error.message}`,
        )
        return
      }
      const now = new Date().toISOString()
      const bootstrappedPaths: string[] = []
      let succeeded = 0
      let failed = 0
      for (const item of response.result.value.items) {
        const workspaceId = item.workspaceId as unknown as SkyAxisWorkspaceId
        try {
          await ensureMeta(item.path, {
            workspaceId,
            workspaceTitle: item.title !== '' ? item.title : '',
            skyAxisVersion: SKY_AXIS_PLUGIN_VERSION,
            now,
          })
          // Sprint 3：mkdir inputs/{prd,attachment} —— 复用用户已有目录(决策 3)
          await ensureInputsLayout(item.path)
          bootstrappedPaths.push(item.path)
          succeeded += 1
        } catch (e) {
          failed += 1
          const code = e instanceof WorkspaceMetaError ? e.code : 'unknown'
          // eslint-disable-next-line no-console
          console.warn(
            `[sky-axis] ensureMeta failed for workspace ${workspaceId} (${item.path}): ` +
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
    })()

    return () => {
      for (const d of disposers) d()
      void reqSvc.close()
    }
  }, 'sky-axis: register ping/health/requirements routes')
})
