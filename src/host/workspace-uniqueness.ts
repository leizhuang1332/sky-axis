/**
 * sky-axis 1:1 workspace-requirement 不变量 —— 纯函数模块。
 *
 * 把不变量校验逻辑从 `RequirementHostService` 中抽出，便于单测。
 * 语义：
 *   - **1 个 workspace 在任意时刻最多对应 1 条 requirement record**
 *   - status 任意值（open / in_progress / done / cancelled）都算占位
 *   - 删除走 `remove()`，仅软删 KV —— 删后该 workspace 可重建（KV 记录不存在即解除占位）
 *
 * 不变量强度 trade-off：
 *   - 当前实现依赖 host service 单进程 + 60s workspace path cache；理论 race 下两次并发
 *     create 都过 in-memory 检查的可能性极小（DSH 单进程 cordis 插件），但不严格为 0
 *   - 真正强一致需要把 requirementId 改成 `${workspaceId}` 或引入 CAS 二级索引，
 *     超出当前 phase 范围
 */
import type { Requirement, WorkspaceId as SkyAxisWorkspaceId } from '../protocol.ts'

/**
 * 在 items 中找已关联到该 workspace 的 requirement（任意 status 都算占位）。
 * 返回 undefined 表示无占位 —— caller 可放心 create。
 */
export function findRequirementByWorkspace(
  items: Iterable<Requirement>,
  workspaceId: SkyAxisWorkspaceId,
): Requirement | undefined {
  for (const r of items) {
    if (r.workspaceId === workspaceId) return r
  }
  return undefined
}

/**
 * 不变量自检：返回所有违例组，每组 = 同一 workspaceId 下的全部 requirement（≥2 条）。
 * 空数组 = 无违例。
 *
 * 仅检测不修不删 —— 数据完整性责任归用户/管理员。
 */
export function findDuplicateWorkspaceGroups(items: Iterable<Requirement>): Requirement[][] {
  const byWs = new Map<SkyAxisWorkspaceId, Requirement[]>()
  for (const r of items) {
    const list = byWs.get(r.workspaceId) ?? []
    list.push(r)
    byWs.set(r.workspaceId, list)
  }
  const violations: Requirement[][] = []
  for (const list of byWs.values()) {
    if (list.length >= 2) violations.push(list)
  }
  return violations
}
