/**
 * AddPrdLinkForm —— 「添加 PRD 链接」表单（section: prdLinks）。
 *
 * 字段（与 protocol.ts AddPrdLinkRequestSchema 对齐）：
 *   - url:    required, URL
 *   - title:  required, 1-200 字
 *   - source: 枚举 yuque / notion / confluence / feishu / custom，默认 yuque
 *
 * 提交流程：submit → controller.addPrdLink → 成功 onClose / 失败显示错误条
 * 字段状态：本地 useState；touched 控制 required 错误提示时机
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FormEvent, JSX } from 'react'
import { useState } from 'react'
import { Modal } from '../../../ui/Modal.tsx'
import { Field } from '../../../ui/Field.tsx'
import type {
  RequirementEntry,
  RequirementError,
  RequirementPrdLink,
  SkyAxisController,
} from '../../../controller/sky-axis-controller.ts'
import css from './forms.module.css'

export interface AddPrdLinkFormProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
  controller: SkyAxisController
  onClose: () => void
}

const SOURCES: RequirementPrdLink['source'][] = ['yuque', 'notion', 'confluence', 'feishu', 'custom']

export function AddPrdLinkForm({ t, requirement, controller, onClose }: AddPrdLinkFormProps): JSX.Element {
  const [url, setUrl] = useState<string>('')
  const [title, setTitle] = useState<string>('')
  const [source, setSource] = useState<RequirementPrdLink['source']>('yuque')
  const [touched, setTouched] = useState<boolean>(false)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<RequirementError | null>(null)

  const urlError = touched && url.trim() === ''
    ? t('requirement.detail.materials.form.errorRequired') : undefined
  const titleError = touched && title.trim() === ''
    ? t('requirement.detail.materials.form.errorRequired') : undefined
  const canSubmit = url.trim() !== '' && title.trim() !== '' && !submitting

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    const handle = controller.addPrdLink(requirement.id, {
      url: url.trim(),
      title: title.trim(),
      source,
    })
    const r = await handle.promise
    setSubmitting(false)
    if (r.ok) {
      onClose()
    } else {
      setError(r.error ?? null)
    }
  }

  return (
    <Modal
      title={t('requirement.detail.materials.form.prdLink.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={css.cancelButton} onClick={onClose} disabled={submitting}>
            {t('requirement.detail.materials.form.cancel')}
          </button>
          <button type="submit" form="add-prd-link-form" className={css.submitButton} disabled={!canSubmit}>
            {submitting
              ? t('requirement.detail.materials.form.submitting')
              : t('requirement.detail.materials.form.submit')}
          </button>
        </>
      }
    >
      <form id="add-prd-link-form" className={css.form} onSubmit={(e): void => { void handleSubmit(e) }}>
        {error !== null && (
          <div className={css.errorBar} role="alert">
            <strong>{t('requirement.detail.materials.form.errorRequired')}</strong>
            <span>{t(`requirement.error.${error.code}` as never)}</span>
            {error.detail !== undefined && <code className={css.errorDetail}>{error.detail}</code>}
          </div>
        )}
        <Field label={t('requirement.detail.materials.form.url')} required error={urlError}>
          <input
            className={css.input}
            type="url"
            value={url}
            onChange={(e): void => { setUrl(e.target.value) }}
            onBlur={(): void => { setTouched(true) }}
            placeholder={t('requirement.detail.materials.form.urlPlaceholder')}
            maxLength={2048}
          />
        </Field>
        <Field label={t('requirement.detail.materials.form.title')} required error={titleError}>
          <input
            className={css.input}
            type="text"
            value={title}
            onChange={(e): void => { setTitle(e.target.value) }}
            onBlur={(): void => { setTouched(true) }}
            placeholder={t('requirement.detail.materials.form.titlePlaceholder')}
            maxLength={200}
          />
        </Field>
        <Field label={t('requirement.detail.materials.form.source')}>
          <select
            className={css.select}
            value={source}
            onChange={(e): void => { setSource(e.target.value as RequirementPrdLink['source']) }}
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>{t(`requirement.detail.materials.source.${s}`)}</option>
            ))}
          </select>
        </Field>
      </form>
    </Modal>
  )
}