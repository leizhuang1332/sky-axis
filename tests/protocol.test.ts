/**
 * protocol.ts schema 单元测试。
 *
 * 覆盖目标：
 *   - 端点路径字面量（host 与 client 必须共用同一份字符串，避免漂移）
 *   - zod schema 解析成功 / 失败路径（host 入参校验 + 响应校验的核心）
 *   - workspaceId 强制必填（NewRequirementSchema 没有 default，缺字段即拒绝）
 *   - Requirement ID 正则（秒级 ISO + 6 位 base36 后缀）
 *   - 错误码联合（SKY_AXIS_ERROR_CODES）6 个值
 *
 * 注意：zod 4.x brand 类型不可跨 schema 直接复用，本测试只做 parse 行为
 * 断言，不引出具体 brand 字符串内容。
 */
import { describe, expect, it } from 'vitest'
import {
  SKY_AXIS_API_PREFIX,
  SkyAxisEndpoints,
  SKY_AXIS_ERROR_CODES,
  AddSourceRepoRequestSchema,
  HealthResponseSchema,
  MaterialsSchema,
  NewRequirementSchema,
  PingResponseSchema,
  PrdFileSchema,
  PrdLinkSchema,
  RequirementEventSchema,
  RequirementIdSchema,
  RequirementPrioritySchema,
  RequirementSchema,
  RequirementStatusSchema,
  RequirementsListResponseSchema,
  SourceRepoSchema,
  UrlSchema,
  UserIdSchema,
  WorkspacesListResponseSchema,
  WorkspaceSummarySchema,
  countMaterials,
  emptyMaterials,
} from '../src/protocol.ts'

/** 一条合法的 requirement 记录（用于响应 schema 校验；Phase 2.1 加 materials）。 */
const sampleRequirement = {
  id: '2026-08-30T12:34:56.789Z-x9k2p4',
  workspaceId: 'ws-abc',
  title: 'demo requirement',
  description: 'demo description',
  priority: 'normal' as const,
  status: 'open' as const,
  tags: ['demo'],
  createdAt: '2026-08-30T12:34:56.789Z',
  updatedAt: '2026-08-30T12:34:56.789Z',
  // ── Phase 1.2 字段（全部 required）──
  stage: 'understand' as const,
  stageHistory: [{ stage: 'understand' as const, enteredAt: '2026-08-30T12:34:56.789Z' }],
  aiState: 'idle' as const,
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

describe('SkyAxisEndpoints 路径字面量', () => {
  it('API 前缀为 /api/sky-axis', () => {
    expect(SKY_AXIS_API_PREFIX).toBe('/api/sky-axis')
  })

  it('所有端点共享同一前缀', () => {
    for (const path of Object.values(SkyAxisEndpoints)) {
      expect(path.startsWith(SKY_AXIS_API_PREFIX)).toBe(true)
    }
  })

  it('包含所有 Phase 1 路由', () => {
    expect(SkyAxisEndpoints.ping).toBe('/api/sky-axis/ping')
    expect(SkyAxisEndpoints.health).toBe('/api/sky-axis/health')
    expect(SkyAxisEndpoints.requirements).toBe('/api/sky-axis/requirements')
    expect(SkyAxisEndpoints.requirementCreate).toBe('/api/sky-axis/requirements/create')
    expect(SkyAxisEndpoints.requirementDelete).toBe('/api/sky-axis/requirements/delete')
    expect(SkyAxisEndpoints.requirementEvents).toBe('/api/sky-axis/requirements/events')
    expect(SkyAxisEndpoints.workspaceList).toBe('/api/sky-axis/workspaces')
  })
})

describe('SKY_AXIS_ERROR_CODES 错误码联合', () => {
  it('正好包含 27 个错误码（Phase 2.5 material-not-found / Step 3 network-error / Phase 2.6 五项 git-* / Phase 2.6 v2 source-repo-duplicate / Phase 2.6 v2.1 git-clone-incomplete / 1:1 不变量 workspace-already-has-requirement / Sprint 4 artifact-sandbox-violation / Sprint 5 yaml-* & migration-failed / Plan I path-1:1 requirement-already-exists-at-path）', () => {
    expect(SKY_AXIS_ERROR_CODES).toHaveLength(27)
  })

  it('错误码集合稳定', () => {
    expect([...SKY_AXIS_ERROR_CODES].sort()).toEqual([
      'ai-event-failed',
      'ai-not-configured',
      'ai-session-missing',
      'artifact-not-found',
      'artifact-sandbox-violation',
      'git-checkout-failed',
      'git-clone-failed',
      'git-clone-incomplete',
      'git-not-installed',
      'git-sandbox-violation',
      'git-timeout',
      'internal-error',
      'invalid-record',
      'material-not-found',
      'migration-failed',
      'network-error',
      'requirement-already-exists-at-path',
      'requirement-not-found',
      'source-repo-duplicate',
      'stage-invalid',
      'validation-failed',
      'workspace-already-has-requirement',
      'workspace-list-failed',
      'workspace-not-found',
      'yaml-lock-timeout',
      'yaml-parse-failed',
      'yaml-write-failed',
    ])
  })
})

describe('RequirementPrioritySchema', () => {
  it('接受 4 档合法值', () => {
    expect(RequirementPrioritySchema.parse('low')).toBe('low')
    expect(RequirementPrioritySchema.parse('normal')).toBe('normal')
    expect(RequirementPrioritySchema.parse('high')).toBe('high')
    expect(RequirementPrioritySchema.parse('urgent')).toBe('urgent')
  })

  it('拒绝未知优先级', () => {
    expect(() => RequirementPrioritySchema.parse('critical')).toThrow()
  })
})

describe('RequirementStatusSchema', () => {
  it('接受 4 态合法值', () => {
    expect(RequirementStatusSchema.parse('open')).toBe('open')
    expect(RequirementStatusSchema.parse('in_progress')).toBe('in_progress')
    expect(RequirementStatusSchema.parse('done')).toBe('done')
    expect(RequirementStatusSchema.parse('cancelled')).toBe('cancelled')
  })

  it('拒绝未知状态', () => {
    expect(() => RequirementStatusSchema.parse('archived')).toThrow()
  })
})

describe('RequirementIdSchema（ID 正则）', () => {
  it('接受合法 ID', () => {
    expect(RequirementIdSchema.parse('2026-08-30T12:34:56.789Z-x9k2p4')).toBeTruthy()
    expect(RequirementIdSchema.parse('2026-01-01T00:00:00.000Z-aaaaaa')).toBeTruthy()
  })

  it('拒绝非 ISO 前缀', () => {
    expect(() => RequirementIdSchema.parse('hello-x9k2p4')).toThrow()
  })

  it('拒绝缺少 6 位 base36 后缀', () => {
    expect(() => RequirementIdSchema.parse('2026-08-30T12:34:56.789Z')).toThrow()
    expect(() => RequirementIdSchema.parse('2026-08-30T12:34:56.789Z-x9k2p')).toThrow()
  })

  it('拒绝后缀含非 base36 字符', () => {
    expect(() => RequirementIdSchema.parse('2026-08-30T12:34:56.789Z-XXXXXX')).toThrow()
    expect(() => RequirementIdSchema.parse('2026-08-30T12:34:56.789Z-x9k2p!')).toThrow()
  })
})

describe('NewRequirementSchema（新建需求入参）', () => {
  it('合法最小入参', () => {
    const r = NewRequirementSchema.parse({
      workspaceId: 'ws-1',
      title: 'demo',
    })
    expect(r.priority).toBe('normal') // default
    expect(r.tags).toEqual([])         // default
    expect(r.description).toBeUndefined()
  })

  it('合法完整入参', () => {
    const r = NewRequirementSchema.parse({
      workspaceId: 'ws-1',
      title: '完整需求',
      description: '详细描述',
      priority: 'high',
      tags: ['前端', '紧急'],
    })
    expect(r.title).toBe('完整需求')
    expect(r.priority).toBe('high')
    expect(r.tags).toEqual(['前端', '紧急'])
  })

  it('workspaceId 缺失即拒绝（强制必填）', () => {
    expect(() => NewRequirementSchema.parse({ title: 'demo' })).toThrow()
  })

  it('workspaceId 空串拒绝', () => {
    expect(() => NewRequirementSchema.parse({ workspaceId: '', title: 'demo' })).toThrow()
  })

  it('title 长度校验', () => {
    expect(() => NewRequirementSchema.parse({ workspaceId: 'ws-1', title: '' })).toThrow()
    expect(() => NewRequirementSchema.parse({ workspaceId: 'ws-1', title: 'a'.repeat(121) })).toThrow()
    expect(() => NewRequirementSchema.parse({ workspaceId: 'ws-1', title: 'a'.repeat(120) })).toBeTruthy()
  })

  it('description 超长拒绝', () => {
    expect(() => NewRequirementSchema.parse({
      workspaceId: 'ws-1',
      title: 'demo',
      description: 'x'.repeat(4001),
    })).toThrow()
  })

  it('tag 单项长度 + 总数限制', () => {
    expect(() => NewRequirementSchema.parse({
      workspaceId: 'ws-1',
      title: 'demo',
      tags: [''], // 空串
    })).toThrow()
    expect(() => NewRequirementSchema.parse({
      workspaceId: 'ws-1',
      title: 'demo',
      tags: ['x'.repeat(33)],
    })).toThrow()
    expect(() => NewRequirementSchema.parse({
      workspaceId: 'ws-1',
      title: 'demo',
      tags: Array.from({ length: 21 }, () => 'tag'),
    })).toThrow()
    expect(() => NewRequirementSchema.parse({
      workspaceId: 'ws-1',
      title: 'demo',
      tags: Array.from({ length: 20 }, () => 'tag'),
    })).toBeTruthy()
  })
})

describe('RequirementSchema（存储记录）', () => {
  it('合法记录通过', () => {
    expect(() => RequirementSchema.parse(sampleRequirement)).not.toThrow()
  })

  it('id 不合法即拒绝', () => {
    expect(() => RequirementSchema.parse({ ...sampleRequirement, id: 'not-a-real-id' })).toThrow()
  })

  it('createdAt 非 ISO datetime 即拒绝', () => {
    expect(() => RequirementSchema.parse({ ...sampleRequirement, createdAt: 'yesterday' })).toThrow()
  })

  it('priority / status 不合法即拒绝', () => {
    expect(() => RequirementSchema.parse({ ...sampleRequirement, priority: 'critical' })).toThrow()
    expect(() => RequirementSchema.parse({ ...sampleRequirement, status: 'archived' })).toThrow()
  })
})

describe('WorkspaceSummarySchema', () => {
  it('合法 workspace 通过', () => {
    expect(() => WorkspaceSummarySchema.parse({
      id: 'ws-1',
      title: 'demo workspace',
      path: '/tmp/ws',
    })).not.toThrow()
  })

  it('id 为空串拒绝', () => {
    expect(() => WorkspaceSummarySchema.parse({ id: '', title: 'x', path: '/x' })).toThrow()
  })
})

describe('PingResponseSchema / HealthResponseSchema', () => {
  it('ping 合法响应通过', () => {
    expect(() => PingResponseSchema.parse({
      ok: true,
      ts: '2026-08-30T12:34:56.789Z',
      host: '@leizhuang/sky-axis',
    })).not.toThrow()
  })

  it('ping 缺失字段即拒绝', () => {
    expect(() => PingResponseSchema.parse({ ok: true, ts: 'now' })).toThrow()
  })

  it('health 合法响应通过', () => {
    expect(() => HealthResponseSchema.parse({
      ok: true,
      uptimeMs: 12345,
      apiPrefix: '/api/sky-axis',
    })).not.toThrow()
  })

  it('health uptimeMs 必须非负整数', () => {
    expect(() => HealthResponseSchema.parse({ ok: true, uptimeMs: -1, apiPrefix: '/x' })).toThrow()
    expect(() => HealthResponseSchema.parse({ ok: true, uptimeMs: 1.5, apiPrefix: '/x' })).toThrow()
  })
})

describe('RequirementsListResponseSchema', () => {
  it('空列表通过', () => {
    expect(() => RequirementsListResponseSchema.parse({ ok: true, items: [] })).not.toThrow()
  })

  it('多条记录通过', () => {
    expect(() => RequirementsListResponseSchema.parse({
      ok: true,
      items: [sampleRequirement, { ...sampleRequirement, id: '2026-08-31T00:00:00.000Z-aaaaaa' }],
    })).not.toThrow()
  })

  it('items 内单条非法即拒绝', () => {
    expect(() => RequirementsListResponseSchema.parse({
      ok: true,
      items: [{ ...sampleRequirement, id: 'bad' }],
    })).toThrow()
  })
})

describe('RequirementEventSchema（SSE 事件判别联合）', () => {
  it('put 事件合法', () => {
    expect(() => RequirementEventSchema.parse({
      operation: 'put',
      item: sampleRequirement,
    })).not.toThrow()
  })

  it('deleted 事件合法', () => {
    expect(() => RequirementEventSchema.parse({
      operation: 'deleted',
      id: '2026-08-30T12:34:56.789Z-x9k2p4',
    })).not.toThrow()
  })

  it('未知 operation 即拒绝', () => {
    expect(() => RequirementEventSchema.parse({ operation: 'updated', item: sampleRequirement })).toThrow()
  })

  it('deleted 事件 id 格式不合法即拒绝', () => {
    expect(() => RequirementEventSchema.parse({ operation: 'deleted', id: 'bad-id' })).toThrow()
  })
})

describe('WorkspacesListResponseSchema', () => {
  it('空列表通过', () => {
    expect(() => WorkspacesListResponseSchema.parse({ ok: true, items: [] })).not.toThrow()
  })

  it('items 内 workspace 非法即拒绝', () => {
    expect(() => WorkspacesListResponseSchema.parse({
      ok: true,
      items: [{ id: '', title: 'x', path: '/x' }],
    })).toThrow()
  })
})

/* ── Phase 2.1：物料 schema 边界 ── */

describe('MaterialsSchema（需求物料）', () => {
  const now = '2026-08-30T12:00:00.000Z'

  it('emptyMaterials 返回 6 个空数组', () => {
    const m = emptyMaterials()
    expect(m.prdFiles).toEqual([])
    expect(m.prdLinks).toEqual([])
    expect(m.sourceRepos).toEqual([])
    expect(m.designLinks).toEqual([])
    expect(m.attachments).toEqual([])
    expect(m.externalLinks).toEqual([])
  })

  it('countMaterials 6 个 section 计数求和', () => {
    const m = {
      prdFiles: [{} as never, {} as never],
      prdLinks: [{} as never],
      sourceRepos: [{} as never, {} as never, {} as never],
      designLinks: [],
      attachments: [{} as never],
      externalLinks: [],
    }
    expect(countMaterials(m)).toBe(7)
  })

  it('合法 Materials 通过 parse', () => {
    expect(() => MaterialsSchema.parse(emptyMaterials())).not.toThrow()
  })

  it('缺 section 字段即拒绝（fail loud，不 silent 兜底）', () => {
    expect(() => MaterialsSchema.parse({
      prdFiles: [], prdLinks: [], sourceRepos: [], designLinks: [], attachments: [],
      // externalLinks 缺失
    })).toThrow()
  })

  it('PrdFileSchema 合法字段', () => {
    expect(() => PrdFileSchema.parse({
      id: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      filename: 'prd.pdf', mimeType: 'application/pdf', size: 1024,
      uploadedAt: now, uploadedBy: 'user-1',
      path: '.sky-axis/req-x/prdFiles/a1b2c3d4-e5f6-7890-abcd-ef0123456789-prd.pdf',
    })).not.toThrow()
  })

  it('PrdFileSchema 非 UUID 拒绝', () => {
    expect(() => PrdFileSchema.parse({
      id: 'not-uuid', filename: 'prd.pdf', mimeType: 'application/pdf', size: 1024,
      uploadedAt: now, uploadedBy: 'user-1',
    })).toThrow()
  })

  it('PrdLinkSchema 仅接受 http/https URL', () => {
    const base = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      title: 'PRD', source: 'yuque' as const, addedAt: now, addedBy: 'user-1',
    }
    expect(() => PrdLinkSchema.parse({ ...base, url: 'https://yuque.com/foo' })).not.toThrow()
    expect(() => PrdLinkSchema.parse({ ...base, url: 'http://example.com' })).not.toThrow()
    expect(() => PrdLinkSchema.parse({ ...base, url: 'javascript:alert(1)' })).toThrow()
    expect(() => PrdLinkSchema.parse({ ...base, url: 'file:///etc/passwd' })).toThrow()
    expect(() => PrdLinkSchema.parse({ ...base, url: 'ftp://example.com' })).toThrow()
  })

  it('SourceRepoSchema lastCommitSha 必须是 7-40 字符 hex', () => {
    const base = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      url: 'https://github.com/foo/bar', branch: 'main',
      description: '', addedAt: now, addedBy: 'user-1',
    }
    expect(() => SourceRepoSchema.parse({ ...base, lastCommitSha: 'a1b2c3d' })).not.toThrow()
    expect(() => SourceRepoSchema.parse({ ...base, lastCommitSha: '0123456789abcdef0123456789abcdef01234567' })).not.toThrow()
    expect(() => SourceRepoSchema.parse({ ...base, lastCommitSha: 'short' })).toThrow()
    expect(() => SourceRepoSchema.parse({ ...base, lastCommitSha: 'not-a-hex-at-all-zzzzzz' })).toThrow()
    expect(() => SourceRepoSchema.parse({ ...base })).not.toThrow()
  })

  it('SourceRepoSchema cloneStatus 缺省时默认 not-cloned（旧记录兼容）', () => {
    const base = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      url: 'https://github.com/foo/bar', branch: 'main',
      description: '', addedAt: now, addedBy: 'user-1',
    }
    const r = SourceRepoSchema.parse(base)
    expect(r.cloneStatus).toBe('not-cloned')
    expect(r.localPath).toBeUndefined()
    expect(r.clonedAt).toBeUndefined()
    expect(r.cloneError).toBeUndefined()
    expect(r.displayName).toBeUndefined()
  })

  it('SourceRepoSchema cloneStatus 枚举合法值', () => {
    const base = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      url: 'https://github.com/foo/bar', branch: 'main',
      description: '', addedAt: now, addedBy: 'user-1',
    }
    for (const s of ['not-cloned', 'cloned', 'clone-failed'] as const) {
      expect(() => SourceRepoSchema.parse({ ...base, cloneStatus: s })).not.toThrow()
    }
    expect(() => SourceRepoSchema.parse({ ...base, cloneStatus: 'unknown' })).toThrow()
  })

  it('SourceRepoSchema 完整克隆记录通过 parse', () => {
    const full = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      url: 'https://github.com/foo/bar', branch: 'feat/test',
      lastCommitSha: 'a1b2c3d',
      description: 'demo', addedAt: now, addedBy: 'user-1',
      // Sprint 1：路径从 `.sky-axis/repos/<id>` 顶层化为 `repos/<id>`
      localPath: 'repos/a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      clonedAt: now,
      cloneStatus: 'cloned' as const,
      displayName: 'zhangsan',
    }
    expect(() => SourceRepoSchema.parse(full)).not.toThrow()
  })

  it('SourceRepoSchema displayName 长度上限 64', () => {
    const base = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      url: 'https://github.com/foo/bar', branch: 'main',
      description: '', addedAt: now, addedBy: 'user-1',
    }
    expect(() => SourceRepoSchema.parse({ ...base, displayName: 'a'.repeat(64) })).not.toThrow()
    expect(() => SourceRepoSchema.parse({ ...base, displayName: 'a'.repeat(65) })).toThrow()
  })

  it('SourceRepoSchema cloneError 长度上限 500', () => {
    const base = {
      id: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
      url: 'https://github.com/foo/bar', branch: 'main',
      description: '', addedAt: now, addedBy: 'user-1',
    }
    expect(() => SourceRepoSchema.parse({ ...base, cloneStatus: 'clone-failed' as const, cloneError: 'x'.repeat(500) })).not.toThrow()
    expect(() => SourceRepoSchema.parse({ ...base, cloneStatus: 'clone-failed' as const, cloneError: 'x'.repeat(501) })).toThrow()
  })

  it('AddSourceRepoRequestSchema branch 必填（min 1）', () => {
    expect(() => AddSourceRepoRequestSchema.parse({
      url: 'https://github.com/foo/bar',
      branch: '',                // 空串拒绝 —— Phase 2.6 起同步 clone 要求明确分支
      description: 'x',
    })).toThrow()
    expect(() => AddSourceRepoRequestSchema.parse({
      url: 'https://github.com/foo/bar',
      branch: 'main',
      description: 'x',
    })).not.toThrow()
  })

  it('AddSourceRepoRequestSchema displayName 仍 optional（向后兼容旧调用,但 Phase 2.6 v2 起 UI 不再输入）', () => {
    expect(() => AddSourceRepoRequestSchema.parse({
      url: 'https://github.com/foo/bar', branch: 'main', description: 'x',
    })).not.toThrow()
    expect(() => AddSourceRepoRequestSchema.parse({
      url: 'https://github.com/foo/bar', branch: 'main', description: 'x',
      displayName: 'zhangsan',
    })).not.toThrow()
    expect(() => AddSourceRepoRequestSchema.parse({
      url: 'https://github.com/foo/bar', branch: 'main', description: 'x',
      displayName: 'a'.repeat(65),
    })).toThrow()
  })

  it('UrlSchema 通用 http/https 校验', () => {
    expect(UrlSchema.safeParse('https://x.com').success).toBe(true)
    expect(UrlSchema.safeParse('http://x.com').success).toBe(true)
    expect(UrlSchema.safeParse('data:text/plain,abc').success).toBe(false)
    expect(UrlSchema.safeParse('not-a-url').success).toBe(false)
  })

  it('UserIdSchema 空字符串合法（系统/未知）', () => {
    expect(UserIdSchema.safeParse('').success).toBe(true)
    expect(UserIdSchema.safeParse('user-1').success).toBe(true)
  })
})