/**
 * AddDesignLinkForm —— 「添加设计稿」表单（section: designLinks）。
 *
 * 字段（与 AddDesignLinkRequestSchema 对齐）：
 *   - url:          required, URL
 *   - kind:         枚举 figma / sketch / image / embed，默认 figma
 *   - title:        required, 1-200 字
 *   - thumbnailUrl: optional, URL
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FormEvent, JSX } from 'react'
import { useState } from 'react'
import { Modal } from '../../../ui/Modal.tsx'
import { Field } from '../../../ui/Field.tsx'
import type {
  RequirementDesignLink,
  RequirementEntry,
  RequirementError,
  SkyAxisController,
} from '../../../controller/sky-axis-controller.ts'
import css from './forms.module.css'

export interface AddDesignLinkFormProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
  controller: SkyAxisController
  onClose: () => void
}

const KINDS: RequirementDesignLink['kind'][] = ['figma', 'sketch', 'image', 'embed']

export function AddDesignLinkForm({ t, requirement, controller, onClose }: AddDesignLinkFormProps): JSX.Element {
  const [url, setUrl] = useState<string>('')
  const [kind, setKind] = useState<RequirementDesignLink['kind']>('figma')
  const [title, setTitle] = useState<string>('')
  const [thumbnailUrl, setThumbnailUrl] = useState<string>('')
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
    const payload: {
      url: string
      kind: RequirementDesignLink['kind']
      title: string
      thumbnailUrl?: string
    } = {
      url: url.trim(),
      kind,
      title: title.trim(),
    }
    if (thumbnailUrl.trim() !== '') {
      payload.thumbnailUrl = thumbnailUrl.trim()
    }
    const handle = controller.addDesignLink(requirement.id, payload)
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
      title={t('requirement.detail.materials.form.designLink.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={css.cancelButton} onClick={onClose} disabled={submitting}>
            {t('requirement.detail.materials.form.cancel')}
          </button>
          <button type="submit" form="add-design-link-form" className={css.submitButton} disabled={!canSubmit}>
            {submitting
              ? t('requirement.detail.materials.form.submitting')
              : t('requirement.detail.materials.form.submit')}
          </button>
        </>
      }
    >
      <form id="add-design-link-form" className={css.form} onSubmit={(e): void => { void handleSubmit(e) }}>
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
        <Field label={t('requirement.detail.materials.form.kind')}>
          <select
            className={css.select}
            value={kind}
            onChange={(e): void => { setKind(e.target.value as RequirementDesignLink['kind']) }}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>{t(`requirement.detail.materials.kind.${k}`)}</option>
            ))}
          </select>
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
        <Field label={t('requirement.detail.materials.form.thumbnailUrl')}>
          <input
            className={css.input}
            type="url"
            value={thumbnailUrl}
            onChange={(e): void => { setThumbnailUrl(e.target.value) }}
            placeholder={t('requirement.detail.materials.form.urlPlaceholder')}
            maxLength={2048}
          />
        </Field>
      </form>
    </Modal>
  )
}