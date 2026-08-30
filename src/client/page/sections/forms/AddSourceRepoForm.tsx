/**
 * AddSourceRepoForm —— 「关联源码仓库」表单（section: sourceRepos）。
 *
 * 字段（与 AddSourceRepoRequestSchema 对齐）：
 *   - url:           required, URL
 *   - branch:        optional（空 = 默认分支），最多 255 字
 *   - lastCommitSha: optional，7-40 hex
 *   - description:   optional，最多 500 字
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FormEvent, JSX } from 'react'
import { useState } from 'react'
import { Modal } from '../../../ui/Modal.tsx'
import { Field } from '../../../ui/Field.tsx'
import type {
  RequirementEntry,
  RequirementError,
  SkyAxisController,
} from '../../../controller/sky-axis-controller.ts'
import css from './forms.module.css'

export interface AddSourceRepoFormProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
  controller: SkyAxisController
  onClose: () => void
}

export function AddSourceRepoForm({ t, requirement, controller, onClose }: AddSourceRepoFormProps): JSX.Element {
  const [url, setUrl] = useState<string>('')
  const [branch, setBranch] = useState<string>('')
  const [lastCommitSha, setLastCommitSha] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [touched, setTouched] = useState<boolean>(false)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<RequirementError | null>(null)

  const urlError = touched && url.trim() === ''
    ? t('requirement.detail.materials.form.errorRequired') : undefined
  const canSubmit = url.trim() !== '' && !submitting

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    const payload: {
      url: string
      branch: string
      lastCommitSha?: string
      description: string
    } = {
      url: url.trim(),
      branch: branch.trim(),
      description: description.trim(),
    }
    if (lastCommitSha.trim() !== '') {
      payload.lastCommitSha = lastCommitSha.trim()
    }
    const r = await controller.addSourceRepo(requirement.id, payload)
    setSubmitting(false)
    if (r.ok) {
      onClose()
    } else {
      setError(r.error ?? null)
    }
  }

  return (
    <Modal
      title={t('requirement.detail.materials.form.sourceRepo.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={css.cancelButton} onClick={onClose} disabled={submitting}>
            {t('requirement.detail.materials.form.cancel')}
          </button>
          <button type="submit" form="add-source-repo-form" className={css.submitButton} disabled={!canSubmit}>
            {submitting
              ? t('requirement.detail.materials.form.submitting')
              : t('requirement.detail.materials.form.submit')}
          </button>
        </>
      }
    >
      <form id="add-source-repo-form" className={css.form} onSubmit={(e): void => { void handleSubmit(e) }}>
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
        <Field label={t('requirement.detail.materials.form.branch')}>
          <input
            className={css.input}
            type="text"
            value={branch}
            onChange={(e): void => { setBranch(e.target.value) }}
            placeholder={t('requirement.detail.materials.form.branchPlaceholder')}
            maxLength={255}
          />
        </Field>
        <Field label={t('requirement.detail.materials.form.lastCommitSha')}>
          <input
            className={css.input}
            type="text"
            value={lastCommitSha}
            onChange={(e): void => { setLastCommitSha(e.target.value) }}
            placeholder="a1b2c3d"
            maxLength={40}
            pattern="[a-f0-9]{7,40}"
          />
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