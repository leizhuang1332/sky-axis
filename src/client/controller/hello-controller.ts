/**
 * Hello 控制器 —— 纯状态机（无 DOM / 无 React）。
 *
 * 状态面（HelloSnapshot）：
 *   - pageOpen: 主列整页是否打开
 *   - viewKey:  当前选中的内部视图（仅在 pageOpen=true 时有意义）
 *
 * 关键不变式：
 *   - 打开页面（openPage）时强制 viewKey 重置为 'home'，避免上次关闭时
 *     留在非首页视图造成「打开却看不到 dashboard」的歧义
 *   - 关闭页面（closePage）时**保留** viewKey，下次打开仍在原视图
 *     （与 dsh-shell 的「保留用户视图」习惯一致）
 *   - setView 仅在 pageOpen=true 时生效（关掉后视图切换无视觉意义）
 *
 * 实现方式：单一可变 snapshot + Set<listener>。subscribe 返回 unsubscribe；
 * getSnapshot 返回引用（React useSyncExternalStore 友好 —— 每次状态变化
 * snapshot 引用必变，触发重渲染）。
 */

/** hello 内部 5 个视图 key。 */
export type HelloViewKey = 'home' | 'team' | 'personal' | 'reports' | 'settings'

/** controller 暴露给订阅者的快照。 */
export interface HelloSnapshot {
  pageOpen: boolean
  viewKey: HelloViewKey
  /** sidebar 是否折叠（默认 false = 展开）。与 pageOpen 独立持久：
   *  关掉 Hello 再打开仍保留折叠状态，符合 sidebar 用户偏好习惯。 */
  sidebarCollapsed: boolean
}

/** controller 公开 API。 */
export interface HelloController {
  /** 订阅状态变化，返回 unsubscribe。 */
  subscribe(listener: () => void): () => void
  /** 读取当前快照（引用稳定，仅在状态变化时切新对象）。 */
  getSnapshot(): HelloSnapshot
  /** pageOpen === true（避免 React 端每次解构判断）。 */
  isPageOpen(): boolean
  /** 打开主列页面（幂等）；同时把 viewKey 重置为 'home'。 */
  openPage(): void
  /** 关闭主列页面（幂等）；保留 viewKey 不变。 */
  closePage(): void
  /** openPage / closePage 翻转。 */
  togglePage(): void
  /** 切换内部视图（仅在 pageOpen=true 时生效）。 */
  setView(view: HelloViewKey): void
  /** 当前视图（pageOpen=false 时返回上次保留值）。 */
  getView(): HelloViewKey
  /** 切换 sidebar 收起 / 展开（与 pageOpen 独立，可任意时机调用）。 */
  toggleSidebar(): void
  /** sidebar 是否折叠（避免 React 端每次解构判断）。 */
  isSidebarCollapsed(): boolean
}

/** 创建 hello 控制器实例（每次 apply 调用产生一个，与 cordis 生命周期对应）。 */
export function createHelloController(): HelloController {
  let snapshot: HelloSnapshot = {
    pageOpen: false,
    viewKey: 'home',
    sidebarCollapsed: false,
  }
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const l of listeners) l()
  }

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
      // 打开时同时设 pageOpen + viewKey（重置为首页）；sidebarCollapsed
      // 透传，保留用户折叠偏好。
      snapshot = {
        pageOpen: true,
        viewKey: 'home',
        sidebarCollapsed: snapshot.sidebarCollapsed,
      }
      notify()
    },
    closePage() {
      if (!snapshot.pageOpen) return
      // 关闭时只翻 pageOpen，保留 viewKey + sidebarCollapsed。
      snapshot = {
        pageOpen: false,
        viewKey: snapshot.viewKey,
        sidebarCollapsed: snapshot.sidebarCollapsed,
      }
      notify()
    },
    togglePage() {
      if (snapshot.pageOpen) {
        // 与 closePage 行为一致：保留 viewKey + sidebarCollapsed
        snapshot = {
          pageOpen: false,
          viewKey: snapshot.viewKey,
          sidebarCollapsed: snapshot.sidebarCollapsed,
        }
      } else {
        // 打开时重置到首页；sidebarCollapsed 透传
        snapshot = {
          pageOpen: true,
          viewKey: 'home',
          sidebarCollapsed: snapshot.sidebarCollapsed,
        }
      }
      notify()
    },
    setView(view) {
      if (!snapshot.pageOpen) return
      if (snapshot.viewKey === view) return
      snapshot = {
        pageOpen: true,
        viewKey: view,
        sidebarCollapsed: snapshot.sidebarCollapsed,
      }
      notify()
    },
    getView() {
      return snapshot.viewKey
    },
    toggleSidebar() {
      // 翻转 sidebarCollapsed；与 pageOpen 完全独立（折叠态下点击 entry
      // 仍可切视图，关掉页面后再打开保留折叠偏好）。
      snapshot = { ...snapshot, sidebarCollapsed: !snapshot.sidebarCollapsed }
      notify()
    },
    isSidebarCollapsed() {
      return snapshot.sidebarCollapsed
    },
  }
}
