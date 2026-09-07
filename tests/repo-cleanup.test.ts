/**
 * src/host/repo-cleanup.ts 单元测试。
 *
 * 测试目标(Phase 2.6 v2 决策):
 *   - 清理 repos/ 下符合「UUID 目录名 + .git/ + 未被引用」三条件的孤儿
 *   - 不清理:目录名非 UUID / 缺 .git/ / 被 requirement 引用 / 沙箱外
 *   - liveLocalPaths 为空集时全部跳过(防御性)
 *   - workspaceRoot 不存在时直接返回空
 *
 * Sprint 1 演进(工作区目录结构改造):
 *   - 扫描目录从 `.sky-axis/repos/` 顶层化为 `repos/`。
 *   - liveLocalPaths 集合元素形态同步更新为 `repos/<name>`。
 *   - 用 `SKY_AXIS_REPOS_DIR` 常量拼路径,避免与常量值耦合。
 *
 * 用真 fs 操作(mkdtemp 创建临时 workspace),不走 mock —— 沙箱断言 +
 * 真实 stat 行为都需要 fs 层支持。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupOrphanRepos } from '../src/host/repo-cleanup.ts'
import { SKY_AXIS_REPOS_DIR } from '../src/host/git-service.ts'

/** 创建一个含 .git/ 子目录的"已 clone"目录,模拟 sky-axis clone 产物。 */
async function makeClonedRepo(workspaceRoot: string, dirName: string): Promise<string> {
  const dir = join(workspaceRoot, SKY_AXIS_REPOS_DIR, dirName)
  await mkdir(join(dir, '.git'), { recursive: true })
  await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  return dir
}

/** 创建一个目录但不含 .git/(用户手动放的,不应被清理)。 */
async function makeNonGitDir(workspaceRoot: string, dirName: string): Promise<string> {
  const dir = join(workspaceRoot, SKY_AXIS_REPOS_DIR, dirName)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'random.txt'), 'user placed this')
  return dir
}

/** 拼出 liveLocalPaths 集合元素的标准形态(Sprint 1:`repos/<name>`)。 */
function livePath(dirName: string): string {
  return `${SKY_AXIS_REPOS_DIR}/${dirName}`
}

let workspaceRoot: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'sky-axis-cleanup-'))
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
})

describe('cleanupOrphanRepos', () => {
  it('workspaceRoot 不存在时返回空', async () => {
    const result = await cleanupOrphanRepos('/nonexistent/path', new Set())
    expect(result.removed).toEqual([])
    expect(result.scanned).toBe(0)
  })

  it('repos/ 不存在时返回空', async () => {
    const result = await cleanupOrphanRepos(workspaceRoot, new Set())
    expect(result.removed).toEqual([])
    expect(result.scanned).toBe(0)
  })

  it('清理符合全部三条件的 UUID 孤儿', async () => {
    const orphan = await makeClonedRepo(workspaceRoot, '10831e16-462c-46eb-8732-a873cf43bb77')
    const live = await makeClonedRepo(workspaceRoot, 'mini_harness')
    const result = await cleanupOrphanRepos(workspaceRoot, new Set([livePath('mini_harness')]))
    expect(result.removed).toEqual([livePath('10831e16-462c-46eb-8732-a873cf43bb77')])
    expect(result.scanned).toBe(2)
    // orphan 应被删
    const { access } = await import('node:fs/promises')
    await expect(access(orphan)).rejects.toThrow()
    // live 应保留
    await expect(access(live)).resolves.toBeUndefined()
  })

  it('不清理被 requirement 引用的目录(即使 UUID + .git/)', async () => {
    const liveUuid = await makeClonedRepo(workspaceRoot, '10831e16-462c-46eb-8732-a873cf43bb77')
    const result = await cleanupOrphanRepos(
      workspaceRoot,
      new Set([livePath('10831e16-462c-46eb-8732-a873cf43bb77')]),
    )
    expect(result.removed).toEqual([])
    const { access } = await import('node:fs/promises')
    await expect(access(liveUuid)).resolves.toBeUndefined()
  })

  it('不清理非 UUID 形态目录(项目名形式保留,即使未被引用)', async () => {
    const repoNamed = await makeClonedRepo(workspaceRoot, 'mini_harness')
    const result = await cleanupOrphanRepos(workspaceRoot, new Set())
    // liveLocalPaths 为空时按规则应该全部跳过,但目录名不是 UUID 形态时直接 short-circuit
    expect(result.removed).toEqual([])
    const { access } = await import('node:fs/promises')
    await expect(access(repoNamed)).resolves.toBeUndefined()
  })

  it('不清理缺 .git/ 的目录(用户手动放的,即使 UUID 形态)', async () => {
    const userDir = await makeNonGitDir(workspaceRoot, '10831e16-462c-46eb-8732-a873cf43bb77')
    const result = await cleanupOrphanRepos(workspaceRoot, new Set())
    expect(result.removed).toEqual([])
    const { access } = await import('node:fs/promises')
    await expect(access(userDir)).resolves.toBeUndefined()
  })

  it('liveLocalPaths 为空集(无 requirement)→ 清掉所有 UUID 孤儿', async () => {
    // 空集语义:没有任何 requirement,所有 UUID 形态的目录都视为孤儿
    await makeClonedRepo(workspaceRoot, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    await makeClonedRepo(workspaceRoot, '11111111-2222-3333-4444-555555555555')
    const result = await cleanupOrphanRepos(workspaceRoot, new Set())
    expect(result.removed.sort()).toEqual([
      livePath('11111111-2222-3333-4444-555555555555'),
      livePath('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
    ])
    expect(result.scanned).toBe(2)
  })

  it('混合场景:UUID 孤儿 + UUID 被引用 + 项目名 + 非 git —— 只删孤儿', async () => {
    const orphan = await makeClonedRepo(workspaceRoot, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    await makeClonedRepo(workspaceRoot, '11111111-2222-3333-4444-555555555555')
    await makeClonedRepo(workspaceRoot, 'mini_harness')
    await makeNonGitDir(workspaceRoot, 'user-dir')

    const result = await cleanupOrphanRepos(
      workspaceRoot,
      new Set([livePath('11111111-2222-3333-4444-555555555555')]),
    )
    expect(result.removed).toEqual([livePath('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')])
    expect(result.scanned).toBe(4)

    const { access } = await import('node:fs/promises')
    await expect(access(orphan)).rejects.toThrow()
    await expect(access(join(workspaceRoot, SKY_AXIS_REPOS_DIR, '11111111-2222-3333-4444-555555555555'))).resolves.toBeUndefined()
    await expect(access(join(workspaceRoot, SKY_AXIS_REPOS_DIR, 'mini_harness'))).resolves.toBeUndefined()
    await expect(access(join(workspaceRoot, SKY_AXIS_REPOS_DIR, 'user-dir'))).resolves.toBeUndefined()
  })
})