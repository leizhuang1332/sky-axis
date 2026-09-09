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
import { mockTaskActionOk } from '../src/client/page/views/requirement-detail.mock.ts'

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

/* ── Phase 1.0：projectTaskList（host schema → client mirror）── */

import {
  type RequirementTask,
  type RequirementTaskList,
  projectTaskList,
} from '../src/client/controller/sky-axis-controller.ts'

describe('projectTaskList（Plan 阶段产物 → client mirror）', () => {
  /** 一条最小合法的 task 输入（host 端 zod parse 后的形态）。 */
  function makeInputTask(overrides: Partial<RequirementTask> = {}): RequirementTask {
    return {
      id: 'T-implement-001',
      title: 'OAuth 回调',
      goal: '接收 GitHub OAuth code',
      acceptance: ['校验 code'],
      dependencies: [],
      filesExpected: ['src/server/auth/oauth-callback.ts'],
      status: 'in_progress',
      subHistory: [],
      artifactRefs: [],
      retryCount: 0,
      enteredAt: '2026-08-30T12:00:00.000Z',
      ...overrides,
    }
  }

  it('空 tasks 列表往返保持空', () => {
    const out: RequirementTaskList = projectTaskList({
      tasks: [],
      producedAt: '2026-08-30T12:00:00.000Z',
      producedAtStage: 'plan',
    })
    expect(out.tasks).toEqual([])
    expect(out.producedAt).toBe('2026-08-30T12:00:00.000Z')
    expect(out.producedAtStage).toBe('plan')
  })

  it('多条 task 往返字段完全保留', () => {
    const inList: RequirementTaskList = {
      tasks: [
        makeInputTask({ id: 'T-1', status: 'done' }),
        makeInputTask({ id: 'T-2', status: 'rolled_back', retryCount: 3 }),
        makeInputTask({ id: 'T-3', status: 'pending' }),
      ],
      producedAt: '2026-08-30T12:00:00.000Z',
      producedAtStage: 'implement',
    }
    const out = projectTaskList(inList)
    expect(out.tasks).toHaveLength(3)
    expect(out.tasks[0]?.id).toBe('T-1')
    expect(out.tasks[0]?.status).toBe('done')
    expect(out.tasks[1]?.status).toBe('rolled_back')
    expect(out.tasks[1]?.retryCount).toBe(3)
    expect(out.tasks[2]?.status).toBe('pending')
  })

  it('lastDriftScore undefined 保留为 undefined（不丢失可选字段语义）', () => {
    const out = projectTaskList({
      tasks: [makeInputTask()],
      producedAt: '2026-08-30T12:00:00.000Z',
      producedAtStage: 'plan',
    })
    expect(out.tasks[0]?.lastDriftScore).toBeUndefined()
    expect('lastDriftScore' in (out.tasks[0] ?? {})).toBe(true) // key 存在但值为 undefined
  })

  it('lastDriftScore 有值时原样保留', () => {
    const out = projectTaskList({
      tasks: [makeInputTask({ lastDriftScore: 0.72 })],
      producedAt: '2026-08-30T12:00:00.000Z',
      producedAtStage: 'implement',
    })
    expect(out.tasks[0]?.lastDriftScore).toBe(0.72)
  })

  it('subHistory 数组引用稳定（不深拷贝，但也不丢失）', () => {
    const subHistory = [
      { status: 'in_progress' as const, enteredAt: '2026-08-30T12:00:00.000Z' },
      { status: 'done' as const, enteredAt: '2026-08-30T12:05:00.000Z' },
    ]
    const out = projectTaskList({
      tasks: [makeInputTask({ subHistory })],
      producedAt: '2026-08-30T12:00:00.000Z',
      producedAtStage: 'plan',
    })
    expect(out.tasks[0]?.subHistory).toHaveLength(2)
    expect(out.tasks[0]?.subHistory[0]?.status).toBe('in_progress')
    expect(out.tasks[0]?.subHistory[1]?.status).toBe('done')
  })

  it('输入与输出对象不共享顶层引用（projection 始终返回新对象）', () => {
    const inList: RequirementTaskList = {
      tasks: [makeInputTask()],
      producedAt: '2026-08-30T12:00:00.000Z',
      producedAtStage: 'plan',
    }
    const out = projectTaskList(inList)
    expect(out).not.toBe(inList)
    expect(out.tasks).not.toBe(inList.tasks)
    expect(out.tasks[0]).not.toBe(inList.tasks[0])
  })

  it('5 个 producedAtStage 全部合法', () => {
    for (const s of ['understand', 'plan', 'implement', 'verify', 'deliver'] as const) {
      const out = projectTaskList({
        tasks: [makeInputTask()],
        producedAt: '2026-08-30T12:00:00.000Z',
        producedAtStage: s,
      })
      expect(out.producedAtStage).toBe(s)
    }
  })
})

/* ── PR-B / 迭代 3：Task 状态机 helper + controller mutation ── */

import {
  appendTaskTransition,
  findPlanArtifact,
  lastOpenSubHistoryEntry,
  parseTaskListFromArtifact,
  serializeTaskList,
  updateTaskInPlanArtifact,
  type RequirementArtifact,
} from '../src/client/controller/sky-axis-controller.ts'

/** 构造一个 plan artifact（含 1 个 pending task 的 TaskList JSON）。 */
function makePlanArtifact(overrides: Partial<{ tasks: RequirementTask[]; producedAtStage: 'understand' | 'plan' | 'implement' }> = {}): RequirementArtifact {
  const tasks = overrides.tasks ?? [
    {
      id: 'T-001',
      title: 'demo task',
      goal: 'demo',
      acceptance: ['a'],
      dependencies: [],
      filesExpected: [],
      status: 'pending',
      subHistory: [],
      artifactRefs: [],
      retryCount: 0,
      enteredAt: '2026-08-30T12:00:00.000Z',
    },
  ]
  const list: RequirementTaskList = {
    tasks,
    producedAt: '2026-08-30T12:00:00.000Z',
    producedAtStage: overrides.producedAtStage ?? 'implement',
  }
  return {
    id: 'plan-art-1',
    kind: 'plan',
    title: 'Task plan',
    createdAt: '2026-08-30T12:00:00.000Z',
    body: serializeTaskList(list),
  }
}

/** 构造一个带 plan artifact 的 requirement fixture。 */
function makeReqWithPlan(artOverrides: Parameters<typeof makePlanArtifact>[0] = {}): RequirementEntry {
  return makeReq({
    id: 'req-prb-1',
    artifacts: { 'plan-art-1': makePlanArtifact(artOverrides) },
  })
}

describe('Task helpers（PR-B）', () => {
  describe('findPlanArtifact', () => {
    it('找到 kind="plan" 的 artifact', () => {
      const plan = makePlanArtifact()
      const req = makeReq({ artifacts: { a: plan, b: { id: 'b', kind: 'note', title: 'n', createdAt: 't', body: '' } } })
      expect(findPlanArtifact(req)).toBe(plan)
    })

    it('多个 artifact 时返回第一个 plan（Object.values 顺序）', () => {
      const plan = makePlanArtifact()
      const note: RequirementArtifact = { id: 'n1', kind: 'note', title: 'n', createdAt: 't', body: '' }
      const req = makeReq({ artifacts: { 'plan-art-1': plan, 'note-1': note } })
      const found = findPlanArtifact(req)
      expect(found?.kind).toBe('plan')
    })

    it('无 plan artifact 时返回 null', () => {
      const req = makeReq({ artifacts: { 'n1': { id: 'n1', kind: 'note', title: 'n', createdAt: 't', body: '' } } })
      expect(findPlanArtifact(req)).toBeNull()
    })
  })

  describe('parseTaskListFromArtifact', () => {
    it('合法 plan artifact body → 解析出 tasks/producedAt/producedAtStage', () => {
      const art = makePlanArtifact({
        tasks: [
          { id: 'T-A', title: 'A', goal: '', acceptance: [], dependencies: [], filesExpected: [], status: 'done', subHistory: [], artifactRefs: [], retryCount: 0, enteredAt: '2026-01-01T00:00:00.000Z' },
          { id: 'T-B', title: 'B', goal: '', acceptance: [], dependencies: [], filesExpected: [], status: 'in_progress', subHistory: [], artifactRefs: [], retryCount: 0, enteredAt: '2026-01-01T00:00:00.000Z' },
        ],
      })
      const out = parseTaskListFromArtifact(art)
      expect(out).not.toBeNull()
      expect(out?.tasks).toHaveLength(2)
      expect(out?.producedAt).toBe('2026-08-30T12:00:00.000Z')
      expect(out?.producedAtStage).toBe('implement')
    })

    it('非 plan artifact → 返回 null', () => {
      const note: RequirementArtifact = { id: 'n', kind: 'note', title: 'n', createdAt: 't', body: '{"tasks":[]}' }
      expect(parseTaskListFromArtifact(note)).toBeNull()
    })

    it('body 不是合法 JSON → 返回 null（不抛）', () => {
      const art: RequirementArtifact = { id: 'p', kind: 'plan', title: 'p', createdAt: 't', body: '{not json' }
      expect(parseTaskListFromArtifact(art)).toBeNull()
    })

    it('body 是合法 JSON 但缺 tasks 字段 → 返回 null', () => {
      const art: RequirementArtifact = { id: 'p', kind: 'plan', title: 'p', createdAt: 't', body: '{"producedAt":"2026-01-01T00:00:00.000Z"}' }
      expect(parseTaskListFromArtifact(art)).toBeNull()
    })

    it('tasks 不是数组 → 返回 null', () => {
      const art: RequirementArtifact = { id: 'p', kind: 'plan', title: 'p', createdAt: 't', body: '{"tasks":"oops","producedAt":"2026-01-01T00:00:00.000Z","producedAtStage":"plan"}' }
      expect(parseTaskListFromArtifact(art)).toBeNull()
    })
  })

  describe('serializeTaskList', () => {
    it('与 parseTaskListFromArtifact 构成 round-trip', () => {
      const list: RequirementTaskList = {
        tasks: [
          { id: 'T-1', title: 't1', goal: 'g', acceptance: ['a'], dependencies: ['T-0'], filesExpected: ['f.ts'], status: 'rolled_back', subHistory: [{ status: 'in_progress', enteredAt: '2026-01-01T00:00:00.000Z' }], artifactRefs: ['a1'], retryCount: 2, lastDriftScore: 0.5, enteredAt: '2026-01-01T00:00:00.000Z' },
        ],
        producedAt: '2026-01-01T00:00:00.000Z',
        producedAtStage: 'plan',
      }
      const art: RequirementArtifact = { id: 'p', kind: 'plan', title: 'p', createdAt: 't', body: serializeTaskList(list) }
      const parsed = parseTaskListFromArtifact(art)
      expect(parsed).toEqual(list)
    })
  })

  describe('updateTaskInPlanArtifact', () => {
    it('正常路径：找到 task → 应用 patch → 返回新 req', () => {
      const req = makeReqWithPlan()
      const now = '2026-09-01T00:00:00.000Z'
      const out = updateTaskInPlanArtifact(req, 'T-001', (task) => ({
        ...task,
        status: 'in_progress',
      }), now)
      expect(out).not.toBe(req)
      expect(out.updatedAt).toBe(now)
      // artifacts 中 plan-art-1 的 body 应已被更新
      const newArt = out.artifacts['plan-art-1']
      expect(newArt).toBeDefined()
      const parsed = parseTaskListFromArtifact(newArt!)
      expect(parsed?.tasks[0]?.status).toBe('in_progress')
    })

    it('找不到 taskId → 返回原 req 不变（引用相等）', () => {
      const req = makeReqWithPlan()
      const out = updateTaskInPlanArtifact(req, 'NON-EXIST', (task) => ({ ...task, status: 'done' }), '2026-09-01T00:00:00.000Z')
      expect(out).toBe(req)
    })

    it('无 plan artifact → 返回原 req 不变', () => {
      const req = makeReq({ artifacts: {} })
      const out = updateTaskInPlanArtifact(req, 'T-001', (task) => ({ ...task, status: 'done' }), '2026-09-01T00:00:00.000Z')
      expect(out).toBe(req)
    })

    it('plan artifact body 损坏 → 返回原 req 不变', () => {
      const req = makeReq({
        artifacts: {
          'plan-art-1': { id: 'plan-art-1', kind: 'plan', title: 'p', createdAt: 't', body: '{broken' },
        },
      })
      const out = updateTaskInPlanArtifact(req, 'T-001', (task) => ({ ...task, status: 'done' }), '2026-09-01T00:00:00.000Z')
      expect(out).toBe(req)
    })

    it('patch 内可读 now 参数', () => {
      const req = makeReqWithPlan()
      const now = '2026-09-09T09:00:00.000Z'
      const out = updateTaskInPlanArtifact(req, 'T-001', (_task, receivedNow) => {
        expect(receivedNow).toBe(now)
        return { ..._task, status: 'in_progress', enteredAt: receivedNow }
      }, now)
      const parsed = parseTaskListFromArtifact(out.artifacts['plan-art-1']!)
      expect(parsed?.tasks[0]?.enteredAt).toBe(now)
    })

    it('只更新指定 task，其余 task 内容不变', () => {
      const req = makeReqWithPlan({
        tasks: [
          { id: 'T-A', title: 'A', goal: 'goal-a', acceptance: [], dependencies: [], filesExpected: [], status: 'pending', subHistory: [], artifactRefs: ['ref-a'], retryCount: 1, lastDriftScore: 0.3, enteredAt: '2026-01-01T00:00:00.000Z' },
          { id: 'T-B', title: 'B', goal: 'goal-b', acceptance: [], dependencies: [], filesExpected: [], status: 'in_progress', subHistory: [], artifactRefs: ['ref-b'], retryCount: 5, lastDriftScore: 0.7, enteredAt: '2026-02-02T00:00:00.000Z' },
        ],
      })
      const out = updateTaskInPlanArtifact(req, 'T-A', (task) => ({ ...task, status: 'in_progress' }), '2026-09-01T00:00:00.000Z')
      const parsed = parseTaskListFromArtifact(out.artifacts['plan-art-1']!)
      // T-A 被更新
      expect(parsed?.tasks[0]?.status).toBe('in_progress')
      // T-B 内容完全保留（包括 retryCount / lastDriftScore / artifactRefs）
      expect(parsed?.tasks[1]?.title).toBe('B')
      expect(parsed?.tasks[1]?.goal).toBe('goal-b')
      expect(parsed?.tasks[1]?.status).toBe('in_progress') // 原始值
      expect(parsed?.tasks[1]?.retryCount).toBe(5)
      expect(parsed?.tasks[1]?.lastDriftScore).toBe(0.7)
      expect(parsed?.tasks[1]?.artifactRefs).toEqual(['ref-b'])
    })
  })

  describe('appendTaskTransition', () => {
    it('status 改变 + subHistory 末尾追加 close(open entry) + 新 open entry', () => {
      const task: RequirementTask = {
        id: 'T-1',
        title: 't',
        goal: '',
        acceptance: [],
        dependencies: [],
        filesExpected: [],
        status: 'pending',
        subHistory: [],
        artifactRefs: [],
        retryCount: 0,
        enteredAt: '2026-09-01T10:00:00.000Z',
      }
      const now = '2026-09-01T10:05:00.000Z'
      const out = appendTaskTransition(task, 'in_progress', now, 'manual')
      expect(out.status).toBe('in_progress')
      expect(out.enteredAt).toBe(now)
      expect(out.subHistory).toHaveLength(2)
      expect(out.subHistory[0]?.status).toBe('pending')
      expect(out.subHistory[0]?.leftAt).toBe(now)
      expect(out.subHistory[0]?.outcome).toBe('manual')
      expect(out.subHistory[1]?.status).toBe('in_progress')
      expect(out.subHistory[1]?.leftAt).toBeUndefined()
    })

    it('保留 retryCount 等其他字段不变', () => {
      const task: RequirementTask = {
        id: 'T-1', title: 't', goal: '', acceptance: [], dependencies: [], filesExpected: [],
        status: 'failed',
        subHistory: [{ status: 'in_progress', enteredAt: '2026-09-01T10:00:00.000Z', leftAt: '2026-09-01T10:30:00.000Z', outcome: 'errored' }],
        artifactRefs: ['a1'],
        retryCount: 2,
        lastDriftScore: 0.3,
        enteredAt: '2026-09-01T10:00:00.000Z',
      }
      const out = appendTaskTransition(task, 'in_progress', '2026-09-01T11:00:00.000Z', 'rolled-back')
      expect(out.retryCount).toBe(2)
      expect(out.lastDriftScore).toBe(0.3)
      expect(out.artifactRefs).toEqual(['a1'])
    })
  })

  describe('lastOpenSubHistoryEntry', () => {
    it('返回最后一条 leftAt===undefined 的 entry', () => {
      const task: RequirementTask = {
        id: 'T-1', title: '', goal: '', acceptance: [], dependencies: [], filesExpected: [],
        status: 'in_progress',
        subHistory: [
          { status: 'pending', enteredAt: 't1', leftAt: 't2', outcome: 'completed' },
          { status: 'in_progress', enteredAt: 't2' }, // open
        ],
        artifactRefs: [], retryCount: 0, enteredAt: 't2',
      }
      const out = lastOpenSubHistoryEntry(task)
      expect(out?.status).toBe('in_progress')
      expect(out?.enteredAt).toBe('t2')
    })

    it('全部 entry 都关闭 → 返回 null', () => {
      const task: RequirementTask = {
        id: 'T-1', title: '', goal: '', acceptance: [], dependencies: [], filesExpected: [],
        status: 'done',
        subHistory: [
          { status: 'in_progress', enteredAt: 't1', leftAt: 't2', outcome: 'completed' },
          { status: 'done', enteredAt: 't2', leftAt: 't3', outcome: 'completed' },
        ],
        artifactRefs: [], retryCount: 0, enteredAt: 't1',
      }
      expect(lastOpenSubHistoryEntry(task)).toBeNull()
    })

    it('subHistory 为空 → 返回 null', () => {
      const task: RequirementTask = {
        id: 'T-1', title: '', goal: '', acceptance: [], dependencies: [], filesExpected: [],
        status: 'pending',
        subHistory: [],
        artifactRefs: [], retryCount: 0, enteredAt: 't1',
      }
      expect(lastOpenSubHistoryEntry(task)).toBeNull()
    })
  })
})

describe('PR-B：startTask / acceptTask / redoTask / skipTask', () => {
  /** taskActionImpl 的精确类型 —— 避免重复写 Parameters<>。 */
  type TaskActionImpl = NonNullable<Parameters<typeof createSkyAxisController>[0]>['taskActionImpl']

  /** 同步成功 UploadHandle 的 impl 工厂 */
  function okTaskAction(): TaskActionImpl {
    return ({ action }) => ({
      promise: Promise.resolve({ ok: true as const, action }),
      abort: () => {},
    })
  }
  /** 同步失败 UploadHandle 的 impl 工厂 */
  function failTaskAction(code: 'internal-error' | 'task-not-found' | 'invalid-state' = 'internal-error'): TaskActionImpl {
    return () => ({
      promise: Promise.resolve({ ok: false as const, error: { code, detail: 'simulated' } }),
      abort: () => {},
    })
  }

  it('startTask：pending → in_progress，subHistory 末尾追加 2 条', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), taskActionImpl: okTaskAction() })
    await c.loadRequirements()
    const before = c.getSnapshot().requirements[0]!.artifacts['plan-art-1']
    const beforeList = parseTaskListFromArtifact(before!)
    expect(beforeList?.tasks[0]?.status).toBe('pending')

    const r = await c.startTask(req.id, 'T-001').promise
    expect(r.ok).toBe(true)

    const after = c.getSnapshot().requirements[0]!.artifacts['plan-art-1']
    const afterList = parseTaskListFromArtifact(after!)
    expect(afterList?.tasks[0]?.status).toBe('in_progress')
    expect(afterList?.tasks[0]?.subHistory).toHaveLength(2)
    expect(afterList?.tasks[0]?.subHistory[0]?.status).toBe('pending')
    expect(afterList?.tasks[0]?.subHistory[0]?.outcome).toBe('manual')
    expect(afterList?.tasks[0]?.subHistory[1]?.status).toBe('in_progress')
  })

  it('startTask 成功且 impl 返回 item 时用 server record 覆盖整条 req', async () => {
    const req = makeReqWithPlan()
    const serverReq = makeReq({
      id: req.id,
      artifacts: {
        ...req.artifacts,
        'plan-art-1': {
          ...req.artifacts['plan-art-1']!,
          body: serializeTaskList({
            tasks: [{
              id: 'T-001', title: 't', goal: '', acceptance: [], dependencies: [], filesExpected: [],
              status: 'in_progress',
              subHistory: [],
              artifactRefs: [],
              retryCount: 0,
              enteredAt: '2026-09-09T00:00:00.000Z',
            }],
            producedAt: '2026-09-09T00:00:00.000Z',
            producedAtStage: 'implement',
          }),
        },
      },
      title: 'server-returned',
    })
    const c = createSkyAxisController({
      loadImpl: okLoad([req]),
      taskActionImpl: () => ({
        promise: Promise.resolve({ ok: true as const, item: serverReq }),
        abort: () => {},
      }),
    })
    await c.loadRequirements()
    const r = await c.startTask(req.id, 'T-001').promise
    expect(r.ok).toBe(true)
    // server record 覆盖 → title 应是 server 端的
    expect(c.getSnapshot().requirements[0]?.title).toBe('server-returned')
  })

  it('acceptTask：in_progress → done', async () => {
    const req = makeReqWithPlan({
      tasks: [{
        id: 'T-001', title: 't', goal: '', acceptance: [], dependencies: [], filesExpected: [],
        status: 'in_progress',
        subHistory: [],
        artifactRefs: [],
        retryCount: 0,
        enteredAt: '2026-09-01T00:00:00.000Z',
      }],
    })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), taskActionImpl: okTaskAction() })
    await c.loadRequirements()
    const r = await c.acceptTask(req.id, 'T-001').promise
    expect(r.ok).toBe(true)
    const out = parseTaskListFromArtifact(c.getSnapshot().requirements[0]!.artifacts['plan-art-1']!)
    expect(out?.tasks[0]?.status).toBe('done')
    expect(out?.tasks[0]?.subHistory).toHaveLength(2)
    expect(out?.tasks[0]?.subHistory[0]?.outcome).toBe('completed')
  })

  it('redoTask：failed → in_progress 且 retryCount +1', async () => {
    const req = makeReqWithPlan({
      tasks: [{
        id: 'T-001', title: 't', goal: '', acceptance: [], dependencies: [], filesExpected: [],
        status: 'failed',
        subHistory: [],
        artifactRefs: [],
        retryCount: 2,
        enteredAt: '2026-09-01T00:00:00.000Z',
      }],
    })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), taskActionImpl: okTaskAction() })
    await c.loadRequirements()
    const r = await c.redoTask(req.id, 'T-001').promise
    expect(r.ok).toBe(true)
    const out = parseTaskListFromArtifact(c.getSnapshot().requirements[0]!.artifacts['plan-art-1']!)
    expect(out?.tasks[0]?.status).toBe('in_progress')
    expect(out?.tasks[0]?.retryCount).toBe(3)
  })

  it('skipTask：pending → skipped', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), taskActionImpl: okTaskAction() })
    await c.loadRequirements()
    const r = await c.skipTask(req.id, 'T-001').promise
    expect(r.ok).toBe(true)
    const out = parseTaskListFromArtifact(c.getSnapshot().requirements[0]!.artifacts['plan-art-1']!)
    expect(out?.tasks[0]?.status).toBe('skipped')
  })

  it('impl 失败：snapshot.requirements 回滚到 mutation 前状态', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), taskActionImpl: failTaskAction('task-not-found') })
    await c.loadRequirements()
    const before = c.getSnapshot().requirements[0]!.artifacts['plan-art-1']
    const r = await c.startTask(req.id, 'T-001').promise
    expect(r.ok).toBe(false)
    // plan artifact body 字符串应与 mutation 前完全相同（深 rollback）
    const after = c.getSnapshot().requirements[0]!.artifacts['plan-art-1']
    expect(after?.body).toBe(before?.body)
  })

  it('impl 失败：workspaces 不被冲掉（与物料 mutation 一致的回归保护）', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), taskActionImpl: failTaskAction() })
    await c.loadRequirements()
    c.setWorkspaces([{ id: 'ws-prb', title: 'Workspace PRB', path: '/path/ws-prb' }])
    expect(c.getSnapshot().workspaces).toHaveLength(1)

    const r = await c.startTask(req.id, 'T-001').promise
    expect(r.ok).toBe(false)
    expect(c.getSnapshot().workspaces).toHaveLength(1)
    expect(c.getSnapshot().workspaces[0]?.id).toBe('ws-prb')
  })

  it('未注入 taskActionImpl → handle.promise 立即 resolve 为 ok:false', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]) }) // 故意不传 taskActionImpl
    await c.loadRequirements()
    const r = await c.startTask(req.id, 'T-001').promise
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error?.code).toBe('internal-error')
  })

  it('找不到 taskId → 乐观更新不发生（updateTaskInPlanArtifact 短路），impl 仍被调用', async () => {
    const req = makeReqWithPlan()
    const implSpy = vi.fn(okTaskAction())
    const c = createSkyAxisController({ loadImpl: okLoad([req]), taskActionImpl: implSpy })
    await c.loadRequirements()
    const before = c.getSnapshot().requirements[0]!.artifacts['plan-art-1']?.body
    const r = await c.startTask(req.id, 'NON-EXIST').promise
    expect(r.ok).toBe(true)
    expect(implSpy).toHaveBeenCalledOnce()
    // plan artifact body 字符串未变（updateTaskInPlanArtifact 短路）
    const after = c.getSnapshot().requirements[0]!.artifacts['plan-art-1']?.body
    expect(after).toBe(before)
  })

  it('缺少 plan artifact → 乐观更新 no-op，impl 仍被调用', async () => {
    const req = makeReq({ artifacts: {} })
    const implSpy = vi.fn(okTaskAction())
    const c = createSkyAxisController({ loadImpl: okLoad([req]), taskActionImpl: implSpy })
    await c.loadRequirements()
    const r = await c.startTask(req.id, 'T-001').promise
    expect(r.ok).toBe(true)
    expect(implSpy).toHaveBeenCalledOnce()
    expect(c.getSnapshot().requirements[0]?.artifacts).toEqual({})
  })

  it('startTask / acceptTask / redoTask / skipTask 都触发 notify（乐观更新可见）', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), taskActionImpl: okTaskAction() })
    await c.loadRequirements()
    const l = makeListener()
    c.subscribe(l.fn)
    const baseline = l.getCalls()
    await c.startTask(req.id, 'T-001').promise
    const afterStart = l.getCalls()
    expect(afterStart).toBeGreaterThan(baseline)
    // 后续 action 每次乐观更新都会再触发
    await c.acceptTask(req.id, 'T-001').promise
    expect(l.getCalls()).toBeGreaterThan(afterStart)
    await c.redoTask(req.id, 'T-001').promise
    await c.skipTask(req.id, 'T-001').promise
    expect(l.getCalls()).toBeGreaterThan(afterStart + 2)
  })
})

/* ── PR-C / 迭代 4 + 5：rewind + drift detect ── */

import type {
  RewindRequest,
  DriftLayer,
  DriftScore,
} from '../src/client/controller/sky-axis-controller.ts'

type RewindImpl = NonNullable<Parameters<typeof createSkyAxisController>[0]>['rewindImpl']
type DriftDetectImpl = NonNullable<Parameters<typeof createSkyAxisController>[0]>['driftDetectImpl']

function okRewindImpl(): RewindImpl {
  return () => ({ promise: Promise.resolve({ ok: true as const }), abort: () => {} })
}
function failRewindImpl(code: 'rewind-target-invalid' | 'rewind-granularity-conflict' = 'rewind-target-invalid'): RewindImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail: 'simulated' } }),
    abort: () => {},
  })
}
function okDriftDetectImpl(): DriftDetectImpl {
  return () => ({ promise: Promise.resolve({ ok: true as const }), abort: () => {} })
}
function failDriftDetectImpl(code: 'drift-detector-unavailable' | 'drift-no-source-task' = 'drift-detector-unavailable'): DriftDetectImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail: 'simulated' } }),
    abort: () => {},
  })
}

describe('PR-C：rewind mutation（迭代 4）', () => {
  it('当前阶段 → current-stage：追加 rewind entry，stage 保持，reason 写入', async () => {
    const req = makeReq({
      stage: 'plan',
      stageHistory: [{ stage: 'plan', enteredAt: '2026-08-30T12:00:00.000Z' }],
    })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), rewindImpl: okRewindImpl() })
    await c.loadRequirements()
    const r = await c.rewind(req.id, {
      target: 'current-stage',
      reason: 'verify-failed',
      reasonDetail: 'lint failed',
      granularity: 'A',
      options: { preserveDownstream: false, draftNewPlan: false },
    }).promise
    expect(r.ok).toBe(true)
    const after = c.getSnapshot().requirements[0]!
    // stage 仍是 plan（current-stage 不变）
    expect(after.stage).toBe('plan')
    // stageHistory 收尾 + 新 entry
    expect(after.stageHistory).toHaveLength(2)
    expect(after.stageHistory[0]?.leftAt).toBeDefined()
    expect(after.stageHistory[0]?.outcome).toBe('rolled-back')
    expect(after.stageHistory[0]?.reason).toBe('lint failed')
    expect(after.stageHistory[1]?.stage).toBe('plan')
    expect(after.stageHistory[1]?.reason).toBe('lint failed')
  })

  it('stage-prev：plan → understand，stage 改变', async () => {
    const req = makeReq({
      stage: 'plan',
      stageHistory: [{ stage: 'plan', enteredAt: '2026-08-30T12:00:00.000Z' }],
    })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), rewindImpl: okRewindImpl() })
    await c.loadRequirements()
    const r = await c.rewind(req.id, {
      target: 'stage-prev',
      reason: 'plan-drift',
      granularity: 'A',
      options: { preserveDownstream: false, draftNewPlan: false },
    }).promise
    expect(r.ok).toBe(true)
    expect(c.getSnapshot().requirements[0]?.stage).toBe('understand')
  })

  it('stage-prev 在 understand 阶段 → fail loud（rewind-target-invalid）', async () => {
    const req = makeReq({
      stage: 'understand',
      stageHistory: [{ stage: 'understand', enteredAt: '2026-08-30T12:00:00.000Z' }],
    })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), rewindImpl: okRewindImpl() })
    await c.loadRequirements()
    const r = await c.rewind(req.id, {
      target: 'stage-prev',
      reason: 'human-request',
      granularity: 'A',
      options: { preserveDownstream: false, draftNewPlan: false },
    }).promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('rewind-target-invalid')
  })

  it('target=task 但缺 targetTaskId → fail loud', async () => {
    const req = makeReq({ stage: 'implement', stageHistory: [{ stage: 'implement', enteredAt: 't' }] })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), rewindImpl: okRewindImpl() })
    await c.loadRequirements()
    // target=task 时 RewindRequest 强制要求 targetTaskId —— 测试 fail loud 需要绕过类型检查
    const req_ = {
      target: 'task' as const,
      reason: 'plan-drift' as const,
      granularity: 'A' as const,
      options: { preserveDownstream: false, draftNewPlan: false },
    } as unknown as RewindRequest
    const r = await c.rewind(req.id, req_).promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('rewind-target-invalid')
  })

  it('target=task + granularity=C → fail loud（rewind-granularity-conflict）', async () => {
    const req = makeReq({ stage: 'implement', stageHistory: [{ stage: 'implement', enteredAt: 't' }] })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), rewindImpl: okRewindImpl() })
    await c.loadRequirements()
    const r = await c.rewind(req.id, {
      target: 'task',
      targetTaskId: 'T-001',
      reason: 'plan-drift',
      granularity: 'C',
      options: { preserveDownstream: false, draftNewPlan: false },
    }).promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('rewind-granularity-conflict')
  })

  it('granularity=C + toStage=understand → 清空 plan artifact 中的 task list', async () => {
    // 当前 stage=plan，有 plan artifact。rewind 到 understand + granularity=C → 清空 plan
    const req = makeReq({
      stage: 'understand',
      stageHistory: [
        { stage: 'understand', enteredAt: 't' },
        { stage: 'plan', enteredAt: 't2', leftAt: 't3', outcome: 'completed' },
      ],
      artifacts: { 'plan-art-1': makePlanArtifact() },
    })
    // makeReq 默认 stageHistory 只有 understand entry；上面已经覆盖了
    const c = createSkyAxisController({ loadImpl: okLoad([req]), rewindImpl: okRewindImpl() })
    await c.loadRequirements()
    const r = await c.rewind(req.id, {
      target: 'stage-understand',
      reason: 'goal-misaligned',
      granularity: 'C',
      options: { preserveDownstream: false, draftNewPlan: false },
    }).promise
    expect(r.ok).toBe(true)
    const after = c.getSnapshot().requirements[0]!
    expect(after.stage).toBe('understand')
    // plan artifact 应被清空 tasks
    const planArt = after.artifacts['plan-art-1']
    const list = parseTaskListFromArtifact(planArt!)
    expect(list?.tasks).toEqual([])
  })

  it('rewind 失败时 requirements 回滚，workspaces 不变', async () => {
    const req = makeReq({ stage: 'plan', stageHistory: [{ stage: 'plan', enteredAt: 't' }] })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), rewindImpl: failRewindImpl() })
    await c.loadRequirements()
    // 先把 workspaces 注入
    c.setWorkspaces([{ id: 'ws-x', title: 'ws', path: '/tmp/x' }])
    const wsBefore = c.getSnapshot().workspaces
    const stageBefore = c.getSnapshot().requirements[0]?.stage
    const r = await c.rewind(req.id, {
      target: 'current-stage',
      reason: 'verify-failed',
      granularity: 'A',
      options: { preserveDownstream: false, draftNewPlan: false },
    }).promise
    expect(r.ok).toBe(false)
    // 乐观更新被回滚
    expect(c.getSnapshot().requirements[0]?.stage).toBe(stageBefore)
    // workspaces 仍在
    expect(c.getSnapshot().workspaces).toEqual(wsBefore)
  })

  it('未注入 rewindImpl → 走 mock 兜底：乐观更新即最终结果', async () => {
    const req = makeReq({ stage: 'plan', stageHistory: [{ stage: 'plan', enteredAt: 't' }] })
    const c = createSkyAxisController({ loadImpl: okLoad([req]) })
    await c.loadRequirements()
    const r = await c.rewind(req.id, {
      target: 'current-stage',
      reason: 'human-request',
      granularity: 'A',
      options: { preserveDownstream: false, draftNewPlan: false },
    }).promise
    expect(r.ok).toBe(true)
    // 乐观更新保留（兜底 impl 返回 ok=true）
    expect(c.getSnapshot().requirements[0]?.stage).toBe('plan')
    expect(c.getSnapshot().requirements[0]?.stageHistory.length).toBeGreaterThan(1)
  })

  it('rewind 缺失 requirement → fail loud', async () => {
    const req = makeReq()
    const c = createSkyAxisController({ loadImpl: okLoad([req]) })
    await c.loadRequirements()
    const r = await c.rewind('NON-EXIST', {
      target: 'current-stage',
      reason: 'human-request',
      granularity: 'A',
      options: { preserveDownstream: false, draftNewPlan: false },
    }).promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('requirement-not-found')
  })

  it('rewind 触发 notify（乐观更新可见）', async () => {
    const req = makeReq({ stage: 'plan', stageHistory: [{ stage: 'plan', enteredAt: 't' }] })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), rewindImpl: okRewindImpl() })
    await c.loadRequirements()
    const l = makeListener()
    c.subscribe(l.fn)
    const baseline = l.getCalls()
    await c.rewind(req.id, {
      target: 'current-stage',
      reason: 'verify-failed',
      granularity: 'A',
      options: { preserveDownstream: false, draftNewPlan: false },
    }).promise
    expect(l.getCalls()).toBeGreaterThan(baseline)
  })
})

describe('PR-C：rerunDriftDetection（迭代 5）', () => {
  it('默认 layer=all → 追加 drift snapshot artifact 含 3 层分数', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), driftDetectImpl: okDriftDetectImpl() })
    await c.loadRequirements()
    const r = await c.rerunDriftDetection(req.id, 'all').promise
    expect(r.ok).toBe(true)
    // 应新增一个 kind=note artifact（drift snapshot）
    const after = c.getSnapshot().requirements[0]!
    const driftArts = Object.values(after.artifacts).filter(a => a.kind === 'note' && a.title === 'Drift snapshot')
    expect(driftArts.length).toBeGreaterThanOrEqual(1)
    const body = JSON.parse(driftArts[driftArts.length - 1]!.body) as { scores: DriftScore[]; overall: number }
    expect(body.scores).toHaveLength(3)
    expect(body.overall).toBeGreaterThanOrEqual(0)
  })

  it('单 layer mode → 只追加该 layer 的分数', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), driftDetectImpl: okDriftDetectImpl() })
    await c.loadRequirements()
    const r = await c.rerunDriftDetection(req.id, 'static').promise
    expect(r.ok).toBe(true)
    const after = c.getSnapshot().requirements[0]!
    const driftArts = Object.values(after.artifacts).filter(a => a.title === 'Drift snapshot')
    const body = JSON.parse(driftArts[driftArts.length - 1]!.body) as { scores: DriftScore[] }
    expect(body.scores).toHaveLength(1)
    expect(body.scores[0]?.layer).toBe('static')
  })

  it('未注入 driftDetectImpl → 走 mock 兜底：乐观更新即最终结果', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]) })
    await c.loadRequirements()
    const r = await c.rerunDriftDetection(req.id, 'all').promise
    expect(r.ok).toBe(true)
    // 至少有一个 drift snapshot artifact
    const after = c.getSnapshot().requirements[0]!
    const driftArts = Object.values(after.artifacts).filter(a => a.title === 'Drift snapshot')
    expect(driftArts.length).toBeGreaterThanOrEqual(1)
  })

  it('drift detect 失败时 requirements 回滚，workspaces 不变', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), driftDetectImpl: failDriftDetectImpl() })
    await c.loadRequirements()
    c.setWorkspaces([{ id: 'ws-x', title: 'ws', path: '/tmp/x' }])
    const wsBefore = c.getSnapshot().workspaces
    const artifactsBefore = c.getSnapshot().requirements[0]?.artifacts
    const r = await c.rerunDriftDetection(req.id, 'all').promise
    expect(r.ok).toBe(false)
    // 乐观 artifact 被回滚
    expect(c.getSnapshot().requirements[0]?.artifacts).toEqual(artifactsBefore)
    // workspaces 保留
    expect(c.getSnapshot().workspaces).toEqual(wsBefore)
  })

  it('rerunDriftDetection 缺失 requirement → fail loud', async () => {
    const req = makeReq()
    const c = createSkyAxisController({ loadImpl: okLoad([req]) })
    await c.loadRequirements()
    const r = await c.rerunDriftDetection('NON-EXIST').promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('requirement-not-found')
  })

  it('rerunDriftDetection 触发 notify（乐观更新可见）', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), driftDetectImpl: okDriftDetectImpl() })
    await c.loadRequirements()
    const l = makeListener()
    c.subscribe(l.fn)
    const baseline = l.getCalls()
    await c.rerunDriftDetection(req.id).promise
    expect(l.getCalls()).toBeGreaterThan(baseline)
  })

  it('summarizeDriftFromTaskList：3 层逻辑分别派生分数', () => {
    const tasks: Parameters<typeof summarizeDriftFromTaskList>[0] = [
      { id: 'T1', title: '', goal: '', acceptance: [], dependencies: [], filesExpected: [], status: 'failed', subHistory: [], artifactRefs: [], retryCount: 0, lastDriftScore: 0.5, enteredAt: 't' },
      { id: 'T2', title: '', goal: '', acceptance: [], dependencies: [], filesExpected: ['a.ts'], status: 'done', subHistory: [], artifactRefs: [], retryCount: 0, enteredAt: 't' },
      { id: 'T3', title: '', goal: '', acceptance: [], dependencies: [], filesExpected: ['b.ts'], status: 'done', subHistory: [], artifactRefs: [], retryCount: 0, lastDriftScore: 0.3, enteredAt: 't' },
    ]
    const staticScore = summarizeDriftFromTaskList(tasks, 'static', 't')
    const dynamicScore = summarizeDriftFromTaskList(tasks, 'dynamic', 't')
    const semanticScore = summarizeDriftFromTaskList(tasks, 'semantic', 't')
    expect(staticScore.layer).toBe('static')
    expect(dynamicScore.layer).toBe('dynamic')
    expect(semanticScore.layer).toBe('semantic')
    // 1/3 task 没 filesExpected → static score 应 > 0
    expect(staticScore.score).toBeGreaterThan(0)
    // 1/3 task failed → dynamic score 应 > 0
    expect(dynamicScore.score).toBeGreaterThan(0)
    // max(0.5, 0.3) + 0.05 jitter = 0.55
    expect(semanticScore.score).toBeCloseTo(0.55, 1)
  })

  it('summarizeDriftFromTaskList：空 taskList → 全部返回 0', () => {
    const scores = (['static', 'dynamic', 'semantic'] as DriftLayer[]).map(l =>
      summarizeDriftFromTaskList([], l, 't'),
    )
    for (const s of scores) expect(s.score).toBe(0)
  })
})

// ── rewind helper 的直接测试 ──

import {
  resolveRewindTarget,
  appendRewindEntry,
  clearTaskListOnRewindToUnderstand,
  summarizeDriftFromTaskList,
} from '../src/client/controller/sky-axis-controller.ts'

describe('PR-C：resolveRewindTarget helper', () => {
  it('current-stage / task → 返回当前 stage', () => {
    const req = makeReq({ stage: 'implement' })
    expect(resolveRewindTarget(req, 'current-stage')).toBe('implement')
    expect(resolveRewindTarget(req, 'task')).toBe('implement')
  })
  it('stage-prev 在 implement → plan', () => {
    expect(resolveRewindTarget(makeReq({ stage: 'implement' }), 'stage-prev')).toBe('plan')
  })
  it('stage-prev 在 understand → null', () => {
    expect(resolveRewindTarget(makeReq({ stage: 'understand' }), 'stage-prev')).toBeNull()
  })
  it('stage-* 强制返回对应 stage', () => {
    const req = makeReq({ stage: 'plan' })
    expect(resolveRewindTarget(req, 'stage-understand')).toBe('understand')
    expect(resolveRewindTarget(req, 'stage-plan')).toBe('plan')
    expect(resolveRewindTarget(req, 'stage-implement')).toBe('implement')
    expect(resolveRewindTarget(req, 'stage-verify')).toBe('verify')
    expect(resolveRewindTarget(req, 'stage-deliver')).toBe('deliver')
  })
})

describe('PR-C：appendRewindEntry helper', () => {
  it('收尾 open entry + 追加新 entry', () => {
    const req = makeReq({
      stage: 'plan',
      stageHistory: [{ stage: 'plan', enteredAt: 't' }],
    })
    const out = appendRewindEntry(req, 'plan', 'plan', 'verify-failed', 'lint failed', 't2')
    expect(out.stage).toBe('plan')
    expect(out.stageHistory).toHaveLength(2)
    expect(out.stageHistory[0]?.leftAt).toBe('t2')
    expect(out.stageHistory[0]?.outcome).toBe('rolled-back')
    expect(out.stageHistory[1]?.stage).toBe('plan')
    expect(out.stageHistory[1]?.reason).toBe('lint failed')
  })
  it('没有 open entry 时不收尾，直接追加', () => {
    const req = makeReq({
      stage: 'plan',
      stageHistory: [{ stage: 'plan', enteredAt: 't', leftAt: 't1', outcome: 'completed' }],
    })
    const out = appendRewindEntry(req, 'plan', 'plan', 'verify-failed', undefined, 't2')
    expect(out.stageHistory).toHaveLength(2)
    expect(out.stageHistory[0]?.leftAt).toBe('t1') // 原 entry 不动
    expect(out.stageHistory[1]?.reason).toBe('verify-failed')
  })
})

describe('PR-C：clearTaskListOnRewindToUnderstand helper', () => {
  it('有 plan artifact → 清空 tasks', () => {
    const req = makeReqWithPlan()
    const out = clearTaskListOnRewindToUnderstand(req, 't')
    const planArt = out.artifacts['plan-art-1']
    const list = parseTaskListFromArtifact(planArt!)
    expect(list?.tasks).toEqual([])
    expect(list?.producedAtStage).toBe('understand')
  })
  it('无 plan artifact → 原 req 不变', () => {
    const req = makeReq({ artifacts: {} })
    const out = clearTaskListOnRewindToUnderstand(req, 't')
    expect(out).toBe(req)
  })
})

// 抑制 unused（RewindRequest 在 import 时声明但 describe 不直接引用 —— vitest 静态分析会忽略）
void (null as unknown as RewindRequest)

/* ── PR-D / 迭代 6：5 个介入点 controller 测试 ── */

import type {
  AdjustTaskListPatch,
  FailedTaskResolveDecision,
  RequirementInterventionItem,
  RequirementStage,
} from '../src/client/controller/sky-axis-controller.ts'

type RespondImpl = NonNullable<Parameters<typeof createSkyAxisController>[0]>['respondInterventionImpl']
type SteerImpl = NonNullable<Parameters<typeof createSkyAxisController>[0]>['steerSessionImpl']
type AdvanceImpl = NonNullable<Parameters<typeof createSkyAxisController>[0]>['advanceStageImpl']
type AdjustImpl = NonNullable<Parameters<typeof createSkyAxisController>[0]>['adjustTaskListImpl']
type ResolveImpl = NonNullable<Parameters<typeof createSkyAxisController>[0]>['resolveFailedTaskImpl']

function okRespondImpl(): RespondImpl {
  return () => ({ promise: Promise.resolve({ ok: true as const }), abort: () => {} })
}
function failRespondImpl(
  code: 'intervention-not-found' | 'intervention-already-resolved' | 'internal-error' = 'internal-error',
): RespondImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail: 'simulated' } }),
    abort: () => {},
  })
}
function okSteerImpl(): SteerImpl {
  return () => ({ promise: Promise.resolve({ ok: true as const }), abort: () => {} })
}
function failSteerImpl(code: 'steer-text-empty' | 'internal-error' = 'internal-error'): SteerImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail: 'simulated' } }),
    abort: () => {},
  })
}
function okAdvanceImpl(): AdvanceImpl {
  return () => ({ promise: Promise.resolve({ ok: true as const }), abort: () => {} })
}
function failAdvanceImpl(code: 'stage-advance-invalid' | 'internal-error' = 'stage-advance-invalid'): AdvanceImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail: 'simulated' } }),
    abort: () => {},
  })
}
function okAdjustImpl(): AdjustImpl {
  return () => ({ promise: Promise.resolve({ ok: true as const }), abort: () => {} })
}
function failAdjustImpl(code: 'internal-error' = 'internal-error'): AdjustImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail: 'simulated' } }),
    abort: () => {},
  })
}
function okResolveImpl(): ResolveImpl {
  return () => ({ promise: Promise.resolve({ ok: true as const }), abort: () => {} })
}
function failResolveImpl(code: 'task-not-resolvable' | 'internal-error' = 'task-not-resolvable'): ResolveImpl {
  return () => ({
    promise: Promise.resolve({ ok: false as const, error: { code, detail: 'simulated' } }),
    abort: () => {},
  })
}

/** 构造一个带 interventionQueue 的 requirement（1 个未 resolved 项）。 */
function makeReqWithQueue(): RequirementEntry {
  const item: RequirementInterventionItem = {
    id: 'ii-1',
    kind: 'approval',
    rpcId: 'rpc-1',
    summary: '需要审批',
    createdAt: '2026-09-01T00:00:00.000Z',
    payload: { toolCall: 'createFile' },
  }
  return makeReq({ interventionQueue: [item] })
}

/** 构造一个 stage=implement + 含 failed task 的 requirement（resolveFailedTask 测试用）。 */
function makeReqWithFailedTask(): RequirementEntry {
  const failedTask: RequirementTask = {
    id: 'T-fail-1',
    title: 'failed task',
    goal: '',
    acceptance: [],
    dependencies: [],
    filesExpected: [],
    status: 'failed',
    subHistory: [{ status: 'failed', enteredAt: 't' }],
    artifactRefs: [],
    retryCount: 3,
    enteredAt: 't',
  }
  const planBody = JSON.stringify({
    tasks: [failedTask],
    producedAt: 't',
    producedAtStage: 'plan',
  })
  const planArt: RequirementArtifact = {
    id: 'plan-art-1',
    kind: 'plan',
    title: 'plan',
    createdAt: 't',
    body: planBody,
  }
  return makeReq({
    stage: 'implement',
    stageHistory: [{ stage: 'implement', enteredAt: 't' }],
    artifacts: { 'plan-art-1': planArt },
  })
}

describe('PR-D：respondIntervention（迭代 6 #3）', () => {
  it('成功：从 interventionQueue 中移除 rpcId 对应项', async () => {
    const req = makeReqWithQueue()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), respondInterventionImpl: okRespondImpl() })
    await c.loadRequirements()
    const r = await c.respondIntervention(req.id, 'rpc-1', { decision: 'approve' }).promise
    expect(r.ok).toBe(true)
    const after = c.getSnapshot().requirements[0]!
    expect(after.interventionQueue.find(it => it.rpcId === 'rpc-1')).toBeUndefined()
    expect(after.interventionQueue).toHaveLength(0)
  })

  it('缺 requirement → fail loud（requirement-not-found）', async () => {
    const req = makeReqWithQueue()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), respondInterventionImpl: okRespondImpl() })
    await c.loadRequirements()
    const r = await c.respondIntervention('NON-EXIST', 'rpc-1', null).promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('requirement-not-found')
  })

  it('rpcId 不在 queue → fail loud（intervention-not-found）', async () => {
    const req = makeReqWithQueue()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), respondInterventionImpl: okRespondImpl() })
    await c.loadRequirements()
    const r = await c.respondIntervention(req.id, 'rpc-MISSING', null).promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('intervention-not-found')
  })

  it('item 已 resolved=true → fail loud（intervention-already-resolved）', async () => {
    const item: RequirementInterventionItem = {
      id: 'ii-1', kind: 'approval', rpcId: 'rpc-1', summary: 'x',
      createdAt: 't', payload: {}, resolved: true,
    }
    const req = makeReq({ interventionQueue: [item] })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), respondInterventionImpl: okRespondImpl() })
    await c.loadRequirements()
    const r = await c.respondIntervention(req.id, 'rpc-1', null).promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('intervention-already-resolved')
  })

  it('impl 失败 → requirements 回滚（rpcId 仍在 queue）', async () => {
    const req = makeReqWithQueue()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), respondInterventionImpl: failRespondImpl() })
    await c.loadRequirements()
    const r = await c.respondIntervention(req.id, 'rpc-1', null).promise
    expect(r.ok).toBe(false)
    const after = c.getSnapshot().requirements[0]!
    expect(after.interventionQueue.find(it => it.rpcId === 'rpc-1')).toBeDefined()
  })
})

describe('PR-D：steerSession（迭代 6 #2）', () => {
  it('成功：追加 kind=note / title="Steer note" / meta.source=steer 的 artifact', async () => {
    const req = makeReq()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), steerSessionImpl: okSteerImpl() })
    await c.loadRequirements()
    const artsBefore = Object.keys(c.getSnapshot().requirements[0]!.artifacts).length
    const r = await c.steerSession(req.id, '用 ESM 不用 CJS').promise
    expect(r.ok).toBe(true)
    const after = c.getSnapshot().requirements[0]!
    expect(Object.keys(after.artifacts).length).toBe(artsBefore + 1)
    const steerArts = Object.values(after.artifacts).filter(a => a.title === 'Steer note')
    expect(steerArts.length).toBe(1)
    const sa = steerArts[0]!
    expect(sa.kind).toBe('note')
    expect(sa.body).toBe('用 ESM 不用 CJS')
    expect(sa.meta).toEqual({ source: 'steer', length: '用 ESM 不用 CJS'.length })
  })

  it('text 为空 → fail loud（steer-text-empty）', async () => {
    const req = makeReq()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), steerSessionImpl: okSteerImpl() })
    await c.loadRequirements()
    const r = await c.steerSession(req.id, '   ').promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('steer-text-empty')
  })

  it('text 自动 trim 后写入', async () => {
    const req = makeReq()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), steerSessionImpl: okSteerImpl() })
    await c.loadRequirements()
    await c.steerSession(req.id, '  hello  ').promise
    const after = c.getSnapshot().requirements[0]!
    const steerArt = Object.values(after.artifacts).find(a => a.title === 'Steer note')
    expect(steerArt?.body).toBe('hello')
  })

  it('缺 requirement → fail loud（requirement-not-found）', async () => {
    const req = makeReq()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), steerSessionImpl: okSteerImpl() })
    await c.loadRequirements()
    const r = await c.steerSession('NON-EXIST', 'x').promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('requirement-not-found')
  })

  it('impl 失败 → artifacts 回滚（steer note 不残留）', async () => {
    const req = makeReq()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), steerSessionImpl: failSteerImpl() })
    await c.loadRequirements()
    const artsBefore = Object.keys(c.getSnapshot().requirements[0]!.artifacts).length
    const r = await c.steerSession(req.id, 'x').promise
    expect(r.ok).toBe(false)
    expect(Object.keys(c.getSnapshot().requirements[0]!.artifacts).length).toBe(artsBefore)
  })
})

describe('PR-D：advanceStage（迭代 6 #5）', () => {
  it('成功：plan → implement，stage 改变 + stageHistory 收尾 + 新 entry（outcome=completed）', async () => {
    const req = makeReq({
      stage: 'plan',
      stageHistory: [{ stage: 'plan', enteredAt: 't' }],
    })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), advanceStageImpl: okAdvanceImpl() })
    await c.loadRequirements()
    const r = await c.advanceStage(req.id, 'implement' satisfies RequirementStage).promise
    expect(r.ok).toBe(true)
    const after = c.getSnapshot().requirements[0]!
    expect(after.stage).toBe('implement')
    expect(after.stageHistory.length).toBe(2)
    expect(after.stageHistory[0]?.outcome).toBe('completed')
    expect(after.stageHistory[1]?.stage).toBe('implement')
  })

  it('跳跃式推进（plan → verify）→ fail loud（stage-advance-invalid）', async () => {
    const req = makeReq({ stage: 'plan', stageHistory: [{ stage: 'plan', enteredAt: 't' }] })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), advanceStageImpl: okAdvanceImpl() })
    await c.loadRequirements()
    const r = await c.advanceStage(req.id, 'verify').promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('stage-advance-invalid')
  })

  it('倒退推进（plan → understand）→ fail loud（stage-advance-invalid）', async () => {
    const req = makeReq({ stage: 'plan', stageHistory: [{ stage: 'plan', enteredAt: 't' }] })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), advanceStageImpl: okAdvanceImpl() })
    await c.loadRequirements()
    const r = await c.advanceStage(req.id, 'understand').promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('stage-advance-invalid')
  })

  it('缺 requirement → fail loud（requirement-not-found）', async () => {
    const req = makeReq({ stage: 'plan', stageHistory: [{ stage: 'plan', enteredAt: 't' }] })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), advanceStageImpl: okAdvanceImpl() })
    await c.loadRequirements()
    const r = await c.advanceStage('NON-EXIST', 'implement').promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('requirement-not-found')
  })

  it('impl 失败 → stage 保持 + stageHistory 不变', async () => {
    const req = makeReq({ stage: 'plan', stageHistory: [{ stage: 'plan', enteredAt: 't' }] })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), advanceStageImpl: failAdvanceImpl() })
    await c.loadRequirements()
    const before = c.getSnapshot().requirements[0]!
    const r = await c.advanceStage(req.id, 'implement').promise
    expect(r.ok).toBe(false)
    const after = c.getSnapshot().requirements[0]!
    expect(after.stage).toBe(before.stage)
    expect(after.stageHistory.length).toBe(before.stageHistory.length)
  })
})

describe('PR-D：adjustTaskList（迭代 6 #1）', () => {
  it('mode=replace：替换 plan artifact 中的 task list 整列表', async () => {
    const req = makeReqWithPlan()
    const newTask: RequirementTask = {
      id: 'T-new', title: '新 task', goal: 'g',
      acceptance: ['a'], dependencies: [], filesExpected: [],
      status: 'pending', subHistory: [], artifactRefs: [], retryCount: 0, enteredAt: 't',
    }
    const c = createSkyAxisController({ loadImpl: okLoad([req]), adjustTaskListImpl: okAdjustImpl() })
    await c.loadRequirements()
    const patch: AdjustTaskListPatch = { mode: 'replace', tasks: [newTask] }
    const r = await c.adjustTaskList(req.id, patch).promise
    expect(r.ok).toBe(true)
    const after = c.getSnapshot().requirements[0]!
    const parsed = parseTaskListFromArtifact(after.artifacts['plan-art-1']!)
    expect(parsed?.tasks).toHaveLength(1)
    expect(parsed?.tasks[0]?.id).toBe('T-new')
  })

  it('缺 plan artifact → fail loud（artifact-not-found）', async () => {
    const req = makeReq({ artifacts: {} })
    const c = createSkyAxisController({ loadImpl: okLoad([req]), adjustTaskListImpl: okAdjustImpl() })
    await c.loadRequirements()
    const patch: AdjustTaskListPatch = { mode: 'replace', tasks: [] }
    const r = await c.adjustTaskList(req.id, patch).promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('artifact-not-found')
  })

  it('缺 requirement → fail loud（requirement-not-found）', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), adjustTaskListImpl: okAdjustImpl() })
    await c.loadRequirements()
    const patch: AdjustTaskListPatch = { mode: 'replace', tasks: [] }
    const r = await c.adjustTaskList('NON-EXIST', patch).promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('requirement-not-found')
  })

  it('impl 失败 → plan artifact body 回滚到 mutation 前', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), adjustTaskListImpl: failAdjustImpl() })
    await c.loadRequirements()
    const beforeBody = c.getSnapshot().requirements[0]!.artifacts['plan-art-1']!.body
    const patch: AdjustTaskListPatch = { mode: 'replace', tasks: [] }
    const r = await c.adjustTaskList(req.id, patch).promise
    expect(r.ok).toBe(false)
    const afterBody = c.getSnapshot().requirements[0]!.artifacts['plan-art-1']!.body
    expect(afterBody).toBe(beforeBody)
  })

  it('未注入 impl → 走 mock 兜底：乐观更新即最终结果', async () => {
    const req = makeReqWithPlan()
    const c = createSkyAxisController({ loadImpl: okLoad([req]) })
    await c.loadRequirements()
    const patch: AdjustTaskListPatch = { mode: 'replace', tasks: [] }
    const r = await c.adjustTaskList(req.id, patch).promise
    expect(r.ok).toBe(true)
    const after = c.getSnapshot().requirements[0]!
    const parsed = parseTaskListFromArtifact(after.artifacts['plan-art-1']!)
    expect(parsed?.tasks).toHaveLength(0)
  })
})

describe('PR-D：resolveFailedTask（迭代 6 #4）', () => {
  it("decision='redo' → 触发 controller.redoTask（failed → in_progress，retryCount +1）", async () => {
    const req = makeReqWithFailedTask()
    const c = createSkyAxisController({
      loadImpl: okLoad([req]),
      taskActionImpl: mockTaskActionOk(),
      resolveFailedTaskImpl: okResolveImpl(),
    })
    await c.loadRequirements()
    const r = await c.resolveFailedTask(req.id, 'T-fail-1', 'redo' satisfies FailedTaskResolveDecision).promise
    expect(r.ok).toBe(true)
    const after = c.getSnapshot().requirements[0]!
    const parsed = parseTaskListFromArtifact(after.artifacts['plan-art-1']!)
    const task = parsed?.tasks.find(tk => tk.id === 'T-fail-1')
    expect(task?.status).toBe('in_progress')
    expect(task?.retryCount).toBe(4)
  })

  it("decision='skip' → 触发 controller.skipTask（failed → skipped）", async () => {
    const req = makeReqWithFailedTask()
    const c = createSkyAxisController({
      loadImpl: okLoad([req]),
      taskActionImpl: mockTaskActionOk(),
      resolveFailedTaskImpl: okResolveImpl(),
    })
    await c.loadRequirements()
    const r = await c.resolveFailedTask(req.id, 'T-fail-1', 'skip' satisfies FailedTaskResolveDecision).promise
    expect(r.ok).toBe(true)
    const after = c.getSnapshot().requirements[0]!
    const parsed = parseTaskListFromArtifact(after.artifacts['plan-art-1']!)
    expect(parsed?.tasks.find(tk => tk.id === 'T-fail-1')?.status).toBe('skipped')
  })

  it("decision='rewind-plan' → 触发 controller.rewind(stage-prev)，implement → plan", async () => {
    const req = makeReqWithFailedTask()
    const c = createSkyAxisController({
      loadImpl: okLoad([req]),
      rewindImpl: okRewindImpl(),
      resolveFailedTaskImpl: okResolveImpl(),
    })
    await c.loadRequirements()
    const r = await c.resolveFailedTask(req.id, 'T-fail-1', 'rewind-plan' satisfies FailedTaskResolveDecision).promise
    expect(r.ok).toBe(true)
    expect(c.getSnapshot().requirements[0]?.stage).toBe('plan')
  })

  it("decision='abort' → fail loud（Phase 2 接 abort 接口）", async () => {
    const req = makeReqWithFailedTask()
    const c = createSkyAxisController({ loadImpl: okLoad([req]), resolveFailedTaskImpl: okResolveImpl() })
    await c.loadRequirements()
    const r = await c.resolveFailedTask(req.id, 'T-fail-1', 'abort' satisfies FailedTaskResolveDecision).promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('internal-error')
  })

  it("task 不在 failed 状态 → fail loud（task-not-resolvable）", async () => {
    const req = makeReqWithPlan()  // 默认 task list 第一个 task 是 in_progress
    const c = createSkyAxisController({ loadImpl: okLoad([req]), resolveFailedTaskImpl: okResolveImpl() })
    await c.loadRequirements()
    const r = await c.resolveFailedTask(req.id, 'T-001', 'redo' satisfies FailedTaskResolveDecision).promise
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: { code: string } }).error.code).toBe('task-not-resolvable')
  })
})