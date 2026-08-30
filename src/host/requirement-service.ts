/**
 * hello 插件 host 半区业务服务 —— 持有 domain + apiProxy 引用，
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
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { WorkspaceId } from '@deepseek-ai/dsh-host-apiproxy'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type {
  NewRequirement,
  Requirement,
  RequirementId,
  WorkspaceId as HelloWorkspaceId,
  HelloErrorCode,
} from '../protocol.ts'
import { helloRequest } from './rpc-helper.ts'
import { requirementDomain } from './storage/requirement-domain.ts'

/** hello 产物在 workspace 内的命名空间目录（隐藏目录，不污染用户根）。 */
const HELLO_ARTIFACT_NAMESPACE = '.dsh-hello'

/** hello 自定义错误（host routes 捕获并翻译为 ApiError 响应）。 */
export class HelloHostError extends Error {
  constructor(
    readonly code: HelloErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'HelloHostError'
  }
}

/** ID 生成：ISO 字符串 + 6 位 base36 随机后缀。 */
function makeRequirementId(): RequirementId {
  const ts = new Date().toISOString()
  const rand = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')
  return `${ts}-${rand}` as RequirementId
}

/** hello 半区产物根目录（不实际创建，返回路径供 lazy 创建）。 */
function artifactRoot(workspacePath: string, requirementId: RequirementId): string {
  return join(workspacePath, HELLO_ARTIFACT_NAMESPACE, requirementId)
}

/**
 * hello host 半区业务服务。
 *
 * 异步初始化：构造时不阻塞 cordis apply，routes handler 在第一次调用
 * 时 `await svc.ready()` 阻塞等 storage domain open 完成。
 */
export class RequirementHostService {
  private readonly domainPromise: Promise<Domain<typeof requirementDomain>>
  /** workspaceId → 真实 path 的本地缓存（每次 list workspace 后刷新一次）。 */
  private workspacePathCache = new Map<HelloWorkspaceId, string>()
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
  async ready(): Promise<KvTable<HelloWorkspaceId & string, Requirement>> {
    const domain = await this.domainPromise
    return domain.table('requirements') as unknown as KvTable<HelloWorkspaceId & string, Requirement>
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
    return table.get(id as unknown as HelloWorkspaceId & string)
  }

  /**
   * 新建一条需求。流程：
   *   1. 解析 workspaceId → 真实 path（缓存 + 校验）
   *   2. 构造 Requirement 实体（含 id / status / 时间戳）
   *   3. 写 KV（持久化）
   *   4. best-effort 创建产物目录（失败不阻塞）
   *
   * @throws HelloHostError
   *   - 'workspace-not-found'：workspaceId 不在 DSH 当前 workspace 列表
   *   - 'workspace-list-failed'：apiProxy.workspace.list 返回 RpcResult 失败
   *   - 'internal-error'：其他未捕获异常
   */
  async create(input: NewRequirement): Promise<Requirement> {
    const table = await this.ready()
    const workspacePath = await this.resolveWorkspacePath(input.workspaceId)

    const now = new Date().toISOString()
    const id = makeRequirementId()
    const requirement: Requirement = {
      id,
      workspaceId: input.workspaceId,
      title: input.title,
      description: input.description ?? '',
      priority: input.priority,
      status: 'open',
      tags: input.tags,
      createdAt: now,
      updatedAt: now,
    }

    await table.put(id as unknown as HelloWorkspaceId & string, requirement)

    // best-effort 产物目录预创建 —— 不阻塞，失败 console.warn 即可
    void this.ensureArtifactRoot(workspacePath, id).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(`[dsh-hello] artifact root pre-create failed for ${id}: ${String(error)}`)
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
    return table.delete(id as unknown as HelloWorkspaceId & string)
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
   * 订阅 hello_requirements domain 的 domain/changed 事件。
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
   * @throws HelloHostError
   *   - 'workspace-not-found'
   *   - 'workspace-list-failed'
   */
  private async resolveWorkspacePath(workspaceId: HelloWorkspaceId): Promise<string> {
    const now = Date.now()
    if (
      this.workspacePathCache.has(workspaceId)
      && now - this.workspaceCacheLoadedAt < RequirementHostService.WORKSPACE_CACHE_TTL_MS
    ) {
      const cached = this.workspacePathCache.get(workspaceId)
      if (cached !== undefined) return cached
    }

    const response = await this.apiProxy.workspace.list(helloRequest({}))
    if (!response.result.ok) {
      throw new HelloHostError(
        'workspace-list-failed',
        `apiProxy.workspace.list failed: ${response.result.error.code}: ${response.result.error.message}`,
      )
    }
    const items = response.result.value.items
    // 刷新整个缓存（便宜：workspace 列表通常 < 100 条）
    const fresh = new Map<HelloWorkspaceId, string>()
    for (const item of items) {
      fresh.set(item.workspaceId as unknown as HelloWorkspaceId, item.path)
    }
    this.workspacePathCache = fresh
    this.workspaceCacheLoadedAt = now

    const path = this.workspacePathCache.get(workspaceId)
    if (path === undefined) {
      throw new HelloHostError(
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
 * hello workspace 元数据拉取（透传给 client，client 端首选 ctx.workspaces.list；
 * 仅当 client 注入失败 / 老版本兼容时 fallback）。
 */
export async function fetchWorkspaces(apiProxy: ApiProxy): Promise<Array<{ id: HelloWorkspaceId; title: string; path: string }>> {
  const response = await apiProxy.workspace.list(helloRequest({}))
  if (!response.result.ok) {
    throw new HelloHostError(
      'workspace-list-failed',
      `apiProxy.workspace.list failed: ${response.result.error.code}: ${response.result.error.message}`,
    )
  }
  return response.result.value.items.map(item => ({
    id: item.workspaceId as unknown as HelloWorkspaceId,
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
