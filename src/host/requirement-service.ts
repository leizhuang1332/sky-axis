/**
 * sky-axis 插件 host 半区业务服务 —— 持有 apiProxy 引用 + workspacePathCache,
 * 封装所有「需求」相关的业务逻辑(list / get / create / delete / 物料 CRUD /
 * artifact 落盘),供 host routes 调用。
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
 * 生命周期:
 *   1. 构造:不再异步初始化(没有 domain open);同步建好,直接可用
 *   2. 业务方法:全部 await resolveWorkspacePath / readAllRequirements / updateRequirements
 *   3. 关闭:close() 幂等;目前无外部资源(Stage 6 fs-watcher-manager 由 index.ts 持有)
 *
 * 关键设计:
 *   - ID 生成:`${ISO}-${rand6}`,可 localeCompare 排序,碰撞概率极低
 *   - workspace 校验:create 时调 apiProxy.workspace.list 校验 workspaceId 真实存在
 *   - 1:1 不变量:在 mutator 内部检查(read-modify-write 锁内原子检查 + 写)
 *   - 不存 workspace 元数据快照:仅存 workspaceId(FK)
 */
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { WorkspaceId } from '@deepseek-ai/dsh-host-apiproxy'
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
  UserId,
  WorkspaceId as SkyAxisWorkspaceId,
  SkyAxisErrorCode,
  defaultRequirementFields,
} from '../protocol.ts'
import * as artifactWriter from './artifact-writer.ts'
import { skyAxisRequest } from './rpc-helper.ts'
import {
  createGitService,
  SKY_AXIS_REPOS_DIR,
  type GitService,
} from './git-service.ts'
import { cleanupOrphanRepos } from './repo-cleanup.ts'
import { canonicalizeRepoUrl, extractRepoName } from './url-utils.ts'
import {
  findRequirementByWorkspace,
  findDuplicateWorkspaceGroups,
} from './workspace-uniqueness.ts'
import type { RequirementsSection } from './workspace-meta.ts'
import { ensureMeta, WorkspaceMetaError } from './workspace-meta.ts'
import {
  readAllRequirements,
  readRequirement as readRequirementFromStore,
  updateRequirements,
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
 */
export class RequirementHostService {
  /** workspaceId → 真实 path 的本地缓存(每次 list workspace 后刷新一次)。 */
  private workspacePathCache = new Map<SkyAxisWorkspaceId, string>()
  /** workspace 列表上次拉取时间(ms epoch),用于缓存 TTL。 */
  private workspaceCacheLoadedAt = 0
  /** 缓存 TTL:60s —— workspace 创建/删除/重命名后最长 60s 同步。 */
  private static readonly WORKSPACE_CACHE_TTL_MS = 60_000

  /**
   * reqId → workspacePath 反向索引(供 get(id) 用)。
   * - 懒填充:第一次 get(id) 时按当前 workspacePathCache 扫一遍
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

  /** Phase 2.6 源码关联:git 沙箱封装(stateless,可在多 service 间共享)。 */
  readonly gitService: GitService = createGitService()

  constructor(
    private readonly ctx: import('@deepseek-ai/cordis').Context,
    /** apiProxy 公开给 host routes 使用(fetchWorkspaces 路由通过它拉 workspace 列表)。 */
    readonly apiProxy: ApiProxy,
  ) {
    // 不再需要 storageDomain 注入;Stage 6 由 fs-watcher-manager 推 emitChange
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

  /**
   * 关闭 service(幂等)。释放 domain handle 触发 backend unit close;
   * DSH host 重启 / 插件卸载时调用。
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.domainChangeListeners.clear()
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
   * workspace 列表来自 apiProxy.workspace.list(60s TTL 缓存)。
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
   *   - 'workspace-list-failed':apiProxy.workspace.list 返回 RpcResult 失败
   *   - 'workspace-already-has-requirement':该 workspace 已有关联 requirement
   *   - 'yaml-parse-failed' / 'yaml-write-failed' / 'yaml-lock-timeout':mate.yaml IO
   */
  async create(input: NewRequirement): Promise<Requirement> {
    const workspacePath = await this.resolveWorkspacePath(input.workspaceId)

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
        // 1:1 不变量校验 —— 锁内原子检查(防止并发 create 同一 workspace)
        const dup = findRequirementByWorkspace(Object.values(current), input.workspaceId)
        if (dup !== undefined) {
          throw new SkyAxisHostError(
            'workspace-already-has-requirement',
            `workspace '${input.workspaceId}' already has requirement '${dup.id}' (status=${dup.status}); delete it first to create a new one`,
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
   * 60s 内不重复拉 apiProxy.workspace.list(缓存命中直接返回)。
   */
  /**
   * 解析 workspaceId → 真实文件系统 path(同时校验 workspace 存在)。
   * 60s 内不重复拉 apiProxy.workspace.list(缓存命中直接返回)。
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
   *   - `workspace-list-failed`:apiProxy.workspace.list 返回 RpcResult 失败
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

    await this.refreshWorkspacePathCache()
    const path = this.workspacePathCache.get(workspaceId)
    if (path === undefined) {
      throw new SkyAxisHostError(
        'workspace-not-found',
        `workspace '${workspaceId}' is not in the current DSH workspace registry`,
      )
    }
    await this.ensureWorkspaceBootstrap(path, workspaceId)
    return path
  }

  /**
   * 幂等 ensureMeta —— 启动 effect 漏掉的 workspace 在第一次写路径前补齐。
   *
   * 失败语义:
   *   - `cross-check-failed`:mate.yaml 已存在但 workspaceId 不一致 → 抛
   *     (数据完整性优先,不覆盖用户手工写的 mate.yaml)
   *   - 其他 WorkspaceMetaError(invalid / io-failed):console.warn 不抛
   *     —— 让后续 updateRequirements 自己抛 yaml-write-failed,便于诊断
   *   - 成功(初次或刷新 lastTouchedAt):静默
   */
  private async ensureWorkspaceBootstrap(
    workspacePath: string,
    workspaceId: SkyAxisWorkspaceId,
  ): Promise<void> {
    try {
      await ensureMeta(workspacePath, {
        workspaceId,
        // title 在 service 层拿不到(workspacePathCache 只存 path)
        // ensureMeta 接受空字符串,启动 effect 会用真实 title 覆盖
        workspaceTitle: '',
        skyAxisVersion: SKY_AXIS_PLUGIN_VERSION,
        now: new Date().toISOString(),
      })
    } catch (e) {
      // WorkspaceMetaError → 翻译成 SkyAxisHostError 让 route 统一处理
      if (e instanceof WorkspaceMetaError) {
        if (e.code === 'cross-check-failed') {
          throw new SkyAxisHostError(
            'yaml-write-failed',
            `workspace meta conflict for ${workspacePath}: ${e.message}`,
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
   */
  private resolveWorkspacePathFromCache(workspaceId: SkyAxisWorkspaceId): string | undefined {
    const now = Date.now()
    if (
      this.workspacePathCache.size > 0
      && now - this.workspaceCacheLoadedAt < RequirementHostService.WORKSPACE_CACHE_TTL_MS
    ) {
      return this.workspacePathCache.get(workspaceId)
    }
    return undefined
  }

  /**
   * 拿全部 workspace path(无 TTL 校验,每次都拉;仅 readAllAcrossWorkspaces 内部用)。
   */
  private async resolveAllWorkspacePaths(): Promise<string[]> {
    await this.refreshWorkspacePathCache()
    return [...this.workspacePathCache.values()]
  }

  /** 刷 workspacePathCache(60s TTL)。 */
  private async refreshWorkspacePathCache(): Promise<void> {
    const now = Date.now()
    if (
      this.workspacePathCache.size > 0
      && now - this.workspaceCacheLoadedAt < RequirementHostService.WORKSPACE_CACHE_TTL_MS
    ) {
      return
    }
    const response = await this.apiProxy.workspace.list(skyAxisRequest({}))
    if (!response.result.ok) {
      throw new SkyAxisHostError(
        'workspace-list-failed',
        `apiProxy.workspace.list failed: ${response.result.error.code}: ${response.result.error.message}`,
      )
    }
    const fresh = new Map<SkyAxisWorkspaceId, string>()
    for (const item of response.result.value.items) {
      fresh.set(item.workspaceId as unknown as SkyAxisWorkspaceId, item.path)
    }
    this.workspacePathCache = fresh
    this.workspaceCacheLoadedAt = now
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

/**
 * sky-axis workspace 元数据拉取(透传给 client,client 端首选 ctx.workspaces.list;
 * 仅当 client 注入失败 / 老版本兼容时 fallback)。
 */
export async function fetchWorkspaces(apiProxy: ApiProxy): Promise<Array<{ id: SkyAxisWorkspaceId; title: string; path: string }>> {
  const response = await apiProxy.workspace.list(skyAxisRequest({}))
  if (!response.result.ok) {
    throw new SkyAxisHostError(
      'workspace-list-failed',
      `apiProxy.workspace.list failed: ${response.result.error.code}: ${response.result.error.message}`,
    )
  }
  return response.result.value.items.map(item => ({
    id: item.workspaceId as unknown as SkyAxisWorkspaceId,
    title: item.title !== '' ? item.title : basename(item.path),
    path: item.path,
  }))
}

/** 兼容 node:path.basename 但不需要 import path 全套。 */
function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? p : p.slice(i + 1)
}

/* ── 类型 re-export(避免 consumer 反复 import @deepseek-ai/dsh-host-apiproxy)── */
export type { ApiProxy, WorkspaceId }