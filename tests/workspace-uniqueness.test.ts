/**
 * src/host/workspace-uniqueness.ts 单元测试 —— 1:1 workspace-requirement 不变量。
 *
 * 测试覆盖：
 *   - findRequirementByWorkspace：空 / 无占位 / 有占位
 *   - findDuplicateWorkspaceGroups：空 / 正常 / 违例（多 workspace 各违例 + 单 workspace 多条）
 *   - status 参数化（open / in_progress / done / cancelled 都算占位）
 *
 * 纯函数测 —— 不依赖 storage domain / cordis，单进程 in-memory 跑得飞快。
 */
import { describe, expect, it } from 'vitest'
import {
  findRequirementByWorkspace,
  findDuplicateWorkspaceGroups,
} from '../src/host/workspace-uniqueness.ts'
import type { Requirement, RequirementStatus, WorkspaceId } from '../src/protocol.ts'

/** 构造一条最小可用的 requirement fixture（host create 写完整 100% 字段）。 */
function makeReq(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: '2026-08-30T12:00:00.000Z-aaaaa1',
    workspaceId: 'ws-1' as WorkspaceId,
    title: 'demo',
    description: '',
    priority: 'normal',
    status: 'open',
    tags: [],
    createdAt: '2026-08-30T12:00:00.000Z',
    updatedAt: '2026-08-30T12:00:00.000Z',
    stage: 'understand',
    stageHistory: [{ stage: 'understand', enteredAt: '2026-08-30T12:00:00.000Z' }],
    aiState: 'idle',
    aiSessionId: null,
    aiLastActivityAt: null,
    interventionQueue: [],
    artifacts: {},
    branch: null,
    materials: {
      prdFiles: [],
      prdLinks: [],
      sourceRepos: [],
      designLinks: [],
      attachments: [],
      externalLinks: [],
    },
    ...overrides,
  }
}

describe('findRequirementByWorkspace', () => {
  it('空集合返回 undefined', () => {
    expect(findRequirementByWorkspace([], 'ws-1' as WorkspaceId)).toBeUndefined()
  })

  it('无占位 workspace 返回 undefined', () => {
    const items: Requirement[] = [
      makeReq({ id: 'r-1', workspaceId: 'ws-a' as WorkspaceId }),
      makeReq({ id: 'r-2', workspaceId: 'ws-b' as WorkspaceId }),
    ]
    expect(findRequirementByWorkspace(items, 'ws-x' as WorkspaceId)).toBeUndefined()
  })

  it('命中第一条匹配的 requirement（status 任意）', () => {
    const target = makeReq({ id: 'r-target', workspaceId: 'ws-1' as WorkspaceId, status: 'done' })
    const items: Requirement[] = [
      makeReq({ id: 'r-other', workspaceId: 'ws-other' as WorkspaceId }),
      target,
      makeReq({ id: 'r-other2', workspaceId: 'ws-other2' as WorkspaceId }),
    ]
    expect(findRequirementByWorkspace(items, 'ws-1' as WorkspaceId)).toBe(target)
  })

  it('status 都算占位（参数化 4 档）', () => {
    for (const status of ['open', 'in_progress', 'done', 'cancelled'] as const satisfies readonly RequirementStatus[]) {
      const items: Requirement[] = [
        makeReq({ id: `r-${status}`, workspaceId: 'ws-1' as WorkspaceId, status }),
      ]
      const found = findRequirementByWorkspace(items, 'ws-1' as WorkspaceId)
      expect(found?.status).toBe(status)
    }
  })

  it('脏数据：同 workspace 出现多条时返回第一条匹配项', () => {
    // 不变量违例场景（历史脏数据），纯函数层面返回 first match；UI 红框警示另说
    const first = makeReq({ id: 'r-first', workspaceId: 'ws-1' as WorkspaceId })
    const second = makeReq({ id: 'r-second', workspaceId: 'ws-1' as WorkspaceId })
    const items: Requirement[] = [first, second]
    expect(findRequirementByWorkspace(items, 'ws-1' as WorkspaceId)).toBe(first)
  })
})

describe('findDuplicateWorkspaceGroups', () => {
  it('空集合返回空数组', () => {
    expect(findDuplicateWorkspaceGroups([])).toEqual([])
  })

  it('全部唯一：无违例', () => {
    const items: Requirement[] = [
      makeReq({ id: 'r-1', workspaceId: 'ws-a' as WorkspaceId }),
      makeReq({ id: 'r-2', workspaceId: 'ws-b' as WorkspaceId }),
      makeReq({ id: 'r-3', workspaceId: 'ws-c' as WorkspaceId }),
    ]
    expect(findDuplicateWorkspaceGroups(items)).toEqual([])
  })

  it('单个 workspace 出现 ≥2 条 → 1 个违例组（含全部 N 条）', () => {
    const items: Requirement[] = [
      makeReq({ id: 'r-1', workspaceId: 'ws-dup' as WorkspaceId }),
      makeReq({ id: 'r-2', workspaceId: 'ws-dup' as WorkspaceId, title: 'second' }),
    ]
    const groups = findDuplicateWorkspaceGroups(items)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(2)
    expect(groups[0]?.map(r => r.id).sort()).toEqual(['r-1', 'r-2'])
  })

  it('多个 workspace 各违例 → 多个违例组', () => {
    const items: Requirement[] = [
      makeReq({ id: 'r-1', workspaceId: 'ws-a' as WorkspaceId }),
      makeReq({ id: 'r-2', workspaceId: 'ws-a' as WorkspaceId }),
      makeReq({ id: 'r-3', workspaceId: 'ws-b' as WorkspaceId }),
      makeReq({ id: 'r-4', workspaceId: 'ws-b' as WorkspaceId }),
      makeReq({ id: 'r-5', workspaceId: 'ws-b' as WorkspaceId }),
      makeReq({ id: 'r-6', workspaceId: 'ws-ok' as WorkspaceId }), // 唯一项，不进组
    ]
    const groups = findDuplicateWorkspaceGroups(items)
    expect(groups).toHaveLength(2)
    // 每组长度：[ws-a] = 2, [ws-b] = 3
    const sizes = groups.map(g => g.length).sort()
    expect(sizes).toEqual([2, 3])
    // 验证组内 workspaceId 一致
    for (const group of groups) {
      const ids = new Set(group.map(r => r.workspaceId))
      expect(ids.size).toBe(1)
    }
  })

  it('任意 status 都触发违例检测', () => {
    for (const status of ['open', 'in_progress', 'done', 'cancelled'] as const satisfies readonly RequirementStatus[]) {
      const items: Requirement[] = [
        makeReq({ id: `r-1-${status}`, workspaceId: 'ws-x' as WorkspaceId, status }),
        makeReq({ id: `r-2-${status}`, workspaceId: 'ws-x' as WorkspaceId, status: 'open' }),
      ]
      expect(findDuplicateWorkspaceGroups(items)).toHaveLength(1)
    }
  })

  it('删一条后即恢复 1:1（KV remove 解除占位）', () => {
    // 模拟 remove 后列表只剩一条 → 不再违例
    const items: Requirement[] = [
      makeReq({ id: 'r-1', workspaceId: 'ws-recovered' as WorkspaceId }),
    ]
    expect(findDuplicateWorkspaceGroups(items)).toEqual([])
  })
})
