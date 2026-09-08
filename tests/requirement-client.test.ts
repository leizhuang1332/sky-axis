/**
 * RequirementClient fetch helper 单元测试。
 *
 * 覆盖目标：
 *   - 4 个 CRUD 方法（list / create / remove / listWorkspaces）的 OK / HTTP
 *     非 2xx / ApiError JSON / schema mismatch 4 条分支
 *   - create 客户端预校验（缺 workspaceId 等）走 'validation-failed'
 *   - 路径拼接：用 default baseUrl 与 自定义 baseUrl 两种
 *   - credentials: 'same-origin' 始终带上
 *   - SSE subscribeRequirementEvents 返回的 dispose() 能取消监听 + 关闭 source
 *
 * 通过 vi.stubGlobal('fetch', ...) mock fetch；EventSource 用 vi.fn 构造桩。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RequirementClient,
  subscribeRequirementEvents,
  type RequirementStreamEvent,
} from '../src/client/api/requirement-client.ts'
import {
  NewRequirementSchema,
  WorkspaceIdSchema,
  type NewRequirement,
  type Requirement,
} from '../src/protocol.ts'

/** 标准 OK 响应构造器。 */
function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 标准 ApiError 响应构造器。 */
function errJson(code: string, detail?: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, error: code, detail }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 一条合法 requirement（Phase 1.2 加 8 个开发意图工作台字段默认值）。 */
const SAMPLE: Requirement = {
  id: '2026-08-30T12:00:00.000Z-aaaaa1',
  workspaceId: WorkspaceIdSchema.parse('ws-1'),
  title: 'demo',
  description: '',
  priority: 'normal',
  status: 'open',
  tags: [],
  createdAt: '2026-08-30T12:00:00.000Z',
  updatedAt: '2026-08-30T12:00:00.000Z',
  // ── Phase 1.2 字段（全部 required）──
  stage: 'understand',
  stageHistory: [{ stage: 'understand', enteredAt: '2026-08-30T12:00:00.000Z' }],
  aiState: 'idle',
  aiSessionId: null,
  aiLastActivityAt: null,
  interventionQueue: [],
  artifacts: {},
  branch: null,
  // ── Phase 2.1 物料（required）──
  materials: {
    prdFiles: [],
    prdLinks: [],
    sourceRepos: [],
    designLinks: [],
    attachments: [],
    externalLinks: [],
  },
}

/** 合法 NewRequirement 入参（带 WorkspaceId brand）。 */
const NEW_INPUT: NewRequirement = NewRequirementSchema.parse({
  workspaceId: WorkspaceIdSchema.parse('ws-1'),
  title: 'demo',
  priority: 'normal',
  tags: [],
})

/** mock fetch 返回指定 Response。 */
function mockFetchOnce(res: Response | (() => Response)): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => (typeof res === 'function' ? res() : res))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** mock fetch 序列：每次调用返回队列里的下一个。 */
function mockFetchSequence(responses: Response[]): ReturnType<typeof vi.fn> {
  let i = 0
  const fn = vi.fn(async () => {
    const r = responses[i]
    if (r === undefined) throw new Error('mock fetch out of responses')
    i += 1
    return r
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('RequirementClient 构造', () => {
  it('默认 baseUrl 为 /api/sky-axis', () => {
    const client = new RequirementClient()
    expect(client['baseUrl' as never]).toBe('/api/sky-axis')
  })

  it('可自定义 baseUrl', () => {
    const client = new RequirementClient('/api/custom')
    expect(client['baseUrl' as never]).toBe('/api/custom')
  })
})

describe('RequirementClient.list', () => {
  it('成功：返回 items 数组', async () => {
    const fetchMock = mockFetchOnce(okJson({ ok: true, items: [SAMPLE] }))
    const c = new RequirementClient()
    const r = await c.list()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sky-axis/requirements')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
  })

  it('空列表成功', async () => {
    mockFetchOnce(okJson({ ok: true, items: [] }))
    const c = new RequirementClient()
    const r = await c.list()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual([])
  })

  it('HTTP 5xx → internal-error', async () => {
    mockFetchOnce(new Response('oops', { status: 500 }))
    const c = new RequirementClient()
    const r = await c.list()
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('internal-error')
      expect(r.detail).toContain('500')
    }
  })

  it('ApiError JSON → 透传 code + detail', async () => {
    mockFetchOnce(errJson('workspace-list-failed', 'rpc timeout'))
    const c = new RequirementClient()
    const r = await c.list()
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('workspace-list-failed')
      expect(r.detail).toBe('rpc timeout')
    }
  })

  it('响应 schema 不匹配 → internal-error + detail 含 zod issue', async () => {
    mockFetchOnce(okJson({ ok: true, items: [{ id: 'bad-id' }] }))
    const c = new RequirementClient()
    const r = await c.list()
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('internal-error')
      expect(r.detail).toContain('response schema mismatch')
    }
  })

  it('响应非 JSON → internal-error', async () => {
    mockFetchOnce(new Response('not json', {
      status: 200, headers: { 'content-type': 'text/plain' },
    }))
    const c = new RequirementClient()
    const r = await c.list()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('internal-error')
  })
})

describe('RequirementClient.create', () => {
  it('成功：返回 item', async () => {
    const fetchMock = mockFetchOnce(okJson({ ok: true, item: SAMPLE }))
    const c = new RequirementClient()
    const r = await c.create(NEW_INPUT)
    // 显式补 priority / tags 默认值供 typecheck
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.id).toBe(SAMPLE.id)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sky-axis/requirements/create')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
    expect(init.credentials).toBe('same-origin')
    expect(JSON.parse(init.body as string)).toEqual(NEW_INPUT)
  })

  it('客户端预校验失败 → validation-failed 不发 fetch', async () => {
    const fetchMock = mockFetchOnce(okJson({ ok: true, item: SAMPLE }))
    const c = new RequirementClient()
    // 故意构造非法 input：workspaceId 空串 + title 空串 → NewRequirementSchema 拒绝
    const r = await c.create({
      workspaceId: '' as never,
      title: '',
      priority: 'normal',
      tags: [],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('validation-failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ApiError JSON → 透传 code', async () => {
    mockFetchOnce(errJson('workspace-not-found', 'gone'))
    const c = new RequirementClient()
    const r = await c.create(NEW_INPUT)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('workspace-not-found')
      expect(r.detail).toBe('gone')
    }
  })

  it('服务端返回的 item 不合法 → schema mismatch → internal-error', async () => {
    // RequirementResponseSchema 内嵌校验 item 是合法 Requirement；item.id
    // 不合法时整个响应 schema 校验失败，detail 含 "response schema mismatch"。
    mockFetchOnce(okJson({ ok: true, item: { ...SAMPLE, id: 'bad-id' } }))
    const c = new RequirementClient()
    const r = await c.create(NEW_INPUT)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('internal-error')
      expect(r.detail).toContain('response schema mismatch')
    }
  })
})

describe('RequirementClient.import (Plan I)', () => {
  // import 入参只有 workspaceId —— ImportRequirementSchema 与 NewRequirementSchema 同形
  // (都要求 workspaceId 非空),但路径不同,语义不同:create 是新建,import 是改 owner。
  const IMPORT_INPUT = { workspaceId: WorkspaceIdSchema.parse('ws-1') }

  it('成功：返回 item', async () => {
    // 模拟 import 后 owner 已切换到新 uuid —— 服务端会回传新值。
    const imported: Requirement = { ...SAMPLE, workspaceId: WorkspaceIdSchema.parse('ws-1') }
    const fetchMock = mockFetchOnce(okJson({ ok: true, item: imported }))
    const c = new RequirementClient()
    const r = await c.import(IMPORT_INPUT)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.id).toBe(imported.id)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    // 关键:走的是 /import 路由,不是 /create
    expect(url).toBe('/api/sky-axis/requirements/import')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
    expect(init.credentials).toBe('same-origin')
    expect(JSON.parse(init.body as string)).toEqual({ workspaceId: 'ws-1' })
  })

  it('客户端预校验失败：workspaceId 空串 → validation-failed 不发 fetch', async () => {
    const fetchMock = mockFetchOnce(okJson({ ok: true, item: SAMPLE }))
    const c = new RequirementClient()
    // workspaceId 空串 → ImportRequirementSchema 拒绝(WorkspaceIdSchema 是 min(1))
    const r = await c.import({ workspaceId: '' as never })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('validation-failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('服务端抛 requirement-not-found → 透传 code(DSH 工作区路径上无 req)', async () => {
    // 极端场景:用户连点两次 import / 或并发竞争;host 端 importRequirement 检测到
    //   path 上已无 req(被别的客户端刚删了)→ 抛 requirement-not-found。
    mockFetchOnce(errJson('requirement-not-found', 'no requirement at path /foo'))
    const c = new RequirementClient()
    const r = await c.import(IMPORT_INPUT)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('requirement-not-found')
      expect(r.detail).toContain('/foo')
    }
  })

  it('服务端抛 invalid-record → 透传 code(数据脏:path 上 > 1 req)', async () => {
    // 1:1 不变量被破坏时的兜底:host 抛 invalid-record,客户端照常透传给 UI
    //   (UI 应展示「数据异常,请联系管理员清理」类错误)。
    mockFetchOnce(errJson('invalid-record', 'path has 2 requirements; 1:1 invariant violated'))
    const c = new RequirementClient()
    const r = await c.import(IMPORT_INPUT)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('invalid-record')
  })
})

/* ── Plan J：addSourceRepo SSH URL 接受 ── */

describe('RequirementClient.addSourceRepo (Plan J: SSH URL 接受)', () => {
  it('SSH URL 通过客户端预校验并发起 POST', async () => {
    const fetchMock = mockFetchOnce(okJson({ ok: true, item: SAMPLE }))
    const c = new RequirementClient()
    const reqId = SAMPLE.id
    const handle = c.addSourceRepo(reqId, {
      url: 'ssh://git@code.jms.com:2222/project/jms/spm/yl-jms-spm-collect-schedule.git',
      branch: 'main',
      description: 'spm schedule',
      displayName: 'spm-collect',
    }, 'user-1')

    const r = await handle.promise
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.id).toBe(SAMPLE.id)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/sky-axis/materials/sourceRepos/add?requirementId=${encodeURIComponent(reqId)}`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.url).toBe('ssh://git@code.jms.com:2222/project/jms/spm/yl-jms-spm-collect-schedule.git')
    expect(body.addedBy).toBe('user-1')
  })

  it('SCP 简写 URL 也通过客户端预校验', async () => {
    const fetchMock = mockFetchOnce(okJson({ ok: true, item: SAMPLE }))
    const c = new RequirementClient()
    const handle = c.addSourceRepo(SAMPLE.id, {
      url: 'git@github.com:anthropic-ai/sdk.git',
      branch: 'main',
      description: 'anthropic sdk',
      displayName: 'sdk',
    })
    const r = await handle.promise
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('客户端拒绝 SSH refspec(把 refspec 当成 SSH URL 上传 → 预校验失败)', async () => {
    const fetchMock = mockFetchOnce(okJson({ ok: true, item: SAMPLE }))
    const c = new RequirementClient()
    const handle = c.addSourceRepo(SAMPLE.id, {
      url: 'git@github.com:main',  // 看着像 SSH refspec,无 path → 拒
      branch: 'main',
      description: 'x',
      displayName: 'x',
    })
    const r = await handle.promise
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('validation-failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('客户端拒绝 file:// URL', async () => {
    const fetchMock = mockFetchOnce(okJson({ ok: true, item: SAMPLE }))
    const c = new RequirementClient()
    const handle = c.addSourceRepo(SAMPLE.id, {
      url: 'file:///etc/passwd',
      branch: 'main',
      description: 'x',
      displayName: 'x',
    })
    const r = await handle.promise
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('validation-failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('服务端 ApiError → 透传 code(SSH URL 已过预校验,服务端可报 auth 错)', async () => {
    mockFetchOnce(errJson('git-clone-failed', 'Permission denied (publickey)'))
    const c = new RequirementClient()
    const handle = c.addSourceRepo(SAMPLE.id, {
      url: 'ssh://git@github.com/private/repo.git',
      branch: 'main',
      description: 'private',
      displayName: 'p',
    })
    const r = await handle.promise
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('git-clone-failed')
      expect(r.detail).toContain('Permission denied')
    }
  })
})

describe('RequirementClient.remove', () => {
  it('成功：返回 { id }', async () => {
    const fetchMock = mockFetchOnce(okJson({ ok: true, id: SAMPLE.id }))
    const c = new RequirementClient()
    const r = await c.remove(SAMPLE.id)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.id).toBe(SAMPLE.id)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sky-axis/requirements/delete?id=' + encodeURIComponent(SAMPLE.id))
    expect(init.method).toBe('DELETE')
    expect(init.credentials).toBe('same-origin')
  })

  it('HTTP 404 → internal-error', async () => {
    mockFetchOnce(new Response('', { status: 404 }))
    const c = new RequirementClient()
    const r = await c.remove('2026-08-30T00:00:00.000Z-aaaaa1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('internal-error')
  })

  it('id 含特殊字符被正确 URL 编码', async () => {
    const fetchMock = mockFetchOnce(okJson({ ok: true, id: '2026-08-30T00:00:00.000Z-aaaaa1' }))
    const c = new RequirementClient()
    await c.remove('a/b+c=2026-08-30T00:00:00.000Z-aaaaa1')
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toContain('id=a%2Fb%2Bc%3D2026-08-30T00%3A00%3A00.000Z-aaaaa1')
  })
})

describe('RequirementClient.listWorkspaces', () => {
  it('成功：返回 items', async () => {
    const fetchMock = mockFetchOnce(okJson({
      ok: true,
      items: [{ id: 'ws-1', title: 'Workspace 1', path: '/tmp/ws-1' }],
    }))
    const c = new RequirementClient()
    const r = await c.listWorkspaces()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value[0]?.id).toBe('ws-1')
      expect(r.value[0]?.title).toBe('Workspace 1')
    }
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/sky-axis/workspaces')
    expect(init.method).toBe('GET')
  })

  it('空列表成功', async () => {
    mockFetchOnce(okJson({ ok: true, items: [] }))
    const c = new RequirementClient()
    const r = await c.listWorkspaces()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual([])
  })

  it('ApiError → 透传', async () => {
    mockFetchOnce(errJson('workspace-list-failed', 'rpc down'))
    const c = new RequirementClient()
    const r = await c.listWorkspaces()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('workspace-list-failed')
  })
})

describe('subscribeRequirementEvents（SSE）', () => {
  /** EventSource 桩：记录 addEventListener / removeEventListener / close 调用。 */
  class FakeEventSource {
    url: string
    listeners = new Map<string, EventListener>()
    closed = false
    constructor(url: string, init?: { withCredentials?: boolean }) {
      this.url = url
      FakeEventSource.lastWithCredentials = init?.withCredentials ?? false
      FakeEventSource.lastInstance = this
    }
    addEventListener(type: string, listener: EventListener): void {
      this.listeners.set(type, listener)
    }
    removeEventListener(type: string, listener: EventListener): void {
      const cur = this.listeners.get(type)
      if (cur === listener) this.listeners.delete(type)
    }
    close(): void {
      this.closed = true
    }
    /** 测试 helper：模拟服务端 push 一个事件。 */
    emit(type: 'put' | 'deleted', data: unknown): void {
      const listener = this.listeners.get(type)
      if (listener === undefined) return
      const evt = { data: JSON.stringify(data) } as MessageEvent<string>
      listener(evt)
    }
    static lastWithCredentials = false
    static lastInstance: FakeEventSource | undefined
  }

  beforeEach(() => {
    FakeEventSource.lastInstance = undefined
    FakeEventSource.lastWithCredentials = false
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource)
  })

  it('构造 EventSource 时带 withCredentials=true', () => {
    subscribeRequirementEvents(() => {})
    expect(FakeEventSource.lastWithCredentials).toBe(true)
    expect(FakeEventSource.lastInstance?.url).toBe('/api/sky-axis/requirements/events')
  })

  it('put 事件：解析后回调 onEvent', () => {
    const received: RequirementStreamEvent[] = []
    const sub = subscribeRequirementEvents((e) => { received.push(e) })
    ;(sub.source as unknown as FakeEventSource).emit('put', SAMPLE)
    expect(received).toHaveLength(1)
    expect(received[0]?.operation).toBe('put')
    if (received[0]?.operation === 'put') {
      expect(received[0].item.id).toBe(SAMPLE.id)
    }
  })

  it('deleted 事件：解析 id 后回调 onEvent', () => {
    const received: RequirementStreamEvent[] = []
    const sub = subscribeRequirementEvents((e) => { received.push(e) })
    ;(sub.source as unknown as FakeEventSource).emit('deleted', { id: SAMPLE.id })
    expect(received).toHaveLength(1)
    expect(received[0]?.operation).toBe('deleted')
  })

  it('put 数据非法时被静默忽略（不抛）', () => {
    const received: RequirementStreamEvent[] = []
    const sub = subscribeRequirementEvents((e) => { received.push(e) })
    expect(() => (sub.source as unknown as FakeEventSource).emit('put', { id: 'bad-id' })).not.toThrow()
    expect(received).toHaveLength(0)
  })

  it('dispose() 移除监听器 + 关闭 source', () => {
    const sub = subscribeRequirementEvents(() => {})
    const source = sub.source as unknown as FakeEventSource
    expect(source.closed).toBe(false)
    sub.dispose()
    expect(source.closed).toBe(true)
    // dispose 后再 emit 不触发回调
    const received: RequirementStreamEvent[] = []
    const sub2 = subscribeRequirementEvents((e) => { received.push(e) })
    sub2.dispose()
    ;(sub2.source as unknown as FakeEventSource).emit('put', SAMPLE)
    expect(received).toHaveLength(0)
  })
})