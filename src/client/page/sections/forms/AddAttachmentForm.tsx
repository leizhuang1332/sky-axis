/**
 * AddAttachmentForm —— 「上传附件」表单（section: attachments）。
 *
 * 形态与 AddPrdFileForm 完全一致，唯一差别是调 controller.addAttachment 而非
 * controller.addPrdFile。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FormEvent, JSX } from 'react'
import { useRef, useState } from 'react'
import { Modal } from '../../../ui/Modal.tsx'
import { Field } from '../../../ui/Field.tsx'
import { UploadIcon } from '../../../icons/icons.tsx'
import type {
  RequirementEntry,
  RequirementError,
  SkyAxisController,
} from '../../../controller/sky-axis-controller.ts'
import css from './forms.module.css'

export interface AddAttachmentFormProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
  controller: SkyAxisController
  onClose: () => void
}

const MAX_FILE_BYTES = 100 * 1024 * 1024

function bytesHuman(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function AddAttachmentForm({ t, requirement, controller, onClose }: AddAttachmentFormProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<RequirementError | null>(null)

  const fileError = file !== null && file.size > MAX_FILE_BYTES
    ? t('requirement.detail.materials.form.errorRequired')
    : undefined
  const canSubmit = file !== null && file.size <= MAX_FILE_BYTES && !submitting

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setFile(e.target.files?.[0] ?? null)
    setError(null)
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!canSubmit || file === null) return
    setSubmitting(true)
    setError(null)
    const r = await controller.addAttachment(requirement.id, {
      content: file,
      filename: file.name,
      mimeType: file.type === '' ? 'application/octet-stream' : file.type,
      size: file.size,
    })
    setSubmitting(false)
    if (r.ok) {
      onClose()
    } else {
      setError(r.error ?? null)
    }
  }

  return (
    <Modal
      title={t('requirement.detail.materials.form.attachment.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={css.cancelButton} onClick={onClose} disabled={submitting}>
            {t('requirement.detail.materials.form.cancel')}
          </button>
          <button type="submit" form="add-attachment-form" className={css.submitButton} disabled={!canSubmit}>
            {submitting
              ? t('requirement.detail.materials.form.submitting')
              : t('requirement.detail.materials.form.submit')}
          </button>
        </>
      }
    >
      <form id="add-attachment-form" className={css.form} onSubmit={(e): void => { void handleSubmit(e) }}>
        {error !== null && (
          <div className={css.errorBar} role="alert">
            <strong>{t('requirement.detail.materials.form.errorRequired')}</strong>
            <span>{t(`requirement.error.${error.code}` as never)}</span>
            {error.detail !== undefined && <code className={css.errorDetail}>{error.detail}</code>}
          </div>
        )}
        <Field label={t('requirement.detail.materials.form.file')} hint={t('requirement.detail.materials.form.fileHint')} required error={fileError}>
          <div className={css.fileDropZone}>
            <button
              type="button"
              className={css.fileButton}
              onClick={(): void => { inputRef.current?.click() }}
              disabled={submitting}
            >
              <UploadIcon size={12} />
              {t('requirement.detail.materials.form.fileSelect')}
            </button>
            <input
              ref={inputRef}
              className={css.fileInput}
              type="file"
              onChange={handleFileChange}
              disabled={submitting}
            />
            <span className={css.fileMeta}>
              {file === null
                ? t('requirement.detail.materials.form.fileEmpty')
                : `${file.name} · ${bytesHuman(file.size)}`}
            </span>
          </div>
        </Field>
      </form>
    </Modal>
  )
}