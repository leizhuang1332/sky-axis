/**
 * sky-axis host 半区 —— 需求数据（mate.yaml `requirements` 段）读写门面。
 *
 * 目的（Sprint 5：YAML-as-SoT）：
 *   - 把「需求数据持久化」封装到 `mate.yaml` 的 `requirements` 段,替换掉旧的
 *     `@deepseek-ai/dsh-storage-domain`(`sky_axis_requirements` v3)调用
 *   - 对外暴露 read / readSingle / update(mutator)三类操作;mutator 走 read-modify-write
 *     + 文件锁(由 fs-lock.withFileLock 保证跨进程互斥)
 *   - 错误码映射:`WorkspaceMetaError` → `SkyAxisHostError` 用 Sprint 5 新增的
 *     `yaml-parse-failed` / `yaml-write-failed` / `yaml-lock-timeout` 三类 code
 *
 * 设计要点：
 *   - **mutator 模式**:`updateRequirements(workspacePath, mutator, opts)` 拿到
 *     当前 section,caller 决定怎么 mutate,store 负责锁 + atomic write
 *   - **mutator 可返回 result**:caller 想返回一些计算中间值(被删的 requirement
 *     / 新生成的 id / etc.)时不用再多一次 read
 *   - **错误透传**:WorkspaceMetaError 在 store 内被翻译为 SkyAxisHostError;
 *     业务层抛的错(workspace 1:1 冲突 / requirement 不存在)原样传播
 *
 * 与 fs-watcher-manager 的协作(Stage 4 接):
 *   - 本模块对外只暴露 CRUD;fs.watch 引起的外部变更通过 subscribeMateYamlChanges
 *     通知 caller(Stage 4 实现)
 *   - 本模块自己写文件后**不**触发 onChange listener —— 由 caller 决定怎么 emit
 *     DomainChanged 事件
 */
import type { Requirement, RequirementId } from '../protocol.ts'
import { SkyAxisHostError } from './requirement-service.ts'
import { withFileLock } from './fs-lock.ts'
import {
  WorkspaceMetaError,
  readRequirementsSection,
  writeRequirementsSection,
  type RequirementsSection,
} from './workspace-meta.ts'

/** updateRequirements 调用的 mutator 入参 + 出参。 */
export interface RequirementsMutatorContext {
  /** 当前 mate.yaml 的 requirements 段(只读快照;不要 hold 引用跨 fn 边界)。 */
  current: RequirementsSection
}

/** mutator 返回值。 */
export interface RequirementsMutatorResult<T> {
  /** mutate 后的完整 section —— store 负责 atomic write 它。 */
  next: RequirementsSection
  /** 想透传给 caller 的任意值(被删的 req / 新生成的 id / 校验结果)。 */
  result: T
}

/** updateRequirements 入参(锁 / 时间戳相关)。 */
export interface UpdateRequirementsOptions {
  /** 当前时间 ISO 字符串 —— 用于刷新 lastTouchedAt,以及 caller 写 updatedAt。 */
  now: string
  /** 锁超时 ms,默认 5000。 */
  timeoutMs?: number
  /** 中途放弃。 */
  signal?: AbortSignal
}

/** updateRequirements 出参。 */
export interface UpdateRequirementsOutcome<T> {
  /** mutator.result 原样透传。 */
  result: T
  /** mutate 前的 section 快照 —— caller 用于诊断 / 审计。 */
  previous: RequirementsSection
}

/* ── read ── */

/**
 * 读 workspace mate.yaml 的全部 requirements。文件缺失 → 空 record(详见
 * `readRequirementsSection` 注释)。
 *
 * 错误:
 *   - YAML 损坏 / schema 不匹配 → `SkyAxisHostError('yaml-parse-failed')`
 *
 * @throws SkyAxisHostError
 */
export async function readAllRequirements(
  workspacePath: string,
): Promise<RequirementsSection> {
  try {
    return await readRequirementsSection(workspacePath)
  } catch (e) {
    throw translateMetaError(e, workspacePath)
  }
}

/**
 * 读单条 requirement。找不到 → 返回 undefined(caller 走 not-found 分支)。
 *
 * @throws SkyAxisHostError
 */
export async function readRequirement(
  workspacePath: string,
  reqId: RequirementId,
): Promise<Requirement | undefined> {
  const section = await readAllRequirements(workspacePath)
  return section[reqId]
}

/* ── write(mutator 模式)── */

/**
 * 锁 + read-modify-write + atomic write 的高层包装。
 *
 * 用法:
 * ```ts
 * const { result } = await updateRequirements(workspacePath, ({ current }) => {
 *   if (Object.keys(current).length > 0) {
 *     throw new SkyAxisHostError('workspace-already-has-requirement', '...')
 *   }
 *   const id = generateRequirementId()
 *   const req: Requirement = { ... }
 *   return { next: { [id]: req }, result: req }
 * }, { now: new Date().toISOString() })
 * ```
 *
 * 失败语义:
 *   - 锁超时 / signal → `SkyAxisHostError('yaml-lock-timeout')`(fs-lock 抛)
 *   - YAML 损坏 → `SkyAxisHostError('yaml-parse-failed')`
 *   - atomic write 失败 → `SkyAxisHostError('yaml-write-failed')`
 *   - mutator 内部抛错 → 锁释放 + 错误原样传播
 *
 * @throws SkyAxisHostError
 */
export async function updateRequirements<T>(
  workspacePath: string,
  mutator: (ctx: RequirementsMutatorContext) =>
    | RequirementsMutatorResult<T>
    | Promise<RequirementsMutatorResult<T>>,
  opts: UpdateRequirementsOptions,
): Promise<UpdateRequirementsOutcome<T>> {
  return withFileLock(
    workspacePath,
    async () => {
      // 1. read current(锁内)
      let current: RequirementsSection
      try {
        current = await readRequirementsSection(workspacePath)
      } catch (e) {
        throw translateMetaError(e, workspacePath)
      }

      // 2. caller 决定 mutate
      const { next, result } = await mutator({ current })

      // 3. atomic write(锁内)
      try {
        await writeRequirementsSection(workspacePath, next, { now: opts.now })
      } catch (e) {
        throw translateWriteError(e, workspacePath)
      }

      return { result, previous: current }
    },
    { timeoutMs: opts.timeoutMs, signal: opts.signal },
  )
}

/* ── error mapping ── */

/**
 * 把 `WorkspaceMetaError` 翻译成 `SkyAxisHostError` 用 `yaml-parse-failed` /
 * `yaml-write-failed` code。`missing` 不会到这里(被 readRequirementsSection /
 * writeRequirementsSection 内部处理);`cross-check-failed` 透传为内部错误
 * (调用方逻辑 bug —— 不该在 requirements-store 里触发)。
 */
function translateMetaError(e: unknown, workspacePath: string): SkyAxisHostError {
  if (e instanceof WorkspaceMetaError) {
    if (e.code === 'invalid') {
      return new SkyAxisHostError(
        'yaml-parse-failed',
        `mate.yaml for ${workspacePath} invalid: ${e.message}`,
      )
    }
    if (e.code === 'io-failed') {
      return new SkyAxisHostError(
        'yaml-write-failed',
        `mate.yaml IO failed for ${workspacePath}: ${e.message}`,
      )
    }
    if (e.code === 'cross-check-failed') {
      return new SkyAxisHostError(
        'internal-error',
        `mate.yaml cross-check failed for ${workspacePath}: ${e.message}`,
      )
    }
  }
  // 非 WorkspaceMetaError —— 包成 yaml-write-failed(罕见;读 IO 失败等)
  return new SkyAxisHostError(
    'yaml-write-failed',
    `read requirements for ${workspacePath} failed: ${(e as Error).message ?? 'unknown'}`,
  )
}

/** writeRequirementsSection 失败 → yaml-write-failed。 */
function translateWriteError(e: unknown, workspacePath: string): SkyAxisHostError {
  if (e instanceof WorkspaceMetaError) {
    if (e.code === 'io-failed' || e.code === 'missing') {
      return new SkyAxisHostError(
        'yaml-write-failed',
        `write requirements for ${workspacePath} failed: ${e.message}`,
      )
    }
    if (e.code === 'invalid') {
      return new SkyAxisHostError(
        'yaml-parse-failed',
        `mate.yaml for ${workspacePath} invalid before write: ${e.message}`,
      )
    }
    if (e.code === 'cross-check-failed') {
      return new SkyAxisHostError(
        'internal-error',
        `mate.yaml cross-check failed for ${workspacePath}: ${e.message}`,
      )
    }
  }
  return new SkyAxisHostError(
    'yaml-write-failed',
    `write requirements for ${workspacePath} failed: ${(e as Error).message ?? 'unknown'}`,
  )
}