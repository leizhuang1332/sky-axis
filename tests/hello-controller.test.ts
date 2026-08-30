/**
 * HelloController 状态机单元测试。
 *
 * 测试覆盖（按状态机维度）：
 *   - 初始 snapshot 默认值
 *   - pageOpen / closePage / togglePage 的幂等性 + viewKey 重置规则
 *   - setView / getView 仅在 pageOpen 时生效
 *   - toggleSidebar / isSidebarCollapsed 与 pageOpen 解耦
 *   - setWorkspaces 引用变化触发 notify
 *   - loadRequirements 成功 / 失败 / 异常三个分支
 *   - createRequirement 乐观更新 + 失败回写
 *   - deleteRequirement 本地立即移除 + 失败回写
 *   - handleStreamEvent SSE put / deleted 与乐观更新去重
 *   - subscribe / unsubscribe 监听器行为
 *
 * 所有依赖（loadImpl / createImpl / deleteImpl）通过 deps 注入，
 * 测试用例不发起任何真实网络请求。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createHelloController,
  type RequirementEntry,
  type RequirementError,
} from '../src/client/controller/hello-controller.ts'

/** 一条最小可用的 requirement fixture。 */
function makeReq(overrides: Partial<RequirementEntry> = {}): RequirementEntry {
  return {
    id: '2026-08-30T12:00:00.000Z-aaaaa1',
    workspaceId: 'ws-1',
    title: 'demo',
    description: '',
    priority: 'normal',
    status: 'open',
    tags: [],
    createdAt: '2026-08-30T12:00:00.000Z',
    updatedAt: '2026-08-30T12:00:00.000Z',
    ...overrides,
  }
}

/** 创建一个返回固定成功响应的 loadImpl。 */
function okLoad(items: RequirementEntry[]): () => Promise<{ ok: true; items: RequirementEntry[] }> {
  return async () => ({ ok: true, items })
}

/** 创建一个返回失败的 loadImpl。 */
function failLoad(code: RequirementError['code'], detail?: string) {
  return async () => ({ ok: false as const, error: { code, detail } })
}

/** 抛异常的 loadImpl（用于测试异常分支）。 */
function throwLoad(message: string) {
  return async () => { throw new Error(message) }
}

/** 收集监听器触发的引用计数 helper。 */
function makeListener() {
  let calls = 0
  const fn = (): void => { calls += 1 }
  return { fn, getCalls: () => calls }
}

describe('HelloController 初始 snapshot', () => {
  it('默认值正确', () => {
    const c = createHelloController()
    const s = c.getSnapshot()
    expect(s.pageOpen).toBe(false)
    expect(s.viewKey).toBe('home')
    expect(s.sidebarCollapsed).toBe(false)
    expect(s.personalExpanded).toBe(true)
    expect(s.requirements).toEqual([])
    expect(s.workspaces).toEqual([])
    expect(s.requirementsLoading).toBe(false)
    expect(s.requirementsError).toBeNull()
  })

  it('未注入 impl 时 loadImpl / createImpl / deleteImpl 都空跑', async () => {
    const c = createHelloController()
    await c.loadRequirements()
    expect(c.getSnapshot().requirements).toEqual([])

    const create = await c.createRequirement({
      workspaceId: 'ws-1', title: 't',
    })
    expect(create.ok).toBe(false)

    const del = await c.deleteRequirement('2026-08-30T00:00:00.000Z-aaaaa1')
    expect(del.ok).toBe(false)
  })
})

describe('HelloController pageOpen 状态机', () => {
  it('openPage 幂等', () => {
    const c = createHelloController()
    const l = makeListener()
    c.subscribe(l.fn)
    c.openPage()
    c.openPage()
    expect(c.isPageOpen()).toBe(true)
    expect(l.getCalls()).toBe(1) // 只触发一次
  })

  it('closePage 幂等', () => {
    const c = createHelloController()
    c.openPage()
    const l = makeListener()
    c.subscribe(l.fn)
    c.closePage()
    c.closePage()
    expect(c.isPageOpen()).toBe(false)
    expect(l.getCalls()).toBe(1)
  })

  it('openPage 强制重置 viewKey 为 home（即使之前是其他视图）', () => {
    const c = createHelloController()
    c.openPage()
    c.setView('settings')
    expect(c.getView()).toBe('settings')
    c.closePage()
    c.openPage()
    expect(c.getView()).toBe('home')
  })

  it('closePage 保留 viewKey 不变（关闭再开仍是上次视图）', () => {
    const c = createHelloController()
    c.openPage()
    c.setView('reports')
    c.closePage()
    expect(c.getView()).toBe('reports')
    c.openPage()
    expect(c.getView()).toBe('home') // openPage 仍然重置
  })

  it('togglePage 在关闭态打开，在打开态关闭', () => {
    const c = createHelloController()
    expect(c.isPageOpen()).toBe(false)
    c.togglePage()
    expect(c.isPageOpen()).toBe(true)
    c.togglePage()
    expect(c.isPageOpen()).toBe(false)
  })

  it('subscribe 返回 unsubscribe，可停止监听', () => {
    const c = createHelloController()
    const l = makeListener()
    const unsub = c.subscribe(l.fn)
    c.openPage()
    unsub()
    c.closePage()
    expect(l.getCalls()).toBe(1)
  })
})

describe('HelloController setView / getView', () => {
  it('仅在 pageOpen=true 时切换视图', () => {
    const c = createHelloController()
    c.setView('team') // pageOpen=false，应被忽略
    expect(c.getView()).toBe('home')

    c.openPage()
    c.setView('team')
    expect(c.getView()).toBe('team')

    c.setView('team') // 同值，幂等
    c.setView('settings')
    expect(c.getView()).toBe('settings')
  })
})

describe('HelloController toggleSidebar', () => {
  it('与 pageOpen 独立，可任意时机切换', () => {
    const c = createHelloController()
    expect(c.isSidebarCollapsed()).toBe(false)
    c.toggleSidebar()
    expect(c.isSidebarCollapsed()).toBe(true)
    c.toggleSidebar()
    expect(c.isSidebarCollapsed()).toBe(false)

    // pageOpen 不影响 toggleSidebar
    c.openPage()
    c.toggleSidebar()
    expect(c.isSidebarCollapsed()).toBe(true)
  })

  it('openPage / closePage 不重置 sidebarCollapsed', () => {
    const c = createHelloController()
    c.toggleSidebar()
    expect(c.isSidebarCollapsed()).toBe(true)
    c.openPage()
    expect(c.isSidebarCollapsed()).toBe(true)
    c.closePage()
    expect(c.isSidebarCollapsed()).toBe(true)
  })
})

describe('HelloController personalExpanded 二级菜单状态机', () => {
  it('初始为 true（首次进入即可见「个人 → 需求列表」）', () => {
    const c = createHelloController()
    expect(c.isPersonalExpanded()).toBe(true)
  })

  it('togglePersonalExpanded 翻转', () => {
    const c = createHelloController()
    c.togglePersonalExpanded()
    expect(c.isPersonalExpanded()).toBe(false)
    c.togglePersonalExpanded()
    expect(c.isPersonalExpanded()).toBe(true)
  })

  it('togglePersonalExpanded 与 pageOpen / sidebarCollapsed 完全独立', () => {
    const c = createHelloController()
    // 关闭 sidebar 不影响 personalExpanded
    c.toggleSidebar()
    expect(c.isPersonalExpanded()).toBe(true)
    c.togglePersonalExpanded()
    expect(c.isPersonalExpanded()).toBe(false)
    c.toggleSidebar() // 重新展开 sidebar
    expect(c.isPersonalExpanded()).toBe(false) // 仍保留上次选择

    // openPage / closePage 也不影响 personalExpanded
    c.openPage()
    expect(c.isPersonalExpanded()).toBe(false)
    c.closePage()
    expect(c.isPersonalExpanded()).toBe(false)
  })

  it('openPage 强制重置 viewKey，但保留 personalExpanded', () => {
    const c = createHelloController()
    c.togglePersonalExpanded() // false
    expect(c.isPersonalExpanded()).toBe(false)
    c.openPage()
    c.setView('reports')
    c.closePage()
    c.openPage()
    expect(c.getView()).toBe('home') // viewKey 重置
    expect(c.isPersonalExpanded()).toBe(false) // personalExpanded 保留
  })
})

describe('HelloController setView 支持 requirements', () => {
  it('pageOpen=true 时切到 requirements 视图', () => {
    const c = createHelloController()
    c.openPage()
    c.setView('requirements')
    expect(c.getView()).toBe('requirements')
  })

  it('从 personal 切到 requirements', () => {
    const c = createHelloController()
    c.openPage()
    c.setView('personal')
    expect(c.getView()).toBe('personal')
    c.setView('requirements')
    expect(c.getView()).toBe('requirements')
  })

  it('pageOpen=false 时 setView 无效', () => {
    const c = createHelloController()
    c.setView('requirements') // pageOpen=false，应被忽略
    expect(c.getView()).toBe('home')
  })
})

describe('HelloController setWorkspaces', () => {
  it('快照引用变化，触发 notify', () => {
    const c = createHelloController()
    const l = makeListener()
    c.subscribe(l.fn)
    c.setWorkspaces([{ id: 'ws-1', title: 'Workspace 1', path: '/tmp/ws-1' }])
    expect(c.getSnapshot().workspaces).toHaveLength(1)
    expect(c.getSnapshot().workspaces[0]?.title).toBe('Workspace 1')
    expect(l.getCalls()).toBe(1)
  })

  it('每次都换新数组引用（即使内容相同），确保 React 重渲染', () => {
    const c = createHelloController()
    const ws = [{ id: 'ws-1', title: 'Workspace 1', path: '/tmp/ws-1' }]
    c.setWorkspaces(ws)
    const before = c.getSnapshot().workspaces
    c.setWorkspaces(ws) // 同内容
    const after = c.getSnapshot().workspaces
    expect(before).not.toBe(after)
    expect(before).toEqual(after)
  })
})

describe('HelloController loadRequirements', () => {
  it('成功：替换 requirements，按 id 倒序', async () => {
    const c = createHelloController({
      loadImpl: okLoad([
        makeReq({ id: '2026-08-30T00:00:00.000Z-aaaaa1' }),
        makeReq({ id: '2026-08-30T00:00:00.000Z-aaaaa2' }),
        makeReq({ id: '2026-08-30T00:00:00.000Z-aaaaa3' }),
      ]),
    })
    await c.loadRequirements()
    const s = c.getSnapshot()
    expect(s.requirements).toHaveLength(3)
    expect(s.requirements[0]?.id).toBe('2026-08-30T00:00:00.000Z-aaaaa3') // 最新在前
    expect(s.requirementsLoading).toBe(false)
    expect(s.requirementsError).toBeNull()
  })

  it('成功：loading 阶段先翻为 true', async () => {
    let resolveLoad: ((v: { ok: true; items: RequirementEntry[] }) => void) | undefined
    const c = createHelloController({
      loadImpl: () => new Promise((resolve) => { resolveLoad = resolve }),
    })
    const p = c.loadRequirements()
    expect(c.getSnapshot().requirementsLoading).toBe(true)
    resolveLoad?.({ ok: true, items: [] })
    await p
    expect(c.getSnapshot().requirementsLoading).toBe(false)
  })

  it('失败（result.ok=false）：写错误但不替换列表', async () => {
    const c = createHelloController({ loadImpl: failLoad('workspace-list-failed', 'rpc timeout') })
    await c.loadRequirements()
    const s = c.getSnapshot()
    expect(s.requirements).toEqual([])
    expect(s.requirementsLoading).toBe(false)
    expect(s.requirementsError).toEqual({ code: 'workspace-list-failed', detail: 'rpc timeout' })
  })

  it('异常（throw）：写 network-error', async () => {
    const c = createHelloController({ loadImpl: throwLoad('connect ECONNREFUSED') })
    await c.loadRequirements()
    const s = c.getSnapshot()
    expect(s.requirementsError?.code).toBe('network-error')
    expect(s.requirementsError?.detail).toContain('ECONNREFUSED')
  })

  it('成功加载后清空之前的错误', async () => {
    // 单个 loadImpl 内部按调用次数切换行为，模拟「先失败后成功」
    let calls = 0
    const c = createHelloController({
      loadImpl: async () => {
        calls += 1
        if (calls === 1) return { ok: false as const, error: { code: 'internal-error' as const, detail: 'first' } }
        return { ok: true as const, items: [] }
      },
    })
    await c.loadRequirements()
    expect(c.getSnapshot().requirementsError?.code).toBe('internal-error')

    await c.loadRequirements()
    const s = c.getSnapshot()
    expect(s.requirements).toEqual([])
    expect(s.requirementsError).toBeNull()
  })
})

describe('HelloController createRequirement', () => {
  it('成功：乐观写入列表头部，去重同 id', async () => {
    const existing = makeReq({ id: '2026-08-30T00:00:00.000Z-aaaaa1' })
    const newItem = makeReq({ id: '2026-08-30T12:00:00.000Z-bbbbb2', title: 'new' })
    const c = createHelloController({
      loadImpl: okLoad([existing]),
      createImpl: async () => ({ ok: true, item: newItem }),
    })
    await c.loadRequirements()

    const r = await c.createRequirement({ workspaceId: 'ws-1', title: 'new' })
    expect(r.ok).toBe(true)
    expect(r.id).toBe(newItem.id)

    const s = c.getSnapshot()
    expect(s.requirements).toHaveLength(2)
    expect(s.requirements[0]?.id).toBe(newItem.id) // 最新在前
  })

  it('失败：保留原列表，写错误', async () => {
    const c = createHelloController({
      createImpl: async () => ({ ok: false as const, error: { code: 'workspace-not-found', detail: 'gone' } }),
    })
    const r = await c.createRequirement({ workspaceId: 'ws-gone', title: 't' })
    expect(r.ok).toBe(false)
    expect(c.getSnapshot().requirements).toEqual([]) // 未写入
    expect(c.getSnapshot().requirementsError?.code).toBe('workspace-not-found')
  })

  it('异常：捕获后返回 network-error', async () => {
    const c = createHelloController({
      createImpl: async () => { throw new Error('socket hang up') },
    })
    const r = await c.createRequirement({ workspaceId: 'ws-1', title: 't' })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('network-error')
  })
})

describe('HelloController deleteRequirement', () => {
  it('成功：本地立即移除', async () => {
    const a = makeReq({ id: '2026-08-30T00:00:00.000Z-aaaaa1' })
    const b = makeReq({ id: '2026-08-30T00:00:00.000Z-aaaaa2' })
    const c = createHelloController({
      loadImpl: okLoad([a, b]),
      deleteImpl: async (id) => {
        expect(id).toBe(a.id)
        return { ok: true }
      },
    })
    await c.loadRequirements()
    const r = await c.deleteRequirement(a.id)
    expect(r.ok).toBe(true)
    expect(c.getSnapshot().requirements.map(x => x.id)).toEqual([b.id])
  })

  it('失败：原列表保留，写错误', async () => {
    const a = makeReq({ id: '2026-08-30T00:00:00.000Z-aaaaa1' })
    const c = createHelloController({
      loadImpl: okLoad([a]),
      deleteImpl: async () => ({ ok: false as const, error: { code: 'requirement-not-found' } }),
    })
    await c.loadRequirements()
    const r = await c.deleteRequirement(a.id)
    expect(r.ok).toBe(false)
    expect(c.getSnapshot().requirements).toHaveLength(1)
  })

  it('异常：捕获后返回 network-error', async () => {
    const c = createHelloController({
      deleteImpl: async () => { throw new Error('boom') },
    })
    const r = await c.deleteRequirement('2026-08-30T00:00:00.000Z-aaaaa1')
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('network-error')
  })
})

describe('HelloController handleStreamEvent（SSE）', () => {
  it('put 新项：插入头部并排序', () => {
    const c = createHelloController()
    const item = makeReq({ id: '2026-08-30T12:00:00.000Z-bbbbb2' })
    c.handleStreamEvent({ operation: 'put', item })
    const s = c.getSnapshot()
    expect(s.requirements).toHaveLength(1)
    expect(s.requirements[0]?.id).toBe(item.id)
  })

  it('put 已有 id：替换（去重后保留单条）', () => {
    const c = createHelloController()
    const item = makeReq({ id: '2026-08-30T12:00:00.000Z-bbbbb2' })
    c.handleStreamEvent({ operation: 'put', item })
    const updated = { ...item, title: 'updated' }
    c.handleStreamEvent({ operation: 'put', item: updated })
    const s = c.getSnapshot()
    expect(s.requirements).toHaveLength(1)
    expect(s.requirements[0]?.title).toBe('updated')
  })

  it('deleted：按 id 移除', () => {
    const c = createHelloController({
      loadImpl: okLoad([
        makeReq({ id: '2026-08-30T00:00:00.000Z-aaaaa1' }),
        makeReq({ id: '2026-08-30T00:00:00.000Z-aaaaa2' }),
      ]),
    })
    void c.loadRequirements().then(() => {
      c.handleStreamEvent({ operation: 'deleted', id: '2026-08-30T00:00:00.000Z-aaaaa1' })
      const s = c.getSnapshot()
      expect(s.requirements.map(x => x.id)).toEqual(['2026-08-30T00:00:00.000Z-aaaaa2'])
    })
  })

  it('optimistic + SSE 去重：本地创建后 SSE put 同一 id 不会重复', async () => {
    const newItem = makeReq({ id: '2026-08-30T12:00:00.000Z-bbbbb2' })
    const c = createHelloController({
      createImpl: async () => ({ ok: true, item: newItem }),
    })
    await c.createRequirement({ workspaceId: 'ws-1', title: 'new' })
    expect(c.getSnapshot().requirements).toHaveLength(1)

    // SSE put 同一 id（host 端 put 也会触发）
    c.handleStreamEvent({ operation: 'put', item: newItem })
    expect(c.getSnapshot().requirements).toHaveLength(1) // 仍然 1 条
  })
})

describe('HelloController subscribe 引用语义', () => {
  it('多次状态变化只触发一次 notify（每次构造新 snapshot 对象）', () => {
    const c = createHelloController()
    const l = makeListener()
    c.subscribe(l.fn)
    const snap1 = c.getSnapshot()
    c.setWorkspaces([{ id: 'ws-1', title: 't', path: '/x' }])
    const snap2 = c.getSnapshot()
    expect(snap1).not.toBe(snap2)
    expect(l.getCalls()).toBe(1)
  })

  it('vi.fn 监听器能记录所有调用', () => {
    const c = createHelloController()
    const spy = vi.fn()
    c.subscribe(spy)
    c.openPage()
    c.setView('team')
    c.toggleSidebar()
    expect(spy).toHaveBeenCalledTimes(3)
  })
})