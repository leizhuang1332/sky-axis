/**
 * sky-axis host 半区 —— fs.watch 监听 + debounce + 多 workspace 管理。
 *
 * 目的（Sprint 5：YAML-as-SoT）：
 *   - mate.yaml 是 source of truth;DSH 进程外的工具(vim / git hook / 其它 host
 *     进程)改写后,host 必须感知并把变化广播给 SSE 订阅者
 *   - 监听 `<workspace>/.sky-axis/` 整个目录(而不是 mate.yaml 文件本身),原因:
 *     - atomic write 模式是 `.tmp + rename`,file-level fs.watch 在 macOS 上
 *       rename 事件不可靠;目录级监听能稳定捕获 rename 后的 final state
 *     - 目录级顺便覆盖 `.lock` 等其他元数据文件(未来扩展)
 *   - debounce 100ms 合并 atomic write 的「.tmp created + .tmp renamed + maybe
 *     unlink」多次事件为一次
 *
 * 自家写冗余 put（Plan 决策）：
 *   - 自家通过 requirements-store.updateRequirements 写入后,fs.watch 也会触发
 *     modified 事件 → 若不抑制,SSE 会重复 emit 一次(requirements-store 写完
 *     已经同步 emit,fs.watch emit 是冗余)
 *   - 保留回路(简单可靠):写入方调 markSelfWrite(workspacePath) 记录时间戳,
 *     emit 时若最近 250ms 内有自写 → 跳过;超过 250ms → 仍 emit(兜底覆盖外部写)
 *
 * 错误恢复：
 *   - fs.watch 'error' 事件 → 退避重连 1s → 2s → 4s → ... → 30s 上限
 *   - 'error' 后停止 emit 直到重连成功(避免漏掉外部写)
 *
 * 不支持：
 *   - 跨 mount point(DSH workspace 都在同一文件系统)
 *   - 监听非 mate.yaml 路径(本模块只关心 `.sky-axis/` 目录)
 */
import { existsSync } from 'node:fs'
import { stat as fsStat } from 'node:fs/promises'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as fs from 'node:fs'

/** mate.yaml 所在的目录(与 workspace-meta.ts 同源,这里独立常量避免循环依赖)。 */
const SKY_AXIS_META_DIR = '.sky-axis'

/** debounce 时长 —— 覆盖 atomic write 的多次触发。 */
const DEBOUNCE_MS = 100

/** 自家写跳过的窗口大小(必须 > DEBOUNCE_MS + fs.watch 触发延迟)。 */
const SELF_WRITE_WINDOW_MS = 250

/** 重连退避上限 30 秒。 */
const MAX_RECONNECT_DELAY_MS = 30_000

/** 初始重连延迟 1 秒(覆盖短时进程重启)。 */
const INITIAL_RECONNECT_DELAY_MS = 1_000

/** 单个 workspace 的 fs.watch 监听选项。 */
export interface WatchOptions {
  /**
   * 文件变化事件(经过 debounce + 自家写抑制后)。
   * - kind='modified'：.sky-axis/ 下文件改动(主要场景 = mate.yaml 被外部改)
   * - kind='created'：.sky-axis/ 目录首次出现(workspace 第一次接入 host)
   * - kind='deleted'：.sky-axis/ 目录消失(workspace 被外部 rm -rf)
   * - kind='reconnected'：fs.watch 出错后重连成功(给 caller 一个恢复信号)
   *
   * 每次回调 **只 emit 一次**(debounce 后);caller 收到后自己 read mate.yaml
   * 拿到最新内容。
   */
  onChange: (event: MateYamlChangeEvent) => void
  /** fs.watch 异常(权限拒绝 / 内核 inotify 用尽 / 文件系统异常)。 */
  onError?: (err: Error) => void
}

/** fs.watch 事件类型(对外)。 */
export type MateYamlChangeEvent =
  | { workspacePath: string; kind: 'modified'; ts: number }
  | { workspacePath: string; kind: 'created'; ts: number }
  | { workspacePath: string; kind: 'deleted'; ts: number }
  | { workspacePath: string; kind: 'reconnected'; ts: number }

/** FsWatcherManager 接口。 */
export interface FsWatcherManager {
  /**
   * 给指定 workspace 启动 fs.watch + debounce。返回 unsubscribe 函数。
   * - 同一 workspace 重复 watch → 后一次替换前一次(共享 listener 集会被覆盖)
   * - workspace 路径不存在 → 仍然注册(下次 watch 'change' 时 mkdir 后再触发)
   */
  watch(workspacePath: string, opts: WatchOptions): () => void
  /**
   * 标记一次自家写。250ms 内 fs.watch 触发的 modified 事件被跳过。
   * caller(requirements-store 写入路径)应在 updateRequirements 成功后调一次。
   */
  markSelfWrite(workspacePath: string, ts?: number): void
  /** 停止所有 watch(测试 / host shutdown 用)。 */
  stopAll(): void
}

/**
 * 工厂:创建 FsWatcherManager。
 * - 单例足够(host 半区只有一个 DSH 进程);多次创建是允许的(测试用)
 */
export function createFsWatcherManager(): FsWatcherManager {
  return new FsWatcherManagerImpl()
}

/* ── 实现 ── */

interface WorkspaceState {
  workspacePath: string
  watchDir: string  // <workspacePath>/.sky-axis
  metaPath: string  // <workspacePath>/.sky-axis/mate.yaml
  watcher: fs.FSWatcher | null
  /** tryStartWatcher 是否正在跑(避免同步多次 watch() 重复启动 fs.watch)。 */
  isStarting: boolean
  debounceTimer: ReturnType<typeof setTimeout> | null
  listeners: Set<WatchOptions>
  /** mate.yaml 已知 mtime(mtimeMs);0 = 未知/不存在。 */
  lastMtimeMs: number
  /** 自家写时间戳环形数组(250ms 窗口)。 */
  selfWriteTimestamps: number[]
  /** 重连尝试计数。 */
  reconnectAttempt: number
  /** 当前是否处于「disconnected」状态(暂停 emit modified)。 */
  disconnected: boolean
  /** 是否已被 stopAll 永久关闭。 */
  closed: boolean
}

class FsWatcherManagerImpl implements FsWatcherManager {
  private readonly workspaces = new Map<string, WorkspaceState>()

  watch(workspacePath: string, opts: WatchOptions): () => void {
    if (!this.workspaces.has(workspacePath)) {
      this.workspaces.set(workspacePath, {
        workspacePath,
        watchDir: join(workspacePath, SKY_AXIS_META_DIR),
        metaPath: join(workspacePath, SKY_AXIS_META_DIR, 'mate.yaml'),
        watcher: null,
        isStarting: false,
        debounceTimer: null,
        listeners: new Set(),
        lastMtimeMs: 0,
        selfWriteTimestamps: [],
        reconnectAttempt: 0,
        disconnected: false,
        closed: false,
      })
    }
    const state = this.workspaces.get(workspacePath)!
    state.listeners.add(opts)

    // 第一次 watch:启动 fs.watch(防止同步多次 watch() 重复启动)
    if (state.watcher === null && !state.isStarting) {
      state.isStarting = true
      void this.tryStartWatcher(state).finally(() => {
        state.isStarting = false
      })
    }

    // 返回 unsubscribe
    return () => {
      state.listeners.delete(opts)
      if (state.listeners.size === 0) {
        this.stopWatcher(state)
        this.workspaces.delete(workspacePath)
      }
    }
  }

  markSelfWrite(workspacePath: string, ts: number = Date.now()): void {
    const state = this.workspaces.get(workspacePath)
    if (state === undefined) return
    state.selfWriteTimestamps.push(ts)
    // 清掉窗口外的旧时间戳(避免数组无限增长)
    const cutoff = ts - SELF_WRITE_WINDOW_MS
    while (state.selfWriteTimestamps.length > 0 &&
           state.selfWriteTimestamps[0]! < cutoff) {
      state.selfWriteTimestamps.shift()
    }
  }

  stopAll(): void {
    for (const state of this.workspaces.values()) {
      this.stopWatcher(state)
      state.closed = true
    }
    this.workspaces.clear()
  }

  /* ── 内部 ── */

  /**
   * 尝试启动 fs.watch;若 .sky-axis/ 目录不存在,等 mkdir 出现后重连。
   */
  private async tryStartWatcher(state: WorkspaceState): Promise<void> {
    if (state.closed) return
    if (state.disconnected) return  // 已经在 disconnected 等退避

    // 确保目录存在(workspace 第一次接入可能 .sky-axis/ 还没建)
    if (!existsSync(state.watchDir)) {
      try {
        await mkdir(state.watchDir, { recursive: true, mode: 0o700 })
      } catch (e) {
        this.emitError(state, e as Error)
        this.scheduleReconnect(state)
        return
      }
    }

    try {
      // 初始化 lastMtimeMs:启动 watch 时先 stat 一次(若 mate.yaml 已存在),
      // 避免 created 后立刻第一次改文件被错误忽略
      try {
        const s = await fsStat(state.metaPath)
        state.lastMtimeMs = s.mtimeMs
      } catch {
        state.lastMtimeMs = 0
      }

      const watcher = fs.watch(state.watchDir, { persistent: false }, (eventType, filename) => {
        // eventType: 'rename' | 'change'
        // filename: 触发的文件(macOS FSEvents 上经常不可靠,可能是 watchDir
        //   的 basename 或 null)。所以不在这里做精确过滤 —— debounce 后用
        //   stat(state.metaPath).mtimeMs 与 lastMtimeMs 比较判断是否真改了。
        void this.handleFsEvent(state, eventType, filename)
      })

      watcher.on('error', (err) => {
        // macOS 上 .sky-axis/ 目录被 rm -rf 时 fs.watch 通常 emit ENOENT;
        // 也可能在 callback 里检查 existsSync 时已删。先判目录消失 → emit deleted。
        if (!existsSync(state.watchDir)) {
          this.cancelDebounce(state)
          this.stopWatcher(state)
          state.disconnected = true
          this.emit(state, { workspacePath: state.workspacePath, kind: 'deleted', ts: Date.now() })
          this.scheduleReconnect(state)
          return
        }
        this.emitError(state, err)
        this.stopWatcher(state)  // 关掉旧 watcher
        this.scheduleReconnect(state)
      })

      state.watcher = watcher

      // 若之前 disconnected,emit reconnected
      if (state.disconnected) {
        state.disconnected = false
        state.reconnectAttempt = 0
        this.emit(state, { workspacePath: state.workspacePath, kind: 'reconnected', ts: Date.now() })
      } else {
        // 第一次启动 → emit created(给 caller 一个初始化信号)
        this.emit(state, { workspacePath: state.workspacePath, kind: 'created', ts: Date.now() })
      }
    } catch (e) {
      this.emitError(state, e as Error)
      this.scheduleReconnect(state)
    }
  }

  /**
   * 处理 fs.watch 原始事件,debounce 后用 stat(mate.yaml).mtimeMs 判断是否
   * 真有修改。
   */
  private async handleFsEvent(
    state: WorkspaceState,
    _eventType: fs.WatchEventType,
    _filename: string | null,
  ): Promise<void> {
    // 目录本身消失(.sky-axis/ 被 rm -rf)→ 立即 emit deleted(不进 debounce)
    if (!existsSync(state.watchDir)) {
      this.cancelDebounce(state)
      state.disconnected = true
      this.stopWatcher(state)
      this.emit(state, { workspacePath: state.workspacePath, kind: 'deleted', ts: Date.now() })
      // 触发重连:目录回来时重新 watch
      this.scheduleReconnect(state)
      return
    }

    // debounce:100ms 内多次合并成一次
    this.cancelDebounce(state)
    const fireAfter = DEBOUNCE_MS
    state.debounceTimer = setTimeout(async () => {
      state.debounceTimer = null
      // 自家写抑制:250ms 内的 modified 跳过
      if (this.isRecentSelfWrite(state)) {
        return
      }
      // stat mate.yaml 的 mtime;若比 lastMtimeMs 新 → 真改了
      let currentMtime: number
      try {
        const s = await fsStat(state.metaPath)
        currentMtime = s.mtimeMs
      } catch {
        // mate.yaml 不存在(或 stat 失败)→ 不 emit(可能 atomic write 中间态)
        return
      }
      if (currentMtime > state.lastMtimeMs) {
        state.lastMtimeMs = currentMtime
        this.emit(state, { workspacePath: state.workspacePath, kind: 'modified', ts: Date.now() })
      }
      void fireAfter  // silence unused
    }, fireAfter)
  }

  /** 取消 pending debounce。 */
  private cancelDebounce(state: WorkspaceState): void {
    if (state.debounceTimer !== null) {
      clearTimeout(state.debounceTimer)
      state.debounceTimer = null
    }
  }

  /** 检查最近 250ms 内是否有自写。 */
  private isRecentSelfWrite(state: WorkspaceState): boolean {
    const cutoff = Date.now() - SELF_WRITE_WINDOW_MS
    return state.selfWriteTimestamps.some(ts => ts >= cutoff)
  }

  /** 关闭当前 watcher(不删 state,允许重连)。 */
  private stopWatcher(state: WorkspaceState): void {
    this.cancelDebounce(state)
    if (state.watcher !== null) {
      try {
        state.watcher.close()
      } catch {
        /* 关闭失败不影响状态清理 */
      }
      state.watcher = null
    }
  }

  /** 退避重连:1s → 2s → 4s → ... → 30s 上限。 */
  private scheduleReconnect(state: WorkspaceState): void {
    if (state.closed) return
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * (2 ** state.reconnectAttempt),
      MAX_RECONNECT_DELAY_MS,
    )
    state.reconnectAttempt++
    state.disconnected = true
    setTimeout(() => {
      void this.tryStartWatcher(state)
    }, delay)
  }

  /** 触发 listener(防御性:listener 抛错不阻断其它 listener)。 */
  private emit(state: WorkspaceState, event: MateYamlChangeEvent): void {
    for (const listener of state.listeners) {
      try {
        listener.onChange(event)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[fs-watcher-manager] listener threw:', e)
      }
    }
  }

  /** 触发 onError listener。 */
  private emitError(state: WorkspaceState, err: Error): void {
    for (const listener of state.listeners) {
      try {
        listener.onError?.(err)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[fs-watcher-manager] onError listener threw:', e)
      }
    }
  }
}

/* ── 测试可见的内部 helper ── */

export const _internal = {
  DEBOUNCE_MS,
  SELF_WRITE_WINDOW_MS,
  MAX_RECONNECT_DELAY_MS,
  INITIAL_RECONNECT_DELAY_MS,
  SKY_AXIS_META_DIR,
}