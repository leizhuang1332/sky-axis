/**
 * sky-axis host 半区 —— 工作区元信息（`.sky-axis/mate.yaml`）读写。
 *
 * 目的：
 *   - 在每个 sky-axis 管理的 workspace 根目录下放一个 `mate.yaml`，记录：
 *     - schemaVersion：未来 schema 演进时 +1
 *     - workspace.{id, title, path}：冗余存储，便于离线校验
 *     - skyAxis.{version, firstInstalledAt, lastTouchedAt}：sky-axis 元信息
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
import type { WorkspaceId } from '../protocol.ts'

/** mate.yaml 文件名。 */
export const SKY_AXIS_META_FILENAME = 'mate.yaml'

/** 当前 schema 版本。Sprint 2 起始 = 1；后续 schema 演进时 +1 + 写迁移指南。 */
export const SKY_AXIS_META_SCHEMA_VERSION = 1 as const

/** mate.yaml 所在目录的相对路径（仅本模块使用，与 SKY_AXIS_REPOS_DIR 独立）。 */
const SKY_AXIS_META_DIR = '.sky-axis'

/* ── zod schema ── */

/** workspace 段：与 apiProxy.workspace.list 返回的 workspace 字段对齐。 */
const WorkspaceSectionSchema = z.object({
  id:    z.string().min(1),
  title: z.string(),
  path:  z.string().min(1),
})

/** skyAxis 段：插件自身的版本与时间戳。 */
const SkyAxisSectionSchema = z.object({
  version:         z.string(),
  firstInstalledAt: z.string().datetime(),
  lastTouchedAt:   z.string().datetime(),
})

/** 完整 mate.yaml schema。schemaVersion 用 literal 锁住，避免外部瞎改。 */
export const WorkspaceMetaSchema = z.object({
  schemaVersion: z.literal(SKY_AXIS_META_SCHEMA_VERSION),
  workspace:     WorkspaceSectionSchema,
  skyAxis:       SkyAxisSectionSchema,
})

/** mate.yaml 反序列化后的完整对象。 */
export type WorkspaceMeta = z.infer<typeof WorkspaceMetaSchema>

/** 构造默认 mate.yaml 对象（host ensureMeta 工厂用）。 */
export function defaultWorkspaceMeta(opts: {
  workspaceId:    WorkspaceId
  workspaceTitle: string
  workspacePath:  string
  skyAxisVersion: string
  now:            string
}): WorkspaceMeta {
  return {
    schemaVersion: SKY_AXIS_META_SCHEMA_VERSION,
    workspace: {
      id:    opts.workspaceId,
      title: opts.workspaceTitle,
      path:  opts.workspacePath,
    },
    skyAxis: {
      version:         opts.skyAxisVersion,
      firstInstalledAt: opts.now,
      lastTouchedAt:   opts.now,
    },
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

/** 原子写 mate.yaml：`.tmp + rename`（与 writeMaterialFile 同源）。 */
async function writeMetaAtomic(workspacePath: string, meta: WorkspaceMeta): Promise<void> {
  const target = metaPath(workspacePath)
  const tmp = `${target}.tmp`
  const yaml = YAML.stringify(meta, { lineWidth: 0, indent: 2 })
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await writeFile(tmp, yaml, { mode: 0o600 })
  await rename(tmp, target)
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
 * 确保 mate.yaml 存在且 valid；不存在 → 写默认值，存在 → 刷新 lastTouchedAt。
 *
 * cross-check（fail loud）：
 *   - 现有 meta 的 workspace.path 必须等于传入的 workspacePath
 *   - workspace.id 也必须等于传入的 workspaceId
 *   - 任一不一致 → 抛 `cross-check-failed`（workspace 被外部移动 / ID 改了的
 *     异常态；调用方应让用户手动修，不静默覆盖）
 *
 * 注意：本函数写入是 best-effort，cross-check 在写入前完成。
 *
 * @throws WorkspaceMetaError
 */
export async function ensureMeta(workspacePath: string, opts: {
  workspaceId:    WorkspaceId
  workspaceTitle: string
  skyAxisVersion: string
  now:            string
}): Promise<WorkspaceMeta> {
  let existing: WorkspaceMeta | undefined
  try {
    existing = await readMeta(workspacePath)
  } catch (e) {
    // missing → 走初始化分支；其他错误（invalid / io-failed）向上抛
    if (!(e instanceof WorkspaceMetaError) || e.code !== 'missing') throw e
  }

  let meta: WorkspaceMeta
  if (existing === undefined) {
    meta = defaultWorkspaceMeta({
      workspaceId:    opts.workspaceId,
      workspaceTitle: opts.workspaceTitle,
      workspacePath:  workspacePath,
      skyAxisVersion: opts.skyAxisVersion,
      now:            opts.now,
    })
  } else {
    // cross-check：现有 meta 与当前 caller 上下文是否一致
    if (existing.workspace.path !== workspacePath) {
      throw new WorkspaceMetaError(
        'cross-check-failed',
        `mate.yaml workspace.path (${existing.workspace.path}) does not match ` +
        `requested workspacePath (${workspacePath}) — workspace may have been moved`,
      )
    }
    if (existing.workspace.id !== opts.workspaceId) {
      throw new WorkspaceMetaError(
        'cross-check-failed',
        `mate.yaml workspace.id (${existing.workspace.id}) does not match ` +
        `requested workspaceId (${opts.workspaceId}) — workspace identity changed`,
      )
    }
    // 保留 firstInstalledAt；刷新 lastTouchedAt；title / version 跟随最新 caller 输入
    meta = {
      schemaVersion: existing.schemaVersion,
      workspace: {
        id:    existing.workspace.id,
        title: opts.workspaceTitle,
        path:  workspacePath,
      },
      skyAxis: {
        version:         opts.skyAxisVersion,
        firstInstalledAt: existing.skyAxis.firstInstalledAt,
        lastTouchedAt:   opts.now,
      },
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