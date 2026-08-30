/**
 * sky-axis 插件的 storage domain 定义（host 半区持久化单元）。
 *
 * 一个 domain（domain 名 = `sky_axis_requirements`）一个 table（`requirements`），
 * 每条记录是一份需求实体（schema 见 protocol.ts 的 RequirementSchema）。
 *
 * 表名 / domain 名必须满足 storage 后端的 UNIT_NAME_RE（^[a-z][a-z0-9_]*$）。
 * `domain-name + table-name` 在 host 进程全局唯一 —— 我们用 `sky_axis_` 前缀避免
 * 与 DSH 内置 domain 冲突。
 *
 * 持久化路径由 host 启动期 storage-json backend 配置决定（sky-axis 不持有
 * 路径信息 —— storage hub 决定 backend，backend 决定 root，root 决定文件
 * 落盘位置）。
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { RequirementSchema } from '../../protocol.ts'

/**
 * sky_axis_requirements domain 声明。
 *
 * name: 'sky_axis_requirements'  —— 满足 UNIT_NAME_RE（^[a-z][a-z0-9_]*$）
 * version: 1                   —— schema 升级时 +1，backend 拒绝跨版本读写
 * tables.requirements: RequirementSchema —— KV 值校验（zod parse at boundary）
 */
/**
 * sky_axis_requirements domain 声明。
 *
 * name: 'sky_axis_requirements'  —— 满足 UNIT_NAME_RE（^[a-z][a-z0-9_]*$）
 * version: 2                   —— Phase 2.1 完美主义演进：
 *                                   1) 物料 schema 从无到有（MaterialsSchema）
 *                                   2) 所有字段从 .optional().default() 升级为 required
 *                                   3) DSH backend 通过 `version: 2` 体现 schema 重大演进
 * tables.requirements: RequirementSchema —— KV 值校验（zod parse at boundary）
 *
 * ⚠️ 升级注意（DSH backend 物理约束）：
 *   - descriptor.version 与 medium 上已 stamp 的 version 不一致时
 *     **直接 reject `version-mismatch`**（不提供迁移 API）
 *   - 旧 v1 数据无法迁移到 v2 —— 遵循「项目未上线无包袱」原则，**不写迁移脚本**
 *   - dev 升级流程：
 *     1) 拉取最新代码（含 version: 2）
 *     2) 第一次启动会失败：DSH backend 拒绝 v1 medium，输出 `version-mismatch` 错误
 *     3) 删 storage 介质目录（DSH storage-json backend root）后重启
 *     4) 创建全新需求，物料数据走新结构
 */
export const requirementDomain = defineDomain({
  name: 'sky_axis_requirements',
  version: 2,
  tables: {
    requirements: domainTable(RequirementSchema),
  },
})
