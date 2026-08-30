/**
 * HomeView —— 工作台首页（dashboard）。
 *
 * Phase 1 升级：
 *   - 顶部新增「需求列表」section —— 显示 controller.requirements
 *     （按 workspaceId 分组 + stale workspace 兜底）
 *   - 保留原有 MetricCards / ActivityStream / TeamOverview 作为下半区
 *     视觉占位（未来这些 mock 数据可替换为真实统计）
 *
 * 视觉顺序（自上而下）：
 *   1. RequirementsList（Phase 1 真实数据，灰底 + 卡片）
 *   2. MetricCards（mock 4 个指标）
 *   3. ActivityStream + TeamOverview（mock 2 列）
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RequirementEntry,
  RequirementOption,
  RequirementError,
} from '../../controller/hello-controller.ts'
import { MetricCards } from '../sections/MetricCards.tsx'
import { ActivityStream } from '../sections/ActivityStream.tsx'
import { TeamOverview } from '../sections/TeamOverview.tsx'
import { RequirementsList } from '../sections/RequirementsList.tsx'
import css from './views.module.css'

export interface HomeViewProps {
  t: PropsLocale<'hello'>['t']
  requirements: readonly RequirementEntry[]
  workspaces: readonly RequirementOption[]
  loading: boolean
  error: RequirementError | null
  onDelete: (id: string) => void
}

export function HomeView({ t, requirements, workspaces, loading, error, onDelete }: HomeViewProps): JSX.Element {
  return (
    <div className={css.view}>
      <header className={css.viewHeader}>
        <h2 className={css.viewTitle}>{t('view.home.title')}</h2>
        <p className={css.viewSubtitle}>{t('view.home.subtitle')}</p>
      </header>

      <section className={css.viewBlock} data-hello-section="requirements">
        <h3 className={css.viewBlockTitle}>{t('requirement.list.title')}</h3>
        <p className={css.viewBlockHint}>{t('requirement.list.subtitle')}</p>
        <RequirementsList
          t={t}
          requirements={requirements}
          workspaces={workspaces}
          loading={loading}
          error={error}
          onDelete={onDelete}
        />
      </section>

      <MetricCards t={t} />

      <div className={css.twoColumn}>
        <ActivityStream t={t} />
        <TeamOverview t={t} />
      </div>
    </div>
  )
}
