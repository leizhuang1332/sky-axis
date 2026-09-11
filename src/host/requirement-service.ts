/**
 * sky-axis 插件 host 半区业务服务 —— 持有 workspaceController 引用 +
 * workspaceViewCache,封装所有「需求」相关的业务逻辑(list / get / create /
 * delete / 物料 CRUD / artifact 落盘),供 host routes 调用。
 *
 * Sprint 5 演进(YAML-as-SoT):
 *   - 删 `@deepseek-ai/dsh-storage-domain` 依赖 —— 不再持有 domain/table handle
 *   - 所有 CRUD 改走 `requirements-store.updateRequirements` (read-modify-write
 *     + link-based 文件锁 + atomic write)
 *   - list / get 跨 workspace 扫描 —— 通过 `resolveAllWorkspacePaths()` 拿全量
 *     workspace path 列表,逐个 readAllRequirements 合并
 *   - reqId → workspacePath 反向索引 `requirementWorkspaceIndex` 加速 get(id)
 *     (单次扫表;后续可在 subscribeDomainChanges 增量维护)
 *   - SSE 订阅改内部 pub-sub —— Stage 6 由 fs-watcher-manager 的 onChange 回调
 *     `emitChange` 推送;这里只保留 subscribeDomainChanges API 签名不变
 *
 * 0.1.2 演进(workspace controller 流化):
 *   - 删 `ApiProxy` 依赖,改 `WorkspaceController`(由 `startWorkspaceFollow()`
 *     订阅其 `follow(signal)` 流,事件驱动维护 `workspaceViewCache`)
 *   - 缓存命中即返回,不再发 RPC;首次 bootstrap 等 `whenBaselineReady()` 拿到
 *     首帧 baseline
 *
 * 生命周期:
 *   1. 构造:不再异步初始化(没有 domain open);同步建好,直接可用
 *   2. 业务方法:全部 await resolveWorkspacePath / readAllRequirements / updateRequirements
 *   3. 关闭:close() 幂等;abort 内部 follow 流 AbortController,释放 fs-watcher
 *
 * 关键设计:
 *   - ID 生成:`${ISO}-${rand6}`,可 localeCompare 排序,碰撞概率极低
 *   - workspace 校验:cache hit 即认为存在;create 时也会复用 `resolveWorkspacePath`
 *     走同一路径,cache miss 抛 workspace-not-found
 *   - 1:1 不变量:在 mutator 内部检查(read-modify-write 锁内原子检查 + 写)
 *   - 不存 workspace 元数据快照:仅存 workspaceId(FK)
 */
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  WorkspaceController,
  WorkspaceFollowFrame,
  WorkspaceView,
} from '@deepseek-ai/dsh-api-workspace-controller'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller'
/**
 * 接入 0：sessionController 类型（type-only，不进 runtime bundle）。
 *   - SessionController 由 DSH host 半区注册（ctx.sessionController），sky-axis
 *     在 src/index.ts:83 inject 数组声明 'sessionController' 后可用
 *   - create({workspaceId, cwd, agentPreset}) → Promise<SessionCreateValue>
 *   - follow({address:{kind:'session',sessionId}}, signal) → AsyncIterable<SessionFollowFrame>
 *   详见 docs/ai工作台接入dsh-agent-session-架构预览.md §2.1 + §3 节点1
 */
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { COLLABORATOR_PRESET_ID } from './ensure-collaborator-preset.ts'
import { isCollaboratorPresetReady } from '../index.ts'
/**
 * 0.1.2 迁移说明(dsh-upgrade-audit 报告 §2.2):
 *   - 原 `@deepseek-ai/dsh-host-apiproxy` 整体被删,`ApiProxy` 类型不再存在
 *   - workspace 相关的服务入口改用 `@deepseek-ai/dsh-api-workspace-controller`
 *     导出的 `WorkspaceController`(继承自 `TypertRemoteService`,提供流式
 *     `follow(signal) → AsyncIterable<WorkspaceFollowFrame>` API)
 *   - `WorkspaceId` 类型从 `@deepseek-ai/dsh-host-apiproxy` 改到同 controller 包
 *   - service 通过 `startWorkspaceFollow()` 订阅流,事件驱动维护
 *     `workspaceViewCache`(替代原 60s TTL 的 path-only cache)
 *   - 详见 UPGRADE-MIGRATION-GUIDE.md §1
 */
import {
  AddDesignLinkRequest,
  AddExternalLinkRequest,
  AddPrdLinkRequest,
  AddSourceRepoRequest,
  Artifact,
  Attachment,
  MaterialItemId,
  MaterialSection,
  NewRequirement,
  PrdFile,
  Requirement,
  RequirementEvent,
  RequirementId,
  SourceRepo,
  Task,
  TaskList,
  TaskListSchema,
  UserId,
  WorkspaceId as SkyAxisWorkspaceId,
  SkyAxisErrorCode,
  defaultRequirementFields,
} from '../protocol.ts'
import * as artifactWriter from './artifact-writer.ts'
import {
  createGitService,
  SKY_AXIS_REPOS_DIR,
  type GitService,
} from './git-service.ts'
import { cleanupOrphanRepos } from './repo-cleanup.ts'
import { canonicalizeRepoUrl, extractRepoName } from './url-utils.ts'
import {
  findDuplicateWorkspaceGroups,
} from './workspace-uniqueness.ts'
import type { RequirementsSection } from './workspace-meta.ts'
import { ensureMeta, WorkspaceMetaError } from './workspace-meta.ts'
import {
  readAllRequirements,
  readRequirement as readRequirementFromStore,
  updateRequirements,
  findExistingRequirementAtPath,
} from './requirements-store.ts'

/**
 * sky-axis 插件自报版本(写入 `.sky-axis/mate.yaml` 的 skyAxis.version)。
 *
 * 与 `src/index.ts` 的 `SKY_AXIS_PLUGIN_VERSION` / `package.json` 的 `version`
 * 同步;后续若要做自动化注入(vite define / tsdown banner),统一改这一处。
 * 服务层 lazy bootstrap 也复用,避免 import 循环。
 */
const SKY_AXIS_PLUGIN_VERSION = '0.1.0'

/**
 * sky-axis 物料文件落盘的顶层目录(与 git-service 的 SKY_AXIS_REPOS_DIR 同源):
 *   - `inputs/prd/` —— PRD 文档上传落盘点
 *   - `inputs/attachment/` —— 附件上传落盘点
 *   - 4 个 link 类 section(prdLinks / designLinks / externalLinks / sourceRepos)
 *     不落盘(只有 URL 或 git clone 元数据,不写文件)。
 *
 * Sprint 3 演进(工作区目录结构改造):
 *   - 原路径 `${workspacePath}/.sky-axis/${requirementId}/${section}/${itemId}-${filename}`
 *     改为顶层 `${workspacePath}/inputs/${sectionInputsDir}/${reqShortId}-${itemIdShort}-${filename}`
 *   - `reqShortId`:requirementId 替换 `:` 为 `-` 后取前 19 字符(ISO 到秒)
 *   - `itemIdShort`:itemId UUID 前 8 字符
 *   - `sectionInputsDir`:`prdFiles` → `prd`、`attachments` → `attachment`
 *   - 双前缀 + 文件名三重防冲突;用户可读性高(一眼看出「哪个 req 的什么文件」)
 *
 * 复用语义(决策 3):`inputs/` 已存在就直接用,不查内部。
 */
const SKY_AXIS_INPUTS_DIR = 'inputs'

/** 物料每 section 数量上限(业务约束,zod 不管 —— 服务层校验)。 */
const MAX_MATERIALS_PER_SECTION = 50

/** sky-axis 自定义错误(host routes 捕获并翻译为 ApiError 响应)。 */
export class SkyAxisHostError extends Error {
  constructor(
    readonly code: SkyAxisErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SkyAxisHostError'
  }
}

/** ID 生成:ISO 字符串 + 6 位 base36 随机后缀。 */
function makeRequirementId(): RequirementId {
  const ts = new Date().toISOString()
  const rand = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')
  return `${ts}-${rand}` as RequirementId
}

/** 物料 itemId:UUID v4(与 protocol MaterialItemIdSchema 对齐)。 */
function makeMaterialItemId(): MaterialItemId {
  return randomUUID() as MaterialItemId
}

/**
 * 把 requirementId 转换为文件系统安全的目录名段。
 * `makeRequirementId` 形如 `2026-08-30T13:44:18.939Z-6hcwlt`,含 `:` 字符
 * —— macOS / ext4 合法但不利于跨平台(Windows / 部分归档工具)。
 * 一律 `:` → `-`,跟 `-` 已有分隔风格一致。
 */
function safeRequirementIdDir(id: RequirementId): string {
  return id.replace(/:/g, '-')
}

/**
 * Section → inputs/ 子目录名映射。
 *   - `prdFiles` → `prd`
 *   - `attachments` → `attachment`
 *   - 4 个 link 类 section 不会被 writeMaterialFile 调用(它们走 JSON add 路径),
 *     此处 throw 兜底 —— 防御未来误用。
 */
export function sectionInputsDirName(section: MaterialSection): 'prd' | 'attachment' {
  switch (section) {
    case 'prdFiles':    return 'prd'
    case 'attachments': return 'attachment'
    case 'prdLinks':
    case 'designLinks':
    case 'externalLinks':
    case 'sourceRepos':
      throw new Error(`section ${section} is link-only and must not write a file to inputs/`)
  }
}

/**
 * 物料文件落盘的 inputs/ 子目录绝对路径(不实际创建,返回路径供 mkdir recursive)。
 *
 * 形态:`<workspacePath>/inputs/<sectionInputsDir>/`
 */
export function materialInputsDir(workspacePath: string, section: MaterialSection): string {
  return join(workspacePath, SKY_AXIS_INPUTS_DIR, sectionInputsDirName(section))
}

/**
 * 确保 inputs/ 顶层布局存在 —— 一次性创建所有 file-upload section 的子目录。
 *
 * 启动期在每个 workspace 调用一次(与 ensureMeta 同步走),幂等(mkdir recursive 已存在 no-op)。
 *
 * 复用语义(决策 3):`inputs/` 目录已存在就直接用,不查内部 —— 但本函数还会
 * 确保两个子目录存在。如果 `inputs/` 已是用户手动建的空目录,子目录会按需创建。
 *
 * 失败抛错:mkdir 失败(如权限不足)会让 ensureMeta 整体失败 → console.warn + 跳过
 * 该 workspace;不阻塞 webServer 启动。
 */
export async function ensureInputsLayout(workspacePath: string): Promise<void> {
  for (const section of ['prdFiles', 'attachments'] as const) {
    await mkdir(materialInputsDir(workspacePath, section), { recursive: true, mode: 0o700 })
  }
}

/**
 * 把 requirementId 压缩为文件名前缀短码(19 字符 = ISO 到秒,已替换 `:` 为 `-`)。
 *
 * 形态例:`2026-09-07T13:44:18.939Z-6hcwlt` → `2026-09-07T13-44-18`(去冒号后前 19 字符)
 *
 * 唯一性:同秒多 requirement 撞名概率低;即使撞,后接 `itemIdShort`(UUID 前 8 字符)
 * 即可万无一失。短码让用户一眼看出「哪个 req」+ 可在 ls 时大致按时间排序。
 */
export function reqShortId(reqId: RequirementId): string {
  return safeRequirementIdDir(reqId).slice(0, 19)
}

/** itemId UUID 前 8 字符(无连字符,文件名前缀用)。 */
export function itemIdShort(itemId: MaterialItemId): string {
  return itemId.slice(0, 8)
}

/**
 * 沙箱断言:absolutePath 必须位于 `${workspacePath}/inputs/` 内。
 *
 * 与 git-service.assertSandboxed 同源的防御性断言 —— 防止 caller 误传或未来
 * refactor 时把恶意 section 名 / 文件名拼到路径外。
 */
function assertInputsDirSandbox(workspacePath: string, absolutePath: string): void {
  const root = resolve(workspacePath)
  const target = resolve(absolutePath)
  const expectedPrefix = root + sep + SKY_AXIS_INPUTS_DIR + sep
  if (target !== root && !target.startsWith(expectedPrefix)) {
    throw new Error(
      `material path escapes inputs sandbox: ${target} not under ${expectedPrefix}`,
    )
  }
}

/**
 * 防御性 sanitize 文件名:
 *   - 剔除 path traversal 字符(/ 与 \)
 *   - 剔除 .. 序列
 *   - 剔除控制字符(ASCII 0x00-0x1F + DEL)
 *   - 剔除开头的点(避免 .bashrc / .ssh 等隐藏文件)
 *   - 空串兜底为 'unnamed'
 *   - 截取最后 200 字符(过长文件名对文件系统不友好)
 *
 * mojibake 救回:如果 filename 含有高位字节序列(每字符 ≥ 0x80),
 * 尝试把它当 latin1 字节重新按 utf8 解码 —— 修 busboy 旧版本 / 老
 * 客户端遗留下来的乱码文件。救不回来的(含控制字符的)保留原值。
 */
function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/^\.+/, '')
    .trim()
  if (cleaned === '') return 'unnamed'
  const head = cleaned.slice(0, -200)
  const tail = head === '' ? cleaned : cleaned.slice(-200)
  if (!/[\x80-\xff]/.test(tail)) return tail
  try {
    const recovered = Buffer.from(tail, 'latin1').toString('utf8')
    // 救回后不能再含控制字符(说明解码失败,留原样)
    if (/[\x00-\x1f\x7f]/.test(recovered)) return tail
    return recovered
  } catch {
    return tail
  }
}

/** 写 PrdFile / Attachment 文件到磁盘,返回相对 workspace 的 path 与绝对路径。
 *
 * 落盘路径(Sprint 3):`${workspacePath}/inputs/${sectionInputsDir}/${reqShortId}-${itemIdShort}-${sanitized}`
 *
 * 写入策略:先写 `.tmp` 临时文件,fsync 完成后 rename 到正式文件名。
 * 目的:
 *   1) 上传中途断流 / KV write 失败 → 磁盘上不会留下半成品文件
 *   2) rename 是 POSIX 原子操作,client 端 list / ls 永远不会看到半写文件
 *   3) 与文件持久名同步由 reqShortId + itemIdShort 前缀提供(即便 sanitize 后同名也不冲突)
 *
 * 沙箱:写完后调 assertInputsDirSandbox 兜底防御 —— 正常路径必然命中 `${ws}/inputs/`,
 * 但若未来 refactor 把恶意 section 名串进去会立即抛错。
 */
export async function writeMaterialFile(args: {
  workspacePath: string
  requirementId: RequirementId
  section: MaterialSection
  itemId: MaterialItemId
  filename: string
  content: Buffer
}): Promise<{ relativePath: string; absolutePath: string }> {
  const dir = materialInputsDir(args.workspacePath, args.section)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const sanitized = sanitizeFilename(args.filename)
  const shortReq = reqShortId(args.requirementId)
  const shortItem = itemIdShort(args.itemId)
  const baseFilename = `${shortReq}-${shortItem}-${sanitized}`
  const absolutePath = join(dir, baseFilename)
  const tmpPath = join(dir, `.${shortItem}.tmp`)
  try {
    await writeFile(tmpPath, args.content, { mode: 0o600 })
    await rename(tmpPath, absolutePath)
  } catch (e) {
    // 清理可能残留的 tmp —— 注意相对路径是新形态(inputs/{section}/{...}.tmp)
    await unlinkMaterialFile(args.workspacePath, join(SKY_AXIS_INPUTS_DIR, sectionInputsDirName(args.section), `.${shortItem}.tmp`))
    throw e
  }
  // 沙箱断言兜底
  assertInputsDirSandbox(args.workspacePath, absolutePath)
  const relativePath = join(
    SKY_AXIS_INPUTS_DIR,
    sectionInputsDirName(args.section),
    baseFilename,
  )
  return { relativePath, absolutePath }
}

/**
 * best-effort 删物料文件:
 *   - ENOENT(已被删)视为成功(caller 不需关心)
 *   - 其它错误 console.warn(不影响 KV 操作的语义)
 */
async function unlinkMaterialFile(workspacePath: string, relativePath: string): Promise<void> {
  const absolute = join(workspacePath, relativePath)
  try {
    await unlink(absolute)
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException
    if (err.code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn(`[sky-axis] unlink ${absolute} failed: ${err.code ?? 'unknown'}`)
    }
  }
}

/**
 * sky-axis host 半区业务服务。
 *
 * Sprint 5:不再持有 storage domain handle;所有持久化通过 requirements-store
 * 走 `<workspace>/.sky-axis/mate.yaml` 的 `requirements` 段。
 *
 * 0.1.2 迁移(dsh-upgrade-audit §2.2 + UPGRADE-MIGRATION-GUIDE §1):
 *   - 0.1.1:`workspacePathCache` 60s TTL 由 `this.apiProxy.workspace.list(req)`
 *     一次性 RPC 主动刷新
 *   - 0.1.2:由 `ctx.workspaceController.follow(signal)` 流订阅驱动,`workspaceViewCache`
 *     缓存 `WorkspaceView`(workspaceId/path/title/sessionIds/时间戳),baseline 帧灌全量,
 *     upsert/remove 增量维护。无 TTL,无主动 refresh
 */
export class RequirementHostService {
  /**
   * workspaceId → 真实 `WorkspaceView`(由 follow 流事件驱动维护)。
   *
   * 0.1.2 选 WorkspaceView 而非 path 字符串的原因:routes/requirements.ts
   * 的 GET /workspaces 端点(以及未来的 workspace-meta 详情接口)需要
   * workspaceId / title / path 三个字段 —— 用 View 一次缓存全部字段
   * 拿出去直接投影,省去一次 RPC。`resolveWorkspacePath` 只取 `.path`。
   */
  private workspaceViewCache = new Map<SkyAxisWorkspaceId, WorkspaceView>()

  /**
   * reqId → workspacePath 反向索引(供 get(id) 用)。
   * - 懒填充:第一次 get(id) 时按当前 workspaceViewCache 扫一遍
   * - 增量维护:list / create / remove / subscribeDomainChanges 回调时更新
   * - 弱保证:跨进程 / 外部工具改 mate.yaml 后可能短暂 stale;fallback 兜底全量扫
   */
  private requirementWorkspaceIndex = new Map<RequirementId, string>()

  /** domainChangeListeners pub-sub。Stage 6 由 fs-watcher-manager 回调驱动。 */
  private readonly domainChangeListeners = new Set<(event: RequirementEvent) => void>()

  /**
   * per-workspace 已知 requirement 快照 —— 给 fs.watch 触发的 diff 用。
   * - write path 通过 emitChange 同步维护(put 写入 + deleted 移除)
   * - 启动期由 `refreshRequirementSnapshots` 一次性灌入
   * - JSON.stringify 比较,Nested object 内容相同则视为无变化
   */
  private readonly requirementSnapshots = new Map<string, RequirementsSection>()

  private closed = false

  /**
   * 0.1.2:内部 follow 流的 AbortController —— `close()` 时 abort,
   * `consumeWorkspaceFollow` 检测后退出。effect dispose 也会触发 abort
   * (我们用 effect.signal 桥接到这个 controller),但保留显式持有便于
   * 测试 / 显式 teardown 路径。
   */
  private readonly followAbortController = new AbortController()

  /**
   * 0.1.2:首次 baseline 到达时 resolve;`whenBaselineReady()` 复用。
   * 后续 reconnect 触发的 baseline 不再 resolve(已经过了;reconnect
   * 自身有完整重灌机制)。
   */
  private readonly baselineReady: {
    promise: Promise<readonly WorkspaceView[]>
    resolve: (views: readonly WorkspaceView[]) => void
  }

  /** Phase 2.6 源码关联:git 沙箱封装(stateless,可在多 service 间共享)。 */
  readonly gitService: GitService = createGitService()

  /**
   * 接入 0-1：per-requirement follow 流 AbortController 管理。
   *   - key = requirementId，value = 该 requirement 的 session follow 流 AbortController
   *   - startFollow 幂等：已有活跃流则 return
   *   - stopFollow / close() 时 abort + delete
   *   - 重启恢复：index.ts bootstrap 末尾对有 aiSessionId 的 req 调 startFollow
   */
  private readonly followControllers = new Map<RequirementId, AbortController>()
  /** 接入 1：onAiStateChange 去重防抖 —— 同状态不重复写盘。key = requirementId。 */
  private readonly lastAiState = new Map<RequirementId, string>()
  // 接入 2：sync stage cache —— consumeSessionFollow 入口处从 mate.yaml 初始化，
  //   applyAdvanceStage 推进后更新；bridge 用它做 plan JSON 提取阶段门控（同步访问）。
  private readonly stageCache = new Map<RequirementId, Requirement['stage']>()

  constructor(
    private readonly ctx: import('@deepseek-ai/cordis').Context,
    /**
     * 0.1.2:替换原 `ApiProxy` 聚合服务为细粒度 `WorkspaceController`。
     * 由 host apply 注入;后续 `startWorkspaceFollow()` 内部使用
     * `this.ctx.workspaceController.follow(signal)` 订阅流。字段保留
     * readonly 仅供 routes/requirements.ts#GET /workspaces 路径直接读取。
     */
    readonly workspaceController: WorkspaceController,
    /**
     * 接入 0：DSH host 半区 SessionController（由 ctx.sessionController 注入）。
     *   - ensureSession: create({workspaceId, cwd, agentPreset:'standard'})
     *   - startFollow: follow({address:{kind:'session',sessionId}}, signal)
     * inject 数组（src/index.ts:83）已声明 'sessionController'。探测确认就绪
     * （[[sky-axis-sessions-gateway-ready]]）。
     */
    readonly sessionController: SessionController,
  ) {
    // 不再需要 storageDomain 注入;Stage 6 由 fs-watcher-manager 推 emitChange
    let resolveBaseline!: (views: readonly WorkspaceView[]) => void
    const promise = new Promise<readonly WorkspaceView[]>((resolve) => {
      resolveBaseline = resolve
    })
    this.baselineReady = { promise, resolve: resolveBaseline }
  }

  /**
   * 0.1.2:在 cordis effect 内订阅 `workspaceController.follow(signal)` 流,
   * 维护 `workspaceViewCache`。由 host apply 在 effect 内调用一次,effect
   * cleanup 时通过 `reqSvc.close()` abort 内部 AbortController 释放。
   *
   * 实现要点:
   *   - 首帧必须 type='baseline',灌全量 cache
   *   - 后续帧 type='upsert'/'remove'/'order'/'archived' 增量维护
   *   - 流被 generator 中断(workspace 进程重启 / connection 断) → 自动
   *     重连并再来一帧 baseline 覆盖 cache
   *   - 解析过的 workspaceViewCache 已稳定 → resolveWorkspacePath /
   *     resolveAllWorkspacePaths 走纯缓存(不再发请求)
   */
  startWorkspaceFollow(): void {
    // 用内部持有的 AbortController —— `close()` 时一并 abort,
    // effect dispose 不必感知 signal 的存在(降低 index.ts 接线复杂度)
    void this.consumeWorkspaceFollow(this.followAbortController.signal).catch((err) => {
      if (this.followAbortController.signal.aborted) return
      // eslint-disable-next-line no-console
      console.warn('[sky-axis] workspace follow stream aborted:', err)
    })
  }

  private async consumeWorkspaceFollow(signal: AbortSignal): Promise<void> {
    const controller = this.ctx.workspaceController
    while (!signal.aborted) {
      try {
        for await (const frame of controller.follow(signal)) {
          if (signal.aborted) break
          this.applyWorkspaceFollowFrame(frame)
        }
        // for await 正常结束(理论上 follow 永不返回)→ 视为流结束,break outer
        break
      } catch (err) {
        if (signal.aborted) throw err
        // eslint-disable-next-line no-console
        console.warn('[sky-axis] workspace follow stream iteration failed; retrying after backoff:', err)
        // 短暂退避后重连
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
      }
    }
  }

  private applyWorkspaceFollowFrame(frame: WorkspaceFollowFrame): void {
    switch (frame.type) {
      case 'baseline': {
        // 全量覆盖 —— 任何 in-flight 反向索引 / snapshots 仍然安全
        // (workspace 不存 requirement,反向索引里 req.workspaceId 不存在
        // 即视为 stale;后续 get(id) 会触发全量扫表重建)
        const fresh = new Map<SkyAxisWorkspaceId, WorkspaceView>()
        for (const item of frame.value.items) {
          fresh.set(item.workspaceId as unknown as SkyAxisWorkspaceId, item)
        }
        this.workspaceViewCache = fresh
        // 首帧到达,resolve baselineReady promise(只 resolve 一次)
        this.baselineReady.resolve(this.snapshotViews())
        return
      }
      case 'upsert': {
        const ws = frame.workspace
        this.workspaceViewCache.set(
          ws.workspaceId as unknown as SkyAxisWorkspaceId,
          ws,
        )
        return
      }
      case 'remove': {
        this.workspaceViewCache.delete(
          frame.workspaceId as unknown as SkyAxisWorkspaceId,
        )
        return
      }
      case 'order':
        // workspace 顺序变更不影响 workspaceId → view 映射,忽略
        return
      case 'archived':
        // archived session 列表变更不影响 workspace view,忽略
        return
    }
  }

  /**
   * 当前 cache 全部 view 的快照(只读)。
   * routes/requirements.ts#GET /workspaces 透传 client 用。
   */
  private snapshotViews(): readonly WorkspaceView[] {
    return [...this.workspaceViewCache.values()]
  }

  /* ── 内部 pub-sub(Stage 6 fs-watcher-manager 接入)── */

  /**
   * 触发 domainChange 事件。本方法由 requirements-store 自家写入路径(显式调)
   * 或 fs-watcher-manager 监听到 mate.yaml 外部变更时调。
   *
   * 副作用:
   *   - 维护 `requirementWorkspaceIndex`(reqId → workspacePath)
   *   - 维护 `requirementSnapshots`(workspacePath → RequirementsSection)——给
   *     fs.watch 触发的 diff 做对比
   *   - 防御性:listener 抛错不影响其他 listener
   */
  emitChange(event: RequirementEvent): void {
    // 1. 维护反向索引 + per-workspace snapshot(同步,在 fan-out 之前)
    if (event.operation === 'put') {
      const cached = this.resolveWorkspacePathFromCache(event.item.workspaceId)
      if (cached !== undefined) {
        this.requirementWorkspaceIndex.set(event.item.id, cached)
        this.upsertSnapshot(cached, event.item)
      } else {
        // 缓存 miss 但 emitChange 是同步方法 → 先用空串占位,异步补
        this.requirementWorkspaceIndex.set(event.item.id, '')
        void this.resolveWorkspacePath(event.item.workspaceId).then(wsPath => {
          this.requirementWorkspaceIndex.set(event.item.id, wsPath)
          this.upsertSnapshot(wsPath, event.item)
        }).catch(() => undefined)
      }
    } else if (event.operation === 'deleted') {
      this.requirementWorkspaceIndex.delete(event.id as RequirementId)
      // 反向查 wsPath(已知 req 之前属哪)
      for (const [wsPath, sec] of this.requirementSnapshots) {
        if (sec[event.id] !== undefined) {
          this.removeFromSnapshot(wsPath, event.id as RequirementId)
          break
        }
      }
    }

    // 2. fan-out listener(防御性:单个 throw 不影响其它)
    for (const cb of this.domainChangeListeners) {
      try {
        cb(event)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[sky-axis] domainChange listener threw:', e)
      }
    }
  }

  /**
   * 把一条 req 写入对应 workspace 的 snapshot(用于 fs.watch diff)。
   * 不存在 → 新建 {}。
   */
  private upsertSnapshot(workspacePath: string, req: Requirement): void {
    if (workspacePath === '') return  // 占位阶段跳过
    const sec = this.requirementSnapshots.get(workspacePath) ?? {}
    this.requirementSnapshots.set(workspacePath, { ...sec, [req.id]: req })
  }

  /** 从 snapshot 移除一条 req。 */
  private removeFromSnapshot(workspacePath: string, reqId: RequirementId): void {
    if (workspacePath === '') return
    const sec = this.requirementSnapshots.get(workspacePath)
    if (sec === undefined) return
    const { [reqId]: _, ...rest } = sec
    this.requirementSnapshots.set(workspacePath, rest)
  }

  /**
   * fs-watcher-manager 监听到 mate.yaml 外部修改时调用。
   *
   * 流程:重读 workspace 的 requirements 段 → 与本进程已知 snapshot diff →
   * 对变化项 emit put / deleted。
   *
   * 错误语义:
   *   - yaml 损坏 → console.warn + 不 emit(等下一次外部写)
   *   - 元数据缺失 → 同上
   *   - yaml-lock-timeout → console.warn(自家正在写,外部 fs.watch 触发是 OK 的)
   *
   * @returns diff 结果条数(便于测试断言)
   */
  async onWorkspaceMateYamlChanged(workspacePath: string): Promise<number> {
    let next: RequirementsSection
    try {
      next = await readAllRequirements(workspacePath)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[sky-axis] fs.watch diff(${workspacePath}) read failed:`, e)
      return 0
    }
    const prev = this.requirementSnapshots.get(workspacePath) ?? {}
    let diffCount = 0
    // 1. 新增 / 修改 → emit put
    for (const id of Object.keys(next)) {
      const n = next[id]!
      const p = prev[id]
      if (p === undefined || JSON.stringify(p) !== JSON.stringify(n)) {
        this.emitChange({ operation: 'put', item: n })
        diffCount++
      }
    }
    // 2. 消失 → emit deleted
    for (const id of Object.keys(prev)) {
      if (next[id] === undefined) {
        this.emitChange({ operation: 'deleted', id: id as RequirementId })
        diffCount++
      }
    }
    // 3. 同步本地 snapshot 为最新(避免下次 diff 误判)
    this.requirementSnapshots.set(workspacePath, next)
    return diffCount
  }

  /**
   * `.sky-axis/` 目录被删 → 视为该 workspace 的全部 requirements 消失。
   * 对已知 snapshot 全部 emit deleted + 清掉 cache。
   *
   * @returns emitted 条数
   */
  onWorkspaceMetaDeleted(workspacePath: string): number {
    const sec = this.requirementSnapshots.get(workspacePath)
    if (sec === undefined) return 0
    let count = 0
    for (const req of Object.values(sec)) {
      this.emitChange({ operation: 'deleted', id: req.id })
      this.requirementWorkspaceIndex.delete(req.id)
      count++
    }
    this.requirementSnapshots.delete(workspacePath)
    return count
  }

  /**
   * 启动期灌入 per-workspace snapshot —— 调用一次,后续 readAllAcrossWorkspaces
   * 也会更新。给 fs-watcher-manager 接 service 时用(避免首次 fs.watch 触发时
   * 与本进程刚写入的内容误判为外部修改)。
   */
  async refreshRequirementSnapshots(): Promise<void> {
    await this.readAllAcrossWorkspaces()
  }

  /**
   * 订阅 domainChange 事件。Stage 6 fs-watcher-manager 启动时调一次,把
   * `onChange` 回调到 `emitChange`。
   */
  subscribeDomainChanges(cb: (event: RequirementEvent) => void): () => void {
    this.domainChangeListeners.add(cb)
    return () => { this.domainChangeListeners.delete(cb) }
  }

  /* ── 接入 2：task 动作 / stage 推进 / plan artifact ── */

  /**
   * 接入 2：处理 task 动作（start/accept/redo/skip）。
   *
   * 4 种 action 语义：
   *   - start：pending → in_progress；调 DSH prompt('queue', taskStartPrompt)
   *   - accept：in_progress/verifying/failed → done；仅本地状态切换
   *   - redo：failed/rolled_back → in_progress；调 DSH prompt('queue', taskRedoPrompt)
   *   - skip：pending/in_progress/failed → skipped；仅本地状态切换
   *
   * start/redo 走 prompt 后会跟着 aiState=running（已启动），不需要再 ensureSession。
   * accept/skip 不调 prompt，本地切换 + emitChange put 即返。
   *
   * 错误：requirement/task 不存在 → 'requirement-not-found'；action 非法 → 'validation-failed'。
   */
  async taskAction(
    requirementId: RequirementId,
    taskId: string,
    action: 'start' | 'accept' | 'redo' | 'skip',
  ): Promise<Requirement> {
    const tag = '[sky-axis:ai] taskAction'
    const current = await this.get(requirementId)
    if (current === undefined) {
      throw new SkyAxisHostError('requirement-not-found', `requirement ${requirementId} not found`)
    }
    if (current.aiSessionId === null) {
      throw new SkyAxisHostError(
        'ai-session-missing',
        `requirement ${requirementId} has no AI session; call /ai/start first`,
      )
    }

    // 在 plan artifact 里找 task（接入 2 plan 提取后才会有；mock 阶段 plan 不存在 → 'task-not-found'）
    const task = this.findTaskInPlan(current, taskId)
    if (task === undefined) {
      throw new SkyAxisHostError('task-not-found', `task ${taskId} not found in plan artifacts`)
    }

    const nextStatus = ((): Task['status'] | null => {
      switch (action) {
        case 'start':  return task.status === 'pending' || task.status === 'blocked' ? 'in_progress' : null
        case 'accept': return task.status === 'in_progress' || task.status === 'verifying' || task.status === 'failed' ? 'done' : null
        case 'redo':   return task.status === 'failed' || task.status === 'rolled_back' ? 'in_progress' : null
        case 'skip':   return task.status === 'pending' || task.status === 'in_progress' || task.status === 'failed' || task.status === 'blocked' ? 'skipped' : null
      }
    })()
    if (nextStatus === null) {
      throw new SkyAxisHostError(
        'validation-failed',
        `task ${taskId} action '${action}' invalid from status '${task.status}'`,
      )
    }

    // 本地状态切换（读-改-写，锁内原子）
    const workspacePath = await this.resolveWorkspacePath(current.workspaceId)
    const now = new Date().toISOString()
    const { result: updated } = await updateRequirements(
      workspacePath,
      ({ current: sec }) => {
        const prev = sec[requirementId]
        if (prev === undefined) {
          throw new SkyAxisHostError('requirement-not-found', `requirement ${requirementId} not found in mate.yaml`)
        }
        const prevTask = prev.artifacts['plan'] === undefined
          ? undefined
          : this.tryParseTaskList(prev.artifacts['plan']?.body ?? '')?.tasks.find(t => t.id === taskId)
        if (prevTask === undefined) {
          throw new SkyAxisHostError('task-not-found', `task ${taskId} disappeared`)
        }
        const subHistory = [
          ...prevTask.subHistory,
          {
            status: prevTask.status,
            enteredAt: prevTask.subHistory[prevTask.subHistory.length - 1]?.enteredAt ?? prevTask.enteredAt,
            leftAt: now,
          },
          { status: nextStatus, enteredAt: now },
        ]
        const nextTask = { ...prevTask, status: nextStatus, subHistory }
        const nextTasks = this.replaceTaskInPlan(prev, prevTask, nextTask)
        return { next: { ...sec, [requirementId]: { ...prev, ...nextTasks, updatedAt: now } }, result: prev }
      },
      { now },
    )
    this.emitChange({ operation: 'put', item: updated })
    void updated // 占位避免 lint

    // start/redo 调 DSH prompt（queue 模式，不打断 running turn）
    if (action === 'start' || action === 'redo') {
      const promptText = action === 'start' ? this.buildTaskStartPrompt(task) : this.buildTaskRedoPrompt(task)
      try {
        await this.sessionController.prompt({
        sessionId: current.aiSessionId as never,
        mode: 'queue',
        content: [{ type: 'text', text: promptText }],
      } as never, new AbortController().signal)
        console.info(tag, `${action} prompt sent for task ${taskId} (sessionId=${current.aiSessionId})`)
      } catch (e) {
        // prompt 失败不影响本地状态切换 —— SSE 已把 in_progress 状态推回 client；
        // 用户重试 taskAction('start') 时 task 已 in_progress 会被 validation-failed 拒
        // （这是故意的：避免重复 prompt 压垮 queue）。
        console.warn(tag, `DSH prompt failed (task status already updated): ${(e as Error).message}`)
      }
    } else {
      console.info(tag, `${action} status changed for task ${taskId} (no DSH prompt)`)
    }
    return updated
  }

  /**
   * 接入 2：stage 推进回调 —— ai-event-bridge 监听到 tool/call 'advance_stage' 时调。
   *
   * 行为：
   *   - 校验 toStage ∈ {'plan','implement','verify','deliver'}（'understand' 不可推）
   *   - 写 stageHistory：收尾当前 stage entry（outcome='completed'）+ leftAt + reason
   *     + 追加新 stage entry（enteredAt=now）
   *   - emitChange put → SSE 回流
   *
   * 失败：req 不存在 → 静默 no-op（agent 在没有 mate.yaml 的 cwd 下跑不会报错）。
   */
  async applyAdvanceStage(
    requirementId: RequirementId,
    toStage: 'plan' | 'implement' | 'verify' | 'deliver',
    reason: string,
    activityAt: string,
  ): Promise<void> {
    const tag = '[sky-axis:ai] applyAdvanceStage'
    const current = await this.get(requirementId)
    if (current === undefined || current.aiSessionId === null) return

    const workspacePath = await this.resolveWorkspacePath(current.workspaceId)
    const now = activityAt
    const { result: updated } = await updateRequirements(
      workspacePath,
      ({ current: sec }) => {
        const prev = sec[requirementId]
        if (prev === undefined) {
          throw new SkyAxisHostError('requirement-not-found', `requirement ${requirementId} not found`)
        }
        // 当前 stage 已是 toStage → 幂等 no-op
        if (prev.stage === toStage) return { next: sec, result: prev }

        const lastIdx = prev.stageHistory.length - 1
        const lastEntry = prev.stageHistory[lastIdx]
        const closedHistory = prev.stageHistory.map((entry, i) => {
          if (i !== lastIdx) return entry
          if (entry.leftAt !== undefined) return entry // 已收尾（rewind/手动 closed）
          return {
            ...entry,
            leftAt: now,
            outcome: 'completed' as const,
            reason: reason || entry.reason,
          }
        })
        const nextHistory = [
          ...closedHistory,
          { stage: toStage, enteredAt: now },
        ]
        return {
          next: { ...sec, [requirementId]: { ...prev, stage: toStage, stageHistory: nextHistory, updatedAt: now } },
          result: prev,
        }
      },
      { now },
    )
    this.emitChange({ operation: 'put', item: updated })
    // 接入 2：更新 stage cache，让后续 follow 帧的阶段门控立刻生效
    this.stageCache.set(requirementId, toStage)
    console.info(tag, `${requirementId} advanced to ${toStage} (reason: ${reason || '(none)'})`)
  }

  /**
   * 接入 2：plan artifact 写入回调 —— ai-event-bridge 解析 assistant/message JSON 后调。
   *
   * 行为：复用 writeArtifact(reqId, {kind:'plan', body: JSON.stringify(taskList)})。
   * taskList 来自 TaskListSchema 校验通过的解析结果（bridge 已 zod check）。
   * artifact meta 写 { isTaskList: true, taskCount } 方便 UI 区分 plan-as-tasks vs plan-as-markdown。
   */
  async applyPlanArtifact(
    requirementId: RequirementId,
    taskList: TaskList,
    activityAt: string,
  ): Promise<void> {
    const tag = '[sky-axis:ai] applyPlanArtifact'
    const artifact: Artifact = {
      id: `plan-${Date.now().toString(36)}`,
      kind: 'plan',
      title: `Tasks (${taskList.tasks.length}) for ${requirementId.slice(-8)}`,
      createdAt: activityAt,
      body: JSON.stringify(taskList),
      meta: { isTaskList: true, taskCount: taskList.tasks.length, producedAt: taskList.producedAt, producedAtStage: taskList.producedAtStage },
    }
    await this.writeArtifact(requirementId, artifact)
    console.info(tag, `${requirementId} wrote plan artifact with ${taskList.tasks.length} tasks`)
  }

  /**
   * 内部 helper：从 plan artifact body 解析 TaskList，找 task by id。
   * plan 不存在 / 解析失败 → undefined。
   */
  private findTaskInPlan(req: Requirement, taskId: string): Task | undefined {
    const planArtifact = req.artifacts['plan']
    if (planArtifact === undefined) return undefined
    const parsed = this.tryParseTaskList(planArtifact.body)
    if (parsed === undefined) return undefined
    return parsed.tasks.find(t => t.id === taskId)
  }

  /** 内部 helper：尝试把 plan artifact body 解析为 TaskList（zod 校验失败 → undefined）。 */
  private tryParseTaskList(body: string): TaskList | undefined {
    try {
      const obj = JSON.parse(body)
      const parsed = TaskListSchema.safeParse(obj)
      if (!parsed.success) return undefined
      return parsed.data
    } catch {
      return undefined
    }
  }

  /** 内部 helper：在 plan artifact KV 里替换单条 task（保 plan body 结构稳定）。 */
  private replaceTaskInPlan(req: Requirement, oldTask: Task, newTask: Task): Partial<Requirement> {
    const planArtifact = req.artifacts['plan']
    if (planArtifact === undefined) return {}
    const parsed = this.tryParseTaskList(planArtifact.body)
    if (parsed === undefined) return {}
    const nextTasks = parsed.tasks.map(t => (t.id === oldTask.id ? newTask : t))
    const nextBody = JSON.stringify({ ...parsed, tasks: nextTasks })
    return {
      artifacts: {
        ...req.artifacts,
        plan: { ...planArtifact, body: nextBody },
      },
    }
  }

  /** 内部 helper：构造 task start prompt 文本（喂给 DSH prompt('queue', ...)）。 */
  private buildTaskStartPrompt(task: Task): string {
    return [
      `## Task ${task.id} (${task.title})`,
      '',
      `**Goal**: ${task.goal}`,
      '',
      '**Acceptance**:',
      ...task.acceptance.map(a => `- ${a}`),
      task.filesExpected.length > 0 ? `\n**Files expected**: ${task.filesExpected.join(', ')}` : '',
      task.dependencies.length > 0 ? `\n**Dependencies**: ${task.dependencies.join(', ')}` : '',
      '',
      '请按以上约束实现本 task，完成后调 advance_stage 推进 sky-axis 阶段。',
    ].filter(Boolean).join('\n')
  }

  /** 内部 helper：构造 task redo prompt 文本。 */
  private buildTaskRedoPrompt(task: Task): string {
    return [
      `## Redo task ${task.id} (${task.title})`,
      '',
      `本 task 之前尝试失败，需要重做。`,
      '',
      `**Goal**: ${task.goal}`,
      '',
      '**Acceptance**:',
      ...task.acceptance.map(a => `- ${a}`),
      '',
      '请分析失败原因、修复并继续。完成后调 advance_stage 推进 sky-axis 阶段。',
    ].filter(Boolean).join('\n')
  }

  /**
   * 关闭 service(幂等)。释放 domain handle 触发 backend unit close;
   * DSH host 重启 / 插件卸载时调用。
   *
   * 0.1.2:同时 abort 内部 follow 流的 AbortController —— `consumeWorkspaceFollow`
   * 检测到 abort 后立刻退出,`startWorkspaceFollow` 端的 .catch handler
   * 因 signal.aborted 而 no-op。effect dispose 也会 abort,但这里
   * 兜底一次防止 effect 先于 close 跑完。
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.followAbortController.abort()
    // 接入 1：abort 所有 per-requirement session follow 流
    for (const controller of this.followControllers.values()) {
      controller.abort()
    }
    this.followControllers.clear()
    this.domainChangeListeners.clear()
  }

  /* ── 接入 0-1：AI session 生命周期 ── */

  /**
   * 接入 0：为 requirement 创建/绑定 DSH agent session（幂等）。
   *
   * 流程：
   *   1. get(reqId) → 不存在抛 requirement-not-found
   *   2. 幂等：req.aiSessionId 非空 → 直接返回（已绑定）
   *   3. resolveWorkspacePath → cwd
   *   4. sessionController.create({workspaceId, cwd, agentPreset:'standard'})
   *   5. updateRequirements 写回 aiSessionId/aiState='running'/aiLastActivityAt
   *   6. emitChange put → SSE 推回 client（UI aiState 自动切 running）
   *
   * 接入 0 用 shipped 'standard' preset 起步（custom sky-axis-collaborator preset
   * 创作延后，见 docs/ai工作台接入dsh-agent-session-架构预览.md §4 决策3）。
   * create 失败（sessionController 未就绪 / preset 未注册）包成 ai-not-configured。
   */
  async ensureSession(requirementId: RequirementId): Promise<Requirement> {
    const req = await this.get(requirementId)
    if (req === undefined) {
      throw new SkyAxisHostError('requirement-not-found', `requirement ${requirementId} not found`)
    }
    // 幂等：已绑定 session 直接返回
    if (req.aiSessionId !== null) return req

    const workspacePath = await this.resolveWorkspacePath(req.workspaceId)
    const now = new Date().toISOString()

    // 调 DSH create —— agentPreset 用 shipped 'standard'（接入 0 起步）
    //
    // DSH session.create 是 workspaceId/cwd 互斥设计（见 commands.js:85-86 守卫）。
    //
    // 接入 2.1 (P1)：sky-axis workspaceId 与 DSH workspaceRegistry 完全同源
    //   —— sky-axis workspaceViewCache 来自 `workspaceController.follow(signal)`，
    //   是 DSH workspaceRegistry 的同一份数据。resolveWorkspacePath() 已经验证 cache hit
    //   并抛 workspace-not-found 兜底，所以可以直接传 workspaceId。
    //
    //   改用 workspaceId 而非 cwd 的好处（接入 2.1 关键）：
    //     - host SessionCommandController.create 在拿到 workspaceId 后会自动
    //       `workspace.attachSession(sessionId)`（commands.js:105-113），让 sessionId
    //       进 DSH workspaceRegistry 的 `workspace.sessionIds` 列表。
    //     - DSH native UI sidebar 通过 `workspace.sessionIds.includes(id)` 把 session
    //       归到 workspace group 下渲染（client.js:370-378），sky-axis 创建的 session
    //       才能像 DSH native 创建的一样出现在 sidebar workspace 分组里。
    //     - 同时 client 端通过 typert gateway push 收到 `api-session/added` 事件
    //       （commands.js 走 host listener emit），sessionId 自动进 client 端
    //       `ctx.sessions.list.summaries`。
    //   客户端再调 `ctx.sessions.open(sessionId)` 设 current，让 sidebar 的
    //   `sessionVisible` 闸（`blank && id !== current`）放行（详见
    //   docs/ai工作台接入dsh-agent-session-接入0-1执行计划.md §10）。
    //
    // 30s 超时兜底：create 内部会调到 ctx.agents.create → agentDefaultModel.currentSelection()，
    // 如果宿主 agent 框架级服务未就绪，create 可能永远不 resolve，超时后抛 ai-not-configured。
    //
    // 接入 2：agentPreset 动态选择。
    //   - collaborator preset 已就位 → 'sky-axis-collaborator'（注入 5 阶段协议 + advance_stage tool）
    //   - collaborator preset 不可用 → 退回 shipped 'standard'（agent 跑得动但不调 advance_stage）
    const CREATE_TIMEOUT_MS = 30_000
    // 模块级状态 import —— 用 require-style 静态导入避免循环依赖（ensure-collaborator-preset 不依赖 service）
    // 状态由 src/index.ts:140 的 apply effect 写入；这里只在 host 半区读（不会从 client 半区触发）
    const agentPresetId = isCollaboratorPresetReady() ? COLLABORATOR_PRESET_ID : 'standard'
    let sessionId: string
    try {
      console.info(`[sky-axis:ai] ensureSession: creating session for ${requirementId} (workspacePath=${workspacePath}, preset=${agentPresetId})`)
      const createPromise = this.sessionController.create({
        workspaceId: req.workspaceId as never,
        agentPreset: agentPresetId,
      } as never) as Promise<{ sessionId: string }>
      const result = await Promise.race([
        createPromise,
        new Promise<never>((_, reject) => setTimeout(
          () => reject(new Error(`create session timed out after ${CREATE_TIMEOUT_MS}ms (agent framework services may not be ready: agents/agentDefaultModel/llm)`)),
          CREATE_TIMEOUT_MS,
        )),
      ])
      sessionId = result.sessionId
      console.info(`[sky-axis:ai] ensureSession: session created, sessionId=${sessionId}, workspaceId=${req.workspaceId} (workspace attached → DSH sidebar will show)`)
    } catch (e) {
      // sessionController 未就绪 / preset 未注册 / 框架级服务缺失 / 超时 —— 统一包成
      // ai-not-configured（mapStatus 已映射 503，UI 给 actionable 提示）
      throw new SkyAxisHostError(
        'ai-not-configured',
        `create session failed for requirement ${requirementId}: ${(e as Error).message}`,
      )
    }

    // 写回 mate.yaml + emitChange put（复用现有 mutator + SSE 模式）
    const { result: updated } = await updateRequirements(
      workspacePath,
      ({ current }) => {
        const prev = current[requirementId]
        if (prev === undefined) {
          throw new SkyAxisHostError('requirement-not-found', `requirement ${requirementId} not found in mate.yaml`)
        }
        // 并发兜底：另一路径已绑定 session 则不覆盖
        if (prev.aiSessionId !== null) {
          return { next: current, result: prev }
        }
        const next: Requirement = {
          ...prev,
          aiSessionId: sessionId,
          aiState: 'running',
          aiLastActivityAt: now,
          updatedAt: now,
        }
        return { next: { ...current, [requirementId]: next }, result: next }
      },
      { now },
    )
    this.emitChange({ operation: 'put', item: updated })
    console.info(`[sky-axis:ai] ensureSession: wrote back aiSessionId=${sessionId} aiState=running for ${requirementId} → SSE put emitted`)

    // 接入 2.2：首次 prompt 注入 —— 让 agent 主动开始干活，把 session 的 blank 翻 false。
    //
    // 设计：发一段静态上下文 + 5 阶段协议提醒。mode='queue'（不打断 host 内部启动）
    // + 同步等首 prompt ack（agent 入队后 host 立即返回）。
    //
    // 内容策略：先验证「agent 能基于上下文开始干活」的最小闭环；PRD 全文 + materials
    // 摘要留到接入 3+ 增量加载。
    //
    // 失败兜底：prompt 失败不影响 aiSessionId/aiState 已写回的事实 —— agent 仍然 idle
    // 等用户在 sidebar 那个 session 里手动打字。
    try {
      const promptText = this.buildInitialPrompt(updated, workspacePath)
      // DSH SessionPromptRequest.requestId 是 required（commands.js:289 立刻用 request.requestId 填 source.rpcId）。
      // sky-axis 自己 mint UUID —— DSH 内部对值格式无要求，只要求非空字符串。
      const requestId = `sky-axis-${require('node:crypto').randomUUID()}`
      await this.sessionController.prompt({
        requestId: requestId as never,
        sessionId: sessionId as never,
        mode: 'queue',
        content: [{ type: 'text', text: promptText }],
      } as never, new AbortController().signal)
      console.info(`[sky-axis:ai] ensureSession: initial prompt queued for ${requirementId} (${promptText.length} chars, requestId=${requestId})`)
    } catch (e) {
      // DSH 任何 prompt 错误都被 commands.js:317 包成 `session/agent-busy: prompt rejected`，
      // 真实 reason 在 e.message 或 e.cause 里。打完整对象便于排查。
      const errAny = e as { message?: string; cause?: unknown; data?: unknown }
      console.warn(`[sky-axis:ai] ensureSession: initial prompt failed (session still alive, user can type in DSH sidebar)`)
      console.warn(`[sky-axis:ai]   message: ${errAny.message ?? '(none)'}`)
      console.warn(`[sky-axis:ai]   full error:`, e)
      if (errAny.data !== undefined) console.warn(`[sky-axis:ai]   data:`, errAny.data)
      if (errAny.cause !== undefined) console.warn(`[sky-axis:ai]   cause:`, errAny.cause)
    }

    return updated
  }

  /**
   * 接入 2.2：构造首次 prompt 文本 —— 静态上下文 + 5 阶段协议提醒。
   *
   * 内容：
   *   - 当前 requirement 关键字段（id / title / description / priority / stage / tags）
   *   - Workspace 路径 + PRD 文件路径（agent 可读）
   *   - 当前 stageHistory（让 agent 知道之前有没有 rewind）
   *   - 5 阶段协议提示（提醒调 advance_stage tool）
   *
   * @param req  - 已写回 aiSessionId 的 requirement
   * @param workspacePath - DSH workspace path（已 resolve）
   */
  private buildInitialPrompt(req: Requirement, workspacePath: string): string {
    const prdFiles = req.materials.prdFiles.map(f => f.path).join(', ') || '(无)'
    const tags = req.tags.length > 0 ? req.tags.join(', ') : '(无)'
    const history = req.stageHistory
      .map(h => `  - ${h.stage}${h.leftAt !== undefined ? ` → leftAt=${h.leftAt}` : ' (current)'} (enteredAt=${h.enteredAt})`)
      .join('\n')
    return `你是 sky-axis 协作 agent。需求 ID: ${req.id}

## 需求快照
- 标题: ${req.title}
- 描述: ${req.description.length > 0 ? req.description : '(空)'}
- 优先级: ${req.priority}
- 当前 stage: ${req.stage}
- 标签: ${tags}

## Workspace 上下文
- Workspace 路径: ${workspacePath}
- PRD 文件: ${prdFiles}

## Stage history
${history}

## 行动指引
请按 5 阶段协议（understand → plan → implement → verify → deliver）推进本需求：
1. 先读 PRD + 现有代码（understand 阶段）
2. 产出 tasks.json（plan 阶段，**严格 JSON，无 markdown fence**）
3. 每个阶段产出符合 stage contract 时立即调 advance_stage(toStage) tool
4. 任意阶段遇到阻塞可调 ask_user_question 申请用户介入

session 已绑定到本需求，follow 流已启动，sky-axis UI 实时显示 aiState / stage / task list。开始工作。`
  }

  /**
   * 接入 1：启动 per-requirement session follow 流（幂等）。
   *
   * 对 req.aiSessionId 对应的 DSH session 调 sessionController.follow()，
   * 由 ai-event-bridge 把 SessionFollowFrame 翻译成 aiState 变化，
   * 通过 onAiStateChange callback 写回 mate.yaml + emitChange put。
   *
   * 幂等：已有活跃 follow 流则 return。重启恢复由 index.ts bootstrap 调用。
   * 流的生命周期：AbortController 管；stopFollow / close() abort 释放。
   */
  startFollow(requirementId: RequirementId): void {
    if (this.followControllers.has(requirementId)) return // 幂等
    console.info(`[sky-axis:ai] startFollow: starting follow stream for ${requirementId}`)
    const controller = new AbortController()
    this.followControllers.set(requirementId, controller)
    void this.consumeSessionFollow(requirementId, controller.signal).catch((err) => {
      if (controller.signal.aborted) return
      // eslint-disable-next-line no-console
      console.warn(`[sky-axis] session follow stream for ${requirementId} aborted:`, err)
    })
  }

  /** 接入 1：停止 per-requirement session follow 流。幂等。 */
  stopFollow(requirementId: RequirementId): void {
    const controller = this.followControllers.get(requirementId)
    if (controller === undefined) return
    controller.abort()
    this.followControllers.delete(requirementId)
    this.lastAiState.delete(requirementId)
  }

  /**
   * 接入 1：消费 session follow 流（同 consumeWorkspaceFollow 范式）。
   *
   * while + for await + signal + 重连退避。调 ai-event-bridge 翻译帧，
   * 通过 onAiStateChange callback 写回 aiState。
   */
  private async consumeSessionFollow(requirementId: RequirementId, signal: AbortSignal): Promise<void> {
    // 延迟 import 避免循环依赖（ai-event-bridge 复用本 service 类型）
    const { consumeFollowStream } = await import('./ai-event-bridge.ts')
    while (!signal.aborted) {
      try {
        const req = await this.get(requirementId)
        if (req === undefined || req.aiSessionId === null) return
        // 接入 2：初始化 stage cache（同步访问用）
        this.stageCache.set(requirementId, req.stage)
        const sessionId = req.aiSessionId
        await consumeFollowStream({
          sessionController: this.sessionController,
          sessionId,
          signal,
          onAiStateChange: async (state, activityAt) => {
            await this.applyAiStateChange(requirementId, state, activityAt)
          },
          // 接入 2：tool/call 'advance_stage' → 推进 stageHistory
          onAdvanceStage: async (toStage, reason, activityAt) => {
            await this.applyAdvanceStage(requirementId, toStage, reason, activityAt)
          },
          // 接入 2：assistant/message plan JSON → 写 Artifact(kind='plan')
          onPlanArtifact: async (taskList, activityAt) => {
            await this.applyPlanArtifact(requirementId, taskList as unknown as TaskList, activityAt)
          },
          // 接入 2：plan 提取阶段门控（仅 understand/plan 阶段触发）。
          //   同步：从 stageCache 取 —— consumeSessionFollow 入口处先 await get()
          //   初始化 cache，bridge 整个 for-await 周期内保持一致。
          currentStage: () => this.stageCache.get(requirementId) ?? 'understand',
        })
        // follow 正常结束（generator return）→ 兜底置 idle
        await this.applyAiStateChange(requirementId, 'idle', new Date().toISOString())
        break
      } catch (err) {
        if (signal.aborted) throw err
        // eslint-disable-next-line no-console
        console.warn(`[sky-axis] session follow for ${requirementId} failed; retrying after backoff:`, err)
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
      }
    }
  }

  /**
   * 接入 1：把 aiState 变化写回 mate.yaml + emitChange put。
   * 去重防抖：同状态（lastAiState）不重复写盘。
   */
  private async applyAiStateChange(
    requirementId: RequirementId,
    state: string,
    activityAt: string,
  ): Promise<void> {
    // 去重：同状态不重复写（turn/start 高频触发）
    if (this.lastAiState.get(requirementId) === state) return
    this.lastAiState.set(requirementId, state)
    console.info(`[sky-axis:ai] applyAiStateChange: ${requirementId} aiState=${state} (from follow stream)`)

    const req = await this.get(requirementId)
    if (req === undefined || req.aiSessionId === null) return
    const workspacePath = await this.resolveWorkspacePath(req.workspaceId)
    const now = new Date().toISOString()
    const { result: updated } = await updateRequirements(
      workspacePath,
      ({ current }) => {
        const prev = current[requirementId]
        if (prev === undefined || prev.aiSessionId === null) {
          return { next: current, result: prev ?? req }
        }
        const next: Requirement = {
          ...prev,
          aiState: state as Requirement['aiState'],
          aiLastActivityAt: activityAt,
          updatedAt: now,
        }
        return { next: { ...current, [requirementId]: next }, result: next }
      },
      { now },
    )
    this.emitChange({ operation: 'put', item: updated })
  }

  /* ── 跨 workspace list / get ── */

  /**
   * 列出全部 workspace 中的全部 requirements,按 id 倒序(最新在前)。
   * Sprint 5 改造:跨 workspace 扫描;每次全量读(workspace 数量 < 100 时足够便宜)。
   */
  async list(): Promise<Requirement[]> {
    const all = await this.readAllAcrossWorkspaces()
    all.sort((a, b) => b.id.localeCompare(a.id))
    return all
  }

  /**
   * 取一条 requirement;不存在返回 undefined。
   * Sprint 5:先查反向索引;miss 时全量扫表(重建索引)再 get。
   */
  async get(id: RequirementId): Promise<Requirement | undefined> {
    const cachedPath = this.requirementWorkspaceIndex.get(id)
    if (cachedPath !== undefined) {
      const req = await readRequirementFromStore(cachedPath, id)
      if (req !== undefined) return req
      // 索引 stale(req 已被外部删)→ 清掉 + 全量扫
      this.requirementWorkspaceIndex.delete(id)
    }
    // 全量扫表 + 重建索引
    const all = await this.readAllAcrossWorkspaces()
    for (const r of all) {
      const wsPath = await this.resolveWorkspacePath(r.workspaceId)
      this.requirementWorkspaceIndex.set(r.id, wsPath)
    }
    return all.find(r => r.id === id)
  }

  /**
   * 1:1 不变量自检:扫一遍全部 workspace,收集「同一 workspaceId 下 ≥2 条需求」的冲突组。
   * 返回数组每个元素 = 同一 workspace 下的全部 requirements(≥2 条)。
   */
  async findDuplicateWorkspaceRequirements(): Promise<Requirement[][]> {
    const all = await this.readAllAcrossWorkspaces()
    return findDuplicateWorkspaceGroups(all)
  }

  /**
   * 跨 workspace 读全部 requirement + 增量维护反向索引。
   * workspace 列表来自 `workspaceViewCache`(由 follow 流驱动)。
   *
   * 注意:某个 workspace 的 mate.yaml 损坏 → 跳过该 workspace + console.warn。
   * (Sprint 5 的 yaml-parse-failed 错误码;不影响其他 workspace 列表)
   */
  private async readAllAcrossWorkspaces(): Promise<Requirement[]> {
    const paths = await this.resolveAllWorkspacePaths()
    const out: Requirement[] = []
    for (const wsPath of paths) {
      try {
        const section = await readAllRequirements(wsPath)
        for (const req of Object.values(section)) {
          out.push(req)
          this.requirementWorkspaceIndex.set(req.id, wsPath)
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[sky-axis] readAllRequirements(${wsPath}) failed:`, e)
      }
    }
    return out
  }

  /* ── 创建 / 删除 ── */

  /**
   * 新建一条需求。流程:
   *   1. 解析 workspaceId → 真实 path(缓存 + 校验)
   *   2. **1:1 不变量校验**:read-modify-write 锁内扫当前 section,
   *      命中同 workspaceId 的现存需求 → 抛 `workspace-already-has-requirement`
   *   3. 构造 Requirement 实体(含 id / status / 时间戳)
   *   4. updateRequirements 写 mate.yaml + emit put 事件
   *
   * @throws SkyAxisHostError
   *   - 'workspace-not-found':workspaceId 不在 DSH 当前 workspace 列表
   *     (cache miss;baseline 还没到或真的不存在)
   *   - 'workspace-already-has-requirement':该 workspace 已有关联 requirement
   *   - 'yaml-parse-failed' / 'yaml-write-failed' / 'yaml-lock-timeout':mate.yaml IO
   */
  async create(input: NewRequirement): Promise<Requirement> {
    const workspacePath = await this.resolveWorkspacePath(input.workspaceId)

    // 1:1 不变量(Plan I):同一 path 最多 1 个 req(跨 DSH workspace 共享)
    const existing = await findExistingRequirementAtPath(workspacePath)
    if (existing !== undefined) {
      throw new SkyAxisHostError(
        'requirement-already-exists-at-path',
        `path '${workspacePath}' already has requirement '${existing.id}' (status=${existing.status}); ` +
        `call importRequirement to re-attach it to workspace '${input.workspaceId}'`,
      )
    }

    const now = new Date().toISOString()
    const id = makeRequirementId()
    const requirement: Requirement = {
      id,
      workspaceId: input.workspaceId,
      title: input.title,
      priority: input.priority,
      status: 'open',
      tags: input.tags,
      createdAt: now,
      updatedAt: now,
      ...defaultRequirementFields({ now, input }),
    }

    const { result } = await updateRequirements(
      workspacePath,
      ({ current }) => {
        // file lock 内再 check 一次(防 TOCTOU —— create 与 import 并发)
        const items = Object.values(current)
        if (items.length > 0) {
          throw new SkyAxisHostError(
            'requirement-already-exists-at-path',
            `path '${workspacePath}' already has requirement '${items[0].id}' (raced); call importRequirement`,
          )
        }
        return {
          next: { ...current, [id]: requirement },
          result: requirement,
        }
      },
      { now },
    )
    this.requirementWorkspaceIndex.set(result.id, workspacePath)
    this.emitChange({ operation: 'put', item: result })
    return result
  }

  /**
   * 把 path 上已有的 requirement 重新归属到当前 DSH workspace。
   *
   * Plan I:用于"DSH 工作区删 + 重建同路径"场景 —— sky-axis 数据全保留,
   * 仅切换 owner uuid。改写 req.workspaceId + updatedAt,其他字段(prd/附件
   * /源码仓库/AI 状态/阶段历史)完全保留。
   *
   * 失败语义:
   *   - path 上无 req → 'requirement-not-found'
   *   - path 上多个 req → 'invalid-record'(1:1 强约束被破坏;通常不应发生,
   *     若发生说明历史数据有遗留,需要人工清理)
   *   - file lock / yaml IO → 'yaml-lock-timeout' / 'yaml-write-failed' / 'yaml-parse-failed'
   *
   * @returns 更新后的 req
   */
  async importRequirement(
    workspacePath: string,
    currentWorkspaceId: SkyAxisWorkspaceId,
  ): Promise<Requirement> {
    const now = new Date().toISOString()
    const { result } = await updateRequirements(
      workspacePath,
      ({ current }) => {
        const items = Object.values(current)
        if (items.length === 0) {
          throw new SkyAxisHostError(
            'requirement-not-found',
            `no requirement at path '${workspacePath}' to import`,
          )
        }
        if (items.length > 1) {
          throw new SkyAxisHostError(
            'invalid-record',
            `path '${workspacePath}' has ${items.length} requirements; ` +
            `1:1 invariant violated — manual cleanup required`,
          )
        }
        const existing = items[0]
        const updated: Requirement = {
          ...existing,
          workspaceId: currentWorkspaceId,  // Plan I 起可变(owner 切换)
          updatedAt: now,
        }
        return {
          next: { ...current, [existing.id]: updated },
          result: updated,
        }
      },
      { now },
    )
    this.requirementWorkspaceIndex.set(result.id, workspacePath)
    this.emitChange({ operation: 'put', item: result })
    return result
  }

  /**
   * 删除一条需求。
   *
   * @returns true 表示记录原本存在并被删除;false 表示 id 不存在(幂等无操作)。
   */
  async remove(id: RequirementId): Promise<boolean> {
    let workspacePath = this.requirementWorkspaceIndex.get(id)
    if (workspacePath === undefined || workspacePath === '') {
      workspacePath = await this.resolveWorkspacePathViaScan(id)
    }
    if (workspacePath === undefined || workspacePath === '') return false

    let removed = false
    await updateRequirements(
      workspacePath,
      ({ current }) => {
        if (current[id] === undefined) {
          removed = false
          return { next: current, result: false }
        }
        const { [id]: _removed, ...rest } = current
        removed = true
        return { next: rest, result: true }
      },
      { now: new Date().toISOString() },
    )
    if (removed) {
      this.requirementWorkspaceIndex.delete(id)
      this.emitChange({ operation: 'deleted', id })
    }
    return removed
  }

  /* ── 物料 CRUD ── */

  /**
   * 上传一个 PRD 文件(multipart 走 PrdFile / Attachment 服务方法)。
   * 写入顺序:**先落盘成功 → 再写 KV**(避免 KV 有记录但磁盘没文件)。
   * 失败回滚:落盘失败 → KV 不动;KV 写失败 → best-effort unlink 已落盘文件。
   */
  async addPrdFile(reqId: RequirementId, file: {
    content: Buffer
    filename: string
    mimeType: string
    size: number
    uploadedBy: UserId
  }): Promise<Requirement> {
    return await this.addFileSection('prdFiles', reqId, file)
  }

  async addAttachment(reqId: RequirementId, file: {
    content: Buffer
    filename: string
    mimeType: string
    size: number
    uploadedBy: UserId
  }): Promise<Requirement> {
    return await this.addFileSection('attachments', reqId, file)
  }

  /** 内部共用:文件类 section(prdFiles / attachments)上传。 */
  private async addFileSection(
    section: Extract<MaterialSection, 'prdFiles' | 'attachments'>,
    reqId: RequirementId,
    file: {
      content: Buffer
      filename: string
      mimeType: string
      size: number
      uploadedBy: UserId
    },
  ): Promise<Requirement> {
    const current = await this.get(reqId)
    if (current === undefined) {
      throw new SkyAxisHostError('requirement-not-found', `requirement ${reqId} not found`)
    }
    const workspacePath = await this.resolveWorkspacePath(current.workspaceId)
    const itemId = makeMaterialItemId()
    const { relativePath } = await writeMaterialFile({
      workspacePath,
      requirementId: reqId,
      section,
      itemId,
      filename: file.filename,
      content: file.content,
    })
    const now = new Date().toISOString()
    const newItem: PrdFile | Attachment = section === 'prdFiles'
      ? {
          id: itemId,
          filename: file.filename,
          mimeType: file.mimeType,
          size: file.size,
          uploadedAt: now,
          uploadedBy: file.uploadedBy,
          path: relativePath,
        }
      : {
          id: itemId,
          filename: file.filename,
          mimeType: file.mimeType,
          size: file.size,
          uploadedAt: now,
          uploadedBy: file.uploadedBy,
          path: relativePath,
        }

    try {
      const { result: updated } = await updateRequirements(
        workspacePath,
        ({ current: sec }) => {
          if (sec[reqId] === undefined) {
            throw new SkyAxisHostError(
              'requirement-not-found',
              `requirement ${reqId} not found during update`,
            )
          }
          const materials = sec[reqId]!.materials
          const nextList = section === 'prdFiles'
            ? [...materials.prdFiles, newItem as PrdFile]
            : [...materials.attachments, newItem as Attachment]
          if (nextList.length > MAX_MATERIALS_PER_SECTION) {
            throw new SkyAxisHostError(
              'validation-failed',
              `${section} exceeds ${MAX_MATERIALS_PER_SECTION} items limit`,
            )
          }
          return {
            next: {
              ...sec,
              [reqId]: {
                ...sec[reqId]!,
                materials: section === 'prdFiles'
                  ? { ...materials, prdFiles: nextList }
                  : { ...materials, attachments: nextList },
                updatedAt: now,
              },
            },
            result: sec[reqId]!,
          }
        },
        { now },
      )
      this.emitChange({ operation: 'put', item: updated })
      return updated
    } catch (e) {
      // 数量超限 / 写失败:回滚已落盘文件
      await unlinkMaterialFile(workspacePath, relativePath)
      throw e
    }
  }

  /**
   * 添加一个 PRD 链接(JSON 入参 —— url / title / source)。
   * 不需要落盘,直接更新 KV。
   */
  async addPrdLink(
    reqId: RequirementId,
    input: AddPrdLinkRequest,
    addedBy: UserId,
  ): Promise<Requirement> {
    const now = new Date().toISOString()
    return await this.addJsonSection('prdLinks', reqId, (id) => ({
      id,
      url: input.url,
      title: input.title,
      source: input.source,
      addedAt: now,
      addedBy,
    }))
  }

  /**
   * 添加一条源码仓库关联 —— 同步 git clone + 写 KV(Phase 2.6)。
   *
   * 顺序(**先落盘成功 → 再写 KV**):
   *   1. 解析 workspacePath(缓存 + 校验 workspace 存在)
   *   2. 从 URL 提取 repo 名 → destDir = `${workspacePath}/repos/${repoName}`
   *      (同 repo 不同 protocol 经 canonicalize 后命中同一目录)
   *   3. **KV dedup**:canonicalize URL 后比对已有 sourceRepos,命中抛 source-repo-duplicate
   *   4. gitService.clone({ url, branch, destDir, workspaceRoot: workspacePath, signal })
   *   5. updateRequirements:写完整 SourceRepo record(含 localPath / clonedAt / cloneStatus='cloned')
   *   6. 写失败 → best-effort rm -rf destDir(仅当 reused=false 时)
   */
  async addSourceRepo(
    reqId: RequirementId,
    input: AddSourceRepoRequest,
    addedBy: UserId,
    opts: { signal?: AbortSignal } = {},
  ): Promise<Requirement> {
    // 1. workspace 校验(同时拿 path)
    const requirement = await this.get(reqId)
    if (requirement === undefined) {
      throw new SkyAxisHostError('requirement-not-found', `requirement ${reqId} not found`)
    }
    const workspacePath = await this.resolveWorkspacePath(requirement.workspaceId)

    // 2. 从 URL 提取 repo 名 + canonical dedup key
    const canonical = canonicalizeRepoUrl(input.url)
    const repoName = extractRepoName(input.url)
    if (canonical === '' || repoName === '') {
      throw new SkyAxisHostError(
        'validation-failed',
        `cannot extract repo name from URL: ${input.url}`,
      )
    }
    const itemId = makeMaterialItemId()
    const destDir = join(workspacePath, SKY_AXIS_REPOS_DIR, repoName)

    // 3. KV dedup(防止同 requirement 重复关联同 repo,跨 protocol 视为相同)
    const existing = requirement.materials.sourceRepos
    for (const r of existing) {
      if (canonicalizeRepoUrl(r.url) === canonical) {
        throw new SkyAxisHostError(
          'source-repo-duplicate',
          `requirement ${reqId} already linked to ${canonical}`,
        )
      }
    }

    // 4. clone —— 失败抛 git-* 错误(不写 KV,不污染)
    const cloneResult = await this.gitService.clone({
      url: input.url,
      branch: input.branch,
      destDir,
      workspaceRoot: workspacePath,
      signal: opts.signal,
    })

    // 5. 写 KV
    const now = new Date().toISOString()
    const newRepo: SourceRepo = {
      id: itemId,
      url: input.url,
      branch: input.branch,
      lastCommitSha: cloneResult.lastCommitSha,
      description: input.description,
      addedAt: now,
      addedBy,
      localPath: cloneResult.localPath,
      clonedAt: now,
      cloneStatus: 'cloned',
    }

    try {
      const { result: updated } = await updateRequirements(
        workspacePath,
        ({ current }) => {
          const prev = current[reqId]
          if (prev === undefined) {
            throw new SkyAxisHostError(
              'requirement-not-found',
              `requirement ${reqId} not found during addSourceRepo`,
            )
          }
          const list = prev.materials.sourceRepos
          // 防御性二次 dedup(防止并发请求绕过预检查)
          for (const r of list) {
            if (canonicalizeRepoUrl(r.url) === canonical) {
              throw new SkyAxisHostError(
                'source-repo-duplicate',
                `requirement ${reqId} already linked to ${canonical}`,
              )
            }
          }
          const nextList = [...list, newRepo]
          if (nextList.length > MAX_MATERIALS_PER_SECTION) {
            throw new SkyAxisHostError(
              'validation-failed',
              `sourceRepos exceeds ${MAX_MATERIALS_PER_SECTION} items limit`,
            )
          }
          return {
            next: {
              ...current,
              [reqId]: {
                ...prev,
                materials: { ...prev.materials, sourceRepos: nextList },
                updatedAt: now,
              },
            },
            result: prev,
          }
        },
        { now },
      )
      const finalReq: Requirement = {
        ...updated,
        materials: { ...updated.materials, sourceRepos: [...updated.materials.sourceRepos, newRepo] },
      }
      this.emitChange({ operation: 'put', item: finalReq })
      return finalReq
    } catch (e) {
      // 6. 写失败 → 仅当 reused=false 时清理(避免误删复用目录)
      if (!cloneResult.reused) {
        await this.gitService.removeSafe(destDir, workspacePath).catch(() => undefined)
      }
      throw e
    }
  }

  async addDesignLink(
    reqId: RequirementId,
    input: AddDesignLinkRequest,
    addedBy: UserId,
  ): Promise<Requirement> {
    const now = new Date().toISOString()
    return await this.addJsonSection('designLinks', reqId, (id) => ({
      id,
      url: input.url,
      kind: input.kind,
      title: input.title,
      thumbnailUrl: input.thumbnailUrl,
      addedAt: now,
      addedBy,
    }))
  }

  async addExternalLink(
    reqId: RequirementId,
    input: AddExternalLinkRequest,
    addedBy: UserId,
  ): Promise<Requirement> {
    const now = new Date().toISOString()
    return await this.addJsonSection('externalLinks', reqId, (id) => ({
      id,
      url: input.url,
      title: input.title,
      kind: input.kind,
      description: input.description,
      addedAt: now,
      addedBy,
    }))
  }

  /**
   * 内部共用:JSON 类 section(prdLinks / designLinks / externalLinks)添加。
   * 直接更新 KV,不需要落盘。
   *
   * @param makeItem - 构造新 item(id 由 host 生成,section 由 factory 决定)
   */
  private async addJsonSection<
    S extends Exclude<MaterialSection, 'prdFiles' | 'attachments'>,
  >(
    section: S,
    reqId: RequirementId,
    makeItem: (id: MaterialItemId) => Requirement['materials'][S][number],
  ): Promise<Requirement> {
    const current = await this.get(reqId)
    if (current === undefined) {
      throw new SkyAxisHostError('requirement-not-found', `requirement ${reqId} not found`)
    }
    const workspacePath = await this.resolveWorkspacePath(current.workspaceId)
    const itemId = makeMaterialItemId()
    const now = new Date().toISOString()
    const { result: updated } = await updateRequirements(
      workspacePath,
      ({ current: sec }) => {
        const prev = sec[reqId]
        if (prev === undefined) {
          throw new SkyAxisHostError(
            'requirement-not-found',
            `requirement ${reqId} not found`,
          )
        }
        const list = prev.materials[section]
        const newItem = makeItem(itemId)
        const nextList = [...list, newItem]
        if (nextList.length > MAX_MATERIALS_PER_SECTION) {
          throw new SkyAxisHostError(
            'validation-failed',
            `${section} exceeds ${MAX_MATERIALS_PER_SECTION} items limit`,
          )
        }
        return {
          next: {
            ...sec,
            [reqId]: {
              ...prev,
              materials: { ...prev.materials, [section]: nextList },
              updatedAt: now,
            },
          },
          result: prev,
        }
      },
      { now },
    )
    const finalReq: Requirement = {
      ...updated,
      materials: {
        ...updated.materials,
        [section]: [...updated.materials[section], makeItem(itemId)],
      },
    }
    this.emitChange({ operation: 'put', item: finalReq })
    return finalReq
  }

  /**
   * 移除一个物料项。
   * 顺序:**先 KV 后 unlink** —— UI 列表立刻一致优先;unlink 失败 best-effort。
   */
  async removeMaterial(
    reqId: RequirementId,
    section: MaterialSection,
    itemId: MaterialItemId,
  ): Promise<Requirement> {
    const current = await this.get(reqId)
    if (current === undefined) {
      throw new SkyAxisHostError('requirement-not-found', `requirement ${reqId} not found`)
    }
    const workspacePath = await this.resolveWorkspacePath(current.workspaceId)
    const list = current.materials[section]
    const targetIdx = list.findIndex((it) => (it as { id: string }).id === itemId)
    if (targetIdx === -1) {
      throw new SkyAxisHostError(
        'material-not-found',
        `material ${itemId} not in ${section}`,
      )
    }
    const target = list[targetIdx] as { id: string; path?: string; localPath?: string }
    const nextList = [...list.slice(0, targetIdx), ...list.slice(targetIdx + 1)]
    const now = new Date().toISOString()
    const { result: updated } = await updateRequirements(
      workspacePath,
      ({ current: sec }) => {
        const prev = sec[reqId]
        if (prev === undefined) {
          throw new SkyAxisHostError(
            'requirement-not-found',
            `requirement ${reqId} not found during remove`,
          )
        }
        return {
          next: {
            ...sec,
            [reqId]: {
              ...prev,
              materials: { ...prev.materials, [section]: nextList },
              updatedAt: now,
            },
          },
          result: prev,
        }
      },
      { now },
    )
    const finalReq: Requirement = {
      ...updated,
      materials: { ...updated.materials, [section]: nextList },
    }
    this.emitChange({ operation: 'put', item: finalReq })
    // 落盘清理:
    //   - prdFiles / attachments: unlink 单文件
    //   - sourceRepos: rm -rf 整个 repos/{itemId} 目录
    if (section === 'sourceRepos' && target.localPath !== undefined) {
      const destDir = join(workspacePath, target.localPath)
      await this.gitService.removeSafe(destDir, workspacePath)
    } else if (target.path !== undefined) {
      await unlinkMaterialFile(workspacePath, target.path)
    }
    return finalReq
  }

  /**
   * Sprint 4:把 AI artifact 落盘到 `outputs/${kind}/...` 并把相对路径回写到 KV。
   *
   * 顺序(**落盘成功 → 再写 KV**):
   *   1. 解析 workspacePath
   *   2. 校验 requirement 存在
   *   3. 落盘到 `outputs/${kind}/${fileName}`(沙箱断言 + 原子写)
   *   4. updateRequirements:把 artifact.path 写到对应 artifactId 的记录;
   *      写失败 → best-effort rm 落盘文件
   */
  async writeArtifact(reqId: RequirementId, artifact: Artifact): Promise<Requirement> {
    const current = await this.get(reqId)
    if (current === undefined) {
      throw new SkyAxisHostError('requirement-not-found', `requirement ${reqId} not found`)
    }
    const workspacePath = await this.resolveWorkspacePath(current.workspaceId)

    const { relativePath, absolutePath } = await artifactWriter.writeArtifact({
      workspacePath,
      requirementId: reqId,
      artifact,
    })

    const now = new Date().toISOString()
    try {
      const { result: updated } = await updateRequirements(
        workspacePath,
        ({ current: sec }) => {
          const prev = sec[reqId]
          if (prev === undefined) {
            throw new SkyAxisHostError(
              'requirement-not-found',
              `requirement ${reqId} not found during update`,
            )
          }
          const nextArtifacts = { ...prev.artifacts }
          const existing = nextArtifacts[artifact.id]
          nextArtifacts[artifact.id] = {
            ...(existing ?? artifact),
            ...artifact,
            path: relativePath,
          }
          return {
            next: {
              ...sec,
              [reqId]: { ...prev, artifacts: nextArtifacts, updatedAt: now },
            },
            result: prev,
          }
        },
        { now },
      )
      const finalReq: Requirement = {
        ...updated,
        artifacts: {
          ...updated.artifacts,
          [artifact.id]: {
            ...(updated.artifacts[artifact.id] ?? artifact),
            ...artifact,
            path: relativePath,
          },
        },
      }
      this.emitChange({ operation: 'put', item: finalReq })
      return finalReq
    } catch (e) {
      await artifactWriter.cleanupArtifact(workspacePath, absolutePath).catch(() => undefined)
      throw e
    }
  }

  /**
   * Phase 2.6 v2:扫一遍所有 workspace 的 `repos/` 目录,
   * 清理未引用的 UUID 形态孤儿(历史 destDir 命名规则残留)。
   */
  async cleanupOrphanRepos(): Promise<{ removed: string[]; scanned: number }> {
    const allRemoved: string[] = []
    let totalScanned = 0
    try {
      const items = await this.list()
      const live = new Set<string>()
      for (const r of items) {
        for (const repo of r.materials.sourceRepos) {
          if (repo.localPath !== undefined) live.add(repo.localPath)
        }
      }
      const seen = new Set<string>()
      for (const r of items) {
        try {
          const wsPath = await this.resolveWorkspacePath(r.workspaceId)
          if (seen.has(wsPath)) continue
          seen.add(wsPath)
          const result = await cleanupOrphanRepos(wsPath, live)
          allRemoved.push(...result.removed)
          totalScanned += result.scanned
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[sky-axis] orphan cleanup iteration failed:', e)
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[sky-axis] orphan cleanup aborted:', e)
    }
    return { removed: allRemoved, scanned: totalScanned }
  }

  /* ── 内部 helper ── */

  /**
   * 解析 workspaceId → 真实文件系统 path(同时校验 workspace 存在)。
   * 直接查 `workspaceViewCache`(由 follow 流驱动);cache hit 即返回,
   * miss 抛 `workspace-not-found`(包括 baseline 还没到的极罕见场景)。
   *
   * Public(Stage 6):migration helper 需要外部把 storage domain 残留 record
   * 搬到对应 workspace,无 service 内部方法能跨 workspace 解析 path —— 这里暴露。
   *
   * **Lazy bootstrap**(Sprint 5.1 补丁):
   *   - 启动 effect 只对启动时已存在的 workspace 跑 ensureMeta
   *   - 启动之后 DSH 新建的 workspace 在 cache miss → resolve 时补 ensureMeta
   *   - 否则 updateRequirements 会抛 `yaml-write-failed`(mate.yaml missing)
   *   - 幂等:已存在的 mate.yaml 命中 cross-check(workspaceId 一致)→ no-op
   *   - 已存在但 workspaceId 不一致 → 抛 cross-check-failed(数据完整性优先)
   *
   * 抛错:
   *   - `workspace-not-found`:workspaceId 不在 DSH 当前 workspace 列表
   *   - `yaml-write-failed`/cross-check-failed:ensureMeta 失败透传
   */
  async resolveWorkspacePath(workspaceId: SkyAxisWorkspaceId): Promise<string> {
    const cached = this.resolveWorkspacePathFromCache(workspaceId)
    if (cached !== undefined) {
      // Lazy bootstrap:即便缓存命中也确认 mate.yaml 存在 —— 启动之后新
      // workspace 被 ensureMeta 跳过(没在启动 effect bootstrap 列表里)
      await this.ensureWorkspaceBootstrap(cached, workspaceId)
      return cached
    }

    // 0.1.2:缓存 miss 后不再主动 refresh —— cache 由 follow 流维护。
    // 这里要么是 cache 真的空(baseline 还没到,极罕见)、要么是这个
    // workspaceId 不存在。前者再 throw workspace-not-found 也是合理
    // (调用方重试可拿到 baseline);后者本来就是错误语义。
    const view = this.workspaceViewCache.get(workspaceId)
    if (view === undefined) {
      throw new SkyAxisHostError(
        'workspace-not-found',
        `workspace '${workspaceId}' is not in the current DSH workspace registry`,
      )
    }
    const path = view.path
    await this.ensureWorkspaceBootstrap(path, workspaceId)
    return path
  }

  /**
   * 幂等 ensureMeta —— 启动 effect 漏掉的 workspace 在第一次写路径前补齐。
   *
   * Plan H:workspaceId 是 informational —— DSH uuid 轮换（删 + 重建同路径）
   * 不再触发 cross-check。path 不一致仍然抛（operator 把 mate.yaml 拷到别的
   * 目录是真实损坏）。
   *
   * 失败语义:
   *   - `cross-check-failed`:仅 path mismatch → 抛 yaml-write-failed
   *   - `invalid`:yaml 损坏 → 抛 yaml-parse-failed
   *   - 其他 WorkspaceMetaError(io-failed):抛 yaml-write-failed
   *   - 非 WorkspaceMetaError 错误:console.warn 不抛
   *   - 成功(初次 / refresh lastTouchedAt / id 自动更新):静默
   */
  private async ensureWorkspaceBootstrap(
    workspacePath: string,
    workspaceId: SkyAxisWorkspaceId,
  ): Promise<void> {
    try {
      await ensureMeta(workspacePath, {
        // Plan H:此处 workspaceId 写入 mate.yaml 作为 informational trace。
        // DSH 删 + 重建同路径工作区时,新 uuid 会自动覆盖旧值(无 cross-check)。
        workspaceId,
        // 0.1.2:workspaceViewCache 里其实有 title,但本方法在 resolveWorkspacePath
        // 命中缓存后调用,调用栈里没传 title(签名上也不传);ensureMeta 接受
        // 空字符串,启动 effect 会用真实 title 覆盖。
        workspaceTitle: '',
        skyAxisVersion: SKY_AXIS_PLUGIN_VERSION,
        now: new Date().toISOString(),
      })
    } catch (e) {
      // WorkspaceMetaError → 翻译成 SkyAxisHostError 让 route 统一处理
      if (e instanceof WorkspaceMetaError) {
        if (e.code === 'cross-check-failed') {
          // Plan H:仅 path mismatch 会触发此分支(uuid 差异已不抛)
          throw new SkyAxisHostError(
            'yaml-write-failed',
            `workspace meta path conflict for ${workspacePath}: ${e.message}`,
          )
        }
        if (e.code === 'invalid') {
          throw new SkyAxisHostError(
            'yaml-parse-failed',
            `workspace meta invalid for ${workspacePath}: ${e.message}`,
          )
        }
        throw new SkyAxisHostError(
          'yaml-write-failed',
          `workspace meta IO failed for ${workspacePath}: ${e.message}`,
        )
      }
      // 其他非预期错误:console.warn 不抛,让后续 updateRequirements 暴露
      // eslint-disable-next-line no-console
      console.warn(
        `[sky-axis] ensureWorkspaceBootstrap(${workspacePath}, ${workspaceId}) failed:`,
        e,
      )
    }
  }

  /**
   * 仅查缓存(不发 API);用于反向索引命中后的路径推导 + 命中后的快速路径。
   *
   * 0.1.2:不再做 TTL 检查 —— 缓存由 `consumeWorkspaceFollow` 流驱动,
   * 任何时候 cache 里有就直接返回;空集意味着 baseline 还没到(罕见,只在
   * apply 启动到首帧之间)→ 返回 undefined 让上层走 fallback。
   */
  private resolveWorkspacePathFromCache(workspaceId: SkyAxisWorkspaceId): string | undefined {
    return this.workspaceViewCache.get(workspaceId)?.path
  }

  /**
   * 拿全部 workspace path(直接读缓存;仅 `readAllAcrossWorkspaces` 内部用)。
   *
   * 0.1.2:不再调主动 refresh —— 缓存由 follow 流维护。
   * 空集意味着 baseline 还没到,返回 `[]`(扫描不到任何 requirement,
   * 不抛错,与 0.1.1 的空 cache 语义一致)。
   */
  private async resolveAllWorkspacePaths(): Promise<string[]> {
    return [...this.workspaceViewCache.values()].map(view => view.path)
  }

  /**
   * 公开:等首帧 baseline 到达后 resolve —— 启动期一次性 bootstrap
   * (ensureMeta / fs-watch / migration)需要全量 workspace 列表,这里
   * 是 0.1.2 唯一阻塞等待流首帧的位置;后续 resolveWorkspacePath /
   * resolveAllWorkspacePaths 都走同步缓存。
   *
   * 失败:流连不上(controller 重启 / DSH 进程崩溃)→ 抛 controller
   * 错误。host apply 应把 bootstrap 嵌入 try/catch,失败 console.warn
   * 不阻塞 webServer。
   */
  whenBaselineReady(): Promise<readonly WorkspaceView[]> {
    return this.baselineReady.promise
  }

  /**
   * 公开:同步拿当前 cache 里的全部 WorkspaceView。
   * 给 routes/requirements.ts#GET /workspaces(以及未来的 workspace
   * detail 端点)用 —— 透传 client,作为 `useWorkspaces()` 的 fallback。
   *
   * 不发请求,空集 = baseline 还没到(返回 `[]`,由 route 决定要不要
   * 503 / fallback)。
   */
  getWorkspaceViews(): readonly WorkspaceView[] {
    return this.snapshotViews()
  }

  /**
   * 通过反向索引 miss 时,全量扫表找 reqId 对应的 workspacePath。
   * 主要给 remove(id) 用 —— 避免在缓存里 + 反向索引 stale 时假阴性。
   */
  private async resolveWorkspacePathViaScan(id: RequirementId): Promise<string | undefined> {
    await this.readAllAcrossWorkspaces()  // 顺带重建反向索引
    return this.requirementWorkspaceIndex.get(id)
  }
}

/* ── 类型 re-export(避免 consumer 反复 import @deepseek-ai/dsh-api-workspace-controller)── */
// 0.1.2 迁移:原 `ApiProxy` 已删,替换为 `WorkspaceController`。
// `WorkspaceId` 从 `dsh-host-apiproxy` 改到 `dsh-api-workspace-controller`。
export type { WorkspaceController, WorkspaceId }