/**
 * RequirementsView —— 「需求列表」独立视图（viewKey='requirements'）。
 *
 * 设计动机：Phase 1 把需求列表放在 HomeView 顶部作为 dashboard 一部分，但用户希望
 * 通过 sidebar「个人 → 需求列表」二级目录独立访问。本视图从 HomeView 抽出，完整
 * 保留 RequirementsList section 的功能，并补一个 header（标题 / 副标题 / 新建按钮）。
 *
 * 与 HomeView 的区别：
 *   - 没有 MetricCards / ActivityStream / TeamOverview（专注需求列表）
 *   - header 内置「新建需求」按钮（QuickActions 入口的复刻，与 sidebar QuickActions
 *     共享同一个 onNewRequirement 回调，行为一致：hasWorkspace=false 时禁用）
 *   - subtitle 由视图层给出（与 HomeView / TeamView / PersonalView 风格统一）
 *
 * 数据流：与原 HomeView 的 RequirementsList section 一致 —— controller.requirements
 * + workspaces + loading + error + onDelete。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RequirementEntry,
  RequirementOption,
  RequirementError,
} from '../../controller/hello-controller.ts'
import { RequirementsList } from '../sections/RequirementsList.tsx'
import css from './views.module.css'

export interface RequirementsViewProps {
  t: PropsLocale<'hello'>['t']
  requirements: readonly RequirementEntry[]
  workspaces: readonly RequirementOption[]
  loading: boolean
  error: RequirementError | null
  onDelete: (id: string) => void
  /** 触发「新建需求」弹窗（HelloPage 内 setModalOpen 包一层）。
   *  hasWorkspace=false 时按钮自动 disabled。 */
  onNewRequirement: () => void
  /** 当前是否有可用 workspace（决定新建按钮是否禁用）。 */
  hasWorkspace: boolean
}

export function RequirementsView({
  t, requirements, workspaces, loading, error, onDelete, onNewRequirement, hasWorkspace,
}: RequirementsViewProps): JSX.Element {
  return (
    <div className={css.view}>
      <header className={css.viewHeaderWithAction}>
        <div className={css.viewHeaderMain}>
          <h2 className={css.viewTitle}>{t('view.requirements.title')}</h2>
          <p className={css.viewSubtitle}>{t('view.requirements.subtitle')}</p>
        </div>
        <button
          type="button"
          className={css.viewPrimaryButton}
          onClick={onNewRequirement}
          disabled={!hasWorkspace}
          title={!hasWorkspace ? t('dashboard.quickActions.newRequirementDisabledHint') : undefined}
        >
          {t('dashboard.quickActions.newRequirement')}
        </button>
      </header>

      <section className={css.viewBlock} data-hello-section="requirements">
        <RequirementsList
          t={t}
          requirements={requirements}
          workspaces={workspaces}
          loading={loading}
          error={error}
          onDelete={onDelete}
        />
      </section>
    </div>
  )
}
