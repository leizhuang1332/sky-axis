/**
 * Sidebar entry injection —— package-specific wiring over the shared core.
 *
 * The DOM injection / self-healing / idempotency logic lives exactly once in
 * sidebar-entry-core.ts (vendored copy from dsh-web-ui/shared/client/); this
 * wrapper supplies the hello icon, copy, CSS module, and the page toggle.
 *
 * The row is plain DOM (no React tree) so it can never disturb the shell's
 * reconciliation; the page view it toggles is a separate React root mounted
 * in the center column (see hello-page-mount.tsx).
 *
 * Sidebar entry 文案 hardcode 英文 'Hello'（与 dsh-ssh / dsh-task-board 的
 * 做法一致：sidebar row 的 label 在 shell 启动时即写入 innerHTML，locale
 * 动态切换不会回流更新 DOM）。面板内部仍然跟随 locale。
 */
import type { HelloController } from './hello-controller.ts'
import { mountSidebarEntry as mountSharedSidebarEntry } from './sidebar-entry-core.ts'
import css from './sidebar-entry.module.css'

/** Stable data attribute identifying the injected entry row. */
export const ENTRY_SELECTOR = '[data-dsh-hello-entry]'

/** 静态 label —— 与 shell 视觉节奏一致。 */
const LABEL = 'Hello'
const TOOLTIP = 'Open the hello page'

/**
 * 16px 手势图标（描边 + 实心圆点），与 shell 内置 nav icon 同视觉风格。
 */
const ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5C5.5 1.5 3.5 3.5 3.5 6c0 3 4.5 8.5 4.5 8.5s4.5-5.5 4.5-8.5c0-2.5-2-4.5-4.5-4.5z"/><circle cx="8" cy="6" r="1.6" fill="currentColor" stroke="none"/></svg>'

/**
 * Mount the sidebar entry, waiting for the shell to render and self-healing
 * on later React re-renders.
 * @param controller - the hello page controller the entry toggles.
 * @returns disposer removing the entry and its observers.
 */
export function mountSidebarEntry(controller: HelloController): () => void {
  return mountSharedSidebarEntry({
    rowAttribute: 'data-dsh-hello-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'hello',
    icon: ICON,
    css,
    label: () => LABEL,
    tooltip: () => TOOLTIP,
    onToggle: () => { controller.togglePage() },
    // 单 plugin —— 不与其他 family 成员排序，但仍使用 familySelectors 防止
    // 被误判为陌生 row 而被挤到末尾（占位保留）。
    position: 'before',
    familySelectors: [ENTRY_SELECTOR],
    active: {
      subscribe: (listener) => controller.subscribe(listener),
      isOpen: () => controller.isPageOpen(),
    },
  })
}