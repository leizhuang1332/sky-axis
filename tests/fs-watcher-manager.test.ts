/**
 * src/host/fs-watcher-manager.ts 单元测试。
 *
 * 测试目标（Sprint 5：YAML-as-SoT fs.watch 监听）：
 *   - 启动 watch 后,workspace .sky-axis/ 目录存在 → emit created
 *   - .sky-axis/ 目录被自动 mkdir(workspace 第一次接入)→ 然后 emit created
 *   - 修改 mate.yaml → emit modified(经过 debounce 100ms)
 *   - debounce:100ms 内多次改 → 只 emit 一次 modified
 *   - 自家写抑制:markSelfWrite 后 250ms 内改 mate.yaml → 不 emit modified
 *   - markSelfWrite 超过 250ms → emit modified(兜底外部写覆盖)
 *   - 目录被删 → emit deleted
 *   - 多个 listener 订阅同 workspace → 都收到事件
 *   - unsubscribe 后不再 emit
 *   - stopAll 关闭所有 watch
 *   - ignore 非 mate.yaml 文件(.lock / .gitignore)
 *
 * 用真 fs(mkdtemp + 真 fs.watch),不走 mock —— fs.watch 行为依赖平台。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createFsWatcherManager,
  type FsWatcherManager,
  type MateYamlChangeEvent,
} from '../src/host/fs-watcher-manager.ts'

let workspaceRoot: string
let manager: FsWatcherManager

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'sky-axis-fswatcher-'))
  manager = createFsWatcherManager()
})

afterEach(async () => {
  manager.stopAll()
  await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
})

/** 等 N ms。 */
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** 等 promise 被 resolve/reject,带超时。 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)),
  ])
}

/** 收集事件 —— 返回 promise + push 函数。 */
function collectEvents(): {
  events: MateYamlChangeEvent[]
  push: (e: MateYamlChangeEvent) => void
  waitFor: (predicate: (e: MateYamlChangeEvent) => boolean, timeoutMs?: number) => Promise<MateYamlChangeEvent>
} {
  const events: MateYamlChangeEvent[] = []
  const waiters: Array<{
    predicate: (e: MateYamlChangeEvent) => boolean
    resolve: (e: MateYamlChangeEvent) => void
    timer: ReturnType<typeof setTimeout>
  }> = []
  const push = (e: MateYamlChangeEvent): void => {
    events.push(e)
    // 倒序遍历:每个 waiter 只匹配一次,匹配后移除
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.predicate(e)) {
        clearTimeout(waiters[i]!.timer)
        waiters[i]!.resolve(e)
        waiters.splice(i, 1)
      }
    }
  }
  const waitFor = (
    predicate: (e: MateYamlChangeEvent) => boolean,
    timeoutMs = 2_000,
  ): Promise<MateYamlChangeEvent> => {
    const existing = events.find(predicate)
    if (existing) return Promise.resolve(existing)
    return new Promise<MateYamlChangeEvent>((res, rej) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex(w => w.resolve === res)
        if (idx >= 0) waiters.splice(idx, 1)
        rej(new Error(`waitFor timeout after ${timeoutMs}ms`))
      }, timeoutMs)
      waiters.push({ predicate, resolve: res, timer })
    })
  }
  return { events, push, waitFor }
}

/* ── created 事件 ── */

describe('FsWatcherManager.watch 启动', () => {
  it('.sky-axis/ 已存在 → emit created', async () => {
    await mkdir(join(workspaceRoot, '.sky-axis'), { recursive: true })
    const col = collectEvents()
    const unsub = manager.watch(workspaceRoot, { onChange: col.push })

    const evt = await withTimeout(col.waitFor(e => e.kind === 'created'), 1_000, 'created')
    expect(evt.kind).toBe('created')
    expect(evt.workspacePath).toBe(workspaceRoot)
    unsub()
  })

  it('.sky-axis/ 不存在 → 自动 mkdir + emit created', async () => {
    const col = collectEvents()
    const unsub = manager.watch(workspaceRoot, { onChange: col.push })

    const evt = await withTimeout(col.waitFor(e => e.kind === 'created'), 1_000, 'created')
    expect(evt.kind).toBe('created')
    // .sky-axis/ 应已被创建
    const { existsSync } = await import('node:fs')
    expect(existsSync(join(workspaceRoot, '.sky-axis'))).toBe(true)
    unsub()
  })
})

/* ── modified + debounce ── */

describe('modified 事件 + debounce', () => {
  it('改 mate.yaml → emit modified(经 100ms debounce)', async () => {
    await mkdir(join(workspaceRoot, '.sky-axis'), { recursive: true })
    const col = collectEvents()
    const unsub = manager.watch(workspaceRoot, { onChange: col.push })
    // 等 created 触发完
    await col.waitFor(e => e.kind === 'created', 1_000)

    const target = join(workspaceRoot, '.sky-axis', 'mate.yaml')
    await writeFile(target, 'hello: world\n', 'utf8')

    const evt = await withTimeout(col.waitFor(e => e.kind === 'modified'), 1_000, 'modified')
    expect(evt.kind).toBe('modified')
    unsub()
  })

  it('100ms 内多次改 → 只 emit 一次 modified(debounce 合并)', async () => {
    await mkdir(join(workspaceRoot, '.sky-axis'), { recursive: true })
    const col = collectEvents()
    const unsub = manager.watch(workspaceRoot, { onChange: col.push })
    await col.waitFor(e => e.kind === 'created', 1_000)

    const target = join(workspaceRoot, '.sky-axis', 'mate.yaml')
    // 50ms 内连续改 3 次
    await writeFile(target, 'v1\n', 'utf8')
    await sleep(20)
    await writeFile(target, 'v2\n', 'utf8')
    await sleep(20)
    await writeFile(target, 'v3\n', 'utf8')

    // 等 debounce 触发(100ms 后)
    await sleep(200)

    const modifiedCount = col.events.filter(e => e.kind === 'modified').length
    expect(modifiedCount).toBe(1)
    unsub()
  })

  it('改非 mate.yaml 文件(.lock)→ 不 emit modified', async () => {
    await mkdir(join(workspaceRoot, '.sky-axis'), { recursive: true })
    const col = collectEvents()
    const unsub = manager.watch(workspaceRoot, { onChange: col.push })
    await col.waitFor(e => e.kind === 'created', 1_000)

    // 写 .lock —— 应该被忽略
    await writeFile(join(workspaceRoot, '.sky-axis', '.lock'), '', 'utf8')
    await sleep(300)

    const modifiedCount = col.events.filter(e => e.kind === 'modified').length
    expect(modifiedCount).toBe(0)
    unsub()
  })
})

/* ── 自家写抑制 ── */

describe('markSelfWrite 自家写抑制', () => {
  it('markSelfWrite 后 250ms 内改 mate.yaml → 不 emit modified', async () => {
    await mkdir(join(workspaceRoot, '.sky-axis'), { recursive: true })
    const col = collectEvents()
    const unsub = manager.watch(workspaceRoot, { onChange: col.push })
    await col.waitFor(e => e.kind === 'created', 1_000)

    // 标记自写 + 立刻改文件
    manager.markSelfWrite(workspaceRoot)
    await writeFile(join(workspaceRoot, '.sky-axis', 'mate.yaml'), 'v1\n', 'utf8')

    await sleep(400)  // > 250ms

    const modifiedCount = col.events.filter(e => e.kind === 'modified').length
    expect(modifiedCount).toBe(0)
    unsub()
  })

  it('markSelfWrite 后超过 250ms 才改 mate.yaml → emit modified(兜底外部写)', async () => {
    await mkdir(join(workspaceRoot, '.sky-axis'), { recursive: true })
    const col = collectEvents()
    const unsub = manager.watch(workspaceRoot, { onChange: col.push })
    await col.waitFor(e => e.kind === 'created', 1_000)

    manager.markSelfWrite(workspaceRoot)
    await sleep(300)  // 等窗口过期
    await writeFile(join(workspaceRoot, '.sky-axis', 'mate.yaml'), 'v1\n', 'utf8')

    const evt = await withTimeout(col.waitFor(e => e.kind === 'modified'), 1_000, 'modified')
    expect(evt.kind).toBe('modified')
    unsub()
  })

  it('markSelfWrite 在不同 workspace 间不串', async () => {
    const wsA = workspaceRoot
    const wsB = await mkdtemp(join(tmpdir(), 'sky-axis-fswatcher-B-'))
    try {
      await mkdir(join(wsA, '.sky-axis'), { recursive: true })
      await mkdir(join(wsB, '.sky-axis'), { recursive: true })

      const colA = collectEvents()
      const colB = collectEvents()
      manager.watch(wsA, { onChange: colA.push })
      manager.watch(wsB, { onChange: colB.push })
      await colA.waitFor(e => e.kind === 'created', 1_000)
      await colB.waitFor(e => e.kind === 'created', 1_000)
      // macOS FSEvents 在 watch() 返回后还有内部稳定期;等 200ms 再写入
      // 避免 writeFile 在 fs.watch 完全建立前完成(导致 modified 不 emit)
      await sleep(200)

      // 只标记 wsA 为自写
      manager.markSelfWrite(wsA)
      await writeFile(join(wsA, '.sky-axis', 'mate.yaml'), 'v1\n', 'utf8')
      await writeFile(join(wsB, '.sky-axis', 'mate.yaml'), 'v1\n', 'utf8')

      // 等 wsB 的 modified 真正 emit(而不是固定 sleep —— 避免 FSEvents latency flake)
      await colB.waitFor(e => e.kind === 'modified', 2_000)
      // 再等一会儿确保 wsA 不会 emit(自写抑制)
      await sleep(300)

      // wsA 被抑制 → 0 modified
      expect(colA.events.filter(e => e.kind === 'modified')).toHaveLength(0)
      // wsB 不被抑制 → 1 modified
      expect(colB.events.filter(e => e.kind === 'modified')).toHaveLength(1)
    } finally {
      await rm(wsB, { recursive: true, force: true }).catch(() => undefined)
    }
  })
})

/* ── 目录被删 ── */

describe('目录被删', () => {
  it('.sky-axis/ 被 rm -rf → emit deleted', async () => {
    await mkdir(join(workspaceRoot, '.sky-axis'), { recursive: true })
    const col = collectEvents()
    const unsub = manager.watch(workspaceRoot, { onChange: col.push })
    await col.waitFor(e => e.kind === 'created', 1_000)

    await rm(join(workspaceRoot, '.sky-axis'), { recursive: true, force: true })

    const evt = await withTimeout(col.waitFor(e => e.kind === 'deleted'), 1_000, 'deleted')
    expect(evt.kind).toBe('deleted')
    unsub()
  })
})

/* ── 多 listener + unsubscribe ── */

describe('多 listener + unsubscribe', () => {
  it('多个 listener 订阅同 workspace → 都收到事件', async () => {
    await mkdir(join(workspaceRoot, '.sky-axis'), { recursive: true })
    const col1 = collectEvents()
    const col2 = collectEvents()
    const unsub1 = manager.watch(workspaceRoot, { onChange: col1.push })
    const unsub2 = manager.watch(workspaceRoot, { onChange: col2.push })
    await col1.waitFor(e => e.kind === 'created', 1_000)
    await col2.waitFor(e => e.kind === 'created', 1_000)

    await writeFile(join(workspaceRoot, '.sky-axis', 'mate.yaml'), 'v1\n', 'utf8')
    await sleep(300)

    expect(col1.events.filter(e => e.kind === 'modified')).toHaveLength(1)
    expect(col2.events.filter(e => e.kind === 'modified')).toHaveLength(1)
    unsub1()
    unsub2()
  })

  it('unsubscribe 后不再 emit', async () => {
    await mkdir(join(workspaceRoot, '.sky-axis'), { recursive: true })
    const col = collectEvents()
    const unsub = manager.watch(workspaceRoot, { onChange: col.push })
    await col.waitFor(e => e.kind === 'created', 1_000)
    unsub()

    await writeFile(join(workspaceRoot, '.sky-axis', 'mate.yaml'), 'v1\n', 'utf8')
    await sleep(300)

    // unsub 之后只有最初的 created(没有 modified)
    const modifiedCount = col.events.filter(e => e.kind === 'modified').length
    expect(modifiedCount).toBe(0)
  })

  it('最后一个 listener unsub 后 → workspace state 清理(改文件再 watch 应能重新 emit)', async () => {
    await mkdir(join(workspaceRoot, '.sky-axis'), { recursive: true })
    const col = collectEvents()
    const unsub = manager.watch(workspaceRoot, { onChange: col.push })
    await col.waitFor(e => e.kind === 'created', 1_000)
    unsub()

    // 再 watch,应该重新 created
    const col2 = collectEvents()
    const unsub2 = manager.watch(workspaceRoot, { onChange: col2.push })
    const evt = await withTimeout(col2.waitFor(e => e.kind === 'created'), 1_000, 'created-2')
    expect(evt.kind).toBe('created')
    unsub2()
  })
})

/* ── stopAll ── */

describe('stopAll', () => {
  it('关闭所有 watch', async () => {
    const ws2 = await mkdtemp(join(tmpdir(), 'sky-axis-fswatcher-C-'))
    try {
      await mkdir(join(workspaceRoot, '.sky-axis'), { recursive: true })
      await mkdir(join(ws2, '.sky-axis'), { recursive: true })

      const col1 = collectEvents()
      const col2 = collectEvents()
      manager.watch(workspaceRoot, { onChange: col1.push })
      manager.watch(ws2, { onChange: col2.push })
      await col1.waitFor(e => e.kind === 'created', 1_000)
      await col2.waitFor(e => e.kind === 'created', 1_000)

      manager.stopAll()

      // 改两个 ws 的文件,都不应 emit
      await writeFile(join(workspaceRoot, '.sky-axis', 'mate.yaml'), 'v1\n', 'utf8')
      await writeFile(join(ws2, '.sky-axis', 'mate.yaml'), 'v1\n', 'utf8')
      await sleep(300)

      expect(col1.events.filter(e => e.kind === 'modified')).toHaveLength(0)
      expect(col2.events.filter(e => e.kind === 'modified')).toHaveLength(0)
    } finally {
      await rm(ws2, { recursive: true, force: true }).catch(() => undefined)
    }
  })
})

/* ── 错误处理 ── */

describe('错误处理', () => {
  it('listener 抛错不阻断其它 listener', async () => {
    await mkdir(join(workspaceRoot, '.sky-axis'), { recursive: true })
    const col = collectEvents()
    let badListenerCalled = 0

    manager.watch(workspaceRoot, { onChange: () => { badListenerCalled++; throw new Error('boom') } })
    manager.watch(workspaceRoot, { onChange: col.push })
    await col.waitFor(e => e.kind === 'created', 1_000)

    await writeFile(join(workspaceRoot, '.sky-axis', 'mate.yaml'), 'v1\n', 'utf8')
    await sleep(300)

    expect(badListenerCalled).toBeGreaterThan(0)  // 至少 created 那次
    expect(col.events.filter(e => e.kind === 'modified')).toHaveLength(1)
  })
})