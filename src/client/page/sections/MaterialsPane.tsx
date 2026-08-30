/**
 * MaterialsPane —— 详情页 tab「需求物料」内容区。
 *
 * Phase 1.13 范围（占位版）：
 *   - 顶部物料说明 + 「待配置」badge
 *   - 5 个 section 标题（PRD / 源码关联 / 设计稿 / 附件 / 外部链接）—— 默认全部折叠
 *   - 每个 section 显示「Phase 2.5 待实现」placeholder
 *   - 列表上方提示用户「先配物料再启动 AI」—— 引导去配置
 *
 * Phase 2.5 增量（计划）：
 *   - PRD：上传（多文件）/ 链接（confluence / 语雀 / Figma embed）
 *   - 源码关联：repo URL + branch + last commit SHA
 *   - 设计稿：Figma / Sketch 链接 + 缩略图
 *   - 附件：任意文件（图片 / PDF / 文档）
 *   - 外部链接：按 kind 分类（API 文档 / 会议纪要 / 调研报告）
 *   - 全部数据走 protocol.ts RequirementSchema 新增 materials 字段
 *   - AI 工作台 tab 顶部读 materials 数量显示徽标
 *
 * 数据来源：完全受控 props（parent 传 t + requirement）。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useState } from 'react'
import { WarningTriangleIcon } from '../../icons/icons.tsx'
import type { RequirementEntry } from '../../controller/sky-axis-controller.ts'
import css from './MaterialsPane.module.css'

export interface MaterialsPaneProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
}

interface Section {
  /** i18n key（string —— 运行时 locale 系统支持 fallback，编译期 LocaleKeysOf 不允许 string 注入）。 */
  titleKey: string
  /** section 内 placeholder 文案 key。 */
  placeholderKey: string
}

/** 5 个物料 section 顺序与文案（按 AI 工作台依赖优先级排）。 */
const SECTIONS: Section[] = [
  { titleKey: 'requirement.detail.materials.section.prd.title', placeholderKey: 'requirement.detail.materials.placeholder' },
  { titleKey: 'requirement.detail.materials.section.repos.title', placeholderKey: 'requirement.detail.materials.placeholder' },
  { titleKey: 'requirement.detail.materials.section.design.title', placeholderKey: 'requirement.detail.materials.placeholder' },
  { titleKey: 'requirement.detail.materials.section.attachments.title', placeholderKey: 'requirement.detail.materials.placeholder' },
  { titleKey: 'requirement.detail.materials.section.links.title', placeholderKey: 'requirement.detail.materials.placeholder' },
]

export function MaterialsPane({ t, requirement }: MaterialsPaneProps): JSX.Element {
  // t 强转为 (k: string) => string —— titleKey/placeholderKey 是动态字符串
  const tAny = t as unknown as (k: string) => string
  // 默认展开 PRD + 源码关联（AI 工作台高频依赖这两个）
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([0, 1]))
  const toggle = (idx: number): void => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  return (
    <div className={css.pane}>
      {/* 头部：物料说明 + 引导 */}
      <header className={css.header}>
        <div className={css.headerMain}>
          <h3 className={css.title}>{t('requirement.detail.materials.title')}</h3>
          <p className={css.subtitle}>{t('requirement.detail.materials.subtitle')}</p>
        </div>
        <span className={css.badge}>{t('requirement.detail.materials.unconfiguredBadge')}</span>
      </header>

      {/* 引导提示 */}
      <section className={css.guidance}>
        <WarningTriangleIcon size={14} className={css.guidanceIcon} />
        <p className={css.guidanceText}>{t('requirement.detail.materials.guidance')}</p>
      </section>

      {/* 物料统计（占位：实际由 materials 字段计算） */}
      <section className={css.statsRow}>
        <span className={css.statsLabel}>{t('requirement.detail.materials.statsLabel')}</span>
        <span className={css.statsValue}>0</span>
      </section>

      {/* 5 个 section 折叠列表 */}
      <ol className={css.sectionList}>
        {SECTIONS.map((section, idx) => {
          const isOpen = expanded.has(idx)
          return (
            <li key={section.titleKey} className={css.sectionItem}>
              <button
                type="button"
                className={css.sectionHeader}
                aria-expanded={isOpen}
                onClick={(): void => { toggle(idx) }}
              >
                <span className={css.sectionTitle}>{tAny(section.titleKey)}</span>
                <span className={`${css.sectionChevron} ${isOpen ? css.sectionChevronOpen : ''}`} aria-hidden="true">
                  ▸
                </span>
              </button>
              {isOpen && (
                <div className={css.sectionBody}>
                  <div className={css.placeholder}>
                    <span className={css.placeholderIcon} aria-hidden="true">○</span>
                    <p className={css.placeholderText}>{tAny(section.placeholderKey)}</p>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {/* 底部 Phase 1.13 占位 */}
      <footer className={css.footer}>
        <p className={css.footerText}>{t('requirement.detail.materials.phaseHint')}</p>
      </footer>
    </div>
  )
}

/** 让 component 标识别名在 DevTools 友好。 */
MaterialsPane.displayName = 'MaterialsPane'