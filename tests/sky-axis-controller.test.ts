/**
 * SkyAxisController 状态机单元测试。
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
  createSkyAxisController,
  type RequirementEntry,
  type RequirementError,
} from '../src/client/controller/sky-axis-controller.ts'

/** 一条最小可用的 requirement fixture。
 *  Phase 2.1 完美主义：所有字段 required（含 materials）—— fixture 必须 100% 完整。
 *  删除之前 `stage: undefined as undefined` 兼容旧 v1 记录的 fixture（DSH backend 已升 v2）。 */
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
    // ── Phase 1.2 字段（全部 required，删之前的 optional）──
    stage: 'understand',
    stageHistory: [{ stage: 'understand', enteredAt: '2026-08-30T12:00:00.000Z' }],
    aiState: 'idle',
    aiSessionId: null,
    aiLastActivityAt: null,
    interventionQueue: [],
    artifacts: {},
    branch: null,
    // ── Phase 2.1 新增物料（required）──
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

describe('SkyAxisController 初始 snapshot', () => {
  it('默认值正确', () => {
    const c = createSkyAxisController()
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
    const c = createSkyAxisController()
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

describe('SkyAxisController pageOpen 状态机', () => {
  it('openPage 幂等', () => {
    const c = createSkyAxisController()
    const l = makeListener()
    c.subscribe(l.fn)
    c.openPage()
    c.openPage()
    expect(c.isPageOpen()).toBe(true)
    expect(l.getCalls()).toBe(1) // 只触发一次
  })

  it('closePage 幂等', () => {
    const c = createSkyAxisController()
    c.openPage()
    const l = makeListener()
    c.subscribe(l.fn)
    c.closePage()
    c.closePage()
    expect(c.isPageOpen()).toBe(false)
    expect(l.getCalls()).toBe(1)
  })

  it('openPage 强制重置 viewKey 为 home（即使之前是其他视图）', () => {
    const c = createSkyAxisController()
    c.openPage()
    c.setView('settings')
    expect(c.getView()).toBe('settings')
    c.closePage()
    c.openPage()
    expect(c.getView()).toBe('home')
  })

  it('closePage 保留 viewKey 不变（关闭再开仍是上次视图）', () => {
    const c = createSkyAxisController()
    c.openPage()
    c.setView('reports')
    c.closePage()
    expect(c.getView()).toBe('reports')
    c.openPage()
    expect(c.getView()).toBe('home') // openPage 仍然重置
  })

  it('togglePage 在关闭态打开，在打开态关闭', () => {
    const c = createSkyAxisController()
    expect(c.isPageOpen()).toBe(false)
    c.togglePage()
    expect(c.isPageOpen()).toBe(true)
    c.togglePage()
    expect(c.isPageOpen()).toBe(false)
  })

  it('subscribe 返回 unsubscribe，可停止监听', () => {
    const c = createSkyAxisController()
    const l = makeListener()
    const unsub = c.subscribe(l.fn)
    c.openPage()
    unsub()
    c.closePage()
    expect(l.getCalls()).toBe(1)
  })
})

describe('SkyAxisController setView / getView', () => {
  it('仅在 pageOpen=true 时切换视图', () => {
    const c = createSkyAxisController()
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

describe('SkyAxisController toggleSidebar', () => {
  it('与 pageOpen 独立，可任意时机切换', () => {
    const c = createSkyAxisController()
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
    const c = createSkyAxisController()
    c.toggleSidebar()
    expect(c.isSidebarCollapsed()).toBe(true)
    c.openPage()
    expect(c.isSidebarCollapsed()).toBe(true)
    c.closePage()
    expect(c.isSidebarCollapsed()).toBe(true)
  })
})

describe('SkyAxisController personalExpanded 二级菜单状态机', () => {
  it('初始为 true（首次进入即可见「个人 → 需求列表」）', () => {
    const c = createSkyAxisController()
    expect(c.isPersonalExpanded()).toBe(true)
  })

  it('togglePersonalExpanded 翻转', () => {
    const c = createSkyAxisController()
    c.togglePersonalExpanded()
    expect(c.isPersonalExpanded()).toBe(false)
    c.togglePersonalExpanded()
    expect(c.isPersonalExpanded()).toBe(true)
  })

  it('togglePersonalExpanded 与 pageOpen / sidebarCollapsed 完全独立', () => {
    const c = createSkyAxisController()
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
    const c = createSkyAxisController()
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

describe('SkyAxisController setView 支持 requirements', () => {
  it('pageOpen=true 时切到 requirements 视图', () => {
    const c = createSkyAxisController()
    c.openPage()
    c.setView('requirements')
    expect(c.getView()).toBe('requirements')
  })

  it('从 personal 切到 requirements', () => {
    const c = createSkyAxisController()
    c.openPage()
    c.setView('personal')
    expect(c.getView()).toBe('personal')
    c.setView('requirements')
    expect(c.getView()).toBe('requirements')
  })

  it('pageOpen=false 时 setView 无效', () => {
    const c = createSkyAxisController()
    c.setView('requirements') // pageOpen=false，应被忽略
    expect(c.getView()).toBe('home')
  })
})

describe('SkyAxisController setWorkspaces', () => {
  it('快照引用变化，触发 notify', () => {
    const c = createSkyAxisController()
    const l = makeListener()
    c.subscribe(l.fn)
    c.setWorkspaces([{ id: 'ws-1', title: 'Workspace 1', path: '/tmp/ws-1' }])
    expect(c.getSnapshot().workspaces).toHaveLength(1)
    expect(c.getSnapshot().workspaces[0]?.title).toBe('Workspace 1')
    expect(l.getCalls()).toBe(1)
  })

  it('每次都换新数组引用（即使内容相同），确保 React 重渲染', () => {
    const c = createSkyAxisController()
    const ws = [{ id: 'ws-1', title: 'Workspace 1', path: '/tmp/ws-1' }]
    c.setWorkspaces(ws)
    const before = c.getSnapshot().workspaces
    c.setWorkspaces(ws) // 同内容
    const after = c.getSnapshot().workspaces
    expect(before).not.toBe(after)
    expect(before).toEqual(after)
  })
})

describe('SkyAxisController loadRequirements', () => {
  it('成功：替换 requirements，按 id 倒序', async () => {
    const c = createSkyAxisController({
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
    const c = createSkyAxisController({
      loadImpl: () => new Promise((resolve) => { resolveLoad = resolve }),
    })
    const p = c.loadRequirements()
    expect(c.getSnapshot().requirementsLoading).toBe(true)
    resolveLoad?.({ ok: true, items: [] })
    await p
    expect(c.getSnapshot().requirementsLoading).toBe(false)
  })

  it('失败（result.ok=false）：写错误但不替换列表', async () => {
    const c = createSkyAxisController({ loadImpl: failLoad('workspace-list-failed', 'rpc timeout') })
    await c.loadRequirements()
    const s = c.getSnapshot()
    expect(s.requirements).toEqual([])
    expect(s.requirementsLoading).toBe(false)
    expect(s.requirementsError).toEqual({ code: 'workspace-list-failed', detail: 'rpc timeout' })
  })

  it('异常（throw）：写 network-error', async () => {
    const c = createSkyAxisController({ loadImpl: throwLoad('connect ECONNREFUSED') })
    await c.loadRequirements()
    const s = c.getSnapshot()
    expect(s.requirementsError?.code).toBe('network-error')
    expect(s.requirementsError?.detail).toContain('ECONNREFUSED')
  })

  it('成功加载后清空之前的错误', async () => {
    // 单个 loadImpl 内部按调用次数切换行为，模拟「先失败后成功」
    let calls = 0
    const c = createSkyAxisController({
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

describe('SkyAxisController createRequirement', () => {
  it('成功：乐观写入列表头部，去重同 id', async () => {
    const existing = makeReq({ id: '2026-08-30T00:00:00.000Z-aaaaa1' })
    const newItem = makeReq({ id: '2026-08-30T12:00:00.000Z-bbbbb2', title: 'new' })
    const c = createSkyAxisController({
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
    const c = createSkyAxisController({
      createImpl: async () => ({ ok: false as const, error: { code: 'workspace-not-found', detail: 'gone' } }),
    })
    const r = await c.createRequirement({ workspaceId: 'ws-gone', title: 't' })
    expect(r.ok).toBe(false)
    expect(c.getSnapshot().requirements).toEqual([]) // 未写入
    expect(c.getSnapshot().requirementsError?.code).toBe('workspace-not-found')
  })

  it('异常：捕获后返回 network-error', async () => {
    const c = createSkyAxisController({
      createImpl: async () => { throw new Error('socket hang up') },
    })
    const r = await c.createRequirement({ workspaceId: 'ws-1', title: 't' })
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('network-error')
  })
})

describe('SkyAxisController deleteRequirement', () => {
  it('成功：本地立即移除', async () => {
    const a = makeReq({ id: '2026-08-30T00:00:00.000Z-aaaaa1' })
    const b = makeReq({ id: '2026-08-30T00:00:00.000Z-aaaaa2' })
    const c = createSkyAxisController({
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
    const c = createSkyAxisController({
      loadImpl: okLoad([a]),
      deleteImpl: async () => ({ ok: false as const, error: { code: 'requirement-not-found' } }),
    })
    await c.loadRequirements()
    const r = await c.deleteRequirement(a.id)
    expect(r.ok).toBe(false)
    expect(c.getSnapshot().requirements).toHaveLength(1)
  })

  it('异常：捕获后返回 network-error', async () => {
    const c = createSkyAxisController({
      deleteImpl: async () => { throw new Error('boom') },
    })
    const r = await c.deleteRequirement('2026-08-30T00:00:00.000Z-aaaaa1')
    expect(r.ok).toBe(false)
    expect(r.error?.code).toBe('network-error')
  })
})

describe('SkyAxisController handleStreamEvent（SSE）', () => {
  it('put 新项：插入头部并排序', () => {
    const c = createSkyAxisController()
    const item = makeReq({ id: '2026-08-30T12:00:00.000Z-bbbbb2' })
    c.handleStreamEvent({ operation: 'put', item })
    const s = c.getSnapshot()
    expect(s.requirements).toHaveLength(1)
    expect(s.requirements[0]?.id).toBe(item.id)
  })

  it('put 已有 id：替换（去重后保留单条）', () => {
    const c = createSkyAxisController()
    const item = makeReq({ id: '2026-08-30T12:00:00.000Z-bbbbb2' })
    c.handleStreamEvent({ operation: 'put', item })
    const updated = { ...item, title: 'updated' }
    c.handleStreamEvent({ operation: 'put', item: updated })
    const s = c.getSnapshot()
    expect(s.requirements).toHaveLength(1)
    expect(s.requirements[0]?.title).toBe('updated')
  })

  it('deleted：按 id 移除', () => {
    const c = createSkyAxisController({
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
    const c = createSkyAxisController({
      createImpl: async () => ({ ok: true, item: newItem }),
    })
    await c.createRequirement({ workspaceId: 'ws-1', title: 'new' })
    expect(c.getSnapshot().requirements).toHaveLength(1)

    // SSE put 同一 id（host 端 put 也会触发）
    c.handleStreamEvent({ operation: 'put', item: newItem })
    expect(c.getSnapshot().requirements).toHaveLength(1) // 仍然 1 条
  })
})

describe('SkyAxisController subscribe 引用语义', () => {
  it('多次状态变化只触发一次 notify（每次构造新 snapshot 对象）', () => {
    const c = createSkyAxisController()
    const l = makeListener()
    c.subscribe(l.fn)
    const snap1 = c.getSnapshot()
    c.setWorkspaces([{ id: 'ws-1', title: 't', path: '/x' }])
    const snap2 = c.getSnapshot()
    expect(snap1).not.toBe(snap2)
    expect(l.getCalls()).toBe(1)
  })

  it('vi.fn 监听器能记录所有调用', () => {
    const c = createSkyAxisController()
    const spy = vi.fn()
    c.subscribe(spy)
    c.openPage()
    c.setView('team')
    c.toggleSidebar()
    expect(spy).toHaveBeenCalledTimes(3)
  })
})

describe('SkyAxisController openDetail / closeDetail / loadDetail（Phase 1.2）', () => {
  it('openDetail 设 selectedRequirementId 且不切 viewKey', async () => {
    const c = createSkyAxisController({
      loadImpl: okLoad([makeReq({ id: '2026-08-30T12:00:00.000Z-aaaaa1' })]),
    })
    await c.loadRequirements()
    c.openPage()
    c.setView('requirements')
    c.openDetail('2026-08-30T12:00:00.000Z-aaaaa1')
    const s = c.getSnapshot()
    expect(s.selectedRequirementId).toBe('2026-08-30T12:00:00.000Z-aaaaa1')
    expect(s.viewKey).toBe('requirements') // 不切 viewKey
  })

  it('openDetail 幂等：同 id 二次调用不重复触发 loadDetail', async () => {
    // Phase 2.1 完美主义：DSH backend 已升 v2，本地 record 永远 100% 完整，
    //   loadDetail 直接走「本地优先」短路，二次 openDetail 不会重复触发网络。
    const detailSpy = vi.fn(async () => ({ ok: true as const, item: makeReq({ id: 'r-1', stage: 'plan' as const }) }))
    const c = createSkyAxisController({
      loadImpl: okLoad([makeReq({ id: 'r-1' })]),
      detailImpl: detailSpy,
    })
    await c.loadRequirements()
    c.openDetail('r-1')
    c.openDetail('r-1')
    expect(detailSpy).not.toHaveBeenCalled() // 本地优先短路，二次不调
  })

  it('closeDetail 清 selectedRequirementId 且不切 viewKey', async () => {
    const c = createSkyAxisController({
      loadImpl: okLoad([makeReq({ id: 'r-1' })]),
    })
    await c.loadRequirements()
    c.openPage()
    c.setView('requirements')
    c.openDetail('r-1')
    c.closeDetail()
    const s = c.getSnapshot()
    expect(s.selectedRequirementId).toBeNull()
    expect(s.viewKey).toBe('requirements') // 不切 viewKey
  })

  it('loadDetail 本地优先：列表里有完整字段（stage 已写）就不调网络', async () => {
    const detailSpy = vi.fn()
    const c = createSkyAxisController({
      loadImpl: okLoad([makeReq({ id: 'r-1' })]), // makeReq 默认 stage='understand'
      detailImpl: detailSpy,
    })
    await c.loadRequirements()
    c.openDetail('r-1') // 触发 loadDetail
    expect(detailSpy).not.toHaveBeenCalled()
    expect(c.getSnapshot().detailError).toBeNull()
  })

  it('loadDetail 网络合并：列表无 + GET 成功 → 合并到列表', async () => {
    // Phase 2.1 完美主义：DSH backend v2 record 永远完整，「本地优先」短路；
    //   列表里没有该 id 时才触发 GET，拿到后合并到列表顶部。
    const fresh = makeReq({ id: 'r-1', stage: 'plan', title: '最新' })
    const c = createSkyAxisController({
      // 列表里只有 r-2，r-1 不存在 → 触发 GET
      loadImpl: okLoad([makeReq({ id: 'r-2' })]),
      detailImpl: async () => ({ ok: true as const, item: fresh }),
    })
    await c.loadRequirements()
    c.openDetail('r-1')
    // 等 microtask flush
    await new Promise(resolve => { setTimeout(resolve, 0) })
    const s = c.getSnapshot()
    const r = s.requirements.find(x => x.id === 'r-1')
    expect(r?.title).toBe('最新')
    expect(r?.stage).toBe('plan')
    expect(s.detailError).toBeNull()
  })

  it('loadDetail 网络合并：列表无 + GET 失败 → 写 detailError 不污染列表', async () => {
    const c = createSkyAxisController({
      loadImpl: okLoad([makeReq({ id: 'r-2' })]),
      detailImpl: async () => ({ ok: false as const, error: { code: 'requirement-not-found' as const } }),
    })
    await c.loadRequirements()
    c.openDetail('r-1')
    await new Promise(resolve => { setTimeout(resolve, 0) })
    const s = c.getSnapshot()
    expect(s.detailError).toEqual({ code: 'requirement-not-found' })
    expect(s.requirements.find(x => x.id === 'r-2')).toBeDefined() // 列表数据不变
  })

  it('loadDetail Phase 1 demo：detailImpl 未注入 + 本地有完整 record → 不写 detailError', async () => {
    // Phase 2.1 完美主义：本地 record 永远完整（DSH v2），loadDetail 本地优先短路；
    //   detailImpl 未注入 + 本地有 → 友好兜底，不写错误。
    const c = createSkyAxisController({
      loadImpl: okLoad([makeReq({ id: 'r-1' })]),
      // 故意不传 detailImpl
    })
    await c.loadRequirements()
    c.openDetail('r-1')
    await new Promise(resolve => { setTimeout(resolve, 0) })
    const s = c.getSnapshot()
    expect(s.detailError).toBeNull()
    expect(s.selectedRequirementId).toBe('r-1')
  })

  it('loadDetail Phase 1 demo：detailImpl 未注入 + 本地无数据 → 写 requirement-not-found 错误（兜底）', async () => {
    const c = createSkyAxisController() // 无 loadImpl / detailImpl
    // 不预加载列表，直接 openDetail 不存在的 id
    c.openDetail('non-existent-id')
    await new Promise(resolve => { setTimeout(resolve, 0) })
    const s = c.getSnapshot()
    expect(s.detailError?.code).toBe('requirement-not-found')
  })
})

describe('SkyAxisController setDetailTab / getDetailTab（Phase 1.13）', () => {
  it('初始 detailTabKey = "workbench"', () => {
    const c = createSkyAxisController()
    expect(c.getDetailTab()).toBe('workbench')
    expect(c.getSnapshot().detailTabKey).toBe('workbench')
  })

  it('openDetail 后 detailTabKey 重置为 "workbench"（避免上个需求 tab 偏好串味）', async () => {
    const c = createSkyAxisController({
      loadImpl: okLoad([
        makeReq({ id: 'r-1' }),
        makeReq({ id: 'r-2' }),
      ]),
    })
    await c.loadRequirements()
    c.openDetail('r-1')
    c.setDetailTab('materials')
    expect(c.getDetailTab()).toBe('materials')
    // 打开第二个需求 → tab 应重置回默认
    c.openDetail('r-2')
    expect(c.getDetailTab()).toBe('workbench')
  })

  it('setDetailTab 切到 materials + 切回 workbench', async () => {
    const c = createSkyAxisController({
      loadImpl: okLoad([makeReq({ id: 'r-1' })]),
    })
    await c.loadRequirements()
    c.openDetail('r-1')
    c.setDetailTab('materials')
    expect(c.getDetailTab()).toBe('materials')
    expect(c.getSnapshot().detailTabKey).toBe('materials')
    c.setDetailTab('workbench')
    expect(c.getDetailTab()).toBe('workbench')
  })

  it('setDetailTab 幂等：相同 tab 不触发 notify', async () => {
    const l = makeListener()
    const c = createSkyAxisController({
      loadImpl: okLoad([makeReq({ id: 'r-1' })]),
    })
    c.subscribe(l.fn)
    await c.loadRequirements()
    c.openDetail('r-1')
    const callsAfterOpen = l.getCalls()
    // 重复切到相同 tab → 不触发 notify
    c.setDetailTab('workbench')
    expect(l.getCalls()).toBe(callsAfterOpen) // 没增加
    // 切到另一个
    c.setDetailTab('materials')
    expect(l.getCalls()).toBe(callsAfterOpen + 1)
    // 再次切到 materials → 幂等
    c.setDetailTab('materials')
    expect(l.getCalls()).toBe(callsAfterOpen + 1)
  })

  it('setDetailTab 无详情时 no-op（不污染 detailTabKey）', () => {
    const c = createSkyAxisController()
    c.setDetailTab('materials')
    expect(c.getDetailTab()).toBe('workbench') // 没详情时不允许切
  })

  it('closeDetail 重置 detailTabKey 为 "workbench"（避免下次 openDetail 残留偏好）', async () => {
    const c = createSkyAxisController({
      loadImpl: okLoad([makeReq({ id: 'r-1' })]),
    })
    await c.loadRequirements()
    c.openDetail('r-1')
    c.setDetailTab('materials')
    c.closeDetail()
    expect(c.getDetailTab()).toBe('workbench')
    expect(c.getSnapshot().selectedRequirementId).toBeNull()
  })

  it('setDetailTab 切 tab 不切 viewKey（保留「列表 → 详情 → 返回」语义）', async () => {
    const c = createSkyAxisController({
      loadImpl: okLoad([makeReq({ id: 'r-1' })]),
    })
    await c.loadRequirements()
    c.openPage()
    c.setView('requirements')
    c.openDetail('r-1')
    const viewKeyBefore = c.getView()
    c.setDetailTab('materials')
    c.setDetailTab('workbench')
    expect(c.getView()).toBe(viewKeyBefore) // viewKey 没变
    expect(c.getView()).toBe('requirements')
  })
})

/* ── Step 4：物料 mutation 失败时回滚不再冲掉 workspaces ── */

/** 故意失败的 addMaterialImpl —— 返回同步 UploadHandle，promise 立即失败。 */
function failAddMaterial() {
  return () => ({
    promise: Promise.resolve({
      ok: false as const,
      error: { code: 'internal-error' as const, detail: 'simulated failure' },
    }),
    abort: () => {},
  })
}

describe('Step 4：物料 mutation 失败回滚只覆 requirements（保留 workspaces）', () => {
  it('addPrdLink 失败时 snapshot.workspaces 仍保留（不被 before 全量覆盖）', async () => {
    const req = makeReq({ id: 'req-step4-1' })
    const c = createSkyAxisController({
      loadImpl: okLoad([req]),
      // 故意失败的 JSON add impl —— 触发 runMaterialMutation 的 rollback 分支
      addMaterialImpl: failAddMaterial(),
    })
    await c.loadRequirements()
    // 模拟 ctx.workspaces.list 在 addPrdLink 之前推送过 workspace
    c.setWorkspaces([{ id: 'ws-1', title: 'Workspace 1', path: '/path/ws-1' }])
    expect(c.getSnapshot().workspaces).toHaveLength(1)

    // 触发失败的 addPrdLink
    const handle = c.addPrdLink(req.id, { url: 'https://example.com', title: 'example', source: 'custom' }, 'user-1')
    const r = await handle.promise

    // 失败
    expect(r.ok).toBe(false)
    // 回滚后：requirements 的 materials.prdLinks 仍为空（tempItem 已撤回）
    const after = c.getSnapshot().requirements.find(r2 => r2.id === req.id)
    expect(after?.materials.prdLinks).toEqual([])
    // 关键：workspaces 仍保留 —— 不被 before snapshot 全量覆盖
    expect(c.getSnapshot().workspaces).toHaveLength(1)
    expect(c.getSnapshot().workspaces[0]?.id).toBe('ws-1')
  })

  it('removeMaterial 失败时 snapshot.workspaces 仍保留', async () => {
    const req = makeReq({ id: 'req-step4-2' })
    const c = createSkyAxisController({
      loadImpl: okLoad([req]),
      // removeMaterialImpl 也故意失败 —— 触发 controller 内的 rollback
      removeMaterialImpl: () => ({
        promise: Promise.resolve({
          ok: false as const,
          error: { code: 'internal-error' as const, detail: 'remove failed' },
        }),
        abort: () => {},
      }),
    })
    await c.loadRequirements()
    c.setWorkspaces([{ id: 'ws-2', title: 'Workspace 2', path: '/path/ws-2' }])
    // remove 一个不存在的 itemId —— 走不到乐观更新分支（filter 不改变），但失败回滚路径相同
    const handle = c.removeMaterial(req.id, 'prdLinks', 'non-existent-item-id')
    const r = await handle.promise
    expect(r.ok).toBe(false)
    expect(c.getSnapshot().workspaces).toHaveLength(1)
    expect(c.getSnapshot().workspaces[0]?.id).toBe('ws-2')
  })

  it('addPrdFile 失败时 snapshot.workspaces 仍保留（upload 路径也走同骨架）', async () => {
    const req = makeReq({ id: 'req-step4-3' })
    const c = createSkyAxisController({
      loadImpl: okLoad([req]),
      uploadMaterialImpl: () => ({
        promise: Promise.resolve({
          ok: false as const,
          error: { code: 'internal-error' as const, detail: 'upload failed' },
        }),
        abort: () => {},
      }),
    })
    await c.loadRequirements()
    c.setWorkspaces([{ id: 'ws-3', title: 'Workspace 3', path: '/path/ws-3' }])

    const blob = new Blob(['x'], { type: 'text/plain' })
    const handle = c.addPrdFile(req.id, {
      content: blob,
      filename: '量本利v2.docx',
      mimeType: 'application/octet-stream',
      size: blob.size,
    }, 'user-1')
    const r = await handle.promise
    expect(r.ok).toBe(false)
    // 关键回归：tempItem 已撤回，workspaces 未被冲掉
    expect(c.getSnapshot().requirements.find(r2 => r2.id === req.id)?.materials.prdFiles).toEqual([])
    expect(c.getSnapshot().workspaces).toHaveLength(1)
  })
})