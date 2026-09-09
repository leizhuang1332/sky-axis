/**
 * AdjustTaskListDrawer —— 介入点 #1「任务开始前调整 task list」（PR-D / 迭代 6）。
 *
 * 设计意图：用户在 StageWorkspacePane 顶部点击「调整计划」→ 父级打开此 drawer；
 * 用户可对每个 task 的 title / goal / acceptance / dependencies / filesExpected 做局部编辑，
 * 也可删除整个 task 或新增 task；提交时把整个 task list 作为 patch 传给 controller.adjustTaskList。
 *
 * 视觉/交互契约：
 *   - 顶部 intro：「AI 已拆分 N 个任务；调整后重新提交」
 *   - 任务列表：每行 = 标题 + goal + acceptance 列表（可逐条增删）+ dependencies（select 多选）+ filesExpected（input）
 *   - 底部：「保存修改 / 取消」按钮（footer 由 RightDrawer 渲染，drawer 内部只放内容）
 *
 * 数据契约：
 *   - onSubmit(patch: AdjustTaskListPatch)：把表单状态打包成 AdjustTaskListPatch 给 parent
 *   - onCancel(): void：父级 footer 触发
 *   - submitting: boolean：提交中禁用所有输入 + 关闭按钮
 *
 * i18n：所有 label 都用 t(key) 拿，遵循包级 zh/en 双语规则。
 */
import { useState, type JSX } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AdjustTaskListPatch,
  RequirementStage,
  RequirementTask,
  RequirementTaskList,
} from '../../controller/sky-axis-controller.ts'
import css from './AdjustTaskListDrawer.module.css'

/** 本地编辑草稿 —— 比 RequirementTask 多 `_localId` 字段用于 React key 稳定。
 *  新增 task 时 `id` 留空（提交时 controller 注入 UUID；本 demo 演示时用 'T-new-N' 占位）。 */
interface DraftTask extends Omit<RequirementTask, 'subHistory' | 'artifactRefs' | 'enteredAt'> {
  /** 仅本地 React key 用，不写回 controller。 */
  _localId: string
  /** acceptance 多行输入：每行一条 acceptance。 */
  acceptanceText: string
  /** filesExpected 多行输入：每行一条 path。 */
  filesText: string
  /** dependencies 多选 select：值 = 其它 task 的 id。 */
  dependencyIds: string[]
}

let LOCAL_ID_COUNTER = 0
function nextLocalId(): string {
  LOCAL_ID_COUNTER += 1
  return `local-${LOCAL_ID_COUNTER}`
}

/** 把 RequirementTask[] 转成本地 DraftTask[]（首次打开 drawer 时调用一次）。
 *  acceptance / filesExpected 拆成 \n-joined text 方便 textarea 编辑。 */
function tasksToDrafts(tasks: RequirementTask[]): DraftTask[] {
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    goal: t.goal,
    acceptance: t.acceptance,
    filesExpected: t.filesExpected,
    dependencies: t.dependencies,
    status: t.status,
    retryCount: t.retryCount,
    lastDriftScore: t.lastDriftScore,
    _localId: nextLocalId(),
    acceptanceText: t.acceptance.join('\n'),
    filesText: t.filesExpected.join('\n'),
    dependencyIds: t.dependencies,
  }))
}

/** 把 DraftTask[] 反向转回 RequirementTask[]（提交时调用）。
 *  新增的 task（id 为空）用 crypto.randomUUID 注入。
 *  acceptance / filesExpected 按 \n 拆分并 trim 去空。 */
function draftsToTasks(drafts: DraftTask[]): RequirementTask[] {
  const now = new Date().toISOString()
  return drafts.map((d) => {
    const id = d.id === '' ? `T-new-${crypto.randomUUID().slice(0, 8)}` : d.id
    const acceptance = d.acceptanceText.split('\n').map(s => s.trim()).filter(s => s !== '')
    const filesExpected = d.filesText.split('\n').map(s => s.trim()).filter(s => s !== '')
    return {
      id,
      title: d.title.trim() === '' ? '(未命名 task)' : d.title.trim(),
      goal: d.goal,
      acceptance,
      filesExpected,
      dependencies: d.dependencyIds,
      status: d.status === 'pending' || d.status === 'in_progress' || d.status === 'verifying'
        || d.status === 'failed' || d.status === 'rolled_back' || d.status === 'blocked'
        || d.status === 'skipped' || d.status === 'done' ? d.status : 'pending',
      subHistory: [],
      artifactRefs: [],
      retryCount: d.retryCount,
      lastDriftScore: d.lastDriftScore,
      enteredAt: now,
    }
  })
}

export interface AdjustTaskListDrawerProps {
  t: PropsLocale<'sky-axis'>['t']
  /** 当前 requirement 的 stage —— 仅为未来扩展预留；当前版本不影响 drawer 行为。 */
  currentStage: RequirementStage
  /** 当前 task list（来自父级 controller 投影）。 */
  taskList: RequirementTaskList
  /** 父级 footer 触发；drawer 把 patch 交给 controller.adjustTaskList。 */
  onSubmit: (patch: AdjustTaskListPatch) => void
  /** 父级 footer「取消」触发。 */
  onCancel: () => void
  /** 提交中状态：禁用所有输入 + 关闭按钮。 */
  submitting: boolean
}

export function AdjustTaskListDrawer(props: AdjustTaskListDrawerProps): JSX.Element {
  const { t, taskList, onSubmit, onCancel, submitting } = props
  const tAny = t as unknown as (k: string) => string
  const [drafts, setDrafts] = useState<DraftTask[]>(() => tasksToDrafts(taskList.tasks))

  /* ── 校验 ── */
  const canSubmit = ((): boolean => {
    if (submitting) return false
    if (drafts.length === 0) return false
    return drafts.every((d) => d.title.trim() !== '')
  })()

  /* ── 表单操作 ── */
  const updateDraft = (localId: string, patch: Partial<DraftTask>): void => {
    setDrafts(prev => prev.map(d => d._localId === localId ? { ...d, ...patch } : d))
  }

  const removeDraft = (localId: string): void => {
    setDrafts(prev => prev.filter(d => d._localId !== localId))
  }

  const addDraft = (): void => {
    const newDraft: DraftTask = {
      id: '',
      title: '',
      goal: '',
      acceptance: [],
      filesExpected: [],
      dependencies: [],
      status: 'pending',
      retryCount: 0,
      lastDriftScore: undefined,
      _localId: nextLocalId(),
      acceptanceText: '',
      filesText: '',
      dependencyIds: [],
    }
    setDrafts(prev => [...prev, newDraft])
  }

  /* ── 提交 ── */
  const handleSubmit = (): void => {
    if (!canSubmit) return
    const tasks = draftsToTasks(drafts)
    onSubmit({ mode: 'replace', tasks })
  }

  return (
    <div className={css.root}>
      <p className={css.subtitle}>
        {tAny('requirement.detail.adjustTaskList.intro')
          .replace('{n}', String(drafts.length))}
      </p>

      <ul className={css.taskList}>
        {drafts.map((d, idx) => (
          <li key={d._localId} className={css.taskItem}>
            <header className={css.taskHeader}>
              <span className={css.taskIndex}>#{idx + 1}</span>
              <input
                type="text"
                className={css.taskTitleInput}
                placeholder={tAny('requirement.detail.adjustTaskList.taskTitlePlaceholder')}
                value={d.title}
                disabled={submitting}
                onChange={(e): void => { updateDraft(d._localId, { title: e.target.value }) }}
              />
              <button
                type="button"
                className={css.removeButton}
                disabled={submitting}
                onClick={(): void => { removeDraft(d._localId) }}
                title={tAny('requirement.detail.adjustTaskList.removeRow')}
                aria-label={tAny('requirement.detail.adjustTaskList.removeRow')}
              >
                ×
              </button>
            </header>

            <fieldset className={css.field} disabled={submitting}>
              <legend className={css.legend}>{tAny('requirement.detail.adjustTaskList.goalLabel')}</legend>
              <textarea
                className={css.textarea}
                rows={2}
                maxLength={500}
                value={d.goal}
                onChange={(e): void => { updateDraft(d._localId, { goal: e.target.value }) }}
              />
            </fieldset>

            <fieldset className={css.field} disabled={submitting}>
              <legend className={css.legend}>
                {tAny('requirement.detail.adjustTaskList.acceptanceLabel')}
              </legend>
              <textarea
                className={css.textarea}
                rows={3}
                maxLength={2000}
                placeholder={tAny('requirement.detail.adjustTaskList.acceptancePlaceholder')}
                value={d.acceptanceText}
                onChange={(e): void => { updateDraft(d._localId, { acceptanceText: e.target.value }) }}
              />
              <p className={css.fieldHint}>{tAny('requirement.detail.adjustTaskList.acceptanceHint')}</p>
            </fieldset>

            <fieldset className={css.field} disabled={submitting}>
              <legend className={css.legend}>{tAny('requirement.detail.adjustTaskList.filesLabel')}</legend>
              <textarea
                className={css.textarea}
                rows={2}
                placeholder={tAny('requirement.detail.adjustTaskList.filesPlaceholder')}
                value={d.filesText}
                onChange={(e): void => { updateDraft(d._localId, { filesText: e.target.value }) }}
              />
            </fieldset>

            <fieldset className={css.field} disabled={submitting}>
              <legend className={css.legend}>
                {tAny('requirement.detail.adjustTaskList.dependenciesLabel')}
              </legend>
              <select
                className={css.select}
                multiple
                size={Math.min(4, Math.max(2, drafts.length - 1))}
                value={d.dependencyIds}
                onChange={(e): void => {
                  const selected = Array.from(e.target.selectedOptions).map(o => o.value)
                  updateDraft(d._localId, { dependencyIds: selected })
                }}
              >
                {drafts.filter(other => other._localId !== d._localId).map((other, otherIdx) => {
                  // 从 drafts 列表里找 idx
                  const realIdx = drafts.findIndex(x => x._localId === other._localId)
                  return (
                    <option key={other._localId} value={other.id === '' ? `_new_${realIdx}` : other.id}>
                      #{realIdx + 1} {other.title || '(未命名 task)'}
                    </option>
                  )
                })}
              </select>
              <p className={css.fieldHint}>{tAny('requirement.detail.adjustTaskList.dependenciesHint')}</p>
            </fieldset>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className={css.addRow}
        disabled={submitting}
        onClick={addDraft}
      >
        {tAny('requirement.detail.adjustTaskList.addRow')}
      </button>

      <p className={css.hint}>{tAny('requirement.detail.adjustTaskList.hint')}</p>

      <div className={css.footer}>
        <button
          type="button"
          className={css.cancelButton}
          onClick={onCancel}
          disabled={submitting}
        >
          {tAny('requirement.detail.adjustTaskList.cancel')}
        </button>
        <button
          type="button"
          className={css.confirmButton}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {tAny('requirement.detail.adjustTaskList.confirmSave')}
        </button>
      </div>
    </div>
  )
}
