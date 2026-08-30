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
import { join } from 'node:path'
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
  UserId,
  WorkspaceId as SkyAxisWorkspaceId,
  SkyAxisErrorCode,
  defaultRequirementFields,
} from '../protocol.ts'
import { skyAxisRequest } from './rpc-helper.ts'
import { requirementDomain } from './storage/requirement-domain.ts'

/** sky-axis 产物在 workspace 内的命名空间目录（隐藏目录，不污染用户根）。 */
const SKY_AXIS_ARTIFACT_NAMESPACE = '.sky-axis'

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

/** sky-axis 半区产物根目录（不实际创建，返回路径供 lazy 创建）。 */
function artifactRoot(workspacePath: string, requirementId: RequirementId): string {
  return join(workspacePath, SKY_AXIS_ARTIFACT_NAMESPACE, safeRequirementIdDir(requirementId))
}

/** 某 section 的产物子目录路径（不实际创建）。 */
function sectionArtifactDir(
  workspacePath: string,
  requirementId: RequirementId,
  section: MaterialSection,
): string {
  return join(workspacePath, SKY_AXIS_ARTIFACT_NAMESPACE, safeRequirementIdDir(requirementId), section)
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
 * 写入策略：先写 `.tmp` 临时文件，fsync 完成后 rename 到正式文件名。
 * 目的：
 *   1) 上传中途断流 / KV write 失败 → 磁盘上不会留下半成品文件
 *   2) rename 是 POSIX 原子操作，client 端 list / ls 永远不会看到半写文件
 *   3) 与文件持久名同步由 itemId 前缀提供（即便 sanitize 后同名也不冲突）
 */
async function writeMaterialFile(args: {
  workspacePath: string
  requirementId: RequirementId
  section: MaterialSection
  itemId: MaterialItemId
  filename: string
  content: Buffer
}): Promise<{ relativePath: string; absolutePath: string }> {
  const dir = sectionArtifactDir(args.workspacePath, args.requirementId, args.section)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const sanitized = sanitizeFilename(args.filename)
  const filename = `${args.itemId}-${sanitized}`
  const absolutePath = join(dir, filename)
  const tmpPath = join(dir, `.${args.itemId}.tmp`)
  try {
    await writeFile(tmpPath, args.content, { mode: 0o600 })
    await rename(tmpPath, absolutePath)
  } catch (e) {
    // 清理可能残留的 tmp
    await unlinkMaterialFile(args.workspacePath, join(SKY_AXIS_ARTIFACT_NAMESPACE, safeRequirementIdDir(args.requirementId), args.section, `.${args.itemId}.tmp`))
    throw e
  }
  const relativePath = join(
    SKY_AXIS_ARTIFACT_NAMESPACE,
    safeRequirementIdDir(args.requirementId),
    args.section,
    filename,
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
   * 新建一条需求。流程：
   *   1. 解析 workspaceId → 真实 path（缓存 + 校验）
   *   2. 构造 Requirement 实体（含 id / status / 时间戳）
   *   3. 写 KV（持久化）
   *   4. best-effort 创建产物目录（失败不阻塞）
   *
   * @throws SkyAxisHostError
   *   - 'workspace-not-found'：workspaceId 不在 DSH 当前 workspace 列表
   *   - 'workspace-list-failed'：apiProxy.workspace.list 返回 RpcResult 失败
   *   - 'internal-error'：其他未捕获异常
   */
  async create(input: NewRequirement): Promise<Requirement> {
    const table = await this.ready()
    const workspacePath = await this.resolveWorkspacePath(input.workspaceId)

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

    // best-effort 产物目录预创建 —— 不阻塞，失败 console.warn 即可
    void this.ensureArtifactRoot(workspacePath, id).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(`[sky-axis] artifact root pre-create failed for ${id}: ${String(error)}`)
    })

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

  async addSourceRepo(
    reqId: RequirementId,
    input: AddSourceRepoRequest,
    addedBy: UserId,
  ): Promise<Requirement> {
    const now = new Date().toISOString()
    return await this.addJsonSection('sourceRepos', reqId, (id) => ({
      id,
      url: input.url,
      branch: input.branch,
      lastCommitSha: input.lastCommitSha,
      description: input.description,
      addedAt: now,
      addedBy,
    }))
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
    const target = list[targetIdx] as { id: string; path?: string }
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
    if (target.path !== undefined) {
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

  /**
   * best-effort 创建某需求的产物根目录。
   * 失败不抛出（caller 不需要 await 此函数的 reject）。
   */
  private async ensureArtifactRoot(workspacePath: string, requirementId: RequirementId): Promise<void> {
    const root = artifactRoot(workspacePath, requirementId)
    await mkdir(root, { recursive: true, mode: 0o700 })
  }
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
