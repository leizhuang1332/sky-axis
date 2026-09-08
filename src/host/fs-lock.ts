/**
 * sky-axis host 半区 —— 跨进程文件锁 helper（YAML-as-SoT 用）。
 *
 * 目的：
 *   - 多个 host 进程(或 host + 外部工具)同时改 `<workspace>/.sky-axis/mate.yaml`
 *     时需要互斥,避免 read-modify-write 丢更新
 *   - 与 `proper-lockfile` 库的算法同源 —— 但本项目不引第三方,手写一个
 *     minimal 实现,覆盖 99% 用例
 *
 * 算法（POSIX link-based lock,与 proper-lockfile 核心算法一致）：
 *   1. 在唯一 sentinel path `lockPath.{pid}.{ts}.{uuid8}` writeFile('wx') 创建文件
 *   2. link sentinel → lockPath —— `link(2)` 在目标已存在时**原子地报 EEXIST**
 *      （注意不能用 rename(2):POSIX rename 会覆盖目标,不报 EEXIST,失去互斥）
 *   3. 如果 EEXIST → unlink sentinel + sleep retryMs 后重试,直到 acquire
 *      成功或超时 / signal
 *   4. fn 跑完后 unlink lockPath(try/finally 保证)
 *
 * 锁粒度:
 *   - 整个 workspace 一个锁 —— 共享同一把 `.sky-axis/.lock`
 *   - 整文件锁够用:mate.yaml < 100KB,read-modify-write 成本 < 5ms
 *
 * 不支持:
 *   - Windows 原生 flock(DSH 是 macOS / Linux 优先;Windows 后续单独 PR)
 *   - stale lock 自动检测(项目假设单一 host 进程;若进程崩溃 lock 残留,
 *     用户可手工 rm `.sky-axis/.lock`)
 *   - 跨 mount point(DSH workspace 都在同一文件系统)
 *
 * 错误码:
 *   - 'yaml-lock-timeout'：acquire 超时 / signal.aborted / 锁释放失败
 *   - 'internal-error'：unlink 失败但 fn 已成功(罕见;不影响主流程传播)
 */
import { randomUUID } from 'node:crypto'
import { link, mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { SkyAxisHostError } from './requirement-service.ts'

/** 锁文件路径:`<workspace>/.sky-axis/.lock`(hidden file,与 mate.yaml 同级)。 */
export const SKY_AXIS_LOCK_FILENAME = '.lock'

/** 锁所在目录。 */
const SKY_AXIS_LOCK_DIR = '.sky-axis'

/** 默认 acquire 超时 5 秒(覆盖慢盘 + 并发峰值)。 */
const DEFAULT_LOCK_TIMEOUT_MS = 5_000

/** 默认重试间隔 50ms(覆盖 acquire 后立即释放的并发场景)。 */
const DEFAULT_LOCK_RETRY_MS = 50

/** withFileLock 调用入参。 */
export interface WithFileLockOptions {
  /** 锁等待超时(ms),默认 5000。超时抛 'yaml-lock-timeout'。 */
  timeoutMs?: number
  /** 重试间隔(ms),默认 50。 */
  retryMs?: number
  /** signal 触发立即放弃,抛 'yaml-lock-timeout'。 */
  signal?: AbortSignal
}

/**
 * sleep helper —— 支持 signal 打断,避免 retry 期间 signal.abort() 还得等
 * retryMs 自然醒来才被 while 循环检查。
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve()
      return
    }
    const t = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t)
        resolve()
      }, { once: true })
    }
  })
}

/**
 * 计算 lock path: `<workspace>/.sky-axis/.lock`。
 *   - 暴露为内部 helper 便于测试验证
 */
function lockPath(workspacePath: string): string {
  return join(workspacePath, SKY_AXIS_LOCK_DIR, SKY_AXIS_LOCK_FILENAME)
}

/**
 * 在 workspace 路径下 acquire 文件锁,跑 fn,finally 释放。
 *
 * 用法:
 * ```ts
 * await withFileLock(workspacePath, async () => {
 *   const meta = await readMeta(workspacePath)
 *   // mutate meta.requirements
 *   await writeMetaAtomic(workspacePath, meta)
 * }, { timeoutMs: 3000 })
 * ```
 *
 * 失败语义:
 *   - 超时 / signal → 抛 `SkyAxisHostError('yaml-lock-timeout', ...)`
 *   - mkdir 失败 → 抛 `SkyAxisHostError('internal-error', ...)`(原始错透传)
 *   - fn 内抛错 → 锁仍释放;fn 异常原样向上传播
 *
 * @throws SkyAxisHostError
 */
export async function withFileLock<T>(
  workspacePath: string,
  fn: () => Promise<T>,
  opts: WithFileLockOptions = {},
): Promise<T> {
  const target = lockPath(workspacePath)
  const timeoutMs = opts.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  const retryMs = opts.retryMs ?? DEFAULT_LOCK_RETRY_MS

  // 0. 确保 .sky-axis/ 父目录存在(mode 0o700;防御性,通常 host apply 已建)
  try {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  } catch (e) {
    throw new SkyAxisHostError(
      'internal-error',
      `fs-lock mkdir ${dirname(target)} failed: ${(e as Error).message}`,
    )
  }

  // 1. acquire:link-based 算法
  //    sentinelPath 必须进程内唯一:同一进程并发 withFileLock 在同一毫秒
  //    会算出相同 `${pid}.${Date.now()}`,导致 catch EEXIST 分支 unlink 把
  //    别人刚 open 的 sentinel 删了 → 后续 rename ENOENT。
  //    randomUUID 8 字符后缀保证唯一性。
  const sentinelPath = `${target}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`
  const start = Date.now()
  let acquired = false
  try {
    while (!acquired) {
      if (opts.signal?.aborted === true) {
        throw new SkyAxisHostError(
          'yaml-lock-timeout',
          `fs-lock acquire aborted by signal for ${target}`,
        )
      }
      if (Date.now() - start > timeoutMs) {
        throw new SkyAxisHostError(
          'yaml-lock-timeout',
          `fs-lock acquire timed out after ${timeoutMs}ms for ${target}`,
        )
      }
      try {
        // 1a. 创建 sentinel(writeFile flag 'wx' = 排他创建;比 open 更省事,
        //     自动管理 FileHandle 生命周期,避免 ERR_INVALID_STATE on GC)
        await writeFile(sentinelPath, '', { flag: 'wx' })
        // 1b. link sentinel → lockPath —— link(2) 在目标已存在时**原子地报
        //     EEXIST**(关键:不能用 rename,POSIX rename 会覆盖目标,失去互斥)
        await link(sentinelPath, target)
        // 1c. link 成功后 sentinel 已经 hardlink 到 target,删 sentinel 释放 inode
        await unlink(sentinelPath).catch(() => undefined)
        acquired = true
      } catch (e) {
        const err = e as NodeJS.ErrnoException
        if (err.code === 'EEXIST') {
          // 别人持有;清掉自己的 sentinel(如果已创建)然后等
          await unlink(sentinelPath).catch(() => undefined)
          await sleep(retryMs, opts.signal)
          continue
        }
        // 其他 IO 错误(磁盘满 / 权限)→ 清 sentinel,抛错
        await unlink(sentinelPath).catch(() => undefined)
        throw new SkyAxisHostError(
          'internal-error',
          `fs-lock acquire ${target} failed: ${err.message ?? 'unknown'}`,
        )
      }
    }

    // 2. 跑 fn(锁持有期间)
    return await fn()
  } finally {
    // 3. release:unlink lockPath —— 静默兜底
    if (acquired) {
      try {
        await unlink(target)
      } catch (e) {
        const err = e as NodeJS.ErrnoException
        if (err.code !== 'ENOENT') {
          // 锁文件被别人删了 —— 不抛,只 warn
          // eslint-disable-next-line no-console
          console.warn(`[sky-axis] fs-lock release ${target} failed: ${err.code ?? 'unknown'}`)
        }
      }
    }
  }
}

/* ── 内部 helper 暴露(测试用)── */

export const _internal = {
  lockPath,
  sentinelPathFor: (workspacePath: string): string =>
    `${lockPath(workspacePath)}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}`,
  sleep,
}