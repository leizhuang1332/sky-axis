/**
 * Hello 页面控制器 —— 极小状态机，仅持有 pageOpen 标志位与订
 * 阅器。
 *
 * 设计上与 dsh-task-board / dsh-ssh 的 PanelController 一致：
 * 暴露 getSnapshot + subscribe 两个对 React useSyncExternalStore
 * 友好的接口；sidebar entry 用 subscribe + isOpen 维持 active 高亮，
 * mount.tsx 用 getSnapshot 读取状态、用 setState 写入。
 *
 * 真正的「切换激活态」逻辑（与 task-board / ssh 的协调、sidebar
 * context click 让出）由 hello-page-mount.tsx 调用本控制器实现。
 */

/** 控制器持有的快照形状。 */
export interface HelloSnapshot {
  /** 主列 page 是否正占据 conversation。 */
  pageOpen: boolean
}

/** Hello 控制器公开接口。 */
export interface HelloController {
  /** 订阅快照变化（用于 React 与 sidebar entry 同步）。 */
  subscribe(listener: () => void): () => void
  /** 读取当前快照（用于 React useSyncExternalStore）。 */
  getSnapshot(): HelloSnapshot
  /** 同步读取 pageOpen 状态（sidebar active bridge 用）。 */
  isPageOpen(): boolean
  /** 打开 hello 页面（mount 负责发 ACTIVATE 事件 + 设 html data attr）。 */
  openPage(): void
  /** 关闭 hello 页面（mount 负责清理 html data attr）。 */
  closePage(): void
  /** 切换。 */
  togglePage(): void
}

/** 构造一个全新控制器。 */
export function createHelloController(): HelloController {
  let snapshot: HelloSnapshot = { pageOpen: false }
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot(): HelloSnapshot {
      return snapshot
    },
    isPageOpen(): boolean {
      return snapshot.pageOpen
    },
    openPage(): void {
      if (snapshot.pageOpen) return
      snapshot = { pageOpen: true }
      notify()
    },
    closePage(): void {
      if (!snapshot.pageOpen) return
      snapshot = { pageOpen: false }
      notify()
    },
    togglePage(): void {
      snapshot = { pageOpen: !snapshot.pageOpen }
      notify()
    },
  }
}