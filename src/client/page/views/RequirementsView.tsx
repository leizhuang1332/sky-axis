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
} from '../../controller/sky-axis-controller.ts'
import { RequirementsList } from '../sections/RequirementsList.tsx'
import css from './views.module.css'

export interface RequirementsViewProps {
  t: PropsLocale<'sky-axis'>['t']
  requirements: readonly RequirementEntry[]
  workspaces: readonly RequirementOption[]
  loading: boolean
  error: RequirementError | null
  onDelete: (id: string) => void
  /** 触发「新建需求」弹窗（SkyAxisPage 内 setModalOpen 包一层）。
   *  按钮始终可点 —— 无 workspace 时 modal 内提供「+ 创建工作区」入口。 */
  onNewRequirement: () => void
  /** 当前是否有可用 workspace。按钮始终可点；该值仅作为未来视觉 hint。 */
  hasWorkspace: boolean
  /** Phase 1.2：点击条目 → 打开详情页。 */
  onOpen: (id: string) => void
}

export function RequirementsView({
  t, requirements, workspaces, loading, error, onDelete, onNewRequirement, hasWorkspace, onOpen,
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
          disabled={false}
        >
          {t('dashboard.quickActions.newRequirement')}
        </button>
      </header>

      <section className={css.viewBlock} data-sky-axis-section="requirements">
        <RequirementsList
          t={t}
          requirements={requirements}
          workspaces={workspaces}
          loading={loading}
          error={error}
          onDelete={onDelete}
          onOpen={onOpen}
        />
      </section>
    </div>
  )
}
