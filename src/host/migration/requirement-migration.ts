/**
 * sky-axis 一次性迁移 helper —— 把 DSH storage domain `sky_axis_requirements` (v3)
 * 里残留的旧需求数据搬到 `<workspace>/.sky-axis/mate.yaml` 的 `requirements` 段。
 *
 * 适用场景:
 *   - 老版本 host(Phase 1 ~ Phase 2.6)用 `@deepseek-ai/dsh-storage-domain` 存
 *     需求数据;Sprint 5 切换到 YAML-as-SoT
 *   - 用户从老版本升级 DSH 进程到新版本时,storage domain 里仍可能存在未迁移
 *     的 requirement record
 *   - 升级第一次启动时:本模块尝试 open 旧 domain → 把每条 record 搬到对应
 *     workspace 的 mate.yaml → 从 storage domain 删掉 → close domain
 *
 * **幂等**:
 *   - storage domain 已空 → migrate 返回 migrated=0, skipped="empty"
 *   - 启动过迁移后再次启动 → 同上(storage domain record 已删)
 *   - 同一 record 已存在于 mate.yaml(并发 / 重复启动)→ skip + 不删 storage
 *     的那条(避免数据丢失);记录到 result.duplicates
 *
 * **失败兜底**:
 *   - domain open 失败(schema 不匹配 / backend 未启动 / 权限不足)→ 返回
 *     skipped=原因,migrated=0,failed=0;不影响后续 host 启动
 *   - 单条 record 搬不过去 → console.warn + failed++,继续下一条
 *
 * **数据范围**:仅搬 `sky_axis_requirements.requirements` 表(老版本只有这一张
 * 表,对应现在 YAML 的 `requirements` 段)。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import {
  RequirementSchema,
  type Requirement,
  type RequirementId,
} from '../../protocol.ts'
import { updateRequirements } from '../requirements-store.ts'
import type { RequirementHostService } from '../requirement-service.ts'

/**
 * 老版本需求表的 zod schema(与 deleted requirement-domain.ts 内容一致)。
 * 这里**重新定义**而不是 import `requirementDomain` —— 旧文件已删,且本模块
 * 是 only reader,不希望被 service 层耦合。
 */
const LEGACY_REQUIREMENT_DOMAIN = defineDomain({
  name: 'sky_axis_requirements',
  version: 3,
  tables: {
    requirements: domainTable(RequirementSchema),
  },
})

/** 迁移结果。 */
export interface MigrateResult {
  /** 成功搬入 mate.yaml 的条数。 */
  migrated: number
  /** 搬运失败(workspace 找不到 / yaml 写错)的条数。 */
  failed: number
  /** 跳过原因(空 / open 失败 / 其他);空字符串 = 没跳过。 */
  skipped: string
  /** mate.yaml 里已有同 id 但内容不同(冲突保留 storage 那条,不删)。 */
  duplicates: number
  /** 扫描后 storage domain 残留(防止后续重启重复搬)。 */
  remainingInStorage: number
}

/**
 * 跑一次性迁移。
 *
 * 步骤:
 *   1. 调 `ctx.storageDomain.open(LEGACY_REQUIREMENT_DOMAIN)` —— 失败兜底 skip
 *   2. table.entries() 快照遍历(同步 in-memory,不阻塞)
 *   3. 对每条 record:
 *      - 通过 `service.resolveWorkspacePath(req.workspaceId)` 拿到 workspacePath
 *      - 用 `updateRequirements` 写入;mutator 内检 1:1 不变量 + 检查同 id 是否已存在
 *      - 写成功后 → table.delete(id)
 *   4. close domain(幂等)
 *   5. 汇总返回
 *
 * 调用方(`src/index.ts` 启动 effect)在 ensureMeta 之后调一次。
 */
export async function migrateLegacyRequirements(
  ctx: Context,
  service: RequirementHostService,
): Promise<MigrateResult> {
  const emptyResult = (skipped: string): MigrateResult => ({
    migrated: 0,
    failed: 0,
    skipped,
    duplicates: 0,
    remainingInStorage: 0,
  })

  // 1. open
  let domain
  try {
    domain = await ctx.storageDomain.open(LEGACY_REQUIREMENT_DOMAIN)
  } catch (e) {
    const reason = `open failed: ${(e as Error).message ?? 'unknown'}`
    // eslint-disable-next-line no-console
    console.info(`[sky-axis] migration skipped (${reason}); likely no legacy data`)
    return emptyResult(reason)
  }

  try {
    const table = domain.table('requirements')
    if (table.size === 0) {
      return emptyResult('empty')
    }

    const idsToDelete: RequirementId[] = []
    let migrated = 0
    let failed = 0
    let duplicates = 0

    for (const [id, raw] of table.entries()) {
      const req = raw as Requirement
      try {
        // 解析 workspaceId → path(可能失败:workspace 已被删)
        const workspacePath = await service.resolveWorkspacePath(req.workspaceId)
        const now = new Date().toISOString()
        const outcome = await updateRequirements(
          workspacePath,
          ({ current }) => {
            // 冲突:同 id 已在 mate.yaml(并发 / 重启场景)→ 不覆盖,不当 migrated
            if (current[id] !== undefined) {
              throw new DuplicateGuard(id)
            }
            // 1:1 不变量:目标 workspace 已有关联 req → 跳过(避免误覆盖新数据)
            const sameWs = Object.values(current).find(r => r.workspaceId === req.workspaceId)
            if (sameWs !== undefined) {
              throw new DuplicateWorkspace(req.workspaceId, sameWs.id)
            }
            return {
              next: { ...current, [id]: req },
              result: null,
            }
          },
          { now },
        )
        // 写成功 → 加入待删列表
        idsToDelete.push(id as RequirementId)
        migrated++
        void outcome  // unused
      } catch (e) {
        if (e instanceof DuplicateGuard || e instanceof DuplicateWorkspace) {
          duplicates++
          // eslint-disable-next-line no-console
          console.warn(
            `[sky-axis] migration: duplicate for id=${id} (${e.message}); ` +
            `leaving storage copy intact for manual review`,
          )
          // 不 delete —— 留给用户手工决策
        } else {
          failed++
          // eslint-disable-next-line no-console
          console.warn(
            `[sky-axis] migration: failed to move id=${id}: ${(e as Error).message ?? 'unknown'}`,
          )
        }
      }
    }

    // 删 storage domain 已搬走的 record
    for (const id of idsToDelete) {
      try {
        await table.delete(id)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[sky-axis] migration: storage delete ${id} failed:`, e)
      }
    }

    return {
      migrated,
      failed,
      skipped: '',
      duplicates,
      remainingInStorage: table.size,
    }
  } finally {
    await domain.close().catch(() => undefined)
  }
}

/** 内部 sentinel:同 id 已在 mate.yaml,跳过迁移。 */
class DuplicateGuard extends Error {
  constructor(readonly id: string) {
    super(`id ${id} already in mate.yaml`)
    this.name = 'DuplicateGuard'
  }
}

/** 内部 sentinel:目标 workspace 已有别的 req(1:1 冲突),跳过迁移。 */
class DuplicateWorkspace extends Error {
  constructor(
    readonly workspaceId: string,
    readonly existingReqId: string,
  ) {
    super(`workspace ${workspaceId} already has requirement ${existingReqId}`)
    this.name = 'DuplicateWorkspace'
  }
}