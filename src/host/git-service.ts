/**
 * sky-axis host 半区 —— git 沙箱封装。
 *
 * 目的：
 *   - 给「源码关联」物料提供 git clone / checkout / rev-parse 能力
 *   - 把 child_process.spawn + 超时 + stderr 截断 + 沙箱断言封装成单一入口
 *   - 把所有失败路径映射为 `SkyAxisHostError` 的 5 个 git-* 错误码之一
 *
 * 设计原则（Phase 2.6 决策）：
 *   - **0 依赖**：不装 `simple-git` / `isomorphic-git`，直接 spawn `git --no-pager`。
 *     原因：
 *       a) `simple-git` 隐藏 stderr + 难配 timeout；
 *       b) `isomorphic-git` 不支持 LFS / submodule / SSH；
 *       c) sky-axis 已经在 src/host/ 下有 `process` 入口 (installSafetyNet)，
 *          加一个 spawn 调用边界不破坏「0 child_process 引用」的现状。
 *   - **沙箱**：所有 destDir 必须以 `${workspaceRoot}/repos/` 开头，
 *     否则抛 `git-sandbox-violation`。这是 path 穿越防护 —— 防止恶意 url 把
 *     工作树写到 workspace 外。
 *
 * 演进（Sprint 1：工作区目录结构改造）：
 *   - 原路径 `${workspaceRoot}/.sky-axis/repos/` 改为顶层 `${workspaceRoot}/repos/` —
 *     让用户在 Finder / VSCode 里可直接打开 clone 产物。
 *   - 沙箱语义不变（仍限定在 workspace 子目录），仅锚点从 `.sky-axis/` 隐藏目录
 *     迁到顶层 `repos/`。
 *   - **硬超时 5 分钟**：用 setTimeout + child.kill('SIGTERM') 实现。
 *     git 进程被 SIGTERM 后内部子进程可能残留，但 Node 进程级不会卡死；
 *     失败路径抛 `git-timeout`。
 *   - **stderr 截断**：累积最多 4KB，存到 SourceRepo.cloneError 时再截到 500。
 *   - **错误码映射**：
 *     - ENOENT / EACCES           → `git-not-installed`
 *     - git clone exit !== 0      → `git-clone-failed`
 *     - git checkout -b exit !== 0 → `git-checkout-failed`
 *     - 5min timeout               → `git-timeout`
 *     - destDir 逃逸 workspace    → `git-sandbox-violation`
 *
 * 单例：`createGitService()` 返回的实例可以跨 service 共享 —— 它无状态（每次
 * 调用都 spawn 新进程，不持有任何 fd / dir）。
 */
import { spawn } from 'node:child_process'
import { access, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { SkyAxisErrorCode } from '../protocol.ts'
import { SkyAxisHostError } from './requirement-service.ts'

/** git 操作默认超时（5 分钟）。 */
export const GIT_CLONE_TIMEOUT_MS = 5 * 60 * 1000

/** stderr 累积上限（截断前）。 */
const STDERR_COLLECT_LIMIT = 4096

/**
 * 构建传给 git 子进程的 env（Plan J + Plan K）。在 process.env 基础上强制:
 *   - GIT_TERMINAL_PROMPT=0:禁 git 自身 stdin prompt(Plan J)
 *   - GIT_SSH_COMMAND:把 git 内部 spawn 的 ssh 子进程也压到"headless 安全"
 *     (Plan K —— Plan J 的 GIT_TERMINAL_PROMPT 不会透传到 ssh)
 *
 * Plan K GIT_SSH_COMMAND 各项含义:
 *   - BatchMode=yes:禁用 ssh 自身所有 stdin/TTY prompt(passphrase / known_hosts / 端口转发)
 *   - ConnectTimeout=15:TCP connect 阶段最长 15s,避免网络层 hang 累加 5min
 *   - StrictHostKeyChecking=accept-new:第一次连陌生 host 自动写 known_hosts(无 prompt)
 *   - ServerAliveInterval=10 + ServerAliveCountMax=3:30s 内无响应断连
 *
 * 注意:只 ADD 变量,不删除 process.env —— SSH_AUTH_SOCK / HOME / HTTP_PROXY
 *   等必须继承,否则 SSH clone / 公司代理会全面失效。
 * 配好 credential helper / ssh-agent 的用户不受影响(BatchMode 不禁 agent forwarding)。
 * OpenSSH 中 -o 选项优先级最高,会覆盖用户 ~/.ssh/config 中的同名选项(预期)。
 *
 * @internal 公开以便 tests/git-service.test.ts 单元测试断言。
 */
export function gitSpawnEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_SSH_COMMAND:
      'ssh -o BatchMode=yes -o ConnectTimeout=15 ' +
      '-o StrictHostKeyChecking=accept-new ' +
      '-o ServerAliveInterval=10 -o ServerAliveCountMax=3',
  }
}

/**
 * 沙箱前缀 —— 工作区顶层 `repos/` 目录的相对路径。
 *
 * Sprint 1 演进：原值 `.sky-axis/repos` → `repos`（顶层化），复用用户已存在的
 * 同名目录（决策 3：复用语义 = 目录已存在就用，不查内部）。
 *
 * 注意：本常量不再以 `.sky-axis/` 开头，与 requirement-service.ts 的
 * `SKY_AXIS_ARTIFACT_NAMESPACE`（仅用于 `mate.yaml` 文件）脱钩 —— 两者职责不同：
 *   - SKY_AXIS_REPOS_DIR：git clone 沙箱的锚点目录
 *   - SKY_AXIS_ARTIFACT_NAMESPACE：sky-axis 元信息存放目录（只有 mate.yaml 一个文件）
 */
export const SKY_AXIS_REPOS_DIR = 'repos'

/** 单次 spawn 调用的 raw 结果（成功路径内部用）。 */
interface SpawnOk {
  ok: true
  /** git 进程退出码。 */
  code: number
  /** 累积 stderr（已截断到 STDERR_COLLECT_LIMIT）。 */
  stderr: string
}

/** 单次 spawn 调用的 raw 结果（失败路径内部用）。 */
interface SpawnErr {
  ok: false
  /** 失败原因（用于映射到 SkyAxisErrorCode）。 */
  reason: 'not-installed' | 'timeout' | 'exit'
  /** 退出码（reason='exit' 时存在）。 */
  code?: number
  /** 累积 stderr（已截断）。 */
  stderr: string
}

/** clone / checkout -b 一次操作的入参（host service 层调用）。 */
export interface CloneSourceOptions {
  /** git URL（http/https —— protocol 层已校验）。 */
  url: string
  /** 分支名（非空 —— AddSourceRepoRequestSchema 已强制 min(1)）。 */
  branch: string
  /** 目标绝对路径（已被 caller 算好）。 */
  destDir: string
  /** workspace 绝对路径（沙箱断言锚点）。 */
  workspaceRoot: string
  /** 可选超时（默认 GIT_CLONE_TIMEOUT_MS）。 */
  timeoutMs?: number
  /** 可选 abort signal（client 端取消时触发）。 */
  signal?: AbortSignal
}

/** clone 成功的返回（host service 写入 KV 用）。 */
export interface CloneSourceResult {
  /** clone 后 `git rev-parse HEAD` 的 SHA（7-40 字符 hex）。 */
  lastCommitSha: string
  /** 落盘的相对路径（相对 workspaceRoot，便于跨机器恢复时只存相对段）。
   *  与 SourceRepo.localPath 字段语义一致。 */
  localPath: string
  /** true = destDir 已存在且含 .git/,本次跳过 git clone 仅复用已 clone 的仓库。 */
  reused: boolean
}

/* ── 模块级 git 二进制探测缓存 ── */

/** git --version 探测结果缓存（plugin 启动后 probe 一次）。 */
let gitAvailable: boolean | undefined

/**
 * 探测 git 二进制是否可用。`git --version` 退出码 0 即视为可用。
 *
 * 注意：结果是模块级缓存 —— 假设 git 不会在进程生命周期内动态消失
 * （卸载 git 需要重启 OS）。如果未来要做"运行时重探测"，可改为
 * 每次调用都跑。
 */
export async function probeGit(): Promise<boolean> {
  if (gitAvailable !== undefined) return gitAvailable
  await new Promise<void>((resolveProbe) => {
    const proc = spawn('git', ['--version'], { stdio: 'ignore', env: gitSpawnEnv() })
    proc.on('error', () => { resolveProbe() })
    proc.on('exit', (code) => {
      gitAvailable = code === 0
      resolveProbe()
    })
  })
  return gitAvailable ?? false
}

/* ── 沙箱断言 ── */

/**
 * 断言 destDir 位于 `${workspaceRoot}/repos/` 内。
 * 防止 caller 误传或恶意 url 携带 `..` 写穿 workspace。
 *
 * 实现细节：
 *   - 用 `resolve` 绝对化两条路径，规避相对路径 / 符号链接带来的前缀误判
 *   - 用 `+ sep` 防"repos-other"被前缀匹配进"repos/"
 */
function assertSandboxed(workspaceRoot: string, destDir: string): void {
  const root = resolve(workspaceRoot)
  const target = resolve(destDir)
  const expectedPrefix = root + sep + SKY_AXIS_REPOS_DIR + sep
  if (target !== root && !target.startsWith(expectedPrefix)) {
    throw new SkyAxisHostError(
      'git-sandbox-violation',
      `destDir must be under ${expectedPrefix}, got ${target}`,
    )
  }
}

/* ── spawn 封装（私有） ── */

/**
 * 跑一个 git 子进程，累积 stderr，硬超时 + abort signal 支持。
 *
 * 返回 discriminated union —— 不直接抛 SkyAxisHostError，让 caller
 * 根据语义映射到具体错误码（clone 失败 vs checkout 失败 vs not-installed）。
 */
function runGit(
  args: readonly string[],
  opts: { timeoutMs: number; signal?: AbortSignal; cwd?: string },
): Promise<SpawnOk | SpawnErr> {
  return new Promise((resolveRun) => {
    let stderrBuf = ''
    let killed = false

    const proc = spawn('git', args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
      // 显式 no detached；macOS 上 git 默认不会 detach，但加显式声明更安全
      detached: false,
      // Plan J:headless 模式下禁止 git 在 stdin 上弹凭证提示 —— 失败时露出真正错误
      env: gitSpawnEnv(),
    })

    const finish = (result: SpawnOk | SpawnErr) => {
      if (killed) return
      killed = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolveRun(result)
    }

    // 收集 stderr（截断到 STDERR_COLLECT_LIMIT）
    proc.stderr.on('data', (chunk: Buffer) => {
      if (stderrBuf.length >= STDERR_COLLECT_LIMIT) return
      const rest = STDERR_COLLECT_LIMIT - stderrBuf.length
      stderrBuf += chunk.toString('utf8').slice(0, rest)
    })

    proc.on('error', (e) => {
      // ENOENT = git 二进制不存在；EACCES = 不可执行；都视为 not-installed
      const reason: SpawnErr['reason'] = (e as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'not-installed'
        : 'not-installed'
      finish({ ok: false, reason, stderr: stderrBuf || e.message })
    })

    proc.on('exit', (code) => {
      if (code === 0) {
        finish({ ok: true, code: 0, stderr: stderrBuf })
      } else {
        finish({ ok: false, reason: 'exit', code: code ?? -1, stderr: stderrBuf })
      }
    })

    // 硬超时
    const timer = setTimeout(() => {
      if (killed) return
      proc.kill('SIGTERM')
      // 给 git 一个 grace period 自己清理；若仍未退出，SIGKILL 兜底
      setTimeout(() => {
        if (!killed) proc.kill('SIGKILL')
      }, 2000).unref()
      finish({ ok: false, reason: 'timeout', stderr: stderrBuf })
    }, opts.timeoutMs)

    // client abort signal
    const onAbort = () => {
      if (killed) return
      proc.kill('SIGTERM')
      finish({ ok: false, reason: 'timeout', stderr: stderrBuf + '\n[aborted by client]' })
    }
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort()
        return
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

/* ── public API ── */

/** GitService —— 单例，所有方法 stateless。 */
export interface GitService {
  /**
   * Clone 源码仓库到 `${workspaceRoot}/repos/{destDir-basename}`。
   * 失败时抛 SkyAxisHostError（git-clone-failed / git-checkout-failed / git-timeout）。
   * 不负责清理 destDir —— caller（service 层）在失败时显式 rm。
   */
  clone(opts: CloneSourceOptions): Promise<CloneSourceResult>
  /** 安全删除 destDir（沙箱断言必须通过）。失败抛 SkyAxisHostError(内部错误)。 */
  removeSafe(destDir: string, workspaceRoot: string): Promise<void>
}

export function createGitService(): GitService {
  return {
    async clone(opts) {
      // 1. 沙箱断言（caller 已经算好 destDir，这里再做一次兜底防御）
      assertSandboxed(opts.workspaceRoot, opts.destDir)

      // 2. 探测 git 是否可用（首次会走 spawn，缓存后无开销）
      const available = await probeGit()
      if (!available) {
        throw new SkyAxisHostError(
          'git-not-installed',
          'git binary not found in PATH; install git or run from a shell that has it on PATH',
        )
      }

      // 3. 确保父目录存在（destDir 还不存在，git clone 会自己创建；但若
      //    workspace 还未挂载 .sky-axis，先建好父目录免得 git 报 parent missing）
      await mkdir(dirname(opts.destDir), { recursive: true })

      const timeoutMs = opts.timeoutMs ?? GIT_CLONE_TIMEOUT_MS

      // 3.5 复用已 clone 的目录：destDir 已存在 + 含 .git/ 子目录 → 跳过 git clone
      //     场景：同 repo 被不同 requirement 关联（caller 已 KV dedup,这里只
      //     处理「跨 requirement 复用」），避免每次 clone 100MB 仓库浪费流量。
      //     注意：只复用,不复用 branch —— 用户期望的 branch 可能在已 clone
      //     的 repo 上不存在,跳过 checkout 由 caller 决定是否提示。
      if (await dirExistsWithGit(opts.destDir)) {
        // ⚠️ 半成品检测：destDir 存在 + 含 .git/ 但不是完整 git repo 时,中止
        //   并抛 git-clone-incomplete —— 不进入 rev-parse HEAD,避免被包装成
        //   笼统的 git-clone-failed。典型场景：
        //     a) 上次 clone 异常终止（SIGTERM / 网络断 / 进程崩溃），git 内部
        //        已创建 .git/ 但 objects / HEAD / refs 不全;
        //     b) 用户手动 git init 一个空目录（没 commit）;
        //     c) 上次 clone 成功后被人为删 worktree 但留 .git/。
        //   探测方法：`git -C <dir> rev-parse HEAD` —— 完整 repo 必然 HEAD 指向
        //   有效 SHA;空 init / 半成品 / 指向不存在 ref 的 HEAD 都会 exit !== 0。
        //   短超时 5s 防御半成品 hang。
        const complete = await isCompleteGitRepo(opts.destDir, opts.signal)
        if (!complete) {
          throw new SkyAxisHostError(
            'git-clone-incomplete',
            `destination ${opts.destDir} contains an incomplete git repository ` +
            `(possibly from a previous failed/terminated clone). ` +
            `Please inspect the directory and clean it up manually before retrying.`,
          )
        }
        const sha = await readHeadSha(opts.destDir, timeoutMs, opts.signal)
        const localPath = relativePath(opts.workspaceRoot, opts.destDir)
        return { lastCommitSha: sha, localPath, reused: true }
      }

      // 4. 首选：git clone --branch <branch> --single-branch <url> <destDir>
      const primary = await runGit(
        ['clone', '--branch', opts.branch, '--single-branch', opts.url, opts.destDir],
        { timeoutMs, signal: opts.signal },
      )
      if (primary.ok) {
        // 5a. 成功 → 取 HEAD SHA
        const sha = await readHeadSha(opts.destDir, timeoutMs, opts.signal)
        const localPath = relativePath(opts.workspaceRoot, opts.destDir)
        return { lastCommitSha: sha, localPath, reused: false }
      }

      // 5b. primary 失败 → 视 reason 决定是否 fallback
      if (primary.reason === 'not-installed') {
        throw new SkyAxisHostError('git-not-installed', primary.stderr || 'git not installed')
      }
      if (primary.reason === 'timeout') {
        throw new SkyAxisHostError('git-timeout', truncate(primary.stderr, 500))
      }

      // 5c. exit !== 0 —— 可能是 branch 不存在 / 协议错误 / 网络问题。
      //     清理掉 primary 可能创建的半成品目录（git clone 失败时不会自动清理）
      await safeRmdir(opts.destDir).catch(() => undefined)

      // Plan K：根因明显是网络 / 鉴权问题时跳过 fallback,直接抛错。
      //   fallback(再来一次 5min 网络尝试)对这类错误毫无意义 —— 只会让用户
      //   等满 10min 才看到同样的错误。
      if (NETWORK_ERROR_RE.test(primary.stderr)) {
        throw cloneFailed(primary.stderr, primary.code)
      }

      // 5d. fallback: 先 clone 默认分支，再 checkout -b 创建分支
      //     （用于"远程确实没这个 branch、用户希望创建本地新分支"的场景）
      const fallbackClone = await runGit(
        ['clone', opts.url, opts.destDir],
        { timeoutMs, signal: opts.signal },
      )
      if (!fallbackClone.ok) {
        if (fallbackClone.reason === 'not-installed') {
          throw new SkyAxisHostError('git-not-installed', fallbackClone.stderr)
        }
        if (fallbackClone.reason === 'timeout') {
          throw new SkyAxisHostError('git-timeout', truncate(fallbackClone.stderr, 500))
        }
        // Plan J：cloneFailed() 识别 GitLab「Unencrypted HTTP is not supported」
        //   模式,改写 detail 让用户立即知道该用 https:// 或 ssh://
        throw cloneFailed(fallbackClone.stderr, fallbackClone.code)
      }

      const checkout = await runGit(
        ['-C', opts.destDir, 'checkout', '-b', opts.branch],
        { timeoutMs: Math.min(timeoutMs, 60_000), signal: opts.signal },
      )
      if (!checkout.ok) {
        if (checkout.reason === 'not-installed') {
          throw new SkyAxisHostError('git-not-installed', checkout.stderr)
        }
        if (checkout.reason === 'timeout') {
          throw new SkyAxisHostError('git-timeout', truncate(checkout.stderr, 500))
        }
        // checkout 失败 → 整个 destDir 视为失败，caller 会 rm
        throw new SkyAxisHostError(
          'git-checkout-failed',
          truncate(checkout.stderr, 500) || `git checkout -b exited with code ${checkout.code}`,
        )
      }

      const sha = await readHeadSha(opts.destDir, timeoutMs, opts.signal)
      const localPath = relativePath(opts.workspaceRoot, opts.destDir)
      return { lastCommitSha: sha, localPath, reused: false }
    },

    async removeSafe(destDir, workspaceRoot) {
      // 沙箱断言：保证只删 repos/ 下的目录
      assertSandboxed(workspaceRoot, destDir)
      await safeRmdir(destDir)
    },
  }
}

/* ── 内部 helper ── */

/** `git -C <destDir> rev-parse HEAD` → SHA 字符串。失败抛 git-clone-failed。 */
async function readHeadSha(destDir: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
  const sha = await new Promise<string>((resolveSha, rejectSha) => {
    let out = ''
    let stderrBuf = ''
    let killed = false

    const proc = spawn('git', ['-C', destDir, 'rev-parse', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Plan J:同 runGit() —— 禁止 git 在 stdin 弹凭证提示
      env: gitSpawnEnv(),
    })

    const finish = (code: number | null) => {
      if (killed) return
      killed = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (code === 0) {
        resolveSha(out.trim())
      } else {
        rejectSha(new SkyAxisHostError(
          'git-clone-failed',
          `rev-parse HEAD failed: ${truncate(stderrBuf, 500) || `exit ${code}`}`,
        ))
      }
    }

    proc.stdout.on('data', (c: Buffer) => { out += c.toString('utf8') })
    proc.stderr.on('data', (c: Buffer) => {
      if (stderrBuf.length >= STDERR_COLLECT_LIMIT) return
      stderrBuf += c.toString('utf8').slice(0, STDERR_COLLECT_LIMIT - stderrBuf.length)
    })
    proc.on('error', () => finish(-1))
    proc.on('exit', (code) => finish(code))

    const timer = setTimeout(() => {
      if (killed) return
      proc.kill('SIGTERM')
      setTimeout(() => { if (!killed) proc.kill('SIGKILL') }, 1000).unref()
      rejectSha(new SkyAxisHostError('git-timeout', 'rev-parse HEAD timeout'))
    }, timeoutMs)

    const onAbort = () => {
      if (killed) return
      proc.kill('SIGTERM')
      rejectSha(new SkyAxisHostError('git-timeout', 'rev-parse HEAD aborted'))
    }
    if (signal) {
      if (signal.aborted) { onAbort(); return }
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })

  if (!/^[a-f0-9]{7,40}$/.test(sha)) {
    throw new SkyAxisHostError('git-clone-failed', `rev-parse HEAD returned invalid SHA: ${sha.slice(0, 20)}`)
  }
  return sha
}

/** 把 destDir 相对于 workspaceRoot 算成 `a/b/c` 形式（无前导 `/`）。 */
function relativePath(workspaceRoot: string, destDir: string): string {
  const root = resolve(workspaceRoot)
  const target = resolve(destDir)
  if (target === root) return ''
  const rel = target.startsWith(root + sep) ? target.slice(root.length + 1) : target
  return rel.split(sep).join('/') // 强制 POSIX 风格路径，便于跨平台
}

/** 截断字符串到 maxLen（用于 SourceRepo.cloneError，UI 长度上限 500）。 */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + '…'
}

/**
 * Plan J：GitLab 16+ 默认拒绝明文 HTTP 的错误文案(多版本略有差异)。
 * 匹配范围刻意宽到「任何 Gitea / GitLab / Gitness 自部署实例也会触发同关键词」的形态。
 */
const GITLAB_HTTP_REFUSAL_RE =
  /unencrypted\s+http\s+is\s+not\s+supported(?:\s+for\s+gitlab)?/i

/**
 * Plan K：网络层 / SSH 鉴权失败关键词。primary clone 命中后跳过 fallback
 *   (避免二次 5min 累加),直接通过 cloneFailed() 抛错给用户。
 *
 * 关键词取自 git / ssh / curl 在网络错误时的标准 stderr —— 跨
 *   GitHub / GitLab / Gitea / Gitness / 自部署 server 都覆盖。
 *
 * 注意:`\b` word boundary 对含 `:` / `(` 的英文短语需要豁免 —— 正则在
 *   词边界判断时 `:` / `(` 会被切;我们故意在 `:host` / `(publickey)`
 *   处不加 boundary,直接匹配。
 */
/**
 * Plan K：网络层 / SSH 鉴权失败关键词。primary clone 命中后跳过 fallback
 *   (避免二次 5min 累加),直接通过 cloneFailed() 抛错给用户。
 *
 * @internal 公开以便 tests/git-service.test.ts 单元测试断言。
 */
export const NETWORK_ERROR_RE =
  /(connection timed out|operation timed out|could not resolve host|connection refused|no route to host|Permission denied \(publickey\)|ssh: connect to host|Host key verification failed)/i

/**
 * Plan J：把 git clone 的 stderr 包装成 SkyAxisHostError('git-clone-failed')。
 * 优先识别「服务器拒绝明文 HTTP」模式(GitLab 典型错误),改写 detail 让用户
 * 立刻知道该用 https:// 或 ssh://;其他错误保持原样以避免误改写。
 *
 * @internal 公开以便 tests/git-service.test.ts 单元测试断言。
 */
export function cloneFailed(
  stderr: string,
  code: number | undefined,
): SkyAxisHostError {
  const trimmed = truncate(stderr, 500)
  if (GITLAB_HTTP_REFUSAL_RE.test(stderr)) {
    return new SkyAxisHostError(
      'git-clone-failed',
      `server rejected plain-HTTP URL; use https:// or ssh:// instead (detail: ${trimmed})`,
    )
  }
  return new SkyAxisHostError(
    'git-clone-failed',
    trimmed || `git clone exited with code ${code}`,
  )
}

/** 容错的 rm -rf(destDir 不存在时静默,否则抛)。 */
async function safeRmdir(destDir: string): Promise<void> {
  await rm(destDir, { recursive: true, force: true })
}

/** 异步判断 destDir 是否已存在且含 `.git/` 子目录（确认是已 clone 的 git repo）。 */
async function dirExistsWithGit(destDir: string): Promise<boolean> {
  try {
    await access(join(destDir, '.git'))
    return true
  } catch {
    return false
  }
}

/**
 * 探测 destDir/.git/ 是否为「完整」的 git repo —— 即能否成功 `rev-parse HEAD`。
 *
 * 用 5s 短超时,防止某些异常状态(例如 `.git/` 是 broken symlink / partial
 * objects pack)让 rev-parse 长时间挂起。
 *
 * false 不区分「不是 git repo」/「半成品」/「HEAD 指向不存在 ref」——
 * 这三种对调用方(caller)语义一致:不能让 git clone 默默复用,需要用户介入。
 */
async function isCompleteGitRepo(destDir: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await access(join(destDir, '.git'))
  } catch {
    return false
  }
  const result = await runGit(['-C', destDir, 'rev-parse', 'HEAD'], {
    timeoutMs: 5_000,
    signal,
  })
  return result.ok
}
