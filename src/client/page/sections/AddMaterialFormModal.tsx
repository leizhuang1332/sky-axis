/**
 * AddMaterialFormModal —— 根据 section 派发到 6 个具体 form 的 dispatcher。
 *
 * 调用方：
 *   - MaterialsPane 持有 pickerOpen / formOpen 状态机
 *   - picker 选 section 后 → 切换到 formOpen(section) → 渲染本组件
 *
 * 模式：纯 switch + 转发 props，无附加逻辑。每个 form 自己持有字段状态。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { JSX } from 'react'
import type {
  RequirementEntry,
  RequirementMaterialSection,
  SkyAxisController,
} from '../../controller/sky-axis-controller.ts'
import { AddPrdFileForm } from './forms/AddPrdFileForm.tsx'
import { AddAttachmentForm } from './forms/AddAttachmentForm.tsx'
import { AddPrdLinkForm } from './forms/AddPrdLinkForm.tsx'
import { AddSourceRepoForm } from './forms/AddSourceRepoForm.tsx'
import { AddDesignLinkForm } from './forms/AddDesignLinkForm.tsx'
import { AddExternalLinkForm } from './forms/AddExternalLinkForm.tsx'

export interface AddMaterialFormModalProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
  controller: SkyAxisController
  section: RequirementMaterialSection
  onClose: () => void
}

export function AddMaterialFormModal(props: AddMaterialFormModalProps): JSX.Element {
  switch (props.section) {
    case 'prdFiles':      return <AddPrdFileForm {...props} />
    case 'attachments':   return <AddAttachmentForm {...props} />
    case 'prdLinks':      return <AddPrdLinkForm {...props} />
    case 'sourceRepos':   return <AddSourceRepoForm {...props} />
    case 'designLinks':   return <AddDesignLinkForm {...props} />
    case 'externalLinks': return <AddExternalLinkForm {...props} />
  }
}