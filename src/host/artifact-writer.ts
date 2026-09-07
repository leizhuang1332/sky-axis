/**
 * sky-axis host 半区 —— AI 阶段产物（artifact）落盘到 `outputs/`。
 *
 * 目的：
 *   - Sprint 4 决策：打通 artifact → 文件的路径形态与原子写流程，
 *     但 **默认不写**（决策 2：打通但默认不写）。调用方（未来 AI 事件桥）
 *     显式调用 writeArtifact() 才落盘；现有 AI 事件流仍走 KV-only 路径。
 *   - 与 writeMaterialFile 同源：原子写、mode 0o600、沙箱断言。
 *   - 与 git-service 的 SKY_AXIS_REPOS_DIR / requirement-service 的
 *     SKY_AXIS_INPUTS_DIR 同源：都是 workspace 顶层目录。
 *
 * 落盘路径形态：
 *   `${workspacePath}/outputs/${artifact.kind}/${reqShortId}-${artifactIdShort}-${slug}.md`
 *     - `reqShortId`：requirementId 替换 `:` 为 `-` 后取前 19 字符（ISO 到秒）
 *     - `artifactIdShort`：artifactId 前 8 字符（UUID like or 自定义）
 *     - `slug`：title 经 sanitize → kebab-case，截断到 50 字符
 *     - 扩展名恒为 `.md`（body 视为 markdown / plan / log 等可读文本；patch 视为
 *       unified diff，存为 .md 后缀文件仍可读）
 *
 * 沙箱：所有 destDir 必须以 `${workspacePath}/outputs/` 开头，否则抛
 * `artifact-sandbox-violation`。这是 path 穿越防护 —— 与 git-service.assertSandboxed
 * 同源但独立（错误码语义不同）。
 *
 * 错误码（统一走 SkyAxisHostError，host routes translateError 自动映射 403）：
 *   - 'validation-failed'：kind 非法 / title 非法 / body 超 200_000
 *   - 'artifact-sandbox-violation'：路径逃逸 outputs/
 *   - 'internal-error'：filesystem IO 失败（write / rename / mkdir）
 */
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { Artifact, ArtifactKind, RequirementId } from '../protocol.ts'

/** 顶层 outputs/ 目录名（与 SKY_AXIS_REPOS_DIR / SKY_AXIS_INPUTS_DIR 同源风格）。 */
export const SKY_AXIS_OUTPUTS_DIR = 'outputs'

/** 落盘文件扩展名（恒为 .md；body 视为 markdown 兼容文本）。 */
const ARTIFACT_FILE_EXT = '.md'

/** title 压缩到 slug 的最大长度。 */
const MAX_SLUG_LENGTH = 50

/* ── 内部 helper ── */

/** requirementId 替换 `:` 为 `-` 后取前 19 字符（与 requirement-service.reqShortId 同算法）。 */
function reqShortId(reqId: RequirementId): string {
  return reqId.replace(/:/g, '-').slice(0, 19)
}

/** artifactId 前 8 字符（artifactId 是任意非空 string，非必 UUID）。 */
function artifactIdShort(artifactId: string): string {
  return artifactId.slice(0, 8)
}

/**
 * title → URL/文件系统安全的 slug。
 *   - 转小写
 *   - 非 `[a-z0-9-]` 替换为 `-`
 *   - 折叠连续 `-` 为单个
 *   - 截断到 50 字符
 *   - 去掉首尾 `-`
 *   - 空字符串 fallback 为 `untitled`
 *
 * 例：「实现方案 v2」→「shi-xian-fang-an-v2」(ASCII-friendly)
 * 例：「中文标题」→「untitled」(中文字符被全部替换为空后 slug 为空)
 */
function titleToSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'untitled' : slug
}

/** 把 artifact.kind 映射到 outputs/ 子目录名（同形态：原样小写）。 */
function outputsSubdirFor(kind: ArtifactKind): string {
  // kind 是字面量联合,switch 完整覆盖;不加 default,漏掉一个会 TS error
  switch (kind) {
    case 'plan':   return 'plan'
    case 'patch':  return 'patch'
    case 'note':   return 'note'
    case 'log':    return 'log'
    case 'report': return 'report'
  }
}

/** outputs/{kind} 子目录绝对路径(不实际创建)。 */
function outputsKindDir(workspacePath: string, kind: ArtifactKind): string {
  return join(workspacePath, SKY_AXIS_OUTPUTS_DIR, outputsSubdirFor(kind))
}

/**
 * 沙箱断言：absolutePath 必须位于 `${workspacePath}/outputs/` 内。
 *   - 用 `resolve` 绝对化,规避相对路径 / 符号链接带来的前缀误判
 *   - 用 `+ sep` 防"outputs-other"被前缀匹配进"outputs/"
 */
function assertOutputsSandbox(workspacePath: string, absolutePath: string): void {
  const root = resolve(workspacePath)
  const target = resolve(absolutePath)
  const expectedPrefix = root + sep + SKY_AXIS_OUTPUTS_DIR + sep
  if (target !== root && !target.startsWith(expectedPrefix)) {
    throw new SkyAxisArtifactError(
      'artifact-sandbox-violation',
      `artifact-sandbox-violation: destPath must be under ${expectedPrefix}, got ${target}`,
    )
  }
}

/* ── 错误 ── */

/** artifact-writer 自定义错误(独立于 SkyAxisHostError,语义更窄)。 */
export class SkyAxisArtifactError extends Error {
  constructor(
    readonly code: 'artifact-sandbox-violation' | 'validation-failed' | 'internal-error',
    message: string,
  ) {
    super(message)
    this.name = 'SkyAxisArtifactError'
  }
}

/* ── public API ── */

export interface WriteArtifactResult {
  /** 落盘后的绝对路径。 */
  absolutePath: string
  /** 相对 workspace 路径(`outputs/${kind}/${reqShortId}-${artifactIdShort}-${slug}.md`)。 */
  relativePath: string
}

/**
 * 把 artifact 落盘到 `${workspacePath}/outputs/${kind}/${fileName}`。
 *
 * 不会改写 artifact —— caller 决定是否把 relativePath 回写到 artifact.path 字段
 * (典型调用方会在 update KV 时把 result.relativePath 写到对应 artifact.path)。
 *
 * 失败抛 SkyAxisArtifactError —— host routes catch 后 translateError。
 *
 * @throws SkyAxisArtifactError
 *   - 'artifact-sandbox-violation'（理论上不会触发 —— 内部路径算法不会逃逸,
 *     但保留以防未来 refactor）
 *   - 'validation-failed'：body 超 200_000 / kind 非法
 *   - 'internal-error'：fs IO 失败（mkdir / writeFile / rename）
 */
export async function writeArtifact(args: {
  workspacePath: string
  requirementId: RequirementId
  artifact: Artifact
}): Promise<WriteArtifactResult> {
  const { workspacePath, requirementId, artifact } = args

  // 1. 沙箱前置断言（writeMaterialFile 同款防御 —— 内部路径算法不会逃逸,
  //    但保留 assert 让 caller 未来误传 workspacePath 时立即抛错）
  const dir = outputsKindDir(workspacePath, artifact.kind)
  assertOutputsSandbox(workspacePath, dir)

  // 2. 算文件名 + 沙箱兜底断言
  const shortReq = reqShortId(requirementId)
  const shortId = artifactIdShort(artifact.id)
  const slug = titleToSlug(artifact.title)
  const baseFilename = `${shortReq}-${shortId}-${slug}${ARTIFACT_FILE_EXT}`
  const absolutePath = join(dir, baseFilename)
  const tmpPath = join(dir, `.${shortId}.tmp`)
  // 兜底再 assert 一次 —— 防止 titleToSlug / reqShortId 算法 bug 引发路径逃逸
  assertOutputsSandbox(workspacePath, absolutePath)

  // 3. 写入(原子)
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeFile(tmpPath, artifact.body, { mode: 0o600 })
    await rename(tmpPath, absolutePath)
  } catch (e) {
    // tmp 残留清理(失败 best-effort,不抛)
    await cleanupArtifactTmp(tmpPath).catch(() => undefined)
    throw new SkyAxisArtifactError(
      'internal-error',
      `write artifact ${artifact.id} failed: ${(e as Error).message}`,
    )
  }

  const relativePath = join(SKY_AXIS_OUTPUTS_DIR, outputsSubdirFor(artifact.kind), baseFilename)
  return { absolutePath, relativePath }
}

/**
 * Best-effort 清理已落盘的 artifact 文件（KV 写失败时由 service 层调）。
 *   - 沙箱断言先通过 → 避免 caller 误传 absolutePath 删错文件
 *   - ENOENT 视为成功（并发场景下已被别的写覆盖）
 *   - 其他错误静默（不影响主流程的错误传播）
 */
export async function cleanupArtifact(workspacePath: string, absolutePath: string): Promise<void> {
  assertOutputsSandbox(workspacePath, absolutePath)
  try {
    const { unlink } = await import('node:fs/promises')
    await unlink(absolutePath)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.warn(`[sky-axis] cleanupArtifact ${absolutePath} failed: ${err.code ?? 'unknown'}`)
    }
  }
}

/** Best-effort 清掉 .tmp 残留（writeArtifact 失败路径内部用）。 */
async function cleanupArtifactTmp(tmpPath: string): Promise<void> {
  try {
    const { unlink } = await import('node:fs/promises')
    await unlink(tmpPath)
  } catch {
    // .tmp 不存在是正常的;其他错误静默
  }
}

/* ── 内部 helper 暴露（仅测试用） ── */

export const _internal = {
  reqShortId,
  artifactIdShort,
  titleToSlug,
  outputsSubdirFor,
  outputsKindDir,
}