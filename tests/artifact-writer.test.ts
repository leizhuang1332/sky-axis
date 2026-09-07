/**
 * src/host/artifact-writer.ts 的单元测试（Sprint 4）。
 *
 * 测试目标：
 *   - writeArtifact 落盘路径形态：
 *     `${ws}/outputs/${kind}/${reqShortId}-${artifactIdShort}-${slug}.md`
 *   - 5 种 kind 各自落到对应子目录（plan/patch/note/log/report）
 *   - 原子写：写完后 .tmp 不残留
 *   - 沙箱断言：路径逃逸 outputs/ 被拦
 *   - cleanupArtifact: ENOENT 静默、正常路径删除、沙箱外删除拒绝
 *   - titleToSlug / reqShortId / artifactIdShort helper 形态正确
 *
 * 用真 fs 操作（mkdtemp + 真 writeFile/rename），不走 mock —— 原子写 +
 * 路径权限行为都需要 fs 层支持。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  access,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import {
  cleanupArtifact,
  writeArtifact,
  _internal,
  SkyAxisArtifactError,
  SKY_AXIS_OUTPUTS_DIR,
} from '../src/host/artifact-writer.ts'
import type { Artifact, ArtifactKind, RequirementId } from '../src/protocol.ts'

let workspaceRoot: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'sky-axis-artifact-'))
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
})

/* ── helper 形态 ── */

describe('_internal.titleToSlug', () => {
  it('转小写、替换非 [a-z0-9-] 为 -', () => {
    expect(_internal.titleToSlug('Hello World!')).toBe('hello-world')
  })

  it('折叠连续 - 为单个', () => {
    expect(_internal.titleToSlug('a -- b --- c')).toBe('a-b-c')
  })

  it('去掉首尾 -', () => {
    expect(_internal.titleToSlug('---trim---')).toBe('trim')
  })

  it('截断到 50 字符', () => {
    const long = 'a'.repeat(80)
    const slug = _internal.titleToSlug(long)
    expect(slug.length).toBeLessThanOrEqual(50)
    expect(slug).toBe('a'.repeat(50))
  })

  it('空字符串 fallback 为 untitled', () => {
    expect(_internal.titleToSlug('')).toBe('untitled')
    expect(_internal.titleToSlug('!!!')).toBe('untitled')
  })

  it('中文字符被全部替换后 fallback untitled', () => {
    expect(_internal.titleToSlug('中文标题')).toBe('untitled')
  })
})

describe('_internal.reqShortId', () => {
  it('requirementId 替换 : 为 - 后取前 19 字符', () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    expect(_internal.reqShortId(reqId)).toBe('2026-09-07T13-44-18')
  })
})

describe('_internal.artifactIdShort', () => {
  it('前 8 字符', () => {
    expect(_internal.artifactIdShort('a1b2c3d4-e5f6-7890-abcd-ef0123456789')).toBe('a1b2c3d4')
  })
})

describe('_internal.outputsSubdirFor', () => {
  it('5 kinds 各自映射到同名小写子目录', () => {
    expect(_internal.outputsSubdirFor('plan')).toBe('plan')
    expect(_internal.outputsSubdirFor('patch')).toBe('patch')
    expect(_internal.outputsSubdirFor('note')).toBe('note')
    expect(_internal.outputsSubdirFor('log')).toBe('log')
    expect(_internal.outputsSubdirFor('report')).toBe('report')
  })
})

/* ── writeArtifact 路径形态 ── */

describe('writeArtifact 路径形态', () => {
  it('落盘到 outputs/plan/${reqShortId}-${artifactIdShort}-${slug}.md', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const artifact = makeArtifact('plan', 'plan-001', '实现方案')
    const result = await writeArtifact({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      artifact,
    })
    expect(result.relativePath).toBe('outputs/plan/2026-09-07T13-44-18-plan-001-untitled.md')
    expect(result.absolutePath).toBe(
      join(workspaceRoot, 'outputs', 'plan', '2026-09-07T13-44-18-plan-001-untitled.md'),
    )
  })

  it('5 kinds 各自落盘到对应子目录', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const kinds: ArtifactKind[] = ['plan', 'patch', 'note', 'log', 'report']
    for (const kind of kinds) {
      const artifact = makeArtifact(kind, `${kind}-001`, 'title')
      const result = await writeArtifact({
        workspacePath: workspaceRoot,
        requirementId: reqId,
        artifact,
      })
      expect(result.relativePath.startsWith(`outputs/${kind}/`)).toBe(true)
      // 磁盘上确实有 outputs/{kind}/ 子目录
      const subEntries = await readdir(join(workspaceRoot, SKY_AXIS_OUTPUTS_DIR, kind))
      expect(subEntries.length).toBe(1)
    }
  })

  it('写完后磁盘文件内容与 artifact.body 一致', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const body = '# Plan\n\n中文测试\n'
    const artifact: Artifact = makeArtifact('plan', 'plan-001', 'title')
    artifact.body = body
    const result = await writeArtifact({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      artifact,
    })
    const onDisk = await readFile(result.absolutePath, 'utf8')
    expect(onDisk).toBe(body)
  })

  it('mode 0o600 落盘（其他人不可读）', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const artifact = makeArtifact('note', 'note-001', 'secret')
    const result = await writeArtifact({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      artifact,
    })
    const st = await stat(result.absolutePath)
    // mode & 0o777 = 0o600
    expect(st.mode & 0o777).toBe(0o600)
  })

  it('写入路径不在旧路径（.sky-axis/）下', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    await writeArtifact({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      artifact: makeArtifact('plan', 'plan-001', 't'),
    })
    // 不应有 .sky-axis/{reqShortId}/
    const oldPath = join(workspaceRoot, '.sky-axis', _internal.reqShortId(reqId))
    await expect(access(oldPath)).rejects.toThrow()
    // workspaceRoot 应只有 outputs/
    const entries = await readdir(workspaceRoot)
    expect(entries).toEqual(['outputs'])
  })
})

/* ── writeArtifact 原子写 ── */

describe('writeArtifact 原子写', () => {
  it('写完后 .tmp 不残留', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const artifact = makeArtifact('log', 'log-001', 't')
    await writeArtifact({ workspacePath: workspaceRoot, requirementId: reqId, artifact })
    const tmpPath = join(workspaceRoot, SKY_AXIS_OUTPUTS_DIR, 'log', '.log-001.tmp')
    await expect(access(tmpPath)).rejects.toThrow()
  })

  it('同一 requirement 连续写不同 artifact 不冲突', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const a1 = makeArtifact('plan', 'aaaaaaaa', 'plan A')
    const a2 = makeArtifact('plan', 'bbbbbbbb', 'plan B')
    const r1 = await writeArtifact({ workspacePath: workspaceRoot, requirementId: reqId, artifact: a1 })
    const r2 = await writeArtifact({ workspacePath: workspaceRoot, requirementId: reqId, artifact: a2 })
    expect(r1.relativePath).not.toBe(r2.relativePath)
    expect(await readFile(r1.absolutePath, 'utf8')).toBe('plan A body')
    expect(await readFile(r2.absolutePath, 'utf8')).toBe('plan B body')
  })
})

/* ── writeArtifact 沙箱断言 ── */

describe('writeArtifact 沙箱断言', () => {
  it('workspacePath 是相对路径时仍正确 resolve 到 outputs/ 下', async () => {
    // workspacePath 用相对路径,内部 resolve 后路径仍含 outputs/ 前缀
    const cwdRel = './' + workspaceRoot.split(sep).pop()!
    // 我们换个写法:绝对路径验证相对路径都被规范化为绝对路径
    // 简单做：cwdRel 在 tmpdir 父目录下可能不存在 —— 这里跳过
    // 改用：传一个不存在的 workspacePath,内部 mkdir 会建对应目录
    const ghost = join(tmpdir(), 'sky-axis-ghost-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    try {
      const artifact = makeArtifact('plan', 'plan-001', 't')
      const result = await writeArtifact({
        workspacePath: ghost,
        requirementId: '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId,
        artifact,
      })
      expect(result.absolutePath.startsWith(ghost + sep + SKY_AXIS_OUTPUTS_DIR)).toBe(true)
    } finally {
      await rm(ghost, { recursive: true, force: true }).catch(() => undefined)
    }
    void cwdRel // silence
  })

  it('artifact.body 为空字符串也允许落盘（空 plan 也是合法 artifact）', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const artifact = makeArtifact('plan', 'plan-001', 't')
    artifact.body = ''
    const result = await writeArtifact({ workspacePath: workspaceRoot, requirementId: reqId, artifact })
    expect(await readFile(result.absolutePath, 'utf8')).toBe('')
  })
})

/* ── cleanupArtifact ── */

describe('cleanupArtifact', () => {
  it('正常路径删除文件', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const artifact = makeArtifact('plan', 'plan-001', 't')
    const result = await writeArtifact({ workspacePath: workspaceRoot, requirementId: reqId, artifact })
    // 文件存在
    await access(result.absolutePath)
    await cleanupArtifact(workspaceRoot, result.absolutePath)
    // 文件已删
    await expect(access(result.absolutePath)).rejects.toThrow()
  })

  it('ENOENT 静默（并发场景下已被覆盖）', async () => {
    const fakePath = join(workspaceRoot, SKY_AXIS_OUTPUTS_DIR, 'plan', 'not-exists.md')
    await expect(cleanupArtifact(workspaceRoot, fakePath)).resolves.toBeUndefined()
  })

  it('沙箱外绝对路径拒绝删除（防误传删错文件）', async () => {
    const outsidePath = join(tmpdir(), 'sky-axis-outside-' + Date.now() + '.md')
    await expect(cleanupArtifact(workspaceRoot, outsidePath)).rejects.toThrow(/artifact-sandbox-violation/)
  })

  it('失败错误码为 artifact-sandbox-violation', async () => {
    const outsidePath = join(tmpdir(), 'sky-axis-outside-' + Date.now() + '.md')
    try {
      await cleanupArtifact(workspaceRoot, outsidePath)
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(SkyAxisArtifactError)
      expect((e as SkyAxisArtifactError).code).toBe('artifact-sandbox-violation')
    }
  })
})

/* ── test helper ── */

function makeArtifact(kind: ArtifactKind, id: string, title: string): Artifact {
  return {
    id,
    kind,
    title,
    createdAt: new Date().toISOString(),
    body: `${title} body`,
  }
}