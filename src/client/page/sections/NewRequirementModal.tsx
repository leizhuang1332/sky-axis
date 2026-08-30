/**
 * 「新建需求」弹窗 —— sidebar QuickActions「新建需求」按钮触发。
 *
 * 表单字段（与 protocol.ts NewRequirementSchema 对齐）：
 *   - workspaceId: 必选（来自 ctx.workspaces 推送的 workspaces 列表）
 *   - title:       必填，1-120 字
 *   - description: 可选，0-4000 字
 *   - priority:    4 档（下拉，默认 normal）
 *   - tags:        可选，0-20 个，每个 1-32 字
 *
 * workspace 必选约束：
 *   - workspaces.length === 0 时整个表单 disabled，submit 显示「请先创建工作区」提示
 *   - workspaceId 为空字符串时 submit 按钮 disabled
 *
 * 关闭策略：
 *   - 提交成功后自动关闭
 *   - 提交失败不关闭（让用户修改后重试）
 *   - 取消按钮 / 遮罩点击 / Esc 关闭
 *
 * 注意：本组件纯受控（props.in / props.out），不持有任何业务状态。
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementEntry, RequirementError, RequirementOption } from '../../controller/sky-axis-controller.ts'
import type { WorkspaceOps } from '../../index.ts'
import css from './new-requirement-modal.module.css'

export type Priority = RequirementEntry['priority']

export interface NewRequirementModalProps {
  /** locale 文案函数。 */
  t: PropsLocale<'sky-axis'>['t']
  /** workspace 列表（来自 ctx.workspaces.list 推送）。 */
  workspaces: readonly RequirementOption[]
  /** 默认预选的 workspaceId（通常是 ctx.workspaces.list.recentWorkspaceId）。 */
  defaultWorkspaceId?: string
  /** 最近一次失败错误（表单顶部展示错误条；成功时传 null）。 */
  submitError?: RequirementError | null
  /** 是否正在提交（submit 按钮显示 loading）。 */
  submitting: boolean
  /** DSH 平台 workspace 创建能力透传（apply 期间由 client/index.ts 填充）。
   *  undefined = 当前没有 ctx.workspaces 能力可用，隐藏「+ 创建工作区」入口。 */
  workspaceOps?: WorkspaceOps
  /** 用户点击提交。parent 调 controller.createRequirement。 */
  onSubmit: (input: {
    workspaceId: string
    title: string
    description: string
    priority: Priority
    tags: string[]
  }) => void
  /** 用户点击取消 / 关闭。 */
  onClose: () => void
}

/** 简单 input 标签组件（统一样式）。 */
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }): JSX.Element {
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}>{label}</span>
      {children}
      {hint !== undefined && <span className={css.fieldHint}>{hint}</span>}
    </label>
  )
}

const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent']

/** 把 priority key 翻译为本地化标签。 */
function priorityLabel(t: PropsLocale<'sky-axis'>['t'], p: Priority): string {
  return t(`requirement.priority.${p}`)
}

export function NewRequirementModal(props: NewRequirementModalProps): JSX.Element {
  const { t, workspaces, defaultWorkspaceId, submitError, submitting, workspaceOps, onSubmit, onClose } = props

  const [workspaceId, setWorkspaceId] = useState<string>(defaultWorkspaceId ?? '')
  const [title, setTitle] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [tagsInput, setTagsInput] = useState<string>('')
  const [creatingWorkspace, setCreatingWorkspace] = useState<boolean>(false)
  /** modal 本地的 workspace 创建错误 —— 不污染 props.submitError（后者仅承载创建需求的错误）。 */
  const [workspaceError, setWorkspaceError] = useState<RequirementError | null>(null)

  const titleRef = useRef<HTMLInputElement | null>(null)
  // 打开时聚焦第一个表单字段（workspace select）
  useEffect(() => {
    const firstFocusable = document.querySelector<HTMLElement>(`.${css.root} select, .${css.root} input`)
    firstFocusable?.focus()
  }, [])

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => { document.removeEventListener('keydown', handler) }
  }, [onClose])

  const noWorkspaces = workspaces.length === 0
  const titleInvalid = title.trim().length === 0 || title.length > 120
  const canSubmit = !noWorkspaces && workspaceId !== '' && !titleInvalid && !submitting && !creatingWorkspace

  const handleTagsChange = (raw: string): void => {
    setTagsInput(raw)
  }
  const parsedTags = tagsInput
    .split(/[,，\s]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length <= 32)
    .slice(0, 20)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({ workspaceId, title: title.trim(), description: description.trim(), priority, tags: parsedTags })
  }

  /**
   * 「+ 创建工作区」链接回调 —— 调 DSH 平台能力：
   *   1. pickDirectory 弹原生目录选择器（用户取消 → null，静默返回）
   *   2. createWorkspace 用选中路径创建
   *   3. 失败 → 错误塞 submitError；成功 → 依赖 ctx.workspaces.list 推送
   *      自动让 controller.setWorkspaces 注入新项，select 多出一项。
   *      React rerender 后我们 fallback 显式 setWorkspaceId，避免用户看到
   *      「刚建好但 select 还没刷新」的一瞬歧义。
   */
  const handleCreateWorkspace = async (): Promise<void> => {
    if (workspaceOps === undefined || creatingWorkspace) return
    setCreatingWorkspace(true)
    try {
      const path = await workspaceOps.pickDirectory()
      if (path === null) return
      const result = await workspaceOps.createWorkspace({ path })
      if (result.ok && result.id !== undefined) {
        // 乐观选中新建 workspace，等 ctx.workspaces.list 推送会再次校准。
        setWorkspaceId(result.id)
        setWorkspaceError(null)
      } else if (!result.ok && result.error !== undefined) {
        setWorkspaceError(result.error as RequirementError)
      }
    } finally {
      setCreatingWorkspace(false)
    }
  }

  return (
    <div
      className={css.overlay}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={t('requirement.new.title')}
    >
      <div className={css.root}>
        <header className={css.header}>
          <h2 className={css.title}>{t('requirement.new.title')}</h2>
          <button
            type="button"
            className={css.closeButton}
            onClick={onClose}
            aria-label={t('requirement.new.cancel')}
          >
            ×
          </button>
        </header>

        <form className={css.form} onSubmit={handleSubmit}>
          {submitError !== undefined && submitError !== null && (
            <div className={css.errorBar} role="alert">
              <strong>{t('requirement.new.errorPrefix')}</strong>
              <span>{t(`requirement.error.${submitError.code}` as never)}</span>
              {submitError.detail !== undefined && <code className={css.errorDetail}>{submitError.detail}</code>}
            </div>
          )}

          {workspaceError !== null && (
            <div className={css.errorBar} role="alert">
              <strong>{t('requirement.new.errorPrefix')}</strong>
              <span>{t(`requirement.error.${workspaceError.code}` as never)}</span>
              {workspaceError.detail !== undefined && <code className={css.errorDetail}>{workspaceError.detail}</code>}
            </div>
          )}

          {noWorkspaces && (
            <div className={css.warningBar}>
              {t('requirement.new.noWorkspace')}
            </div>
          )}

          <Field label={t('requirement.new.workspace')} hint={t('requirement.new.workspaceHint')}>
            <select
              className={css.select}
              value={workspaceId}
              onChange={(e) => { setWorkspaceId(e.target.value) }}
              required
            >
              <option value="" disabled>— {t('requirement.new.workspacePlaceholder')} —</option>
              {workspaces.map(ws => (
                <option key={ws.id} value={ws.id}>{ws.title}</option>
              ))}
            </select>
            {/* DSH 平台 workspace 创建入口 —— 复用 ctx.workspaces.pickDirectory + create。
                apply(ctx) 还没跑完时 workspaceOps 为 undefined，链接隐藏。 */}
            {workspaceOps !== undefined && (
              <button
                type="button"
                className={css.linkButton}
                onClick={() => { void handleCreateWorkspace() }}
                disabled={creatingWorkspace}
                title={t('requirement.new.createWorkspaceHint')}
              >
                {creatingWorkspace
                  ? t('requirement.new.creatingWorkspace')
                  : `+ ${t('requirement.new.createWorkspace')}`}
              </button>
            )}
          </Field>

          <Field label={t('requirement.new.titleLabel')} hint={t('requirement.new.titleHint')}>
            <input
              ref={titleRef}
              type="text"
              className={css.input}
              value={title}
              maxLength={120}
              onChange={(e) => { setTitle(e.target.value) }}
              placeholder={t('requirement.new.titlePlaceholder')}
              required
            />
          </Field>

          <Field label={t('requirement.new.descriptionLabel')} hint={t('requirement.new.descriptionHint')}>
            <textarea
              className={css.textarea}
              value={description}
              maxLength={4000}
              rows={4}
              onChange={(e) => { setDescription(e.target.value) }}
              placeholder={t('requirement.new.descriptionPlaceholder')}
            />
          </Field>

          <Field label={t('requirement.new.priorityLabel')}>
            <select
              className={css.select}
              value={priority}
              onChange={(e) => { setPriority(e.target.value as Priority) }}
            >
              {PRIORITIES.map(p => (
                <option key={p} value={p}>{priorityLabel(t, p)}</option>
              ))}
            </select>
          </Field>

          <Field label={t('requirement.new.tagsLabel')} hint={t('requirement.new.tagsHint')}>
            <input
              type="text"
              className={css.input}
              value={tagsInput}
              onChange={(e) => { handleTagsChange(e.target.value) }}
              placeholder={t('requirement.new.tagsPlaceholder')}
            />
          </Field>

          <footer className={css.footer}>
            <button
              type="button"
              className={css.cancelButton}
              onClick={onClose}
              disabled={submitting}
            >
              {t('requirement.new.cancel')}
            </button>
            <button
              type="submit"
              className={css.submitButton}
              disabled={!canSubmit}
            >
              {submitting ? t('requirement.new.submitting') : t('requirement.new.submit')}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
