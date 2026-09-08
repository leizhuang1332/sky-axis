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
 * 1:1 workspace-requirement 不变量（client UX 加速层）：
 *   - 已有关联需求的 workspace 在 select 里**灰显 + 标「（已占用）」**，无法选中
 *   - `defaultWorkspaceId` 落空时自动选「第一个未占用」workspace
 *   - host 仍是权威 —— 即使 UI 被绕过（多 tab / 老 client），host create() 仍会拒绝
 *
 * 关闭策略：
 *   - 提交成功后自动关闭
 *   - 提交失败不关闭（让用户修改后重试）
 *   - 取消按钮 / 遮罩点击 / Esc 关闭（Modal 抽象已处理）
 *
 * 注意：本组件纯受控（props.in / props.out），不持有任何业务状态。
 * Step 7 改造：移除内联 modal 样式和本地 Field 函数，改用 Modal + ui/Field 抽象。
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementEntry, RequirementError, RequirementOption } from '../../controller/sky-axis-controller.ts'
import { useWorkspaceOps } from '../../shared/workspace-context.tsx'
import { Modal } from '../../ui/Modal.tsx'
import { Field } from '../../ui/Field.tsx'
import css from './new-requirement-modal.module.css'

export type Priority = RequirementEntry['priority']

export interface NewRequirementModalProps {
  /** locale 文案函数。 */
  t: PropsLocale<'sky-axis'>['t']
  /** workspace 列表（来自 ctx.workspaces.list 推送）。 */
  workspaces: readonly RequirementOption[]
  /** 默认预选的 workspaceId（通常是 ctx.workspaces.list.recentWorkspaceId）。 */
  defaultWorkspaceId?: string
  /** 已占用 workspaceId 集合（来自 controller.getRequirementByWorkspace 派生）。
   *  这些 workspace 在 select 中灰显、无法选中。
   *  undefined 时按"无占用"处理（早期 mount / controller 还未注入）。 */
  takenByWorkspaceId?: ReadonlyMap<string, RequirementEntry>
  /** 最近一次失败错误（表单顶部展示错误条；成功时传 null）。 */
  submitError?: RequirementError | null
  /** 是否正在提交（submit 按钮显示 loading）。 */
  submitting: boolean
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

const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent']

/** 模块级空 Map —— 早期 mount / controller 还没注入 takenByWorkspaceId 时的兜底。
 *  用模块级单例避免每次 render 重新构造（同一引用，React 不会触发额外更新）。 */
const EMPTY_TAKEN: ReadonlyMap<string, RequirementEntry> = new Map()

/** 把 priority key 翻译为本地化标签。 */
function priorityLabel(t: PropsLocale<'sky-axis'>['t'], p: Priority): string {
  return t(`requirement.priority.${p}`)
}

/** 找第一个「未占用」的 workspaceId。无可用时返回 undefined。 */
function firstAvailable(
  workspaces: readonly RequirementOption[],
  taken: ReadonlyMap<string, RequirementEntry>,
): string | undefined {
  for (const ws of workspaces) {
    if (!taken.has(ws.id)) return ws.id
  }
  return undefined
}

export function NewRequirementModal(props: NewRequirementModalProps): JSX.Element {
  const { t, workspaces, defaultWorkspaceId, takenByWorkspaceId, submitError, submitting, onSubmit, onClose } = props
  /* 0.1.2:从 Context 拿 WorkspaceOps —— Provider 没 mount 时 useWorkspaceOps() 会
   *   throw,直接连根组件都渲染不出来,所以这里不需要 `=== undefined` 守卫。 */
  const workspaceOps = useWorkspaceOps()
  // 默认空 map —— 早期 mount / controller 还没注入 takenByWorkspaceId 时按"无占用"处理
  const taken: ReadonlyMap<string, RequirementEntry> = takenByWorkspaceId ?? EMPTY_TAKEN

  // 默认预选逻辑：
  //   1. 调用方显式传的 defaultWorkspaceId 必须未占用
  //   2. 否则挑第一个未占用
  //   3. 全占用 / 空列表 → ''（触发 noWorkspaces 分支）
  const [workspaceId, setWorkspaceId] = useState<string>(() => {
    if (defaultWorkspaceId !== undefined && !taken.has(defaultWorkspaceId)) return defaultWorkspaceId
    return firstAvailable(workspaces, taken) ?? ''
  })
  const [title, setTitle] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [tagsInput, setTagsInput] = useState<string>('')
  const [creatingWorkspace, setCreatingWorkspace] = useState<boolean>(false)
  /** modal 本地的 workspace 创建错误 —— 不污染 props.submitError（后者仅承载创建需求的错误）。 */
  const [workspaceError, setWorkspaceError] = useState<RequirementError | null>(null)

  const titleRef = useRef<HTMLInputElement | null>(null)
  // 打开时聚焦第一个表单字段（workspace select）。Modal 抽象用 [role="dialog"] 标识。
  useEffect(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const firstFocusable = dialog?.querySelector<HTMLElement>('select, input')
    firstFocusable?.focus()
  }, [])

  const noWorkspaces = workspaces.length === 0
  const titleInvalid = title.trim().length === 0 || title.length > 120
  // 当前选中 workspace 是否被占用 —— 防御性兜底（select 已 disabled，正常不会发生）
  const workspaceTaken = workspaceId !== '' && taken.has(workspaceId)
  const canSubmit = !noWorkspaces && workspaceId !== '' && !titleInvalid && !submitting && !creatingWorkspace && !workspaceTaken

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
    if (creatingWorkspace) return
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
    <Modal
      title={t('requirement.new.title')}
      onClose={onClose}
      footer={
        <>
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
            form="new-requirement-form"
            className={css.submitButton}
            disabled={!canSubmit}
          >
            {submitting ? t('requirement.new.submitting') : t('requirement.new.submit')}
          </button>
        </>
      }
    >
      <form id="new-requirement-form" className={css.form} onSubmit={handleSubmit}>
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
            {workspaces.map(ws => {
              // 1:1 不变量：已有关联 requirement 的 workspace 灰显 + 标「已占用」，
              //   让用户在 select 里就明白这个 workspace 不能选，避免提交后被 host 拒绝。
              const taken = takenByWorkspaceId?.get(ws.id)
              const suffix = taken !== undefined ? `（${t('requirement.new.workspaceTaken')}）` : ''
              return (
                <option key={ws.id} value={ws.id} disabled={taken !== undefined}>
                  {ws.title}{suffix}
                </option>
              )
            })}
          </select>
          {/* DSH 平台 workspace 创建入口 —— 复用 ctx.uiWorkspace.pickDirectory +
              ctx.remote.workspace.create。Provider 必然 mount,所以按钮总是显示。 */}
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
      </form>
    </Modal>
  )
}