/**
 * src/host/requirement-service.ts 中物料文件落盘相关 helper 的单元测试。
 *
 * 测试目标（Sprint 3：工作区目录结构改造）：
 *   - writeMaterialFile 落盘路径形态：
 *     `${ws}/inputs/${sectionInputsDir}/${reqShortId}-${itemIdShort}-${sanitized}`
 *   - writeMaterialFile 4 个 link 类 section 抛错（防御性 —— 它们不该落盘）
 *   - writeMaterialFile 原子写：写完后 .tmp 不残留
 *   - writeMaterialFile sanitize：路径 traversal 字符被剔除
 *   - writeMaterialFile 沙箱断言：escape 攻击被拦
 *   - ensureInputsLayout 一次性建 inputs/{prd,attachment}/
 *   - ensureInputsLayout 幂等（已存在目录 no-op）
 *   - reqShortId / itemIdShort / sectionInputsDirName helper 形态正确
 *
 * 用真 fs 操作（mkdtemp + 真 writeFile/rename），不走 mock —— 原子写 +
 * 路径权限行为都需要 fs 层支持。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  access,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import {
  ensureInputsLayout,
  itemIdShort,
  materialInputsDir,
  reqShortId,
  sectionInputsDirName,
  writeMaterialFile,
} from '../src/host/requirement-service.ts'
import type { MaterialItemId, RequirementId } from '../src/protocol.ts'

let workspaceRoot: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'sky-axis-material-'))
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
})

/* ── helper 形态 ── */

describe('sectionInputsDirName', () => {
  it('prdFiles → "prd"', () => {
    expect(sectionInputsDirName('prdFiles')).toBe('prd')
  })

  it('attachments → "attachment"', () => {
    expect(sectionInputsDirName('attachments')).toBe('attachment')
  })

  it('4 个 link 类 section 抛错（防御性）', () => {
    expect(() => sectionInputsDirName('prdLinks')).toThrow(/link-only/)
    expect(() => sectionInputsDirName('sourceRepos')).toThrow(/link-only/)
    expect(() => sectionInputsDirName('designLinks')).toThrow(/link-only/)
    expect(() => sectionInputsDirName('externalLinks')).toThrow(/link-only/)
  })
})

describe('reqShortId', () => {
  it('requirementId 替换 `:` 为 `-` 后取前 19 字符', () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    // 前 19 字符 = `2026-09-07T13-44-18`（到秒，冒号已被替换）
    expect(reqShortId(reqId)).toBe('2026-09-07T13-44-18')
  })

  it('长度恰好 19 字符', () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    expect(reqShortId(reqId).length).toBe(19)
  })
})

describe('itemIdShort', () => {
  it('UUID 前 8 字符', () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' as MaterialItemId
    expect(itemIdShort(id)).toBe('a1b2c3d4')
  })

  it('长度恰好 8 字符', () => {
    const id = '11111111-2222-3333-4444-555555555555' as MaterialItemId
    expect(itemIdShort(id).length).toBe(8)
  })
})

/* ── ensureInputsLayout ── */

describe('ensureInputsLayout', () => {
  it('一次性建 inputs/{prd,attachment}/ 空目录', async () => {
    await ensureInputsLayout(workspaceRoot)
    const entries = await readdir(join(workspaceRoot, 'inputs'))
    expect(entries.sort()).toEqual(['attachment', 'prd'])
    // 都是 directory
    for (const name of entries) {
      const st = await stat(join(workspaceRoot, 'inputs', name))
      expect(st.isDirectory()).toBe(true)
    }
  })

  it('inputs/ 已存在 → 不报错，幂等 no-op', async () => {
    // 先建 inputs/ 但不建子目录
    await mkdir(join(workspaceRoot, 'inputs'), { recursive: true })
    await ensureInputsLayout(workspaceRoot)
    const entries = await readdir(join(workspaceRoot, 'inputs'))
    expect(entries.sort()).toEqual(['attachment', 'prd'])
  })

  it('重复调用 3 次不报错', async () => {
    await ensureInputsLayout(workspaceRoot)
    await ensureInputsLayout(workspaceRoot)
    await ensureInputsLayout(workspaceRoot)
    const entries = await readdir(join(workspaceRoot, 'inputs'))
    expect(entries.sort()).toEqual(['attachment', 'prd'])
  })
})

/* ── writeMaterialFile ── */

describe('writeMaterialFile 路径形态', () => {
  it('prdFiles 落盘到 inputs/prd/${reqShortId}-${itemIdShort}-${filename}', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const itemId = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' as MaterialItemId
    const result = await writeMaterialFile({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      section: 'prdFiles',
      itemId,
      filename: 'prd.md',
      content: Buffer.from('# PRD'),
    })
    expect(result.relativePath).toBe(`inputs/prd/2026-09-07T13-44-18-a1b2c3d4-prd.md`)
    expect(result.absolutePath).toBe(
      join(workspaceRoot, 'inputs', 'prd', '2026-09-07T13-44-18-a1b2c3d4-prd.md'),
    )
  })

  it('attachments 落盘到 inputs/attachment/${reqShortId}-${itemIdShort}-${filename}', async () => {
    const reqId = '2026-09-08T00:00:00.000Z-aaaaaa' as RequirementId
    const itemId = '11111111-2222-3333-4444-555555555555' as MaterialItemId
    const result = await writeMaterialFile({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      section: 'attachments',
      itemId,
      filename: '原型.png',
      content: Buffer.from('binary'),
    })
    expect(result.relativePath).toBe(`inputs/attachment/2026-09-08T00-00-00-11111111-原型.png`)
    expect(result.absolutePath).toBe(
      join(workspaceRoot, 'inputs', 'attachment', '2026-09-08T00-00-00-11111111-原型.png'),
    )
  })

  it('写完后磁盘文件内容与入参一致', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const itemId = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' as MaterialItemId
    const content = Buffer.from('# PRD body 中文测试', 'utf8')
    const result = await writeMaterialFile({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      section: 'prdFiles',
      itemId,
      filename: 'prd.md',
      content,
    })
    const onDisk = await readFile(result.absolutePath, 'utf8')
    expect(onDisk).toBe('# PRD body 中文测试')
  })

  it('写入路径不在旧路径（.sky-axis/）下', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const itemId = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' as MaterialItemId
    await writeMaterialFile({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      section: 'prdFiles',
      itemId,
      filename: 'prd.md',
      content: Buffer.from(''),
    })
    // 不应有 .sky-axis/{reqId}/
    const oldPath = join(workspaceRoot, '.sky-axis', reqShortId(reqId))
    await expect(access(oldPath)).rejects.toThrow()
    // 也不应有 .sky-axis/{reqId}/prdFiles/
    const oldSectionPath = join(workspaceRoot, '.sky-axis', reqShortId(reqId), 'prdFiles')
    await expect(access(oldSectionPath)).rejects.toThrow()
  })
})

describe('writeMaterialFile 原子写', () => {
  it('写完后 .tmp 不残留', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const itemId = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' as MaterialItemId
    await writeMaterialFile({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      section: 'prdFiles',
      itemId,
      filename: 'prd.md',
      content: Buffer.from(''),
    })
    const tmpPath = join(workspaceRoot, 'inputs', 'prd', '.a1b2c3d4.tmp')
    await expect(access(tmpPath)).rejects.toThrow()
  })

  it('同一 section 连续写两个文件不冲突', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const itemA = 'aaaaaaaa-1111-2222-3333-444444444444' as MaterialItemId
    const itemB = 'bbbbbbbb-1111-2222-3333-444444444444' as MaterialItemId
    const r1 = await writeMaterialFile({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      section: 'prdFiles',
      itemId: itemA,
      filename: 'prd.md',
      content: Buffer.from('A'),
    })
    const r2 = await writeMaterialFile({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      section: 'prdFiles',
      itemId: itemB,
      filename: 'prd.md',
      content: Buffer.from('B'),
    })
    expect(r1.relativePath).not.toBe(r2.relativePath)
    expect(await readFile(r1.absolutePath, 'utf8')).toBe('A')
    expect(await readFile(r2.absolutePath, 'utf8')).toBe('B')
  })
})

describe('writeMaterialFile 文件名 sanitize', () => {
  it('剔除 path traversal 字符（/ 与 \\）', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const itemId = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' as MaterialItemId
    const result = await writeMaterialFile({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      section: 'prdFiles',
      itemId,
      filename: '../../etc/passwd',
      content: Buffer.from('evil'),
    })
    // 路径仍应在 inputs/prd/ 下,没有 ../ 逃逸
    expect(result.absolutePath.startsWith(join(workspaceRoot, 'inputs', 'prd') + sep)).toBe(true)
    // 文件名不含 ..
    expect(result.absolutePath).not.toContain('..')
  })

  it('剔除控制字符', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const itemId = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' as MaterialItemId
    const result = await writeMaterialFile({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      section: 'prdFiles',
      itemId,
      filename: 'pre\x00\x01\x02post.md',
      content: Buffer.from(''),
    })
    // 文件名不含 \x00
    expect(result.absolutePath).not.toMatch(/[\x00-\x1f]/)
  })

  it('空文件名 → 兜底为 "unnamed"', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const itemId = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' as MaterialItemId
    const result = await writeMaterialFile({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      section: 'prdFiles',
      itemId,
      filename: '',
      content: Buffer.from(''),
    })
    expect(result.relativePath).toMatch(/unnamed$/)
  })

  it('中文文件名原样保留', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const itemId = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' as MaterialItemId
    const result = await writeMaterialFile({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      section: 'prdFiles',
      itemId,
      filename: '产品需求文档.md',
      content: Buffer.from(''),
    })
    expect(result.relativePath).toMatch(/产品需求文档\.md$/)
  })
})

describe('writeMaterialFile link section 拒绝', () => {
  it('4 个 link 类 section 抛错', async () => {
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const itemId = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' as MaterialItemId
    for (const section of ['prdLinks', 'sourceRepos', 'designLinks', 'externalLinks'] as const) {
      await expect(writeMaterialFile({
        workspacePath: workspaceRoot,
        requirementId: reqId,
        section,
        itemId,
        filename: 'x.md',
        content: Buffer.from(''),
      })).rejects.toThrow(/link-only/)
    }
  })
})

describe('writeMaterialFile 沙箱断言', () => {
  it('沙箱逃逸 attack 不直接命中（resolve 后拒绝）', async () => {
    // writeMaterialFile 内部 path 算法 + 沙箱断言共同防御 —— 这里只是间接验证
    // （filenames 经过 sanitize,无法直接构造 escape 路径）
    // 直接验证 inputs/ 外无文件
    const reqId = '2026-09-07T13:44:18.939Z-6hcwlt' as RequirementId
    const itemId = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' as MaterialItemId
    await writeMaterialFile({
      workspacePath: workspaceRoot,
      requirementId: reqId,
      section: 'prdFiles',
      itemId,
      filename: 'prd.md',
      content: Buffer.from(''),
    })
    // 工作区根目录不应该有 prd.md（应在 inputs/prd/ 下）
    await expect(access(join(workspaceRoot, 'prd.md'))).rejects.toThrow()
    // 也不应有 inputs/ 之外的 .md
    const entries = await readdir(workspaceRoot)
    expect(entries).toEqual(['inputs'])
  })
})

/* ── materialInputsDir helper ── */

describe('materialInputsDir', () => {
  it('prdFiles → ${ws}/inputs/prd', () => {
    expect(materialInputsDir(workspaceRoot, 'prdFiles')).toBe(
      join(workspaceRoot, 'inputs', 'prd'),
    )
  })

  it('attachments → ${ws}/inputs/attachment', () => {
    expect(materialInputsDir(workspaceRoot, 'attachments')).toBe(
      join(workspaceRoot, 'inputs', 'attachment'),
    )
  })
})