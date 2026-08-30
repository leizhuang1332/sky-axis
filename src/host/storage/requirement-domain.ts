/**
 * hello 插件的 storage domain 定义（host 半区持久化单元）。
 *
 * 一个 domain（domain 名 = `hello_requirements`）一个 table（`requirements`），
 * 每条记录是一份需求实体（schema 见 protocol.ts 的 RequirementSchema）。
 *
 * 表名 / domain 名必须满足 storage 后端的 UNIT_NAME_RE（^[a-z][a-z0-9_]*$）。
 * `domain-name + table-name` 在 host 进程全局唯一 —— 我们用 `hello_` 前缀避免
 * 与 DSH 内置 domain 冲突。
 *
 * 持久化路径由 host 启动期 storage-json backend 配置决定（hello 不持有
 * 路径信息 —— storage hub 决定 backend，backend 决定 root，root 决定文件
 * 落盘位置）。
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { RequirementSchema } from '../../protocol.ts'

/**
 * hello_requirements domain 声明。
 *
 * name: 'hello_requirements'  —— 满足 UNIT_NAME_RE（^[a-z][a-z0-9_]*$）
 * version: 1                   —— schema 升级时 +1，backend 拒绝跨版本读写
 * tables.requirements: RequirementSchema —— KV 值校验（zod parse at boundary）
 */
export const requirementDomain = defineDomain({
  name: 'hello_requirements',
  version: 1,
  tables: {
    requirements: domainTable(RequirementSchema),
  },
})
