/**
 * src/host/workspace-meta.ts 单元测试。
 *
 * 测试目标（Sprint 2：工作区目录结构改造）：
 *   - readMeta 行为：
 *     - 文件不存在 → throws WorkspaceMetaError('missing')
 *     - YAML 语法错 → throws WorkspaceMetaError('invalid')
 *     - zod schema 不匹配 → throws WorkspaceMetaError('invalid')
 *     - 文件读失败（非 ENOENT）→ throws WorkspaceMetaError('io-failed')
 *   - ensureMeta 行为：
 *     - 首次调用 → 写默认值（firstInstalledAt == lastTouchedAt == now）
 *     - 二次调用 → 保留 firstInstalledAt，更新 lastTouchedAt
 *     - cross-check fail（workspaceId / workspacePath 不一致）→ throws 'cross-check-failed'
 *   - 原子写：写完后磁盘上不存在 .tmp 残留
 *   - 幂等性：连续两次 ensureMeta 不报错
 *
 * 用真 fs 操作（mkdtemp + 真 writeFile/rename），不走 mock —— 原子写 + 权限
 * 行为都需要 fs 层支持。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import {
  defaultWorkspaceMeta,
  SKY_AXIS_META_FILENAME,
  WorkspaceMetaError,
  WorkspaceMetaSchema,
  _metaPath,
  readMeta,
  ensureMeta,
  type WorkspaceMeta,
} from '../src/host/workspace-meta.ts'

let workspaceRoot: string
const NOW = '2026-09-08T00:00:00.000Z'
const LATER = '2026-09-08T01:00:00.000Z'
const WORKSPACE_ID = 'ws-test-001' as unknown as Parameters<typeof ensureMeta>[1]['workspaceId']
const SKY_AXIS_VERSION = '0.1.0'

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'sky-axis-meta-'))
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
})

/** 构造 ensureMeta 入参的 helper,默认值与 NOW 对齐。 */
function makeOpts(overrides: Partial<Parameters<typeof ensureMeta>[1]> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    workspaceTitle: 'Test Workspace',
    skyAxisVersion: SKY_AXIS_VERSION,
    now: NOW,
    ...overrides,
  }
}

describe('readMeta', () => {
  it('mate.yaml 不存在 → throws missing', async () => {
    await expect(readMeta(workspaceRoot)).rejects.toMatchObject({
      code: 'missing',
    })
  })

  it('mate.yaml 是损坏的 YAML → throws invalid', async () => {
    const target = _metaPath(workspaceRoot)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, 'this is: not: valid: yaml: ::\n  bad indent\n', 'utf8')
    await expect(readMeta(workspaceRoot)).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  it('mate.yaml 缺字段 → throws invalid', async () => {
    const target = _metaPath(workspaceRoot)
    await mkdir(join(target, '..'), { recursive: true })
    // 缺 skyAxis 整段
    await writeFile(target, YAML.stringify({
      schemaVersion: 1,
      workspace: { id: 'ws-x', title: 't', path: workspaceRoot },
    }), 'utf8')
    await expect(readMeta(workspaceRoot)).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  it('mate.yaml schemaVersion 不匹配（升级未迁移的旧版）→ throws invalid', async () => {
    const target = _metaPath(workspaceRoot)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, YAML.stringify({
      schemaVersion: 999,
      workspace: { id: 'ws-x', title: 't', path: workspaceRoot },
      skyAxis: { version: '0.1.0', firstInstalledAt: NOW, lastTouchedAt: NOW },
    }), 'utf8')
    await expect(readMeta(workspaceRoot)).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  it('工作区根路径无读权限 → throws io-failed', async () => {
    // skip on platforms where chmod 0o000 不阻止 root（macOS root 用户跳过）
    if (process.getuid && process.getuid() === 0) {
      // eslint-disable-next-line no-console
      console.warn('[test] skipping chmod 0o000 test: running as root')
      return
    }
    const target = _metaPath(workspaceRoot)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, YAML.stringify({
      schemaVersion: 1,
      workspace: { id: 'ws-x', title: 't', path: workspaceRoot },
      skyAxis: { version: '0.1.0', firstInstalledAt: NOW, lastTouchedAt: NOW },
    }), 'utf8')
    await chmod(workspaceRoot, 0o000)
    try {
      await expect(readMeta(workspaceRoot)).rejects.toMatchObject({
        code: 'io-failed',
      })
    } finally {
      await chmod(workspaceRoot, 0o755).catch(() => undefined)
    }
  })
})

describe('ensureMeta', () => {
  it('首次调用：写默认值，firstInstalledAt == lastTouchedAt == now', async () => {
    const meta = await ensureMeta(workspaceRoot, makeOpts())
    expect(meta).toEqual({
      schemaVersion: 2,
      workspace: { id: WORKSPACE_ID, title: 'Test Workspace', path: workspaceRoot },
      skyAxis: {
        version: SKY_AXIS_VERSION,
        firstInstalledAt: NOW,
        lastTouchedAt: NOW,
      },
      requirements: {},
    })
    // 文件确实写到磁盘了
    await expect(access(_metaPath(workspaceRoot))).resolves.toBeUndefined()
  })

  it('二次调用：保留 firstInstalledAt，更新 lastTouchedAt', async () => {
    const first = await ensureMeta(workspaceRoot, makeOpts())
    expect(first.skyAxis.firstInstalledAt).toBe(NOW)
    expect(first.skyAxis.lastTouchedAt).toBe(NOW)

    // 用 LATER 时间再调,firstInstalledAt 应保留
    const second = await ensureMeta(workspaceRoot, makeOpts({ now: LATER }))
    expect(second.skyAxis.firstInstalledAt).toBe(NOW)
    expect(second.skyAxis.lastTouchedAt).toBe(LATER)
    expect(second.workspace.id).toBe(WORKSPACE_ID)
  })

  it('v1 现有 mate.yaml → ensureMeta 升级到 v2，requirements 段初始化空 record', async () => {
    // 先写一个 v1 mate.yaml
    const target = _metaPath(workspaceRoot)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, YAML.stringify({
      schemaVersion: 1,
      workspace: { id: WORKSPACE_ID, title: 'Old Title', path: workspaceRoot },
      skyAxis: { version: '0.0.1', firstInstalledAt: NOW, lastTouchedAt: NOW },
    }), 'utf8')

    const meta = await ensureMeta(workspaceRoot, makeOpts())
    expect(meta.schemaVersion).toBe(2)
    expect(meta.workspace.title).toBe('Test Workspace')  // 跟随最新 caller
    expect(meta.skyAxis.firstInstalledAt).toBe(NOW)       // 保留 v1 字段
    expect(meta.requirements).toEqual({})
  })

  it('cross-check fail：现有 mate.yaml 的 workspacePath 与 caller 不一致 → throws cross-check-failed', async () => {
    // 先写 workspaceRoot 的 mate.yaml
    await ensureMeta(workspaceRoot, makeOpts())

    // 把同一个 mate.yaml copy 到 otherRoot,但路径字段不一致
    //   → readMeta(otherRoot) 命中 existing 分支 → cross-check 检查 workspace.path != otherRoot
    const otherRoot = await mkdtemp(join(tmpdir(), 'sky-axis-meta-other-'))
    try {
      const otherMetaDir = join(otherRoot, '.sky-axis')
      await mkdir(otherMetaDir, { recursive: true })
      const originalRaw = await readFile(_metaPath(workspaceRoot), 'utf8')
      await writeFile(_metaPath(otherRoot), originalRaw, 'utf8')

      await expect(ensureMeta(otherRoot, makeOpts({
        workspaceId: WORKSPACE_ID,
      }))).rejects.toMatchObject({
        code: 'cross-check-failed',
      })
    } finally {
      await rm(otherRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  it('cross-check fail：现有 mate.yaml 的 workspaceId 与 caller 不一致 → throws cross-check-failed', async () => {
    await ensureMeta(workspaceRoot, makeOpts())
    await expect(ensureMeta(workspaceRoot, makeOpts({
      workspaceId: 'ws-different' as unknown as typeof WORKSPACE_ID,
    }))).rejects.toMatchObject({
      code: 'cross-check-failed',
    })
  })

  it('现有 mate.yaml 损坏 → throws invalid（不静默修复）', async () => {
    // 先写一个损坏文件
    const target = _metaPath(workspaceRoot)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, 'broken: : yaml: ::\n', 'utf8')

    await expect(ensureMeta(workspaceRoot, makeOpts())).rejects.toMatchObject({
      code: 'invalid',
    })
  })

  it('原子写：写完后磁盘上无 .tmp 残留', async () => {
    await ensureMeta(workspaceRoot, makeOpts())
    const target = _metaPath(workspaceRoot)
    const tmp = `${target}.tmp`
    await expect(access(tmp)).rejects.toThrow()
  })

  it('写入的 YAML 是合法格式（可独立 parse）', async () => {
    await ensureMeta(workspaceRoot, makeOpts())
    const raw = await readFile(_metaPath(workspaceRoot), 'utf8')
    const parsed = YAML.parse(raw) as unknown
    // zod 再 parse 一遍验证完整性
    const result = WorkspaceMetaSchema.safeParse(parsed)
    expect(result.success).toBe(true)
  })

  it('可重复调用 5 次不报错', async () => {
    for (let i = 0; i < 5; i++) {
      await ensureMeta(workspaceRoot, makeOpts({ now: new Date(Date.parse(NOW) + i * 1000).toISOString() }))
    }
    const meta = await readMeta(workspaceRoot)
    expect(meta.workspace.id).toBe(WORKSPACE_ID)
    expect(meta.skyAxis.firstInstalledAt).toBe(NOW)
  })
})

describe('defaultWorkspaceMeta 工厂', () => {
  it('构造的字段全部对齐入参', () => {
    const meta: WorkspaceMeta = defaultWorkspaceMeta({
      workspaceId: WORKSPACE_ID,
      workspaceTitle: 'X',
      workspacePath: '/tmp/x',
      skyAxisVersion: '0.2.0',
      now: NOW,
    })
    expect(meta.schemaVersion).toBe(2)
    expect(meta.workspace).toEqual({ id: WORKSPACE_ID, title: 'X', path: '/tmp/x' })
    expect(meta.skyAxis).toEqual({
      version: '0.2.0',
      firstInstalledAt: NOW,
      lastTouchedAt: NOW,
    })
    // v2 新增:空 requirements record
    expect(meta.requirements).toEqual({})
  })

  it('写出的 firstInstalledAt == lastTouchedAt == now', () => {
    const meta = defaultWorkspaceMeta({
      workspaceId: WORKSPACE_ID,
      workspaceTitle: 'X',
      workspacePath: '/tmp/x',
      skyAxisVersion: '0.2.0',
      now: NOW,
    })
    expect(meta.skyAxis.firstInstalledAt).toBe(meta.skyAxis.lastTouchedAt)
    expect(meta.skyAxis.firstInstalledAt).toBe(NOW)
  })
})

describe('常量边界', () => {
  it('SKY_AXIS_META_FILENAME == "mate.yaml"', () => {
    expect(SKY_AXIS_META_FILENAME).toBe('mate.yaml')
  })
})

/* ==== Sprint 5: v2 schema + requirements 段 ==== */

describe('readMeta v2 schema', () => {
  it('v2 文件 + 含 requirements 段 → 解析成功并保留内容', async () => {
    const target = _metaPath(workspaceRoot)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, YAML.stringify({
      schemaVersion: 2,
      workspace: { id: 'ws-x', title: 't', path: workspaceRoot },
      skyAxis: { version: '0.1.0', firstInstalledAt: NOW, lastTouchedAt: NOW },
      requirements: {
        '2026-09-08T00:00:00.000Z-aaaa01': {
          id: '2026-09-08T00:00:00.000Z-aaaa01',
          workspaceId: 'ws-x',
          title: 'demo',
          description: '',
          priority: 'normal',
          status: 'open',
          tags: [],
          createdAt: NOW,
          updatedAt: NOW,
          stage: 'understand',
          stageHistory: [],
          aiState: 'idle',
          aiSessionId: null,
          aiLastActivityAt: null,
          interventionQueue: [],
          artifacts: {},
          branch: null,
          materials: {
            prdFiles: [], prdLinks: [], sourceRepos: [],
            designLinks: [], attachments: [], externalLinks: [],
          },
        },
      },
    }), 'utf8')

    const meta = await readMeta(workspaceRoot)
    expect(meta.schemaVersion).toBe(2)
    if (meta.schemaVersion === 2) {
      expect(Object.keys(meta.requirements)).toHaveLength(1)
      expect(meta.requirements['2026-09-08T00:00:00.000Z-aaaa01'].title).toBe('demo')
    } else {
      throw new Error('expected schemaVersion=2')
    }
  })

  it('v1 文件 + 无 requirements 段 → 解析成功（union v1 分支）', async () => {
    const target = _metaPath(workspaceRoot)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, YAML.stringify({
      schemaVersion: 1,
      workspace: { id: 'ws-x', title: 't', path: workspaceRoot },
      skyAxis: { version: '0.0.1', firstInstalledAt: NOW, lastTouchedAt: NOW },
    }), 'utf8')

    const meta = await readMeta(workspaceRoot)
    expect(meta.schemaVersion).toBe(1)
  })

  it('v2 文件 + requirements 段缺字段 → throws invalid', async () => {
    const target = _metaPath(workspaceRoot)
    await mkdir(join(target, '..'), { recursive: true })
    // requirements 段里塞非法 record（缺 workspaceId）
    await writeFile(target, YAML.stringify({
      schemaVersion: 2,
      workspace: { id: 'ws-x', title: 't', path: workspaceRoot },
      skyAxis: { version: '0.1.0', firstInstalledAt: NOW, lastTouchedAt: NOW },
      requirements: {
        'bad-id': { id: 'bad-id', title: 'x' /* 缺其他 required 字段 */ },
      },
    }), 'utf8')

    await expect(readMeta(workspaceRoot)).rejects.toMatchObject({
      code: 'invalid',
    })
  })
})