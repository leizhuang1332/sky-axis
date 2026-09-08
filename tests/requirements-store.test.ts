/**
 * src/host/requirements-store.ts 单元测试。
 *
 * 测试目标（Sprint 5：YAML-as-SoT 需求数据持久化）：
 *   - readAllRequirements: 空 record / 损坏 yaml / 已存数据
 *   - readRequirement: 找到 / 找不到(undefined)
 *   - updateRequirements mutator 模式:
 *     - 新增 / 删除 / 修改条目
 *     - lastTouchedAt 自动刷新
 *     - mutator 抛错 → 锁释放 + 错误透传(不写盘)
 *     - 串行互斥(并发 updateRequirements 不丢更新)
 *     - 返回 previous + result
 *   - 错误码映射:
 *     - 损坏 mate.yaml → yaml-parse-failed
 *     - mate.yaml 缺失(且 mutate 想写)→ yaml-write-failed
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import {
  emptyMaterials,
  WorkspaceIdSchema,
  type Requirement,
  type RequirementId,
  type WorkspaceId,
} from '../src/protocol.ts'
import {
  SKY_AXIS_META_SCHEMA_VERSION,
  _metaPath,
  ensureMeta,
  WorkspaceMetaError,
} from '../src/host/workspace-meta.ts'
import {
  readAllRequirements,
  readRequirement,
  findExistingRequirementAtPath,
  updateRequirements,
} from '../src/host/requirements-store.ts'
import { SkyAxisHostError } from '../src/host/requirement-service.ts'
import { _internal, withFileLock } from '../src/host/fs-lock.ts'

const WORKSPACE_PATH = '/tmp/sky-axis-reqstore-test'
let workspaceRoot: string
const NOW = '2026-09-08T00:00:00.000Z'
const LATER = '2026-09-08T01:00:00.000Z'
const WORKSPACE_ID: WorkspaceId = WorkspaceIdSchema.parse('ws-rs-test-001')

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'sky-axis-reqstore-'))
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
})

/** 构造测试用 Requirement 工厂。 */
function makeReq(id: RequirementId, overrides: Partial<Requirement> = {}): Requirement {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    title: `req-${id}`,
    description: '',
    priority: 'normal',
    status: 'open',
    tags: [],
    createdAt: NOW,
    updatedAt: NOW,
    stage: 'understand',
    stageHistory: [{ stage: 'understand', enteredAt: NOW }],
    aiState: 'idle',
    aiSessionId: null,
    aiLastActivityAt: null,
    interventionQueue: [],
    artifacts: {},
    branch: null,
    materials: emptyMaterials(),
    ...overrides,
  }
}

/** helper:先 ensureMeta 初始化 mate.yaml(workspace 不存在元数据会写默认值)。 */
async function initMeta(): Promise<void> {
  await ensureMeta(workspaceRoot, {
    workspaceId:    WORKSPACE_ID,
    workspaceTitle: 'Test',
    skyAxisVersion: '0.1.0',
    now:            NOW,
  })
}

/* ── readAllRequirements ── */

describe('readAllRequirements', () => {
  it('mate.yaml 不存在 → 返回空 record(不抛错)', async () => {
    const section = await readAllRequirements(workspaceRoot)
    expect(section).toEqual({})
  })

  it('mate.yaml v2 + 空 requirements 段 → 返回空 record', async () => {
    await initMeta()
    const section = await readAllRequirements(workspaceRoot)
    expect(section).toEqual({})
  })

  it('mate.yaml v2 + 已存 requirements → 返回全部', async () => {
    await initMeta()
    // 写入两条
    await updateRequirements(workspaceRoot, ({ current }) => {
      const req1 = makeReq('2026-09-08T00:00:00.000Z-aaaa01' as RequirementId)
      const req2 = makeReq('2026-09-08T00:00:00.000Z-aaaa02' as RequirementId)
      return {
        next: { ...current, [req1.id]: req1, [req2.id]: req2 },
        result: [req1.id, req2.id],
      }
    }, { now: NOW })

    const section = await readAllRequirements(workspaceRoot)
    expect(Object.keys(section)).toHaveLength(2)
  })

  it('mate.yaml 损坏 → 抛 yaml-parse-failed', async () => {
    const target = _metaPath(workspaceRoot)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, 'broken: : yaml: ::\n', 'utf8')

    await expect(readAllRequirements(workspaceRoot)).rejects.toMatchObject({
      code: 'yaml-parse-failed',
    })
  })

  it('mate.yaml v1(无 requirements 段)→ 返回空 record(向后兼容)', async () => {
    const target = _metaPath(workspaceRoot)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, YAML.stringify({
      schemaVersion: 1,
      workspace: { id: WORKSPACE_ID, title: 'T', path: workspaceRoot },
      skyAxis: { version: '0.0.1', firstInstalledAt: NOW, lastTouchedAt: NOW },
    }), 'utf8')

    const section = await readAllRequirements(workspaceRoot)
    expect(section).toEqual({})
  })
})

/* ── readRequirement ── */

describe('readRequirement', () => {
  it('找不到 → 返回 undefined(不抛)', async () => {
    await initMeta()
    const req = await readRequirement(
      workspaceRoot,
      '2026-09-08T00:00:00.000Z-aaaa99' as RequirementId,
    )
    expect(req).toBeUndefined()
  })

  it('找到 → 返回完整 Requirement', async () => {
    await initMeta()
    const req = makeReq('2026-09-08T00:00:00.000Z-aaaa01' as RequirementId, {
      title: 'hello',
    })
    await updateRequirements(workspaceRoot, ({ current }) => ({
      next: { ...current, [req.id]: req },
      result: null,
    }), { now: NOW })

    const fetched = await readRequirement(workspaceRoot, req.id)
    expect(fetched?.title).toBe('hello')
  })
})

/* ── findExistingRequirementAtPath (Plan I: 1:1 path-based 不变量用) ── */

describe('findExistingRequirementAtPath', () => {
  it('path 上无 req(mate.yaml 不存在)→ 返回 undefined', async () => {
    const found = await findExistingRequirementAtPath(workspaceRoot)
    expect(found).toBeUndefined()
  })

  it('path 上有 1 条 req → 返回该 req', async () => {
    await initMeta()
    const req = makeReq('2026-09-08T00:00:00.000Z-aaaa01' as RequirementId, {
      title: 'only-one',
    })
    await updateRequirements(workspaceRoot, ({ current }) => ({
      next: { ...current, [req.id]: req },
      result: null,
    }), { now: NOW })

    const found = await findExistingRequirementAtPath(workspaceRoot)
    expect(found?.id).toBe(req.id)
    expect(found?.title).toBe('only-one')
  })

  it('path 上有 ≥2 条 req(强约束被破坏)→ 返回第一条(由 caller 报错 / 人工清理)', async () => {
    // 模拟:Plan H 之前用户可能因 DSH uuid 轮换残留多 req;Plan I 改 path-based 后
    //   后续 create() 拒绝。store 这一层只负责"返回任意一条",错误由 service 层抛。
    await initMeta()
    const req1 = makeReq('2026-09-08T00:00:00.000Z-aaaa01' as RequirementId, {
      title: 'orphan-1',
    })
    const req2 = makeReq('2026-09-08T00:00:00.000Z-aaaa02' as RequirementId, {
      title: 'orphan-2',
    })
    await updateRequirements(workspaceRoot, ({ current }) => ({
      next: { ...current, [req1.id]: req1, [req2.id]: req2 },
      result: null,
    }), { now: NOW })

    const found = await findExistingRequirementAtPath(workspaceRoot)
    expect(found).toBeDefined()
    expect(['orphan-1', 'orphan-2']).toContain(found?.title)
  })
})

/* ── updateRequirements 正常路径 ── */

describe('updateRequirements 正常路径', () => {
  it('mutator 新增一条 → 写入 + 返回 result + previous', async () => {
    await initMeta()
    const req = makeReq('2026-09-08T00:00:00.000Z-aaaa01' as RequirementId)

    const outcome = await updateRequirements(workspaceRoot, ({ current }) => ({
      next: { ...current, [req.id]: req },
      result: req,
    }), { now: LATER })

    expect(outcome.result.id).toBe(req.id)
    expect(outcome.previous).toEqual({})  // mutate 前是空
    // 落盘验证
    const section = await readAllRequirements(workspaceRoot)
    expect(section[req.id]?.title).toBe('req-2026-09-08T00:00:00.000Z-aaaa01')
  })

  it('mutator 删除一条 → next 不含 + 返回被删的 req', async () => {
    await initMeta()
    const req = makeReq('2026-09-08T00:00:00.000Z-aaaa01' as RequirementId)
    await updateRequirements(workspaceRoot, ({ current }) => ({
      next: { ...current, [req.id]: req },
      result: null,
    }), { now: NOW })

    const outcome = await updateRequirements(workspaceRoot, ({ current }) => {
      const removed = current[req.id]
      const { [req.id]: _removed, ...rest } = current
      return {
        next: rest,
        result: removed,
      }
    }, { now: LATER })

    expect(outcome.result?.id).toBe(req.id)
    expect(Object.keys(await readAllRequirements(workspaceRoot))).toHaveLength(0)
  })

  it('lastTouchedAt 被刷新到 opts.now', async () => {
    await initMeta()  // lastTouchedAt = NOW
    await updateRequirements(workspaceRoot, ({ current }) => ({
      next: current,
      result: null,
    }), { now: LATER })

    // 读 mate.yaml 内部 skyAxis.lastTouchedAt
    const raw = await import('node:fs/promises').then(fs =>
      fs.readFile(_metaPath(workspaceRoot), 'utf8'),
    )
    const parsed = YAML.parse(raw) as { skyAxis: { lastTouchedAt: string } }
    expect(parsed.skyAxis.lastTouchedAt).toBe(LATER)
  })

  it('schemaVersion 写入仍是 2(不被 mutator 误改)', async () => {
    await initMeta()
    await updateRequirements(workspaceRoot, ({ current }) => ({
      next: current,
      result: null,
    }), { now: NOW })

    const raw = await import('node:fs/promises').then(fs =>
      fs.readFile(_metaPath(workspaceRoot), 'utf8'),
    )
    const parsed = YAML.parse(raw) as { schemaVersion: number }
    expect(parsed.schemaVersion).toBe(SKY_AXIS_META_SCHEMA_VERSION)
  })
})

/* ── updateRequirements 错误处理 ── */

describe('updateRequirements 错误处理', () => {
  it('mutator 抛错 → 锁释放 + 错误透传 + 不写盘', async () => {
    await initMeta()
    const req = makeReq('2026-09-08T00:00:00.000Z-aaaa01' as RequirementId)

    await expect(updateRequirements(workspaceRoot, ({ current: _c }) => {
      throw new SkyAxisHostError('workspace-already-has-requirement', 'ws busy')
    }, { now: NOW })).rejects.toMatchObject({
      code: 'workspace-already-has-requirement',
    })

    // 锁释放 + 没写:section 仍空
    const section = await readAllRequirements(workspaceRoot)
    expect(Object.keys(section)).toHaveLength(0)

    // 后续 updateRequirements 可正常获取锁
    const outcome = await updateRequirements(workspaceRoot, ({ current }) => ({
      next: { ...current, [req.id]: req },
      result: null,
    }), { now: NOW })
    expect(outcome.result).toBeNull()
  })

  it('mate.yaml 缺失 → 抛 yaml-write-failed(确保元数据由 ensureMeta 先初始化)', async () => {
    // 不调 initMeta —— mate.yaml 不存在
    await expect(updateRequirements(workspaceRoot, ({ current }) => ({
      next: current,
      result: null,
    }), { now: NOW })).rejects.toMatchObject({
      code: 'yaml-write-failed',
    })
  })
})

/* ── updateRequirements 并发互斥 ── */

describe('updateRequirements 并发互斥', () => {
  it('N=5 个并发 updateRequirements 都串行执行,不丢更新', async () => {
    await initMeta()
    const N = 5
    const ids = Array.from({ length: N }, (_, i) =>
      `2026-09-08T00:00:00.000Z-aaaa0${i + 1}` as RequirementId,
    )

    await Promise.all(ids.map((id, i) =>
      updateRequirements(workspaceRoot, ({ current }) => {
        // 模拟短计算
        const req = makeReq(id, { title: `req-${i}` })
        return { next: { ...current, [id]: req }, result: id }
      }, { now: NOW }),
    ))

    const section = await readAllRequirements(workspaceRoot)
    expect(Object.keys(section).sort()).toEqual([...ids].sort())
    // 每条都写入了
    for (let i = 0; i < N; i++) {
      expect(section[ids[i]]?.title).toBe(`req-${i}`)
    }
  })

  it('updateRequirements 与 readAllRequirements 并发不冲突', async () => {
    await initMeta()
    const req = makeReq('2026-09-08T00:00:00.000Z-aaaa01' as RequirementId)
    await updateRequirements(workspaceRoot, ({ current }) => ({
      next: { ...current, [req.id]: req },
      result: null,
    }), { now: NOW })

    // 并发读 10 次 + 写 10 次
    const ops = await Promise.all([
      ...Array.from({ length: 10 }, () => readAllRequirements(workspaceRoot)),
      ...Array.from({ length: 10 }, (_, i) =>
        updateRequirements(workspaceRoot, ({ current }) => ({
          next: current,
          result: i,
        }), { now: NOW }),
      ),
    ])
    // readAllRequirements 返回的 record 都含 req(因为读 - 写交错是 OK 的)
    const reads = ops.slice(0, 10) as Awaited<ReturnType<typeof readAllRequirements>>[]
    for (const r of reads) {
      expect(r[req.id]?.id).toBe(req.id)
    }
  })
})

/* ── 错误码映射 ── */

describe('错误码映射', () => {
  it('WorkspaceMetaError(invalid)→ SkyAxisHostError(yaml-parse-failed)', async () => {
    // 直接读取坏 yaml(不走 writeRequirementsSection)
    const target = _metaPath(workspaceRoot)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, 'schemaVersion: 999\n', 'utf8')

    await expect(readAllRequirements(workspaceRoot)).rejects.toMatchObject({
      code: 'yaml-parse-failed',
    })
  })

  it('WorkspaceMetaError(cross-check-failed)只在 ensureMeta 触发 — store read 不触发', async () => {
    // 验证 read path 不做 cross-check:即使 workspace.path 不一致,
    // readAllRequirements 仍能正确读出 requirements 段。
    // (cross-check 由 ensureMeta 在写前完成 —— 本测试仅文档化 store 的边界。)
    const target = _metaPath(workspaceRoot)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, YAML.stringify({
      schemaVersion: 2,
      workspace: { id: WORKSPACE_ID, title: 'T', path: '/different/path' },
      skyAxis: { version: '0.1.0', firstInstalledAt: NOW, lastTouchedAt: NOW },
      requirements: {
        '2026-09-08T00:00:00.000Z-aaaa01': makeReq('2026-09-08T00:00:00.000Z-aaaa01' as RequirementId),
      },
    }), 'utf8')

    const section = await readAllRequirements(workspaceRoot)
    expect(Object.keys(section)).toHaveLength(1)
  })
})

/* ── 防御性 / 边界 ── */

describe('防御性', () => {
  it('workspaceRoot 不存在 → readAllRequirements 返回空(不 mkdir)', async () => {
    // 完全不存在的路径
    const section = await readAllRequirements('/tmp/this-does-not-exist-xyz-12345')
    expect(section).toEqual({})
  })

  it('updateRequirements with timeoutMs=50 + 锁被占 → yaml-lock-timeout', async () => {
    await initMeta()
    // 先拿锁不放
    let releaseFirst: () => void = () => undefined
    const firstHeld = new Promise<void>(r => { releaseFirst = r })
    const firstPromise = withFileLock(workspaceRoot, async () => {
      await firstHeld
    })

    // 等 first 持锁
    const lockPath = _internal.lockPath(workspaceRoot)
    const start = Date.now()
    while (Date.now() - start < 1_000) {
      try { await access(lockPath); break } catch { /* not yet */ }
      await new Promise(r => setTimeout(r, 2))
    }

    // 第二个 updateRequirements 应超时
    await expect(updateRequirements(workspaceRoot, ({ current }) => ({
      next: current,
      result: null,
    }), { now: NOW, timeoutMs: 50 })).rejects.toMatchObject({
      code: 'yaml-lock-timeout',
    })

    releaseFirst()
    await firstPromise
  })
})

/* ── 无用 import 抑制 ── */
void WORKSPACE_PATH
void chmod