/**
 * AddSourceRepoForm —— 「关联源码仓库」表单（section: sourceRepos）。
 *
 * Phase 2.6 v2 简化（用户反馈）：
 *   - 删除 displayName 输入框 —— 不再需要用户提供英文/拼音名
 *   - 删除「推荐分支」chip（依赖 displayName,已无意义）
 *   - branch input placeholder 提示命名格式: `<你的英文名>/feat-MMDD-<需求名>`
 *   - 保留「沿用上次」chip：同 requirement 重复关联时复用上次的 branch 名
 *     （同需求的 PR/commit 应落同一分支）
 *   - 保留 60s 长操作确认 + 5min 硬超时
 *   - 保留 destDir = 项目名 + 跨 requirement 复用已 clone 仓库的语义（host 端处理）
 *
 * 字段（与 AddSourceRepoRequestSchema 对齐）：
 *   - url:           required, URL
 *   - branch:        required（min 1 —— clone 必须明确分支）
 *   - description:   optional, ≤ 500 字
 *   - lastCommitSha: 不再让用户填 —— host clone 后自动 `git rev-parse HEAD` 取
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FormEvent, JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../../ui/Modal.tsx'
import { Field } from '../../../ui/Field.tsx'
import type {
  RequirementEntry,
  RequirementError,
  SkyAxisController,
} from '../../../controller/sky-axis-controller.ts'
import { FormErrorBar } from './FormErrorBar.tsx'
import css from './forms.module.css'

export interface AddSourceRepoFormProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
  controller: SkyAxisController
  onClose: () => void
}

/** 「太长感觉不太好」的辅助常量。 */
const LONG_CLONE_CONFIRM_MS = 60 * 1000   // 60s 后弹确认
const HARD_TIMEOUT_MS = 5 * 60 * 1000     // 5 分钟兜底（与 host GIT_CLONE_TIMEOUT_MS 对齐）

export function AddSourceRepoForm({ t, requirement, controller, onClose }: AddSourceRepoFormProps): JSX.Element {
  // ── 派生数据（每次 render 算一次，开销可忽略）──
  const existingRepos = requirement.materials.sourceRepos
  // 「沿用上次」= 取最早一条 sourceRepo 的 branch（首次创建后命名锁定）
  const reuseBranch = existingRepos.length > 0 ? (existingRepos[0]?.branch ?? '') : ''

  // ── state ──
  const [url, setUrl] = useState<string>('')
  // 默认分支: 若 sourceRepos 有历史，沿用上次；否则空
  const [branch, setBranch] = useState<string>(reuseBranch)
  const [description, setDescription] = useState<string>('')
  const [touched, setTouched] = useState<boolean>(false)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<RequirementError | null>(null)
  // 60s 确认弹窗：clone 超过 60s 还没回时显示
  const [confirmLongWait, setConfirmLongWait] = useState<boolean>(false)

  // 计时器：60s / 5min 硬超时
  const longWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 当前 in-flight AbortController —— 用户点「取消长操作 / 关闭弹窗」时调 abort
  const abortRef = useRef<AbortController | null>(null)

  const urlError = touched && url.trim() === ''
    ? t('requirement.detail.materials.form.errorRequired') : undefined
  const branchError = touched && branch.trim() === ''
    ? t('requirement.detail.materials.form.errorRequired') : undefined
  const canSubmit = url.trim() !== '' && branch.trim() !== '' && !submitting

  // 卸载时清理所有计时器 + abort in-flight 操作
  useEffect(() => {
    return () => {
      if (longWaitTimer.current !== null) clearTimeout(longWaitTimer.current)
      if (hardTimeoutRef.current !== null) clearTimeout(hardTimeoutRef.current)
      abortRef.current?.abort()
    }
  }, [])

  const clearTimers = (): void => {
    if (longWaitTimer.current !== null) {
      clearTimeout(longWaitTimer.current)
      longWaitTimer.current = null
    }
    if (hardTimeoutRef.current !== null) {
      clearTimeout(hardTimeoutRef.current)
      hardTimeoutRef.current = null
    }
  }

  /** 真正提交：被 handleSubmit 与 confirmLongWait 的"继续等"共用。 */
  const doSubmit = (): void => {
    const payload = {
      url: url.trim(),
      branch: branch.trim(),
      description: description.trim(),
    }
    const ac = new AbortController()
    abortRef.current = ac
    const handle = controller.addSourceRepo(requirement.id, payload, '', {
      signal: ac.signal,
      timeoutMs: HARD_TIMEOUT_MS,
    })

    // 60s 后问用户 —— 大仓库可能很慢,别静默卡死
    longWaitTimer.current = setTimeout(() => {
      setConfirmLongWait(true)
    }, LONG_CLONE_CONFIRM_MS)

    // 5min 硬超时兜底（client 侧 + host 端双超时,通常 host 先抛）
    hardTimeoutRef.current = setTimeout(() => {
      ac.abort(new Error(`clone hard timeout after ${HARD_TIMEOUT_MS}ms`))
    }, HARD_TIMEOUT_MS)

    void handle.promise.then((r) => {
      clearTimers()
      setSubmitting(false)
      setConfirmLongWait(false)
      if (r.ok) {
        onClose()
      } else {
        // r.error 是 RequirementError | undefined;setError 要求 | null —— null 兜底
        setError(r.error ?? null)
      }
    })
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    doSubmit()
  }

  /** 长操作确认 —— 取消（abort 当前 in-flight）*/
  const cancelLongWait = (): void => {
    abortRef.current?.abort()
    clearTimers()
    setSubmitting(false)
    setConfirmLongWait(false)
    setError({ code: 'network-error', detail: '用户取消长操作' })
  }

  /** 长操作确认 —— 继续等（关闭确认弹窗,继续等到 5min）*/
  const keepWaiting = (): void => {
    setConfirmLongWait(false)
    // 长等待计时器已触发，无需重启；硬超时仍生效
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
      <form id="add-source-repo-form" className={css.form} onSubmit={handleSubmit}>
        <FormErrorBar t={t} error={error} />

        {/* ── URL ── */}
        <Field
          label={t('requirement.detail.materials.form.url')}
          required
          error={urlError}
        >
          <input
            className={css.input}
            type="text"  // 不强制 type=url —— 部分 git URL 不是 https,例如 git@github.com:xxx
            value={url}
            onChange={(e): void => { setUrl(e.target.value) }}
            onBlur={(): void => { setTouched(true) }}
            placeholder={t('requirement.detail.materials.form.urlPlaceholder')}
            maxLength={2048}
          />
        </Field>

        {/* ── Branch ── */}
        <Field
          label={t('requirement.detail.materials.form.branch')}
          required
          error={branchError}
          hint={t('requirement.detail.materials.form.sourceRepo.branchHint')}
        >
          <input
            className={css.input}
            type="text"
            value={branch}
            onChange={(e): void => { setBranch(e.target.value) }}
            onBlur={(): void => { setTouched(true) }}
            placeholder={t('requirement.detail.materials.form.sourceRepo.branchPlaceholder')}
            maxLength={255}
          />
        </Field>

        {/* 「沿用上次」chip —— 仅当该需求已有 sourceRepo 时显示 */}
        {reuseBranch !== '' && reuseBranch !== branch && (
          <div className={css.sourceRepoSuggestion}>
            <span className={css.sourceRepoSuggestionLabel}>
              {t('requirement.detail.materials.form.sourceRepo.reuseLabel')}
            </span>
            <code className={css.sourceRepoSuggestionBranch}>{reuseBranch}</code>
            <button
              type="button"
              className={css.sourceRepoUseBtn}
              onClick={(): void => { setBranch(reuseBranch) }}
            >
              {t('requirement.detail.materials.form.sourceRepo.useThis')}
            </button>
          </div>
        )}

        {/* ── Description ── */}
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

        {/* ── 长操作确认层（覆盖在表单上,但不阻塞滚动） ── */}
        {confirmLongWait && (
          <div className={css.longWaitOverlay} role="alertdialog" aria-live="polite">
            <div className={css.longWaitCard}>
              <p className={css.longWaitTitle}>
                {t('requirement.detail.materials.form.sourceRepo.longWaitTitle')}
              </p>
              <p className={css.longWaitDetail}>
                {t('requirement.detail.materials.form.sourceRepo.longWaitDetail')}
              </p>
              <div className={css.longWaitActions}>
                <button type="button" className={css.cancelButton} onClick={cancelLongWait}>
                  {t('requirement.detail.materials.form.sourceRepo.longWaitCancel')}
                </button>
                <button type="button" className={css.submitButton} onClick={keepWaiting}>
                  {t('requirement.detail.materials.form.sourceRepo.longWaitKeep')}
                </button>
              </div>
            </div>
          </div>
        )}
      </form>
    </Modal>
  )
}
