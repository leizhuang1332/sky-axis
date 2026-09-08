/**
 * sky-axis host 半区 —— 工作区元信息（`.sky-axis/mate.yaml`）读写。
 *
 * 目的：
 *   - 在每个 sky-axis 管理的 workspace 根目录下放一个 `mate.yaml`，记录：
 *     - schemaVersion：未来 schema 演进时 +1
 *     - workspace.{id, title, path}：冗余存储，便于离线校验
 *     - skyAxis.{version, firstInstalledAt, lastTouchedAt}：sky-axis 元信息
 *     - requirements：Sprint 5 引入，记录当前 workspace 的全部需求数据
 *       （YAML-as-SoT；从此 sky-axis 不再依赖 storage domain 持久化需求）
 *   - 启动期 ensureMeta()：不存在 → 写默认值；存在 → 刷新 lastTouchedAt；
 *     损坏 → 抛 WorkspaceMetaError（让 UI / 启动日志提示用户，不静默修复）
 *
 * 设计原则（Phase 3.x 决策）：
 *   - **0 业务复杂度**：只用一个 zod schema + YAML.stringify/parse；schemaVersion
 *     用 z.literal 锁住，未来升级时通过 +1 触发旧值不兼容
 *   - **原子写**：复用 `writeMaterialFile` 的 `.tmp + rename` 模式
 *     （见 requirement-service.ts 第 158-194 行注释），避免半成品文件
 *   - **mode 0o600**：仅 owner 可读写；`.sky-axis/` 父目录 0o700
 *   - **cross-check**：现有 mate.yaml 的 workspace.path 必须等于调用方传入的
 *     workspacePath；不一致 → 抛 `cross-check-failed`（workspace 被外部移动
 *     后元数据会误导，必须人工介入）
 *
 * Sprint 5 演进（YAML-as-SoT）：
 *   - schemaVersion 1 → 2；保留 v1 兼容（`z.discriminatedUnion`）
 *   - v2 新增 `requirements: Record<RequirementId, Requirement>` 段
 *   - ensureMeta 命中 v1 → 升级到 v2（requirements: {} 空 record）
 *     （Sprint 6 migrate-once 负责把 storage domain 旧数据搬进来）
 *   - readMeta 返回 v1 | v2 union type（caller 用 schemaVersion 判定）
 *
 * 与 git-service / requirement-service 的关系：
 *   - 与 `SKY_AXIS_REPOS_DIR` (`'repos'`)：本模块管 `.sky-axis/mate.yaml`，独立
 *   - 与 `SKY_AXIS_ARTIFACT_NAMESPACE` (`.sky-axis`)：本模块存放位置在同一个
 *     隐藏目录下，但目前 `mate.yaml` 是 `.sky-axis/` 里唯一的文件（未来若有
 *     其他元数据可继续放进这个目录，但本常量只在本模块用，不与其他模块共享）
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import YAML from 'yaml'
import { RequirementIdSchema, RequirementSchema, type WorkspaceId } from '../protocol.ts'

/** mate.yaml 文件名。 */
export const SKY_AXIS_META_FILENAME = 'mate.yaml'

/**
 * 当前 schema 版本。
 *   - Sprint 2 起始 = 1（仅 workspace + skyAxis 段，无 requirements）
 *   - Sprint 5 = 2（新增 requirements 段,YAML-as-SoT）
 *   - 后续 schema 演进时 +1 + 写迁移指南。
 */
export const SKY_AXIS_META_SCHEMA_VERSION = 2 as const

/** mate.yaml 所在目录的相对路径（仅本模块使用，与 SKY_AXIS_REPOS_DIR 独立）。 */
const SKY_AXIS_META_DIR = '.sky-axis'

/* ── zod schema ── */

/** workspace 段：与 `WorkspaceView`(`@deepseek-ai/dsh-api-workspace-controller`)字段对齐 —— 0.1.2 流驱动 cache 直接落 WorkspaceView,这里只取 path/title 用。
 *
 *  Plan H:`id` 是 informational only —— DSH uuid 是入口参数,path 才是
 *  on-disk identity。旧 mate.yaml(含 id)继续 parse;新默认 write 可省略 id。
 *  仅 `path` 在 ensureMeta cross-check 中强制。 */
const WorkspaceSectionSchema = z.object({
  id:    z.string().min(1).optional(),
  title: z.string(),
  path:  z.string().min(1),
})

/** skyAxis 段：插件自身的版本与时间戳。 */
const SkyAxisSectionSchema = z.object({
  version:         z.string(),
  firstInstalledAt: z.string().datetime(),
  lastTouchedAt:   z.string().datetime(),
})

/** v2 新增：requirements 段 —— key = RequirementId, value = Requirement 实体。 */
const RequirementsSectionSchema = z.record(RequirementIdSchema, RequirementSchema)
export type RequirementsSection = z.infer<typeof RequirementsSectionSchema>

/** v1 legacy schema —— 只 workspace + skyAxis,无 requirements 段。 */
const WorkspaceMetaV1Schema = z.object({
  schemaVersion: z.literal(1),
  workspace:     WorkspaceSectionSchema,
  skyAxis:       SkyAxisSectionSchema,
})

/** v2 current schema —— workspace + skyAxis + requirements 段。 */
const WorkspaceMetaV2Schema = z.object({
  schemaVersion: z.literal(SKY_AXIS_META_SCHEMA_VERSION),
  workspace:     WorkspaceSectionSchema,
  skyAxis:       SkyAxisSectionSchema,
  requirements:  RequirementsSectionSchema,
})

/**
 * 完整 mate.yaml schema —— 用 discriminatedUnion 接受 v1 + v2。
 *   - v1 是历史遗留,readMeta 仍可读;ensureMeta 命中 v1 会升级到 v2
 *   - 任何未注册 schemaVersion → throw 'invalid'(fail loud)
 *   - requirements 段缺字段(zod parse fail) → throw 'invalid'
 */
export const WorkspaceMetaSchema = z.discriminatedUnion('schemaVersion', [
  WorkspaceMetaV1Schema,
  WorkspaceMetaV2Schema,
])

/** mate.yaml 反序列化后的完整对象（v1 | v2 union）。 */
export type WorkspaceMeta = z.infer<typeof WorkspaceMetaSchema>

/** v2 形态：caller 拿到 meta 后用 schemaVersion 收窄。 */
export type WorkspaceMetaV2 = z.infer<typeof WorkspaceMetaV2Schema>

/** 构造默认 mate.yaml 对象（host ensureMeta 工厂用,输出 v2 形态）。
 *
 *  Plan H：`workspaceId` 改为 optional —— 传入时写入 `workspace.id`（供日志
 *  / debug 追溯）,不传时 YAML 中省略该字段（path 是唯一身份）。 */
export function defaultWorkspaceMeta(opts: {
  /** 可选 DSH uuid。传入时写入 workspace.id;不传时 YAML 中无该字段。 */
  workspaceId?:   WorkspaceId
  workspaceTitle: string
  workspacePath:  string
  skyAxisVersion: string
  now:            string
}): WorkspaceMetaV2 {
  return {
    schemaVersion: SKY_AXIS_META_SCHEMA_VERSION,
    workspace: {
      ...(opts.workspaceId !== undefined ? { id: opts.workspaceId } : {}),
      title: opts.workspaceTitle,
      path:  opts.workspacePath,
    },
    skyAxis: {
      version:         opts.skyAxisVersion,
      firstInstalledAt: opts.now,
      lastTouchedAt:   opts.now,
    },
    requirements: {},
  }
}

/* ── 错误 ── */

/** workspace-meta 模块自定义错误。code 决定调用方如何分支。 */
export class WorkspaceMetaError extends Error {
  constructor(
    readonly code: 'missing' | 'invalid' | 'cross-check-failed' | 'io-failed',
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceMetaError'
  }
}

/* ── 内部 helper ── */

/** mate.yaml 绝对路径。 */
function metaPath(workspacePath: string): string {
  return join(workspacePath, SKY_AXIS_META_DIR, SKY_AXIS_META_FILENAME)
}

/**
 * 原子写 mate.yaml：`.tmp + rename`（与 writeMaterialFile 同源）。
 *   - mode 0o600,父目录 0o700
 *   - 接受任意 WorkspaceMeta 形态(v1 / v2);本模块只写入 v2,但 v1→v2
 *     升级期间 caller 可以从 readMeta 拿到 v1 后再传回来(防御性兼容)
 */
async function writeMetaAtomic(workspacePath: string, meta: WorkspaceMeta): Promise<void> {
  const target = metaPath(workspacePath)
  const tmp = `${target}.tmp`
  const yaml = YAML.stringify(meta, { lineWidth: 0, indent: 2 })
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await writeFile(tmp, yaml, { mode: 0o600 })
  await rename(tmp, target)
}

/**
 * 把任意 v1/v2 WorkspaceMeta 升级到 v2。
 *   - v1 → 升级:requirements: {}
 *   - v2 → 直接返回
 * 不会写入磁盘;caller 自己决定何时 writeMetaAtomic。
 */
export function upgradeMetaToV2(meta: WorkspaceMeta): WorkspaceMetaV2 {
  if (meta.schemaVersion === SKY_AXIS_META_SCHEMA_VERSION) {
    return meta
  }
  return {
    schemaVersion: SKY_AXIS_META_SCHEMA_VERSION,
    workspace: meta.workspace,
    skyAxis: meta.skyAxis,
    requirements: {},
  }
}

/* ── public API ── */

/**
 * 读取并 parse 现有 mate.yaml。
 *
 * 错误映射：
 *   - ENOENT → `missing`（调用方在 ensureMeta 中按 missing 走初始化分支）
 *   - 其他读错误 / YAML parse 失败 / zod schema mismatch → `invalid`（启动期应 fail loud）
 *
 * @throws WorkspaceMetaError
 */
export async function readMeta(workspacePath: string): Promise<WorkspaceMeta> {
  const path = metaPath(workspacePath)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      throw new WorkspaceMetaError('missing', `${path} not found`)
    }
    throw new WorkspaceMetaError('io-failed', `read ${path} failed: ${err.message ?? 'unknown'}`)
  }
  let parsed: unknown
  try {
    parsed = YAML.parse(raw)
  } catch (e) {
    throw new WorkspaceMetaError(
      'invalid',
      `${path} YAML parse failed: ${(e as Error).message}`,
    )
  }
  const result = WorkspaceMetaSchema.safeParse(parsed)
  if (!result.success) {
    throw new WorkspaceMetaError(
      'invalid',
      `${path} schema mismatch: ${result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    )
  }
  return result.data
}

/**
 * 读取 mate.yaml 的 `requirements` 段。v1 / v2 都支持 —— v1 自动视为空 record。
 *
 * 错误：
 *   - 文件损坏(YAML parse / schema mismatch)→ 抛 `WorkspaceMetaError('invalid')`
 *     —— caller（一般是 requirements-store）应包成 `SkyAxisHostError('yaml-parse-failed')`
 *   - 文件不存在 → 视为空 record(Sprint 6 migration 在写入 requirements 段前应
 *     走 ensureMeta 初始化 mate.yaml;但 requirements-store 单独调用本函数时若
 *     meta 缺失也应返回空而不是抛错,便于只读场景降级)
 *
 * @throws WorkspaceMetaError
 */
export async function readRequirementsSection(
  workspacePath: string,
): Promise<RequirementsSection> {
  let meta: WorkspaceMeta
  try {
    meta = await readMeta(workspacePath)
  } catch (e) {
    if (e instanceof WorkspaceMetaError && e.code === 'missing') {
      return {}
    }
    throw e
  }
  return upgradeMetaToV2(meta).requirements
}

/**
 * 替换 mate.yaml 的 `requirements` 段 + 刷新 lastTouchedAt。
 *
 * **不**取文件锁 — 由 caller（requirements-store）通过 fs-lock.withFileLock
 * 包住 read-modify-write 整段;本函数只做「在已有 meta 上下文里改 requirements
 * 段并原子写」。
 *
 * 错误：
 *   - 文件不存在 → 抛 `WorkspaceMetaError('io-failed', ...)`（caller 应先用
 *     ensureMeta 初始化 mate.yaml）
 *   - 文件损坏 / 读 IO 错 → 透传 WorkspaceMetaError,caller 包成 yaml-* 错
 *   - atomic write 失败 → 抛 `WorkspaceMetaError('io-failed', ...)`
 *
 * @throws WorkspaceMetaError
 */
export async function writeRequirementsSection(
  workspacePath: string,
  section: RequirementsSection,
  opts: { now: string },
): Promise<void> {
  let existing: WorkspaceMeta
  try {
    existing = await readMeta(workspacePath)
  } catch (e) {
    if (e instanceof WorkspaceMetaError && e.code === 'missing') {
      throw new WorkspaceMetaError(
        'io-failed',
        `mate.yaml missing for ${workspacePath}; call ensureMeta() before writeRequirementsSection()`,
      )
    }
    throw e
  }

  const upgraded = upgradeMetaToV2(existing)
  const newMeta: WorkspaceMetaV2 = {
    schemaVersion: SKY_AXIS_META_SCHEMA_VERSION,
    workspace:     upgraded.workspace,
    skyAxis: {
      ...upgraded.skyAxis,
      lastTouchedAt: opts.now,
    },
    requirements:  section,
  }

  // 用包内私有 writeMetaAtomic 做 .tmp + rename(mode 0o600)
  const target = metaPath(workspacePath)
  const tmp = `${target}.tmp`
  const yaml = YAML.stringify(newMeta, { lineWidth: 0, indent: 2 })
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await writeFile(tmp, yaml, { mode: 0o600 })
  await rename(tmp, target)
}

/**
 * 确保 mate.yaml 存在且 valid；不存在 → 写默认值，存在 → 刷新 lastTouchedAt。
 *
 * cross-check（fail loud，Plan H 起仅校验 path）：
 *   - 现有 meta 的 workspace.path 必须等于传入的 workspacePath（不变）
 *   - ~~workspace.id 也必须等于传入的 workspaceId~~ —— Plan H 移除。DSH 删
 *     + 重建同路径工作区是合法操作,sky-axis 不再因 uuid 轮换而拒绝。
 *   - path 不一致 → 抛 `cross-check-failed`（workspace 被外部移动 / mate.yaml
 *     被拷到别的目录；调用方应让用户手动修,不静默覆盖）
 *
 * Plan H 行为：
 *   - `workspace.id` 是 informational only —— on-disk 身份是 path,不是 DSH uuid
 *   - `opts.workspaceId` 改为 optional：
 *     - 传入 → 写入 `workspace.id`（覆盖旧值,DSH 给新 uuid 时自动 update）
 *     - 不传 → 保留旧 `workspace.id`（若存在）；旧值也缺则 YAML 中省略
 *
 * Sprint 5 增量（YAML-as-SoT）：
 *   - 命中 v1 → 升级到 v2 + requirements: {}（Sprint 6 migration 负责把
 *     storage domain 旧数据 dump 进 requirements 段）
 *   - 命中 v2 → 保留 requirements 内容,只刷元字段
 *
 * 注意：本函数写入是 best-effort，cross-check 在写入前完成。
 *
 * @throws WorkspaceMetaError
 */
export async function ensureMeta(workspacePath: string, opts: {
  /** 可选 DSH uuid。Plan H 起不再强制 cross-check；传入时写入 workspace.id
   *  （覆盖旧值）,不传时保留旧 id（若有）。 */
  workspaceId?:   WorkspaceId
  workspaceTitle: string
  skyAxisVersion: string
  now:            string
}): Promise<WorkspaceMetaV2> {
  let existing: WorkspaceMeta | undefined
  try {
    existing = await readMeta(workspacePath)
  } catch (e) {
    // missing → 走初始化分支；其他错误（invalid / io-failed）向上抛
    if (!(e instanceof WorkspaceMetaError) || e.code !== 'missing') throw e
  }

  let meta: WorkspaceMetaV2
  if (existing === undefined) {
    meta = defaultWorkspaceMeta({
      ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
      workspaceTitle: opts.workspaceTitle,
      workspacePath:  workspacePath,
      skyAxisVersion: opts.skyAxisVersion,
      now:            opts.now,
    })
  } else {
    // Plan H:仅校验 path（id 是 informational,DSH uuid 轮换不抛）
    if (existing.workspace.path !== workspacePath) {
      throw new WorkspaceMetaError(
        'cross-check-failed',
        `mate.yaml workspace.path (${existing.workspace.path}) does not match ` +
        `requested workspacePath (${workspacePath}) — workspace may have been moved`,
      )
    }
    // 保留 firstInstalledAt；刷新 lastTouchedAt；title / version 跟随最新 caller 输入
    // Sprint 5：v1 → v2 升级(requirements 段初始化空 record)
    const upgraded = upgradeMetaToV2(existing)
    // 解析应写入的 id:opts 显式传入优先（DSH 给的新 uuid）,否则保留已有
    const nextId = opts.workspaceId ?? upgraded.workspace.id
    meta = {
      schemaVersion: upgraded.schemaVersion,
      workspace: {
        ...(nextId !== undefined ? { id: nextId } : {}),
        title: opts.workspaceTitle,
        path:  workspacePath,
      },
      skyAxis: {
        version:         opts.skyAxisVersion,
        firstInstalledAt: upgraded.skyAxis.firstInstalledAt,
        lastTouchedAt:   opts.now,
      },
      requirements: upgraded.requirements,
    }
  }

  await writeMetaAtomic(workspacePath, meta)
  return meta
}

/* ── 内部 helper 暴露（仅测试用） ── */

/** 测试可见：mate.yaml 绝对路径计算。 */
export function _metaPath(workspacePath: string): string {
  return metaPath(workspacePath)
}