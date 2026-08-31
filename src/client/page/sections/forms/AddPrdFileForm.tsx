/**
 * AddPrdFileForm —— 「上传 PRD 文档」表单（section: prdFiles）。
 *
 * 形态：单个文件选择按钮 + 文件元数据展示。无附加字段（filename/mimeType/size 由
 * 用户选定文件自动读取）。
 *
 * 提交流程：选 File → submit → controller.addPrdFile → 成功 onClose / 失败显示错误条
 *
 * 上传体验（Step 3）：
 *   - 进度条 + 百分比 + 已传/总大小（bytesHuman）
 *   - 「取消」按钮 → handle.abort() → host 端 req.on('aborted') 清理临时文件
 *   - 组件 unmount 时若上传未完成 → 自动 abort（防内存/连接泄漏）
 *   - 失败回滚由 controller.runMaterialMutation 处理（保留 workspaces 等上下文）
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FormEvent, JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../../ui/Modal.tsx'
import { Field } from '../../../ui/Field.tsx'
import { UploadIcon } from '../../../icons/icons.tsx'
import type {
  RequirementEntry,
  RequirementError,
  SkyAxisController,
  UploadHandle,
  UploadProgress,
} from '../../../controller/sky-axis-controller.ts'
import { FormErrorBar } from './FormErrorBar.tsx'
import css from './forms.module.css'

export interface AddPrdFileFormProps {
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

export function AddPrdFileForm({ t, requirement, controller, onClose }: AddPrdFileFormProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [error, setError] = useState<RequirementError | null>(null)
  // 持有当前 UploadHandle，组件 unmount / 取消时调用 abort()
  const handleRef = useRef<UploadHandle | null>(null)

  const fileError = file !== null && file.size > MAX_FILE_BYTES
    ? t('requirement.detail.materials.form.errorRequired')
    : undefined
  const canSubmit = file !== null && file.size <= MAX_FILE_BYTES && !submitting

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setFile(e.target.files?.[0] ?? null)
    setError(null)
    setProgress(null)
  }

  // 组件卸载时若仍在上传 → 主动 abort，避免 host 端孤儿连接
  useEffect(() => {
    return () => {
      handleRef.current?.abort()
      handleRef.current = null
    }
  }, [])

  const handleCancel = (): void => {
    handleRef.current?.abort()
    handleRef.current = null
    setSubmitting(false)
    setProgress(null)
    setError({ code: 'network-error', detail: t('requirement.detail.materials.form.aborted') as never })
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (!canSubmit || file === null) return
    setSubmitting(true)
    setError(null)
    setProgress({ loaded: 0, total: file.size })
    const handle = controller.addPrdFile(requirement.id, {
      content: file,
      filename: file.name,
      mimeType: file.type === '' ? 'application/octet-stream' : file.type,
      size: file.size,
    }, '', {
      onProgress: (p) => { setProgress(p) },
    })
    handleRef.current = handle
    const r = await handle.promise
    handleRef.current = null
    setSubmitting(false)
    setProgress(null)
    if (r.ok) {
      onClose()
    } else {
      setError(r.error ?? null)
    }
  }

  const pct = progress !== null && progress.total > 0
    ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
    : 0

  return (
    <Modal
      title={t('requirement.detail.materials.form.prdFile.title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={css.cancelButton} onClick={onClose} disabled={false}>
            {t('requirement.detail.materials.form.cancel')}
          </button>
          {submitting && progress !== null ? (
            <button type="button" className={css.cancelUploadButton} onClick={handleCancel}>
              {t('requirement.detail.materials.form.cancelUpload')}
            </button>
          ) : (
            <button type="submit" form="add-prd-file-form" className={css.submitButton} disabled={!canSubmit}>
              {submitting
                ? t('requirement.detail.materials.form.submitting')
                : t('requirement.detail.materials.form.submit')}
            </button>
          )}
        </>
      }
    >
      <form id="add-prd-file-form" className={css.form} onSubmit={(e): void => { void handleSubmit(e) }}>
        <FormErrorBar t={t} error={error} />
        {progress !== null && (
          <div className={css.progressBar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className={css.progressFill} style={{ width: `${pct}%` }} />
            <div className={css.progressLabel}>
              {pct}% · {bytesHuman(progress.loaded)} / {bytesHuman(progress.total)}
            </div>
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