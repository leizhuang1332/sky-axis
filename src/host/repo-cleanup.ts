/**
 * sky-axis host 半区 —— 清理 `repos/` 下的历史孤儿目录。
 *
 * 背景：
 *   Phase 2.6 第一次落盘 destDir 时用了 `randomUUID()` 作为目录名,导致
 *   `repos/<uuid>/` 这种目录形态。Phase 2.6 后续修正改为
 *   `extractRepoName(url)` —— 旧 UUID 目录变成孤儿。本模块负责识别
 *   并安全清理这些孤儿。
 *
 * Sprint 1 演进（工作区目录结构改造）：
 *   - 扫描路径从 `.sky-axis/repos/` 改为顶层 `repos/`。
 *   - 返回的 relativeDir 形态同步更新（`repos/<name>`）。
 *   - `liveLocalPaths` 入参的语义不变（相对 workspaceRoot 的 POSIX 路径），
 *     但调用方传值需要相应改成 `repos/...` 形态（与 git-service.clone 返回的
 *     `cloneResult.localPath` 字段保持一致）。
 *
 * 识别规则（必须**全部满足**才算孤儿）：
 *   1. 目录名前缀匹配 `/^[a-f0-9-]{36}$/` —— 仅历史 UUID 形态
 *   2. 目录下存在 `.git/` 子目录 —— 确认是 sky-axis clone 出来的
 *      （用户手动放在这里的目录不会被误删）
 *   3. 目录相对路径 **不在** liveLocalPaths 集合里 —— 没被任何 requirement 引用
 *
 * 安全网：
 *   - 所有候选 destDir 必须通过 `assertSandboxed` 校验
 *   - `liveLocalPaths` 传空集 = 兜底模式（不清任何东西,只扫描）
 *   - 删除失败（权限 / IO 错误）console.warn,不影响其他孤儿清理
 *
 * 触发时机：
 *   host apply 启动后 + storage domain ready 后,跑一次（不阻塞 webServer 启动）。
 */
import { access, readdir, rm, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { SKY_AXIS_REPOS_DIR } from './git-service.ts'

/** UUID v4 目录名正则（8-4-4-4-12 hex + 4 个 `-`，共 36 字符）。 */
const UUID_DIR_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

/** 沙箱断言 —— 与 git-service.assertSandboxed 同源,但这里重新实现一份
 *  因为 git-service 把 assertSandboxed 设为私有。逻辑必须保持一致。 */
function assertSandboxed(workspaceRoot: string, destDir: string): void {
  const root = resolve(workspaceRoot)
  const target = resolve(destDir)
  const expectedPrefix = root + sep + SKY_AXIS_REPOS_DIR + sep
  if (target !== root && !target.startsWith(expectedPrefix)) {
    throw new Error(`orphan cleanup: destDir ${target} escapes sandbox ${expectedPrefix}`)
  }
}

/** 异步判断 path 是否存在（ENOENT 返回 false）。 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * 清理孤儿目录。
 *
 * @param workspaceRoot - workspace 绝对路径
 * @param liveLocalPaths - 当前所有 requirement 引用的 localPath 集合
 *                         （相对 workspaceRoot 的 POSIX 路径,如 `repos/mini_harness`）
 * @returns 被清理的目录相对路径列表（用于日志 / 调试）
 */
export async function cleanupOrphanRepos(
  workspaceRoot: string,
  liveLocalPaths: ReadonlySet<string>,
): Promise<{ removed: string[]; scanned: number }> {
  const reposRoot = join(workspaceRoot, SKY_AXIS_REPOS_DIR)
  if (!await pathExists(reposRoot)) {
    return { removed: [], scanned: 0 }
  }

  const entries = await readdir(reposRoot, { withFileTypes: true }).catch(() => [])
  const removed: string[] = []
  let scanned = 0

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    scanned += 1
    // 规则 1：仅清理 UUID 形态的目录名
    if (!UUID_DIR_RE.test(entry.name)) continue

    const absoluteDir = join(reposRoot, entry.name)
    // 沙箱断言：即使 readdir 只列了根目录的子项,显式 assert 仍是好习惯
    try {
      assertSandboxed(workspaceRoot, absoluteDir)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[sky-axis] orphan cleanup skipped (sandbox violation):', absoluteDir, e)
      continue
    }

    // 规则 2：必须含 .git/ 子目录（确认是 sky-axis clone）
    const gitDir = join(absoluteDir, '.git')
    if (!await pathExists(gitDir)) continue

    // 规则 3：相对路径不在 liveLocalPaths 集合中
    // Sprint 1：relativeDir 形态从 `.sky-axis/repos/${name}` → `${SKY_AXIS_REPOS_DIR}/${name}`
    //          用常量拼接便于后续路径再演进时只需改 SKY_AXIS_REPOS_DIR 一处
    const relativeDir = `${SKY_AXIS_REPOS_DIR}/${entry.name}`
    if (liveLocalPaths.has(relativeDir)) continue

    // 防御性 stat 检查：避免误删符号链接 / 管道 / 普通文件
    try {
      const st = await stat(absoluteDir)
      if (!st.isDirectory()) continue
    } catch {
      continue
    }

    // 全部满足 → 清理
    try {
      await rm(absoluteDir, { recursive: true, force: true })
      removed.push(relativeDir)
      // eslint-disable-next-line no-console
      console.info('[sky-axis] orphan repo removed:', relativeDir)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[sky-axis] orphan repo rm failed:', relativeDir, e)
    }
  }

  return { removed, scanned }
}
