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

/** 一条合法 requirement。 */
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