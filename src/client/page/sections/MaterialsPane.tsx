/**
 * MaterialsPane —— 详情页 tab「需求物料」内容区。
 *
 * Phase 2.1 增量：读 requirement.materials 真实数据。
 * Phase 2.5 增量：上传 / 添加 / 删除交互。
 *   - 头部右上角「+ 添加物料」按钮 → 打开 MaterialPickerModal
 *   - picker 选 section → 切到 AddMaterialFormModal（dispatcher）
 *   - 每个列表项末尾加 TrashIcon 删除按钮 —— 三态：
 *       default → hover 红 → 二次点击确认 → 3s 自动 revert
 *   - section 配置数组保留 typing 严格性：section → section.icon / renderItem
 *     强绑定，TS 推断避免 cast unknown
 *
 * 数据来源：完全受控 props（parent 传 t + requirement + controller）。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useState, type JSX } from 'react'
import {
  AttachmentIcon, DesignIcon, GlobeIcon, PrdFileIcon, PrdLinkIcon,
  GitBranchIcon, PlusIcon, TrashIcon,
} from '../../icons/icons.tsx'
import type { IconComponent } from '../../icons/icons.tsx'
import {
  countRequirementMaterials,
  type RequirementAttachment,
  type RequirementDesignLink,
  type RequirementEntry,
  type RequirementExternalLink,
  type RequirementMaterials,
  type RequirementMaterialSection,
  type RequirementPrdFile,
  type RequirementPrdLink,
  type RequirementSourceRepo,
  type SkyAxisController,
} from '../../controller/sky-axis-controller.ts'
import { MaterialPickerModal } from './MaterialPickerModal.tsx'
import { AddMaterialFormModal } from './AddMaterialFormModal.tsx'
import css from './MaterialsPane.module.css'

export interface MaterialsPaneProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
  controller: SkyAxisController
}

/* ── Section 配置：section key → icon + renderItem 强绑定（保留 typing） ── */

type AnyMaterialItem =
  | RequirementPrdFile
  | RequirementPrdLink
  | RequirementSourceRepo
  | RequirementDesignLink
  | RequirementAttachment
  | RequirementExternalLink

const SOURCE_LABEL: Record<RequirementPrdLink['source'], string> = {
  yuque: '语雀', notion: 'Notion', confluence: 'Confluence', feishu: '飞书', custom: '其他',
}
const DESIGN_KIND_LABEL: Record<RequirementDesignLink['kind'], string> = {
  figma: 'Figma', sketch: 'Sketch', image: '图片', embed: '嵌入',
}
const EXTERNAL_KIND_LABEL: Record<RequirementExternalLink['kind'], string> = {
  'api-doc': 'API 文档', meeting: '会议纪要', research: '调研报告', incident: '故障复盘', other: '其他',
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
  } catch { return iso }
}

/** 强类型 section 配置：每条目 type-narrow 到对应 item + icon + renderer。 */
interface SectionDef<K extends RequirementMaterialSection, T extends AnyMaterialItem> {
  key: K
  titleKey: string
  emptyKey: string
  icon: IconComponent
  items: T[]
  renderItem: (item: T, pendingDeleteId: string | null, onDeleteClick: (id: string) => void, t: (k: string) => string) => JSX.Element
}

function buildSections(m: RequirementMaterials): SectionDef<RequirementMaterialSection, AnyMaterialItem>[] {
  return [
    {
      key: 'prdFiles',
      titleKey: 'requirement.detail.materials.section.prd.title',
      emptyKey: 'requirement.detail.materials.section.prd.empty',
      icon: PrdFileIcon,
      items: m.prdFiles,
      renderItem: (item, pendingDeleteId, onDeleteClick, t) => renderFileItem('prdFiles', item as RequirementPrdFile, pendingDeleteId, onDeleteClick, t),
    },
    {
      key: 'prdLinks',
      titleKey: 'requirement.detail.materials.section.prdLinks.title',
      emptyKey: 'requirement.detail.materials.section.prdLinks.empty',
      icon: PrdLinkIcon,
      items: m.prdLinks,
      renderItem: (item, pendingDeleteId, onDeleteClick, t) => renderLinkItem('prdLinks', item as RequirementPrdLink, pendingDeleteId, onDeleteClick, t),
    },
    {
      key: 'sourceRepos',
      titleKey: 'requirement.detail.materials.section.sourceRepos.title',
      emptyKey: 'requirement.detail.materials.section.sourceRepos.empty',
      icon: GitBranchIcon,
      items: m.sourceRepos,
      renderItem: (item, pendingDeleteId, onDeleteClick, t) => renderRepoItem(item as RequirementSourceRepo, pendingDeleteId, onDeleteClick, t),
    },
    {
      key: 'designLinks',
      titleKey: 'requirement.detail.materials.section.design.title',
      emptyKey: 'requirement.detail.materials.section.design.empty',
      icon: DesignIcon,
      items: m.designLinks,
      renderItem: (item, pendingDeleteId, onDeleteClick, t) => renderDesignItem(item as RequirementDesignLink, pendingDeleteId, onDeleteClick, t),
    },
    {
      key: 'attachments',
      titleKey: 'requirement.detail.materials.section.attachments.title',
      emptyKey: 'requirement.detail.materials.section.attachments.empty',
      icon: AttachmentIcon,
      items: m.attachments,
      renderItem: (item, pendingDeleteId, onDeleteClick, t) => renderFileItem('attachments', item as RequirementAttachment, pendingDeleteId, onDeleteClick, t),
    },
    {
      key: 'externalLinks',
      titleKey: 'requirement.detail.materials.section.externalLinks.title',
      emptyKey: 'requirement.detail.materials.section.externalLinks.empty',
      icon: GlobeIcon,
      items: m.externalLinks,
      renderItem: (item, pendingDeleteId, onDeleteClick, t) => renderExternalItem(item as RequirementExternalLink, pendingDeleteId, onDeleteClick, t),
    },
  ]
}

/* ── 三态删除按钮：default / hover red / 二次点击确认 / 3s 自动 revert ── */

interface DeleteItemButtonProps {
  itemId: string
  pendingDeleteId: string | null
  onClick: (id: string) => void
  t: (k: string) => string
}

function DeleteItemButton({ itemId, pendingDeleteId, onClick, t }: DeleteItemButtonProps): JSX.Element {
  const isPending = pendingDeleteId === itemId
  return (
    <button
      type="button"
      className={`${css.deleteButton} ${isPending ? css.deleteButtonPending : ''}`}
      onClick={(): void => { onClick(itemId) }}
      title={isPending ? t('requirement.detail.materials.confirmDeleteHint') : t('requirement.detail.materials.deleteItem')}
      aria-label={isPending ? t('requirement.detail.materials.confirmDelete') : t('requirement.detail.materials.deleteItem')}
    >
      {isPending
        ? <span className={css.deleteConfirmText}>{t('requirement.detail.materials.confirmDeleteShort')}</span>
        : <TrashIcon size={12} />}
    </button>
  )
}

/* ── 6 个 item 渲染器：共享 base + section 特定 meta ── */

function renderFileItem(
  _section: 'prdFiles' | 'attachments',
  item: RequirementPrdFile | RequirementAttachment,
  pendingDeleteId: string | null,
  onDeleteClick: (id: string) => void,
  t: (k: string) => string,
): JSX.Element {
  return (
    <li key={item.id} className={css.item}>
      <div className={css.itemMain}>
        <span className={css.itemTitle}>{item.filename}</span>
        <span className={css.itemMeta}>
          {bytesHuman(item.size)} · {item.mimeType}
        </span>
      </div>
      <span className={css.itemAside}>{dateShort(item.uploadedAt)}</span>
      <DeleteItemButton itemId={item.id} pendingDeleteId={pendingDeleteId} onClick={onDeleteClick} t={t} />
    </li>
  )
}

function renderLinkItem(
  _section: 'prdLinks',
  item: RequirementPrdLink,
  pendingDeleteId: string | null,
  onDeleteClick: (id: string) => void,
  t: (k: string) => string,
): JSX.Element {
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
      <DeleteItemButton itemId={item.id} pendingDeleteId={pendingDeleteId} onClick={onDeleteClick} t={t} />
    </li>
  )
}

function renderRepoItem(
  item: RequirementSourceRepo,
  pendingDeleteId: string | null,
  onDeleteClick: (id: string) => void,
  t: (k: string) => string,
): JSX.Element {
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
      <DeleteItemButton itemId={item.id} pendingDeleteId={pendingDeleteId} onClick={onDeleteClick} t={t} />
    </li>
  )
}

function renderDesignItem(
  item: RequirementDesignLink,
  pendingDeleteId: string | null,
  onDeleteClick: (id: string) => void,
  t: (k: string) => string,
): JSX.Element {
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
      <DeleteItemButton itemId={item.id} pendingDeleteId={pendingDeleteId} onClick={onDeleteClick} t={t} />
    </li>
  )
}

function renderExternalItem(
  item: RequirementExternalLink,
  pendingDeleteId: string | null,
  onDeleteClick: (id: string) => void,
  t: (k: string) => string,
): JSX.Element {
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
      <DeleteItemButton itemId={item.id} pendingDeleteId={pendingDeleteId} onClick={onDeleteClick} t={t} />
    </li>
  )
}

/* ── 主组件 ── */

export function MaterialsPane({ t, requirement, controller }: MaterialsPaneProps): JSX.Element {
  const tAny = t as unknown as (k: string) => string
  const [expanded, setExpanded] = useState<Set<RequirementMaterialSection>>(() => new Set(['prdFiles', 'prdLinks']))
  const [pickerOpen, setPickerOpen] = useState<boolean>(false)
  const [formSection, setFormSection] = useState<RequirementMaterialSection | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  // 3 秒自动 revert pending delete
  useEffect(() => {
    if (pendingDeleteId === null) return
    const timer = setTimeout(() => { setPendingDeleteId(null) }, 3000)
    return () => { clearTimeout(timer) }
  }, [pendingDeleteId])

  const toggle = (key: RequirementMaterialSection): void => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // 三态删除：第 1 次 hover 进入「pending」状态；第 2 次点击真实调用 controller.removeMaterial
  // 用 section 绑定的删除点击 —— 真正传到 controller
  const handleDeleteClickFor = (section: RequirementMaterialSection) => (id: string): void => {
    if (pendingDeleteId === id) {
      void controller.removeMaterial(requirement.id, section, id)
      setPendingDeleteId(null)
    } else {
      setPendingDeleteId(id)
    }
  }

  const m: RequirementMaterials = requirement.materials
  const total = countRequirementMaterials(m)
  const isEmpty = total === 0
  const sections = buildSections(m)

  return (
    <div className={css.pane}>
      {/* 头部 */}
      <header className={css.header}>
        <div className={css.headerMain}>
          <h3 className={css.title}>{t('requirement.detail.materials.title')}</h3>
          <p className={css.subtitle}>{t('requirement.detail.materials.subtitle')}</p>
        </div>
        <div className={css.headerActions}>
          <span className={`${css.badge} ${isEmpty ? css.badgeEmpty : css.badgeConfigured}`}>
            {isEmpty
              ? t('requirement.detail.materials.unconfiguredBadge')
              : t('requirement.detail.materials.configuredBadge', { count: total })}
          </span>
          <button
            type="button"
            className={css.headerAddButton}
            onClick={(): void => { setPickerOpen(true) }}
            aria-label={t('requirement.detail.materials.addButton')}
          >
            <PlusIcon size={12} />
            <span>{t('requirement.detail.materials.addButton')}</span>
          </button>
        </div>
      </header>

      {/* 6 个 section 折叠列表 */}
      <ol className={css.sectionList}>
        {sections.map((section) => {
          const isOpen = expanded.has(section.key)
          const count = section.items.length
          const SectionIcon = section.icon
          return (
            <li key={section.key} className={css.sectionItem} data-sky-axis-section={section.key}>
              <button
                type="button"
                className={css.sectionHeader}
                aria-expanded={isOpen}
                onClick={(): void => { toggle(section.key) }}
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
                      {section.items.map(item => section.renderItem(item, pendingDeleteId, handleDeleteClickFor(section.key), tAny))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {/* Picker / Form modal 状态机 */}
      {pickerOpen && (
        <MaterialPickerModal
          t={t}
          onClose={(): void => { setPickerOpen(false) }}
          onPick={(section): void => {
            setPickerOpen(false)
            setFormSection(section)
          }}
        />
      )}
      {formSection !== null && (
        <AddMaterialFormModal
          t={t}
          requirement={requirement}
          controller={controller}
          section={formSection}
          onClose={(): void => { setFormSection(null) }}
        />
      )}
    </div>
  )
}

/** 让 component 标识别名在 DevTools 友好。 */
MaterialsPane.displayName = 'MaterialsPane'