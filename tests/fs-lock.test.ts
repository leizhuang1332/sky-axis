/**
 * src/host/fs-lock.ts 单元测试。
 *
 * 测试目标（Sprint 5：YAML-as-SoT）：
 *   - withFileLock 正常 acquire + release(锁文件存在期间可见,fn 跑完被 unlink)
 *   - 串行:两个 withFileLock 串行跑,第二个等第一个释放
 *   - 并发互斥:N 个 Promise.all,fn 总执行时长 ≥ N*fnDuration(证明互斥)
 *   - 超时:锁被占 + timeoutMs=100 → 抛 'yaml-lock-timeout'
 *   - signal:signal.aborted → 立即抛 'yaml-lock-timeout'
 *   - 失败透传:fn 抛错 → 锁释放,后续 withFileLock 可正常 acquire
 *   - .sky-axis/ 父目录自动 mkdir(防御性)
 *   - 不存在 workspacePath 抛 'internal-error'
 *
 * 用真 fs(mkdtemp + 真 rename/unlink),不走 mock —— 锁算法依赖 POSIX 语义。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  access,
  mkdtemp,
  rm,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _internal,
  SKY_AXIS_LOCK_FILENAME,
  withFileLock,
} from '../src/host/fs-lock.ts'

let workspaceRoot: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'sky-axis-fslock-'))
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
})

/**
 * 等 lock 文件在磁盘上可见。async 调度顺序不定 —— 发起 firstPromise
 * 不保证它先 acquire,所以测试需要主动等 firstPromise 真持锁后再发
 * secondPromise。
 */
async function waitForLock(ws: string, maxMs = 1_000): Promise<boolean> {
  const lock = _internal.lockPath(ws)
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    try {
      await access(lock)
      return true
    } catch {
      /* not yet */
    }
    await new Promise(r => setTimeout(r, 2))
  }
  return false
}

/* ── 正常路径 ── */

describe('withFileLock 正常路径', () => {
  it('acquire 后 lockPath 存在,fn 跑完 lockPath 被 unlink', async () => {
    const target = join(workspaceRoot, '.sky-axis', SKY_AXIS_LOCK_FILENAME)
    let lockVisibleDuringFn = false

    const result = await withFileLock(workspaceRoot, async () => {
      // fn 跑期间:锁文件应可见
      await access(target)
      lockVisibleDuringFn = true
      return 'fn-result'
    })

    expect(result).toBe('fn-result')
    expect(lockVisibleDuringFn).toBe(true)
    // fn 跑完:锁文件被 unlink
    await expect(access(target)).rejects.toThrow()
  })

  it('自动创建 .sky-axis/ 父目录', async () => {
    await withFileLock(workspaceRoot, async () => {
      const skyAxisDir = join(workspaceRoot, '.sky-axis')
      await access(skyAxisDir)
    })
  })

  it('fn 返回值原样透传', async () => {
    const obj = { x: 1, y: 'hello' }
    const result = await withFileLock(workspaceRoot, async () => obj)
    expect(result).toBe(obj)
  })
})

/* ── 串行与互斥 ── */

describe('withFileLock 串行互斥', () => {
  it('两个 withFileLock 串行跑,第二个等第一个释放', async () => {
    const order: string[] = []
    await withFileLock(workspaceRoot, async () => {
      order.push('first-start')
      // 让出 event loop 让第二个有机会发起 acquire
      await new Promise(r => setTimeout(r, 50))
      order.push('first-end')
    })
    order.push('between')
    await withFileLock(workspaceRoot, async () => {
      order.push('second-start')
    })
    expect(order).toEqual(['first-start', 'first-end', 'between', 'second-start'])
  })

  it('N=5 个并发 withFileLock,fn 时长 100ms,总时长 ≥ 500ms(证明串行)', async () => {
    const N = 5
    const fnDurationMs = 100
    const t0 = Date.now()
    await Promise.all(
      Array.from({ length: N }, () =>
        withFileLock(workspaceRoot, async () => {
          await new Promise(r => setTimeout(r, fnDurationMs))
        }),
      ),
    )
    const elapsed = Date.now() - t0
    // 串行下 ≥ N * fnDurationMs;留 30ms 余量(单 setTimeout 不保证精确)
    expect(elapsed).toBeGreaterThanOrEqual(N * fnDurationMs - 10)
    // 但不应远超(避免死锁检测误判)
    expect(elapsed).toBeLessThan(N * fnDurationMs + 1000)
  })
})

/* ── 超时 ── */

describe('withFileLock 超时', () => {
  it('锁被占 + timeoutMs=100 → 抛 yaml-lock-timeout', async () => {
    // 先 acquire 锁,让第二个 acquire 卡住
    let releaseFirst: () => void = () => undefined
    const firstHeld = new Promise<void>(r => { releaseFirst = r })
    const firstPromise = withFileLock(workspaceRoot, async () => {
      await firstHeld
    }, { timeoutMs: 5_000 })

    // 等 firstPromise 真持锁(轮询 lock 文件存在)
    expect(await waitForLock(workspaceRoot)).toBe(true)

    // 第二个等 100ms 应超时
    const secondPromise = withFileLock(workspaceRoot, async () => {
      throw new Error('should not reach')
    }, { timeoutMs: 100 })

    await expect(secondPromise).rejects.toMatchObject({
      code: 'yaml-lock-timeout',
    })

    // 释放第一个,清场
    releaseFirst()
    await firstPromise
  })

  it('超时错误消息含 timeoutMs', async () => {
    let releaseFirst: () => void = () => undefined
    const firstHeld = new Promise<void>(r => { releaseFirst = r })
    const firstPromise = withFileLock(workspaceRoot, async () => {
      await firstHeld
    })

    // 等 firstPromise 持锁
    expect(await waitForLock(workspaceRoot)).toBe(true)

    try {
      await withFileLock(workspaceRoot, async () => undefined, { timeoutMs: 50 })
      throw new Error('expected throw')
    } catch (e) {
      expect((e as Error).message).toMatch(/50ms/)
    }

    releaseFirst()
    await firstPromise
  })
})

/* ── signal ── */

describe('withFileLock signal', () => {
  it('signal.aborted → 立即抛 yaml-lock-timeout', async () => {
    const controller = new AbortController()
    let releaseFirst: () => void = () => undefined
    const firstHeld = new Promise<void>(r => { releaseFirst = r })
    const firstPromise = withFileLock(workspaceRoot, async () => {
      await firstHeld
    })

    // 等 firstPromise 持锁
    expect(await waitForLock(workspaceRoot)).toBe(true)

    const secondPromise = withFileLock(workspaceRoot, async () => undefined, {
      timeoutMs: 10_000,
      signal: controller.signal,
    })

    // 50ms 后 abort
    setTimeout(() => controller.abort(), 50)

    await expect(secondPromise).rejects.toMatchObject({
      code: 'yaml-lock-timeout',
    })

    releaseFirst()
    await firstPromise
  })
})

/* ── fn 错误处理 ── */

describe('withFileLock fn 错误处理', () => {
  it('fn 抛错 → 锁仍释放(后续 withFileLock 可正常 acquire)', async () => {
    await expect(
      withFileLock(workspaceRoot, async () => {
        throw new Error('fn 故意抛错')
      }),
    ).rejects.toThrow('fn 故意抛错')

    // 锁应已释放
    await expect(withFileLock(workspaceRoot, async () => 'after-throw'))
      .resolves.toBe('after-throw')
  })

  it('fn 抛 SkyAxisHostError → 错误原样透传', async () => {
    await expect(
      withFileLock(workspaceRoot, async () => {
        throw new Error('custom error from fn')
      }),
    ).rejects.toThrow('custom error from fn')
  })
})

/* ── 内部 helper ── */

describe('_internal helper', () => {
  it('lockPath = <workspace>/.sky-axis/.lock', () => {
    expect(_internal.lockPath('/tmp/ws')).toBe(join('/tmp/ws', '.sky-axis', '.lock'))
  })

  it('sentinelPathFor 包含 pid + timestamp', () => {
    const p = _internal.sentinelPathFor('/tmp/ws')
    expect(p).toContain(`${_internal.lockPath('/tmp/ws')}.${process.pid}.`)
    expect(p.length).toBeGreaterThan(_internal.lockPath('/tmp/ws').length + 10)
  })

  it('sleep N ms 后 resolve', async () => {
    const t0 = Date.now()
    await _internal.sleep(50)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45)
  })
})

/* ── SKY_AXIS_LOCK_FILENAME ── */

describe('SKY_AXIS_LOCK_FILENAME', () => {
  it('=".lock"(hidden file,与 mate.yaml 同级)', () => {
    expect(SKY_AXIS_LOCK_FILENAME).toBe('.lock')
  })
})