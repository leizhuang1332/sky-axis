/**
 * MaterialPickerModal —— 「+ 添加物料」后弹出的 6 选 1 picker。
 *
 * 视觉契约：
 *   - 顶部 intro 文案说明用途
 *   - 6 个 tile 网格（2 列）：每 tile 显示 icon + label + hint
 *   - tile 大块可点击；点击触发 onPick(section) → parent 切换到具体 form
 *
 * 国际化：6 个 tile 的 labelKey/hintKey 由 caller 传 t 函数解析。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { JSX } from 'react'
import { Modal } from '../../ui/Modal.tsx'
import {
  AttachmentIcon,
  DesignIcon,
  GlobeIcon,
  PrdFileIcon,
  PrdLinkIcon,
  GitBranchIcon,
} from '../../icons/icons.tsx'
import type { IconComponent } from '../../icons/icons.tsx'
import type { RequirementMaterialSection } from '../../controller/sky-axis-controller.ts'
import css from './MaterialPickerModal.module.css'

/** 一个 tile 的描述。 */
interface TileSpec {
  key: RequirementMaterialSection
  labelKey: string
  hintKey: string
  Icon: IconComponent
}

const TILES: readonly TileSpec[] = [
  { key: 'prdFiles',      labelKey: 'requirement.detail.materials.picker.prdFiles.label',      hintKey: 'requirement.detail.materials.picker.prdFiles.hint',      Icon: PrdFileIcon },
  { key: 'prdLinks',      labelKey: 'requirement.detail.materials.picker.prdLinks.label',      hintKey: 'requirement.detail.materials.picker.prdLinks.hint',      Icon: PrdLinkIcon },
  { key: 'sourceRepos',   labelKey: 'requirement.detail.materials.picker.sourceRepos.label',   hintKey: 'requirement.detail.materials.picker.sourceRepos.hint',   Icon: GitBranchIcon },
  { key: 'designLinks',   labelKey: 'requirement.detail.materials.picker.designLinks.label',   hintKey: 'requirement.detail.materials.picker.designLinks.hint',   Icon: DesignIcon },
  { key: 'attachments',   labelKey: 'requirement.detail.materials.picker.attachments.label',   hintKey: 'requirement.detail.materials.picker.attachments.hint',   Icon: AttachmentIcon },
  { key: 'externalLinks', labelKey: 'requirement.detail.materials.picker.externalLinks.label', hintKey: 'requirement.detail.materials.picker.externalLinks.hint', Icon: GlobeIcon },
]

export interface MaterialPickerModalProps {
  t: PropsLocale<'sky-axis'>['t']
  onClose: () => void
  /** parent 收到 section 后切换到对应 form。 */
  onPick: (section: RequirementMaterialSection) => void
}

export function MaterialPickerModal({ t, onClose, onPick }: MaterialPickerModalProps): JSX.Element {
  return (
    <Modal
      title={t('requirement.detail.materials.picker.title')}
      onClose={onClose}
      maxWidth={520}
    >
      <p className={css.intro}>{t('requirement.detail.materials.picker.intro')}</p>
      <div className={css.grid}>
        {TILES.map(({ key, labelKey, hintKey, Icon }) => (
          <button
            key={key}
            type="button"
            className={css.tile}
            onClick={(): void => { onPick(key) }}
          >
            <Icon size={20} className={css.tileIcon} />
            <span className={css.tileLabel}>{t(labelKey as never)}</span>
            <span className={css.tileHint}>{t(hintKey as never)}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}