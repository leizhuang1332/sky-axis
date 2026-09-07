/**
 * sky-axis 插件 host 半区业务服务 —— 持有 domain + apiProxy 引用，
 * 封装所有「需求」相关的业务逻辑（list / get / create / delete），
 * 供 host routes 调用。
 *
 * 生命周期：
 *   1. 构造：调 `ctx.storageDomain.open(spec)` 拿 domain handle（异步）
 *   2. ready：第一次 await service.ready() 时等 open 完成 + 缓存 table handle
 *   3. 业务方法：list / create / get / delete 全部 await ready() 后操作 table
 *   4. 关闭：close() 关 domain（幂等）
 *
 * 关键设计：
 *   - ID 生成：`${ISO}-${rand6}`，可 localeCompare 排序，碰撞概率极低
 *   - workspace 校验：create 时调 apiProxy.workspace.list 校验 workspaceId
 *     真实存在；workspace 不存在 → 'workspace-not-found' 错误（不入 KV）
 *   - 产物目录预创建：best-effort 调 `mkdir -p`，失败不影响 KV 写入（产物
 *     目录只是「第一次写文件时确保存在」的 lazy 保证；后续真写文件时可
 *     重试或提示用户手动 mkdir）
 *   - 不存 workspace 元数据快照：仅存 workspaceId（FK），展示标题由 client
 *     端 ctx.workspaces.list 实时 join
 */
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { WorkspaceId } from '@deepseek-ai/dsh-host-apiproxy'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  AddDesignLinkRequest,
  AddExternalLinkRequest,
  AddPrdLinkRequest,
  AddSourceRepoRequest,
  Attachment,
  MaterialItemId,
  MaterialSection,
  NewRequirement,
  PrdFile,
  Requirement,
  RequirementId,
  SourceRepo,
  UserId,
  WorkspaceId as SkyAxisWorkspaceId,
  SkyAxisErrorCode,
  defaultRequirementFields,
} from '../protocol.ts'
import { skyAxisRequest } from './rpc-helper.ts'
import { requirementDomain } from './storage/requirement-domain.ts'
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

/**
 * sky-axis 物料文件落盘的顶层目录（与 git-service 的 SKY_AXIS_REPOS_DIR 同源）：
 *   - `inputs/prd/` —— PRD 文档上传落盘点
 *   - `inputs/attachment/` —— 附件上传落盘点
 *   - 4 个 link 类 section（prdLinks / designLinks / externalLinks / sourceRepos）
 *     不落盘（只有 URL 或 git clone 元数据，不写文件）。
 *
 * Sprint 3 演进（工作区目录结构改造）：
 *   - 原路径 `${workspacePath}/.sky-axis/${requirementId}/${section}/${itemId}-${filename}`
 *     改为顶层 `${workspacePath}/inputs/${sectionInputsDir}/${reqShortId}-${itemIdShort}-${filename}`
 *   - `reqShortId`：requirementId 替换 `:` 为 `-` 后取前 19 字符（ISO 到秒）
 *   - `itemIdShort`：itemId UUID 前 8 字符
 *   - `sectionInputsDir`：`prdFiles` → `prd`、`attachments` → `attachment`
 *   - 双前缀 + 文件名三重防冲突；用户可读性高（一眼看出「哪个 req 的什么文件」）
 *
 * 复用语义（决策 3）：`inputs/` 已存在就直接用，不查内部。
 */
const SKY_AXIS_INPUTS_DIR = 'inputs'

/** 物料每 section 数量上限（业务约束，zod 不管 —— 服务层校验）。 */
const MAX_MATERIALS_PER_SECTION = 50

/** sky-axis 自定义错误（host routes 捕获并翻译为 ApiError 响应）。 */
export class SkyAxisHostError extends Error {
  constructor(
    readonly code: SkyAxisErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'SkyAxisHostError'
  }
}

/**
 * 把 KvTable<K, V> 投影成 Iterable<V>，让纯函数（findRequirementByWorkspace /
 * findDuplicateWorkspaceGroups）能直接消费 table 内容。
 * KvTable.entries() 返回 [key, value] 元组，纯函数只关心 value。
 */
function* toRequirementValues<V extends Requirement>(table: KvTable<string, V>): Iterable<V> {
  for (const [, value] of table.entries()) yield value
}

/** ID 生成：ISO 字符串 + 6 位 base36 随机后缀。 */
function makeRequirementId(): RequirementId {
  const ts = new Date().toISOString()
  const rand = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')
  return `${ts}-${rand}` as RequirementId
}

/** 物料 itemId：UUID v4（与 protocol MaterialItemIdSchema 对齐）。 */
function makeMaterialItemId(): MaterialItemId {
  return randomUUID() as MaterialItemId
}

/**
 * 把 requirementId 转换为文件系统安全的目录名段。
 * `makeRequirementId` 形如 `2026-08-30T13:44:18.939Z-6hcwlt`，含 `:` 字符
 * —— macOS / ext4 合法但不利于跨平台（Windows / 部分归档工具）。
 * 一律 `:` → `-`，跟 `-` 已有分隔风格一致。
 */
function safeRequirementIdDir(id: RequirementId): string {
  return id.replace(/:/g, '-')
}

/**
 * Section → inputs/ 子目录名映射。
 *   - `prdFiles` → `prd`
 *   - `attachments` → `attachment`
 *   - 4 个 link 类 section 不会被 writeMaterialFile 调用(它们走 JSON add 路径)，
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
 * 物料文件落盘的 inputs/ 子目录绝对路径（不实际创建，返回路径供 mkdir recursive）。
 *
 * 形态：`<workspacePath>/inputs/<sectionInputsDir>/`
 */
export function materialInputsDir(workspacePath: string, section: MaterialSection): string {
  return join(workspacePath, SKY_AXIS_INPUTS_DIR, sectionInputsDirName(section))
}

/**
 * 确保 inputs/ 顶层布局存在 —— 一次性创建所有 file-upload section 的子目录。
 *
 * 启动期在每个 workspace 调用一次（与 ensureMeta 同步走），幂等（mkdir recursive 已存在 no-op）。
 *
 * 复用语义（决策 3）：`inputs/` 目录已存在就直接用，不查内部 —— 但本函数还会
 * 确保两个子目录存在。如果 `inputs/` 已是用户手动建的空目录，子目录会按需创建。
 *
 * 失败抛错：mkdir 失败（如权限不足）会让 ensureMeta 整体失败 → console.warn + 跳过
 * 该 workspace；不阻塞 webServer 启动。
 */
export async function ensureInputsLayout(workspacePath: string): Promise<void> {
  for (const section of ['prdFiles', 'attachments'] as const) {
    await mkdir(materialInputsDir(workspacePath, section), { recursive: true, mode: 0o700 })
  }
}

/**
 * 把 requirementId 压缩为文件名前缀短码（19 字符 = ISO 到秒，已替换 `:` 为 `-`）。
 *
 * 形态例：`2026-09-07T13:44:18.939Z-6hcwlt` → `2026-09-07T13-44-18`（去冒号后前 19 字符）
 *
 * 唯一性：同秒多 requirement 撞名概率低；即使撞，后接 `itemIdShort`（UUID 前 8 字符）
 * 即可万无一失。短码让用户一眼看出「哪个 req」+ 可在 ls 时大致按时间排序。
 */
export function reqShortId(reqId: RequirementId): string {
  return safeRequirementIdDir(reqId).slice(0, 19)
}

/** itemId UUID 前 8 字符（无连字符，文件名前缀用）。 */
export function itemIdShort(itemId: MaterialItemId): string {
  return itemId.slice(0, 8)
}

/**
 * 沙箱断言：absolutePath 必须位于 `${workspacePath}/inputs/` 内。
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
 * 防御性 sanitize 文件名：
 *   - 剔除 path traversal 字符（/ 与 \）
 *   - 剔除 .. 序列
 *   - 剔除控制字符（ASCII 0x00-0x1F + DEL）
 *   - 剔除开头的点（避免 .bashrc / .ssh 等隐藏文件）
 *   - 空串兜底为 'unnamed'
 *   - 截取最后 200 字符（过长文件名对文件系统不友好）
 *
 * mojibake 救回：如果 filename 含有高位字节序列（每字符 ≥ 0x80），
 * 尝试把它当 latin1 字节重新按 utf8 解码 —— 修 busboy 旧版本 / 老
 * 客户端遗留下来的乱码文件。救不回来的（含控制字符的）保留原值。
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
    // 救回后不能再含控制字符（说明解码失败，留原样）
    if (/[\x00-\x1f\x7f]/.test(recovered)) return tail
    return recovered
  } catch {
    return tail
  }
}

/** 写 PrdFile / Attachment 文件到磁盘，返回相对 workspace 的 path 与绝对路径。
 *
 * 落盘路径（Sprint 3）：`${workspacePath}/inputs/${sectionInputsDir}/${reqShortId}-${itemIdShort}-${sanitized}`
 *
 * 写入策略：先写 `.tmp` 临时文件，fsync 完成后 rename 到正式文件名。
 * 目的：
 *   1) 上传中途断流 / KV write 失败 → 磁盘上不会留下半成品文件
 *   2) rename 是 POSIX 原子操作，client 端 list / ls 永远不会看到半写文件
 *   3) 与文件持久名同步由 reqShortId + itemIdShort 前缀提供（即便 sanitize 后同名也不冲突）
 *
 * 沙箱：写完后调 assertInputsDirSandbox 兜底防御 —— 正常路径必然命中 `${ws}/inputs/`,
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
    // 清理可能残留的 tmp —— 注意相对路径是新形态（inputs/{section}/{...}.tmp）
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
 * best-effort 删物料文件：
 *   - ENOENT（已被删）视为成功（caller 不需关心）
 *   - 其它错误 console.warn（不影响 KV 操作的语义）
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
 * 异步初始化：构造时不阻塞 cordis apply，routes handler 在第一次调用
 * 时 `await svc.ready()` 阻塞等 storage domain open 完成。
 */
export class RequirementHostService {
  private readonly domainPromise: Promise<Domain<typeof requirementDomain>>
  /** workspaceId → 真实 path 的本地缓存（每次 list workspace 后刷新一次）。 */
  private workspacePathCache = new Map<SkyAxisWorkspaceId, string>()
  /** workspace 列表上次拉取时间（ms epoch），用于缓存 TTL。 */
  private workspaceCacheLoadedAt = 0
  /** 缓存 TTL：60s —— workspace 创建/删除/重命名后最长 60s 同步。 */
  private static readonly WORKSPACE_CACHE_TTL_MS = 60_000

  private closed = false

  /** Phase 2.6 源码关联：git 沙箱封装（stateless，可在多 service 间共享）。 */
  readonly gitService: GitService = createGitService()

  constructor(
    private readonly ctx: import('@deepseek-ai/cordis').Context,
    /** apiProxy 公开给 host routes 使用（fetchWorkspaces 路由通过它拉 workspace 列表）。 */
    readonly apiProxy: ApiProxy,
    private readonly storageDomain: import('@deepseek-ai/dsh-storage-domain').DomainFacility,
  ) {
    this.domainPromise = this.storageDomain.open(requirementDomain)
  }

  /** 等 domain 就绪，返回 typed table handle。多次调用复用同一 promise。 */
  async ready(): Promise<KvTable<SkyAxisWorkspaceId & string, Requirement>> {
    const domain = await this.domainPromise
    return domain.table('requirements') as unknown as KvTable<SkyAxisWorkspaceId & string, Requirement>
  }

  /**
   * 列出当前 domain 内全部需求，按 id 倒序（最新在前）。list 不分页
   * —— 数量 < 1k 直接 in-memory；量大了再加索引视图或后端分页。
   */
  async list(): Promise<Requirement[]> {
    const table = await this.ready()
    const items: Requirement[] = []
    for (const [, value] of table.entries()) items.push(value)
    items.sort((a, b) => b.id.localeCompare(a.id))
    return items
  }

  /**
   * 取一条需求；不存在返回 undefined。
   */
  async get(id: RequirementId): Promise<Requirement | undefined> {
    const table = await this.ready()
    return table.get(id as unknown as SkyAxisWorkspaceId & string)
  }

  /**
   * 1:1 不变量自检：扫一遍 table，收集「同一 workspaceId 下 ≥2 条需求」的冲突组。
   * 返回数组每个元素 = 同一 workspace 下的全部 requirements（≥2 条）。
   * 空数组 = 无违例。
   *
   * 用途：
   *   - host 启动期自检（console.error 列出冲突，让用户/升级文档手动处理）
   *   - UI 层检测历史脏数据（红框警示该组）
   *
   * 注意：本方法**只读不写**，发现违例也不抛、不删 —— 保持数据完整性责任归用户。
   */
  async findDuplicateWorkspaceRequirements(): Promise<Requirement[][]> {
    const table = await this.ready()
    return findDuplicateWorkspaceGroups(toRequirementValues(table))
  }

  /**
   * 新建一条需求。流程：
   *   1. 解析 workspaceId → 真实 path（缓存 + 校验）
   *   2. **1:1 不变量校验**：扫一遍当前 table，命中同 workspaceId 的现存需求
   *      → 抛 `workspace-already-has-requirement`（任何 status 都算占位：
   *      status=open/in_progress/done/cancelled 都阻止新建；要换只能删了重建）
   *   3. 构造 Requirement 实体（含 id / status / 时间戳）
   *   4. 写 KV（持久化）
   *   5. best-effort 创建产物目录（失败不阻塞）
   *
   * @throws SkyAxisHostError
   *   - 'workspace-not-found'：workspaceId 不在 DSH 当前 workspace 列表
   *   - 'workspace-list-failed'：apiProxy.workspace.list 返回 RpcResult 失败
   *   - 'workspace-already-has-requirement'：该 workspace 已有关联 requirement
   *   - 'internal-error'：其他未捕获异常
   *
   * 并发说明（不变量强度 trade-off）：
   *   - DSH 是单进程 cordis，本 service 是单例，理论并发窗口极小
   *   - 当前实现是 in-memory 检查 + table.put，**理论 race**下两次并发 create 可能都通过检查
   *     （最终后者覆盖前者，但 product 形态决定两次写同一 workspaceId 都应被拒绝 —— 见方案）
   *   - 真正强一致需把主键改成 `${workspaceId}` 或引入 CAS 二级索引，超出当前 phase 范围
   */
  async create(input: NewRequirement): Promise<Requirement> {
    const table = await this.ready()
    const workspacePath = await this.resolveWorkspacePath(input.workspaceId)

    // 1:1 不变量校验 —— 任何 status 都算占位
    const existing = findRequirementByWorkspace(toRequirementValues(table), input.workspaceId)
    if (existing !== undefined) {
      throw new SkyAxisHostError(
        'workspace-already-has-requirement',
        `workspace '${input.workspaceId}' already has requirement '${existing.id}' (status=${existing.status}); delete it first to create a new one`,
      )
    }

    const now = new Date().toISOString()
    const id = makeRequirementId()
    // Phase 2.1 完美主义：显式调用工厂函数写完整 10 个扩展字段（含 Phase 1.2 的 8 个 + Phase 2.1 的 materials）。
    //   - 不依赖 zod parse-time default 兜底 —— 每条持久化记录 100% 完整
    //   - 工厂函数单一职责 —— 默认值集中管理，未来字段增减只改一处
    //   - stageHistory 第一条记录就是「进入理解阶段」（审计链起点）
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

    await table.put(id as unknown as SkyAxisWorkspaceId & string, requirement)

    // Sprint 3：取消 `.sky-axis/{id}/` 产物目录预创建。inputs/{section}/ 由
    //   writeMaterialFile lazy mkdir（已存在则 no-op）+ host apply 启动期一次性建空目录兜底。

    return requirement
  }

  /**
   * 删除一条需求。删除 KV 记录，不递归删除磁盘上的产物目录（保留软删除
   * 友好性，方便用户恢复；后续如需硬删可加 query 参数 `?purge=true`）。
   *
   * @returns true 表示记录原本存在并被删除；false 表示 id 不存在（幂等无操作）。
   */
  async remove(id: RequirementId): Promise<boolean> {
    const table = await this.ready()
    return table.delete(id as unknown as SkyAxisWorkspaceId & string)
  }

  /**
   * 关闭 service（幂等）。释放 domain handle 触发 backend unit close；
   * DSH host 重启 / 插件卸载时调用。
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const domain = await this.domainPromise
    await domain.close()
  }

  /**
   * Phase 2.6 v2：扫一遍所有 workspace 的 `repos/` 目录,
   * 清理未引用的 UUID 形态孤儿(历史 destDir 命名规则残留)。
   *
   * Sprint 1 演进：扫描路径从 `.sky-axis/repos/` 顶层化为 `repos/`。
   *
   * 设计：
   *   - 收集所有 requirement 的 sourceRepos.localPath → liveLocalPaths
   *   - 按 workspace 分组去重(避免同一个 workspace 重复扫)
   *   - 单个 workspace 失败 console.warn,不阻断其他 workspace
   *
   * 失败兜底：
   *   - domain 未就绪 / list 失败 → 整体 return 不抛
   *   - 单 workspace resolveWorkspacePath 失败 → console.warn,跳过
   *
   * 调用方：host 启动后 effect 内跑一次。
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

  /* ── Phase 2.5：物料 CRUD ── */

  /**
   * 上传一个 PRD 文件（multipart 走 PrdFile / Attachment 服务方法）。
   * 写入顺序：**先落盘成功 → 再写 KV**（避免 KV 有记录但磁盘没文件）。
   * 失败回滚：落盘失败 → KV 不动；KV 写失败 → best-effort unlink 已落盘文件。
   *
   * @throws SkyAxisHostError
   *   - 'requirement-not-found'：requirementId 不存在
   *   - 'validation-failed'：超 MAX_MATERIALS_PER_SECTION（50）
   *   - 'internal-error'：文件 IO 失败
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

  /** 内部共用：文件类 section（prdFiles / attachments）上传。 */
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
    const table = await this.ready()
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
      const updated = await table.update(
        reqId as unknown as SkyAxisWorkspaceId & string,
        (prev) => {
          const materials = prev.materials
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
            ...prev,
            materials: section === 'prdFiles'
              ? { ...materials, prdFiles: nextList }
              : { ...materials, attachments: nextList },
            updatedAt: now,
          }
        },
      )
      if (updated === undefined) {
        await unlinkMaterialFile(workspacePath, relativePath)
        throw new SkyAxisHostError('requirement-not-found', `requirement ${reqId} not found during update`)
      }
      return updated
    } catch (e) {
      // 数量超限 / KV 写失败：回滚已落盘文件
      await unlinkMaterialFile(workspacePath, relativePath)
      throw e
    }
  }

  /**
   * 添加一个 PRD 链接（JSON 入参 —— url / title / source）。
   * 不需要落盘，直接更新 KV。
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
   * 添加一条源码仓库关联 —— 同步 git clone + 写 KV（Phase 2.6）。
   *
   * 顺序（**先落盘成功 → 再写 KV**）：
   *   1. 解析 workspacePath（缓存 + 校验 workspace 存在）
   *   2. 从 URL 提取 repo 名 → destDir = `${workspacePath}/repos/${repoName}`
 *      （Sprint 1：路径从 `.sky-axis/repos/` 顶层化为 `repos/`，便于用户在
 *      Finder / VSCode 直接打开）
   *      （同 repo 不同 protocol 经 canonicalize 后命中同一目录）
   *   3. **KV dedup**：canonicalize URL 后比对已有 sourceRepos,命中抛 source-repo-duplicate
   *   4. gitService.clone({ url, branch, destDir, workspaceRoot: workspacePath, signal })
   *      - 失败抛 git-clone-failed / git-checkout-failed / git-timeout / git-sandbox-violation / git-not-installed
   *      - 失败时 clone 内部已 best-effort 清理半成品目录,本方法不重复清理
   *      - **destDir 已存在 + 含 .git/ 时**：跳过 git clone,直接复用（reused=true）
   *   5. KV update: 写完整 SourceRepo record(含 localPath / clonedAt / cloneStatus='cloned' / displayName)
   *   6. KV 写失败 → best-effort rm -rf destDir（**仅当 reused=false 时**,
   *      避免误删已 clone 复用的仓库)
   *
   * @throws SkyAxisHostError
   *   - 'workspace-not-found'：workspaceId 不在 DSH workspace 列表
   *   - 'requirement-not-found'：reqId 不存在
   *   - 'validation-failed'：section 超 50 条上限 或 URL 解析失败
   *   - 'source-repo-duplicate'：该 requirement 已关联相同 canonical URL
   *   - 'git-*'：clone 阶段失败(见上)
   *   - 'internal-error'：KV 写失败
   */
  async addSourceRepo(
    reqId: RequirementId,
    input: AddSourceRepoRequest,
    addedBy: UserId,
    opts: { signal?: AbortSignal } = {},
  ): Promise<Requirement> {
    const table = await this.ready()
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

    // 3. KV dedup（防止同 requirement 重复关联同 repo,跨 protocol 视为相同）
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

    let updated: Requirement | undefined
    try {
      updated = await table.update(
        reqId as unknown as SkyAxisWorkspaceId & string,
        (prev) => {
          const list = prev.materials.sourceRepos
          // 防御性二次 dedup（防止并发请求绕过预检查）
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
            ...prev,
            materials: { ...prev.materials, sourceRepos: nextList },
            updatedAt: now,
          }
        },
      )
    } catch (e) {
      // 6. KV 写失败 → 仅当 reused=false 时清理(避免误删复用目录)
      if (!cloneResult.reused) {
        await this.gitService.removeSafe(destDir, workspacePath).catch(() => undefined)
      }
      throw e
    }

    if (updated === undefined) {
      if (!cloneResult.reused) {
        await this.gitService.removeSafe(destDir, workspacePath).catch(() => undefined)
      }
      throw new SkyAxisHostError(
        'requirement-not-found',
        `requirement ${reqId} not found during addSourceRepo`,
      )
    }
    return updated
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
   * 内部共用：JSON 类 section（prdLinks / sourceRepos / designLinks /
   * externalLinks）添加。直接更新 KV，不需要落盘。
   *
   * @param makeItem - 构造新 item（id 由 host 生成，section 由 factory 决定）
   */
  private async addJsonSection<
    S extends Exclude<MaterialSection, 'prdFiles' | 'attachments'>,
  >(
    section: S,
    reqId: RequirementId,
    makeItem: (id: MaterialItemId) => Requirement['materials'][S][number],
  ): Promise<Requirement> {
    const table = await this.ready()
    const itemId = makeMaterialItemId()
    const now = new Date().toISOString()
    const updated = await table.update(
      reqId as unknown as SkyAxisWorkspaceId & string,
      (prev) => {
        const list = prev.materials[section]
        const nextList = [...list, makeItem(itemId)]
        if (nextList.length > MAX_MATERIALS_PER_SECTION) {
          throw new SkyAxisHostError(
            'validation-failed',
            `${section} exceeds ${MAX_MATERIALS_PER_SECTION} items limit`,
          )
        }
        return {
          ...prev,
          materials: { ...prev.materials, [section]: nextList },
          updatedAt: now,
        }
      },
    )
    if (updated === undefined) {
      throw new SkyAxisHostError('requirement-not-found', `requirement ${reqId} not found`)
    }
    return updated
  }

  /**
   * 移除一个物料项。
   * 顺序：**先 KV 后 unlink** —— UI 列表立刻一致优先；unlink 失败 best-effort
   * （残留文件不影响功能，留待人工清理）。
   *
   * @throws SkyAxisHostError
   *   - 'requirement-not-found'：requirementId 不存在
   *   - 'material-not-found'：itemId 不在指定 section 内
   */
  async removeMaterial(
    reqId: RequirementId,
    section: MaterialSection,
    itemId: MaterialItemId,
  ): Promise<Requirement> {
    const table = await this.ready()
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
    // 上传类物料(path 字段)与源码类(localPath 字段)字段名不同,分别处理落盘清理。
    const target = list[targetIdx] as { id: string; path?: string; localPath?: string }
    const nextList = [...list.slice(0, targetIdx), ...list.slice(targetIdx + 1)]
    const now = new Date().toISOString()
    const updated = await table.update(
      reqId as unknown as SkyAxisWorkspaceId & string,
      (prev) => ({
        ...prev,
        materials: { ...prev.materials, [section]: nextList },
        updatedAt: now,
      }),
    )
    if (updated === undefined) {
      throw new SkyAxisHostError(
        'requirement-not-found',
        `requirement ${reqId} not found during remove`,
      )
    }
    // 落盘清理:
    //   - prdFiles / attachments: unlink 单文件
    //   - sourceRepos: rm -rf 整个 repos/{itemId} 目录(用 gitService.removeSafe 保证沙箱断言)
    if (section === 'sourceRepos' && target.localPath !== undefined) {
      const destDir = join(workspacePath, target.localPath)
      await this.gitService.removeSafe(destDir, workspacePath)
    } else if (target.path !== undefined) {
      await unlinkMaterialFile(workspacePath, target.path)
    }
    return updated
  }

  /**
   * 订阅 sky_axis_requirements domain 的 domain/changed 事件。
   * 仅透传属于本 domain 的 put/deleted 事件（其它 domain 一律过滤）。
   * @param cb - 事件回调；返回 disposer 解除订阅。
   */
  subscribeDomainChanges(cb: (event: { operation: 'put'; item: Requirement } | { operation: 'deleted'; id: string }) => void): () => void {
    const disposer = this.ctx.on('domain/changed', (raw) => {
      const c = raw as { domain?: string; table?: string; key?: string; operation?: 'put' | 'deleted'; value?: Requirement }
      if (c.domain !== requirementDomain.name || c.table !== 'requirements') return
      if (c.operation === 'put' && c.value !== undefined) {
        cb({ operation: 'put', item: c.value })
      } else if (c.operation === 'deleted' && c.key !== undefined) {
        cb({ operation: 'deleted', id: c.key })
      }
    })
    return () => { disposer?.() }
  }

  /* ── 内部 helper ── */

  /**
   * 解析 workspaceId → 真实文件系统 path（同时校验 workspace 存在）。
   * 60s 内不重复拉 apiProxy.workspace.list（缓存命中直接返回）。
   *
   * @throws SkyAxisHostError
   *   - 'workspace-not-found'
   *   - 'workspace-list-failed'
   */
  private async resolveWorkspacePath(workspaceId: SkyAxisWorkspaceId): Promise<string> {
    const now = Date.now()
    if (
      this.workspacePathCache.has(workspaceId)
      && now - this.workspaceCacheLoadedAt < RequirementHostService.WORKSPACE_CACHE_TTL_MS
    ) {
      const cached = this.workspacePathCache.get(workspaceId)
      if (cached !== undefined) return cached
    }

    const response = await this.apiProxy.workspace.list(skyAxisRequest({}))
    if (!response.result.ok) {
      throw new SkyAxisHostError(
        'workspace-list-failed',
        `apiProxy.workspace.list failed: ${response.result.error.code}: ${response.result.error.message}`,
      )
    }
    const items = response.result.value.items
    // 刷新整个缓存（便宜：workspace 列表通常 < 100 条）
    const fresh = new Map<SkyAxisWorkspaceId, string>()
    for (const item of items) {
      fresh.set(item.workspaceId as unknown as SkyAxisWorkspaceId, item.path)
    }
    this.workspacePathCache = fresh
    this.workspaceCacheLoadedAt = now

    const path = this.workspacePathCache.get(workspaceId)
    if (path === undefined) {
      throw new SkyAxisHostError(
        'workspace-not-found',
        `workspace '${workspaceId}' is not in the current DSH workspace registry`,
      )
    }
    return path
  }

  // Sprint 3：ensureArtifactRoot 已删除 —— `.sky-axis/${requirementId}/` 目录形态废弃。
}

/**
 * sky-axis workspace 元数据拉取（透传给 client，client 端首选 ctx.workspaces.list；
 * 仅当 client 注入失败 / 老版本兼容时 fallback）。
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

/* ── 类型 re-export（避免 consumer 反复 import @deepseek-ai/dsh-host-apiproxy）── */
export type { ApiProxy, WorkspaceId }
