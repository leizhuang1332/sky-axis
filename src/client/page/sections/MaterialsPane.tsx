/**
 * MaterialsPane —— 详情页 tab「需求物料」内容区。
 *
 * Phase 2.1 增量：读 requirement.materials 真实数据。
 *   - 6 个 section 各自渲染对应子项列表（prdFiles / prdLinks / sourceRepos /
 *     designLinks / attachments / externalLinks）
 *   - 每个 section 显示计数 + 折叠/展开
 *   - 每个 item 展示关键元数据（filename / url / branch / source 等）
 *   - 空 section 显示「未配置」空状态（带 Phase 2.5 待实现提示）
 *   - 总数 = prdFiles.length + prdLinks.length + ...
 *
 * Phase 2.5 待实现：上传按钮 + 链接/源码表单 + 删除（路由 + UI）。
 *
 * 数据来源：完全受控 props（parent 传 t + requirement）。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useState, type JSX } from 'react'
import {
  AttachmentIcon, DesignIcon, GlobeIcon, PrdFileIcon, PrdLinkIcon,
  WarningTriangleIcon,
} from '../../icons/icons.tsx'
import type {
  RequirementEntry, RequirementMaterials,
  RequirementPrdFile, RequirementPrdLink, RequirementSourceRepo,
  RequirementDesignLink, RequirementAttachment, RequirementExternalLink,
} from '../../controller/sky-axis-controller.ts'
import { countRequirementMaterials } from '../../controller/sky-axis-controller.ts'
import type { IconComponent } from '../../icons/icons.tsx'
import css from './MaterialsPane.module.css'

export interface MaterialsPaneProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
}

/* ── Section 配置：titleKey + section icon + 渲染 item 函数 ── */

interface SectionConfig<T> {
  titleKey: string
  emptyKey: string
  icon: IconComponent
  items: T[]
  renderItem: (item: T, t: (k: string) => string) => JSX.Element
}

function bytesHuman(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function dateShort(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch {
    return iso
  }
}

const SOURCE_LABEL: Record<RequirementPrdLink['source'], string> = {
  yuque: '语雀',
  notion: 'Notion',
  confluence: 'Confluence',
  feishu: '飞书',
  custom: '其他',
}

const DESIGN_KIND_LABEL: Record<RequirementDesignLink['kind'], string> = {
  figma: 'Figma',
  sketch: 'Sketch',
  image: '图片',
  embed: '嵌入',
}

const EXTERNAL_KIND_LABEL: Record<RequirementExternalLink['kind'], string> = {
  'api-doc': 'API 文档',
  meeting: '会议纪要',
  research: '调研报告',
  incident: '故障复盘',
  other: '其他',
}

/* ── 6 个 section 的渲染器 ── */

function renderPrdFile(item: RequirementPrdFile, t: (k: string) => string): JSX.Element {
  return (
    <li key={item.id} className={css.item}>
      <div className={css.itemMain}>
        <span className={css.itemTitle}>{item.filename}</span>
        <span className={css.itemMeta}>
          {bytesHuman(item.size)} · {item.mimeType}
        </span>
      </div>
      <span className={css.itemAside}>{dateShort(item.uploadedAt)}</span>
    </li>
  )
}

function renderPrdLink(item: RequirementPrdLink, t: (k: string) => string): JSX.Element {
  return (
    <li key={item.id} className={css.item}>
      <div className={css.itemMain}>
        <span className={css.itemTitle}>{item.title}</span>
        <span className={css.itemMeta}>
          <span className={css.itemTag}>{SOURCE_LABEL[item.source]}</span>
          <span className={css.itemUrl}>{item.url}</span>
        </span>
      </div>
      <span className={css.itemAside}>{dateShort(item.addedAt)}</span>
    </li>
  )
}

function renderSourceRepo(item: RequirementSourceRepo, t: (k: string) => string): JSX.Element {
  return (
    <li key={item.id} className={css.item}>
      <div className={css.itemMain}>
        <span className={css.itemTitle}>
          {item.description !== '' ? item.description : item.url}
        </span>
        <span className={css.itemMeta}>
          <span className={css.itemTag}>{item.branch === '' ? 'default' : item.branch}</span>
          {item.lastCommitSha !== undefined && (
            <span className={css.itemSha}>{item.lastCommitSha}</span>
          )}
          <span className={css.itemUrl}>{item.url}</span>
        </span>
      </div>
      <span className={css.itemAside}>{dateShort(item.addedAt)}</span>
    </li>
  )
}

function renderDesignLink(item: RequirementDesignLink, t: (k: string) => string): JSX.Element {
  return (
    <li key={item.id} className={css.item}>
      <div className={css.itemMain}>
        <span className={css.itemTitle}>{item.title}</span>
        <span className={css.itemMeta}>
          <span className={css.itemTag}>{DESIGN_KIND_LABEL[item.kind]}</span>
          <span className={css.itemUrl}>{item.url}</span>
        </span>
      </div>
      <span className={css.itemAside}>{dateShort(item.addedAt)}</span>
    </li>
  )
}

function renderAttachment(item: RequirementAttachment, t: (k: string) => string): JSX.Element {
  return (
    <li key={item.id} className={css.item}>
      <div className={css.itemMain}>
        <span className={css.itemTitle}>{item.filename}</span>
        <span className={css.itemMeta}>
          {bytesHuman(item.size)} · {item.mimeType}
        </span>
      </div>
      <span className={css.itemAside}>{dateShort(item.uploadedAt)}</span>
    </li>
  )
}

function renderExternalLink(item: RequirementExternalLink, t: (k: string) => string): JSX.Element {
  return (
    <li key={item.id} className={css.item}>
      <div className={css.itemMain}>
        <span className={css.itemTitle}>{item.title}</span>
        <span className={css.itemMeta}>
          <span className={css.itemTag}>{EXTERNAL_KIND_LABEL[item.kind]}</span>
          {item.description !== '' && <span>{item.description}</span>}
          <span className={css.itemUrl}>{item.url}</span>
        </span>
      </div>
      <span className={css.itemAside}>{dateShort(item.addedAt)}</span>
    </li>
  )
}

/* ── 主组件 ── */

export function MaterialsPane({ t, requirement }: MaterialsPaneProps): JSX.Element {
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

  const m: RequirementMaterials = requirement.materials
  const total = countRequirementMaterials(m)
  const isEmpty = total === 0

  const sections: SectionConfig<unknown>[] = [
    {
      titleKey: 'requirement.detail.materials.section.prd.title',
      emptyKey: 'requirement.detail.materials.section.prd.empty',
      icon: PrdFileIcon,
      items: m.prdFiles,
      renderItem: renderPrdFile as (i: unknown, t: (k: string) => string) => JSX.Element,
    },
    {
      titleKey: 'requirement.detail.materials.section.prdLinks.title',
      emptyKey: 'requirement.detail.materials.section.prdLinks.empty',
      icon: PrdLinkIcon,
      items: m.prdLinks,
      renderItem: renderPrdLink as (i: unknown, t: (k: string) => string) => JSX.Element,
    },
    {
      titleKey: 'requirement.detail.materials.section.sourceRepos.title',
      emptyKey: 'requirement.detail.materials.section.sourceRepos.empty',
      icon: WarningTriangleIcon, // 没有现成 GitBranchIcon，复用 WarningTriangle 是兜底
      items: m.sourceRepos,
      renderItem: renderSourceRepo as (i: unknown, t: (k: string) => string) => JSX.Element,
    },
    {
      titleKey: 'requirement.detail.materials.section.design.title',
      emptyKey: 'requirement.detail.materials.section.design.empty',
      icon: DesignIcon,
      items: m.designLinks,
      renderItem: renderDesignLink as (i: unknown, t: (k: string) => string) => JSX.Element,
    },
    {
      titleKey: 'requirement.detail.materials.section.attachments.title',
      emptyKey: 'requirement.detail.materials.section.attachments.empty',
      icon: AttachmentIcon,
      items: m.attachments,
      renderItem: renderAttachment as (i: unknown, t: (k: string) => string) => JSX.Element,
    },
    {
      titleKey: 'requirement.detail.materials.section.externalLinks.title',
      emptyKey: 'requirement.detail.materials.section.externalLinks.empty',
      icon: GlobeIcon,
      items: m.externalLinks,
      renderItem: renderExternalLink as (i: unknown, t: (k: string) => string) => JSX.Element,
    },
  ]

  return (
    <div className={css.pane}>
      {/* 头部 */}
      <header className={css.header}>
        <div className={css.headerMain}>
          <h3 className={css.title}>{t('requirement.detail.materials.title')}</h3>
          <p className={css.subtitle}>{t('requirement.detail.materials.subtitle')}</p>
        </div>
        <span className={`${css.badge} ${isEmpty ? css.badgeEmpty : css.badgeConfigured}`}>
          {isEmpty
            ? t('requirement.detail.materials.unconfiguredBadge')
            : t('requirement.detail.materials.configuredBadge', { count: total })
          }
        </span>
      </header>

      {/* 引导提示：物料为空 / 已配物料 */}
      <section className={css.guidance}>
        <WarningTriangleIcon size={14} className={css.guidanceIcon} />
        <p className={css.guidanceText}>
          {isEmpty
            ? t('requirement.detail.materials.guidanceEmpty')
            : t('requirement.detail.materials.guidanceConfigured')
          }
        </p>
      </section>

      {/* 6 个 section 折叠列表 */}
      <ol className={css.sectionList}>
        {sections.map((section, idx) => {
          const isOpen = expanded.has(idx)
          const count = section.items.length
          const SectionIcon = section.icon
          return (
            <li key={section.titleKey} className={css.sectionItem}>
              <button
                type="button"
                className={css.sectionHeader}
                aria-expanded={isOpen}
                onClick={(): void => { toggle(idx) }}
              >
                <span className={css.sectionHeaderMain}>
                  <SectionIcon size={13} className={css.sectionIcon} />
                  <span className={css.sectionTitle}>{tAny(section.titleKey)}</span>
                  <span className={css.sectionCount}>{count}</span>
                </span>
                <span className={`${css.sectionChevron} ${isOpen ? css.sectionChevronOpen : ''}`} aria-hidden="true">
                  ▸
                </span>
              </button>
              {isOpen && (
                <div className={css.sectionBody}>
                  {count === 0 ? (
                    <div className={css.placeholder}>
                      <span className={css.placeholderIcon} aria-hidden="true">○</span>
                      <p className={css.placeholderText}>{tAny(section.emptyKey)}</p>
                    </div>
                  ) : (
                    <ul className={css.itemList}>
                      {section.items.map(item => section.renderItem(item, tAny))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {/* 底部 Phase 2.5 占位 */}
      <footer className={css.footer}>
        <p className={css.footerText}>{t('requirement.detail.materials.phaseHint')}</p>
      </footer>
    </div>
  )
}

/** 让 component 标识别名在 DevTools 友好。 */
MaterialsPane.displayName = 'MaterialsPane'