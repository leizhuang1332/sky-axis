/**
 * AddExternalLinkForm —— 「添加外部链接」表单（section: externalLinks）。
 *
 * 字段（与 AddExternalLinkRequestSchema 对齐）：
 *   - url:         required, URL
 *   - title:       required, 1-200 字
 *   - kind:        枚举 api-doc / meeting / research / incident / other，默认 api-doc
 *   - description: optional, 最多 500 字
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FormEvent, JSX } from 'react'
import { useState } from 'react'
import { Modal } from '../../../ui/Modal.tsx'
import { Field } from '../../../ui/Field.tsx'
import type {
  RequirementEntry,
  RequirementError,
  RequirementExternalLink,
  SkyAxisController,
} from '../../../controller/sky-axis-controller.ts'
import css from './forms.module.css'

export interface AddExternalLinkFormProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
  controller: SkyAxisController
  onClose: () => void
}

const KINDS: RequirementExternalLink['kind'][] = ['api-doc', 'meeting', 'research', 'incident', 'other']

export function AddExternalLinkForm({ t, requirement, controller, onClose }: AddExternalLinkFormProps): JSX.Element {
  const [url, setUrl] = useState<string>('')
  const [title, setTitle] = useState<string>('')
  const [kind, setKind] = useState<RequirementExternalLink['kind']>('api-doc')
  const [description, setDescription] = useState<string>('')
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
    const handle = controller.addExternalLink(requirement.id, {
      url: url.trim(),
      title: title.trim(),
      kind,
      description: description.trim(),
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
      title={t('requirement.detail.materials.form.externalLink.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={css.cancelButton} onClick={onClose} disabled={submitting}>
            {t('requirement.detail.materials.form.cancel')}
          </button>
          <button type="submit" form="add-external-link-form" className={css.submitButton} disabled={!canSubmit}>
            {submitting
              ? t('requirement.detail.materials.form.submitting')
              : t('requirement.detail.materials.form.submit')}
          </button>
        </>
      }
    >
      <form id="add-external-link-form" className={css.form} onSubmit={(e): void => { void handleSubmit(e) }}>
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
        <Field label={t('requirement.detail.materials.form.kind')}>
          <select
            className={css.select}
            value={kind}
            onChange={(e): void => { setKind(e.target.value as RequirementExternalLink['kind']) }}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>{t(`requirement.detail.materials.kind.${k}`)}</option>
            ))}
          </select>
        </Field>
        <Field label={t('requirement.detail.materials.form.description')}>
          <textarea
            className={css.textarea}
            value={description}
            onChange={(e): void => { setDescription(e.target.value) }}
            placeholder={t('requirement.detail.materials.form.descriptionPlaceholder')}
            maxLength={500}
            rows={3}
          />
        </Field>
      </form>
    </Modal>
  )
}