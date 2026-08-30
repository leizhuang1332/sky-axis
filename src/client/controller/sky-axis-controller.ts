/**
 * SkyAxis 控制器 —— 纯状态机（无 DOM / 无 React）。
 *
 * 状态面（SkyAxisSnapshot）：
 *   - pageOpen: 主列整页是否打开
 *   - viewKey:  当前选中的内部视图（仅在 pageOpen=true 时有意义）
 *   - sidebarCollapsed: 内部 sidebar 是否折叠
 *   - requirements: 需求列表（来自 host 持久化 + SSE 推送）
 *   - requirementOptions.workspaces: workspace 选项（来自 ctx.workspaces 订阅）
 *   - requirementsLoading: 列表是否在 fetch 中
 *   - requirementsError: 最近一次失败原因（用于 UI 提示）
 *
 * 关键不变式：
 *   - 打开页面（openPage）时强制 viewKey 重置为 'home'
 *   - 关闭页面（closePage）时保留 viewKey（与 dsh-shell「保留用户视图」习惯一致）
 *   - setView 仅在 pageOpen=true 时生效
 *   - 折叠状态与 pageOpen 完全独立
 *   - requirements 与 workspaces 改动必触发 notify（引用必变，React 重渲染）
 *
 * 实现方式：单一可变 snapshot + Set<listener>。subscribe 返回 unsubscribe；
 * getSnapshot 返回引用，每次状态变化时构造新 snapshot 对象。
 */

/** sky-axis 内部视图 key。
 *  'personal' 保留作为 PersonalView 的入口（通过个人 entry 子项「个人主页」触发，本轮未暴露 sidebar 入口）；
 *  'requirements' 作为 sidebar「个人」下的二级目录入口对应的独立视图。 */
export type SkyAxisViewKey = 'home' | 'team' | 'personal' | 'requirements' | 'reports' | 'settings'

/** workspace 摘要（client UI 展示用）。 */
export interface WorkspaceOption {
  /** workspaceId（与 ctx.workspaces.list.items[i].workspaceId 同源）。 */
  id: string
  /** 展示标题（title 为空时回退到 path basename）。 */
  title: string
  /** 真实目录路径（仅供调试展示；client 不参与文件系统 IO）。 */
  path: string
}

/** 控制器公开依赖 —— client.fetch + ctx.workspaces 投影。 */
export interface RequirementOption {
  id: string
  title: string
  path: string
}

/** controller 暴露给订阅者的快照。 */
export interface SkyAxisSnapshot {
  pageOpen: boolean
  viewKey: SkyAxisViewKey
  /** sidebar 是否折叠（默认 false = 展开）。与 pageOpen 独立持久：
   *  关掉 sky-axis 再打开仍保留折叠状态，符合 sidebar 用户偏好习惯。 */
  sidebarCollapsed: boolean
  /** sidebar「个人」分组是否展开（默认 true = 展开）。独立于 pageOpen / sidebarCollapsed：
   *  - 关掉 sky-axis 再打开仍保留展开偏好（用户偏好持久）
   *  - sidebar 折叠态（icon rail）下二级菜单不可见，本字段不影响可见性
   *  - 5 个视图 entry 里只有「个人」带子菜单，其它 entry 无二级目录 */
  personalExpanded: boolean
  /** 全部需求（按 id 倒序，最新在前）。 */
  requirements: readonly RequirementEntry[]
  /** workspace 选项（来自 ctx.workspaces.list 推送；空数组表示当前无 workspace）。 */
  workspaces: readonly RequirementOption[]
  /** 列表 / CRUD 进行中状态。 */
  requirementsLoading: boolean
  /** 最近一次 CRUD / SSE 失败原因（null = 无错误）。UI 用来显示 toast 或 inline 提示。 */
  requirementsError: RequirementError | null
}

/** 极简 Requirement 镜像（与 host Requirement schema 同字段子集）。
 *  此处重定义而非直接 import 是为了 client bundle 不依赖 protocol.ts 的 zod
 *  schema（让 client 体积更小）。host 端 schema 仍为权威源。 */
export interface RequirementEntry {
  id: string
  workspaceId: string
  title: string
  description: string
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: 'open' | 'in_progress' | 'done' | 'cancelled'
  tags: string[]
  createdAt: string
  updatedAt: string
}

/** CRUD / SSE 错误（轻量版，client UI 展示用）。 */
export interface RequirementError {
  code:
    | 'validation-failed'
    | 'workspace-not-found'
    | 'workspace-list-failed'
    | 'requirement-not-found'
    | 'invalid-record'
    | 'internal-error'
    | 'network-error'
    | 'workspace-create-failed'
  detail?: string
}

/** Requirement 流事件（SSE）。 */
export type RequirementStreamEvent =
  | { operation: 'put'; item: RequirementEntry }
  | { operation: 'deleted'; id: string }

/** controller 公开 API。 */
export interface SkyAxisController {
  /** 订阅状态变化，返回 unsubscribe。 */
  subscribe(listener: () => void): () => void
  /** 读取当前快照（引用稳定，仅在状态变化时切新对象）。 */
  getSnapshot(): SkyAxisSnapshot
  /** pageOpen === true（避免 React 端每次解构判断）。 */
  isPageOpen(): boolean
  /** 打开主列页面（幂等）；同时把 viewKey 重置为 'home'。 */
  openPage(): void
  /** 关闭主列页面（幂等）；保留 viewKey 不变。 */
  closePage(): void
  /** openPage / closePage 翻转。 */
  togglePage(): void
  /** 切换内部视图（仅在 pageOpen=true 时生效）。 */
  setView(view: SkyAxisViewKey): void
  /** 当前视图（pageOpen=false 时返回上次保留值）。 */
  getView(): SkyAxisViewKey
  /** 切换 sidebar 收起 / 展开（与 pageOpen 独立，可任意时机调用）。 */
  toggleSidebar(): void
  /** sidebar 是否折叠（避免 React 端每次解构判断）。 */
  isSidebarCollapsed(): boolean
  /** 切换 sidebar「个人」分组的二级菜单展开 / 收起（与 pageOpen、sidebarCollapsed 独立）。 */
  togglePersonalExpanded(): void
  /** sidebar「个人」分组是否展开。 */
  isPersonalExpanded(): boolean

  /* ── Requirement CRUD ── */

  /** 推送 workspace 选项（来自 ctx.workspaces.list 订阅；空数组 = 当前无 workspace）。 */
  setWorkspaces(items: readonly RequirementOption[]): void

  /** 拉取全部需求（host list 路由）。失败时设置 requirementsError。 */
  loadRequirements(): Promise<void>

  /** 新建一条需求（host create 路由）。成功后 SSE 会推 put 事件回来，
   *  controller 内部根据 SSE 事件更新列表；本方法返回的 promise 在
   *  HTTP 响应完成时 resolve，UI 可用来关闭 modal。 */
  createRequirement(input: {
    workspaceId: string
    title: string
    description?: string
    priority?: RequirementEntry['priority']
    tags?: string[]
  }): Promise<{ ok: boolean; id?: string; error?: RequirementError }>

  /** 删除一条需求（host delete 路由）。成功后 SSE 推 deleted 事件。 */
  deleteRequirement(id: string): Promise<{ ok: boolean; error?: RequirementError }>

  /** 处理 SSE 事件（来自 subscribeRequirementEvents 回调）。 */
  handleStreamEvent(event: RequirementStreamEvent): void
}

/**
 * 创建 sky-axis 控制器实例。
 *
 * @param loadImpl - 拉取列表的实现（由调用方注入 RequirementClient.list）
 * @param createImpl - 新建需求的实现（注入 RequirementClient.create）
 * @param deleteImpl - 删除需求的实现（注入 RequirementClient.remove）
 */
export function createSkyAxisController(deps: {
  loadImpl?: () => Promise<{ ok: boolean; items?: RequirementEntry[]; error?: RequirementError }>
  createImpl?: (input: {
    workspaceId: string
    title: string
    description?: string
    priority?: RequirementEntry['priority']
    tags?: string[]
  }) => Promise<{ ok: boolean; item?: RequirementEntry; error?: RequirementError }>
  deleteImpl?: (id: string) => Promise<{ ok: boolean; error?: RequirementError }>
} = {}): SkyAxisController {
  let snapshot: SkyAxisSnapshot = {
    pageOpen: false,
    viewKey: 'home',
    sidebarCollapsed: false,
    personalExpanded: true, // 默认展开二级菜单：首次进入即可看见「个人 → 需求列表」入口
    requirements: [],
    workspaces: [],
    requirementsLoading: false,
    requirementsError: null,
  }
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const l of listeners) l()
  }

  /**
   * 把 host Requirement / error 投影到 client 类型（避免 protocol.ts zod schema
   * 进入 client bundle）。如果 host → client 字段名一致，直接复制。
   */
  const projectItem = (item: {
    id: string; workspaceId: string; title: string; description: string;
    priority: RequirementEntry['priority']; status: RequirementEntry['status'];
    tags: string[]; createdAt: string; updatedAt: string;
  }): RequirementEntry => item

  const projectError = (code: RequirementError['code'], detail?: string): RequirementError =>
    detail === undefined ? { code } : { code, detail }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot() {
      return snapshot
    },
    isPageOpen() {
      return snapshot.pageOpen
    },
    openPage() {
      if (snapshot.pageOpen) return
      snapshot = { ...snapshot, pageOpen: true, viewKey: 'home' }
      notify()
    },
    closePage() {
      if (!snapshot.pageOpen) return
      snapshot = { ...snapshot, pageOpen: false }
      notify()
    },
    togglePage() {
      snapshot = snapshot.pageOpen
        ? { ...snapshot, pageOpen: false }
        : { ...snapshot, pageOpen: true, viewKey: 'home' }
      notify()
    },
    setView(view) {
      if (!snapshot.pageOpen) return
      if (snapshot.viewKey === view) return
      snapshot = { ...snapshot, viewKey: view }
      notify()
    },
    getView() {
      return snapshot.viewKey
    },
    toggleSidebar() {
      snapshot = { ...snapshot, sidebarCollapsed: !snapshot.sidebarCollapsed }
      notify()
    },
    isSidebarCollapsed() {
      return snapshot.sidebarCollapsed
    },
    togglePersonalExpanded() {
      snapshot = { ...snapshot, personalExpanded: !snapshot.personalExpanded }
      notify()
    },
    isPersonalExpanded() {
      return snapshot.personalExpanded
    },

    /* ── Requirement CRUD ── */

    setWorkspaces(items) {
      // 浅引用比较：items 内容可能变（rename），每次都换引用让 React 重渲染
      snapshot = { ...snapshot, workspaces: [...items] }
      notify()
    },

    async loadRequirements() {
      if (deps.loadImpl === undefined) return
      snapshot = { ...snapshot, requirementsLoading: true, requirementsError: null }
      notify()
      try {
        const result = await deps.loadImpl()
        if (result.ok && result.items !== undefined) {
          snapshot = {
            ...snapshot,
            requirements: [...result.items].sort((a, b) => b.id.localeCompare(a.id)),
            requirementsLoading: false,
          }
        } else if (!result.ok) {
          snapshot = { ...snapshot, requirementsLoading: false, requirementsError: result.error ?? projectError('internal-error') }
        }
      } catch (e) {
        snapshot = { ...snapshot, requirementsLoading: false, requirementsError: projectError('network-error', e instanceof Error ? e.message : String(e)) }
      }
      notify()
    },

    async createRequirement(input) {
      if (deps.createImpl === undefined) {
        return { ok: false, error: projectError('internal-error', 'createImpl not injected') }
      }
      try {
        const result = await deps.createImpl(input)
        if (result.ok && result.item !== undefined) {
          // 乐观更新：不等 SSE 立即把新项塞到列表顶部
          const item = projectItem(result.item)
          snapshot = {
            ...snapshot,
            requirements: [item, ...snapshot.requirements.filter(r => r.id !== item.id)],
            requirementsError: null,
          }
          notify()
          return { ok: true, id: item.id }
        }
        // createImpl 返回失败：把错误写回 snapshot 让 UI 能展示（toast / inline）
        const err = result.error ?? projectError('internal-error')
        snapshot = { ...snapshot, requirementsError: err }
        notify()
        return { ok: false, error: err }
      } catch (e) {
        const err = projectError('network-error', e instanceof Error ? e.message : String(e))
        snapshot = { ...snapshot, requirementsError: err }
        notify()
        return { ok: false, error: err }
      }
    },

    async deleteRequirement(id) {
      if (deps.deleteImpl === undefined) {
        return { ok: false, error: projectError('internal-error', 'deleteImpl not injected') }
      }
      try {
        const result = await deps.deleteImpl(id)
        if (result.ok) {
          // 乐观更新：本地立刻移除；SSE 推 deleted 事件时去重处理
          snapshot = { ...snapshot, requirements: snapshot.requirements.filter(r => r.id !== id), requirementsError: null }
          notify()
          return { ok: true }
        }
        // 删除失败：写错误到 snapshot 让 UI 可见
        const err = result.error ?? projectError('internal-error')
        snapshot = { ...snapshot, requirementsError: err }
        notify()
        return { ok: false, error: err }
      } catch (e) {
        const err = projectError('network-error', e instanceof Error ? e.message : String(e))
        snapshot = { ...snapshot, requirementsError: err }
        notify()
        return { ok: false, error: err }
      }
    },

    handleStreamEvent(event) {
      if (event.operation === 'put') {
        const exists = snapshot.requirements.some(r => r.id === event.item.id)
        const next = exists
          ? snapshot.requirements.map(r => r.id === event.item.id ? event.item : r)
          : [event.item, ...snapshot.requirements]
        snapshot = { ...snapshot, requirements: next.sort((a, b) => b.id.localeCompare(a.id)) }
      } else {
        snapshot = { ...snapshot, requirements: snapshot.requirements.filter(r => r.id !== event.id) }
      }
      notify()
    },
  }
}
