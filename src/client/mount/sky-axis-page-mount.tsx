/**
 * SkyAxis 页面主列挂载。
 *
 * DSH shell 暴露的 `conversation` 槽位是单占用（ui-conversation），外
 * 部插件不能 declare 自己的 slot。沿用 dsh-task-board / dsh-ssh 的做法：
 * 在主列（`[data-pane="conversation"], [class*="centerCol"]`）尾部
 * append 一个独立 React 根容器，CSS 用 `<html>` 上的 `data-sky-axis-active`
 * 属性切换可见性，conversation 容器本身仍保留挂载（状态不丢）。
 *
 * 跨 panel 协议与 task-board / ssh 一致：
 * - 打开 sky-axis 时 evict 兄弟 panel 的 active attr，并 dispatch `dsh-panel-activate`
 * - 监听 `dsh-panel-activate`：其他 panel 打开 → 自动关闭自己
 * - 捕获 sidebar context click：让出主列回 conversation
 */
import { createRoot, type Root } from 'react-dom/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkyAxisController } from '../controller/sky-axis-controller.ts'
import { SkyAxisPage } from '../page/SkyAxisPage.tsx'
import css from '../page/SkyAxisPage.module.css'

/** 注入的 sky-axis view 容器选择器（自身可见性 + takeover CSS 都用它）。 */
export const SKY_AXIS_VIEW_SELECTOR = '[data-sky-axis-view]'

/** 主列选择器（兼容 0.1.0-rc.6+ AppFrame 与旧版 shell）。 */
const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'

/** `<html>` 上表示 sky-axis 当前活跃的属性；CSS 用它做可见性切换。 */
const ACTIVE_ATTR = 'data-sky-axis-active'

/** 兄弟 panel 的 active 属性：打开 sky-axis 时 evict 它们。 */
const OTHER_ACTIVE_ATTRS = ['data-dsh-taskboard-active', 'data-dsh-ssh-active'] as const

/** 跨 panel 激活事件（与 task-board / ssh 共享协议）。 */
const ACTIVATE_EVENT = 'dsh-panel-activate'

/** 本 panel 在协议里的名字。 */
const PANEL_NAME = 'sky-axis'

/** sidebar context 点击：让出主列。 */
const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'

/** 找主列；若框架尚未挂载返回 undefined。 */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

export interface MountSkyAxisOptions {
  /** 控制器（持有 pageOpen 状态）。 */
  controller: SkyAxisController
  /** locale t 函数（SkyAxisPage 内 section 引用）。 */
  t: PropsLocale<'sky-axis'>['t']
}

/**
 * Mount the SkyAxis page React tree into the center column and bind its
 * visibility to the controller's pageOpen state.
 * @param opts - controller / t 两件套。
 * @returns disposer unmounting the tree and restoring the column.
 */
export function mountSkyAxisPage(opts: MountSkyAxisOptions): () => void {
  const { controller, t } = opts
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  const ensure = (): void => {
    if (container !== undefined) {
      if (container.isConnected) return
      // conversation pane 被替换：丢弃旧树、重新挂载。
      root?.unmount()
      root = undefined
      container.remove()
      container = undefined
    }
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset.skyAxisView = ''
    container.dataset.dshPlugin = 'sky-axis'
    container.dataset.dshPart = 'sky-axis-page'
    container.className = css.page
    column.appendChild(container)
    root = createRoot(container)
    // 把 controller 传给 SkyAxisPage，由它内部 useSyncExternalStore 订阅
    // viewKey 变化 —— SPA 风格内部路由不需要路由库。
    root.render(<SkyAxisPage t={t} onClose={() => { controller.closePage() }} controller={controller} />)
  }

  // 框架在 boot 之后才挂主列；MutationObserver 等待它出现。
  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (controller.isPageOpen()) {
      // 单占用主列：打开 sky-axis 必须 evict 兄弟 panel（task-board / ssh），
      // 否则两个 panel 的可见性 CSS 会相互打架。
      for (const attr of OTHER_ACTIVE_ATTRS) {
        document.documentElement.removeAttribute(attr)
      }
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }

  // 兄弟 panel 激活 → 关闭自己（避免多 panel 同时显示）。
  const onOtherActivate = (event: Event): void => {
    const detail = (event as CustomEvent<string | undefined>).detail
    if (detail !== undefined && detail !== PANEL_NAME && controller.isPageOpen()) {
      controller.closePage()
    }
  }

  // sidebar context 点击：让出主列给 conversation（与 task-board / ssh 一致）。
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!controller.isPageOpen()) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.closePage()
  }

  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
