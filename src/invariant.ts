/**
 * Invariant companion plugin —— hello 插件不持有任何跨包运行时不变量，
 * 因此 invariant 入口导出空 apply。这是 bundle 的标准结构，便于包的
 * invariants 检查门禁识别 lib/invariant.js。
 */

/** Provides no assertions: the plugin owns no cross-package runtime invariants. */
export function apply(): void {}