/**
 * HomeView —— 工作台首页（dashboard）。
 *
 * 视觉顺序（自上而下）：
 *   1. MetricCards（mock 4 个指标）
 *   2. ActivityStream + TeamOverview（mock 2 列）
 *
 * 「需求列表」自本版本起从 HomeView 抽出，提升为 sidebar「个人 → 需求列表」二级
 * 目录对应的独立视图 RequirementsView。HomeView 回归 Phase 0 的纯 dashboard 形态。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { MetricCards } from '../sections/MetricCards.tsx'
import { ActivityStream } from '../sections/ActivityStream.tsx'
import { TeamOverview } from '../sections/TeamOverview.tsx'
import css from './views.module.css'

export interface HomeViewProps {
  t: PropsLocale<'sky-axis'>['t']
}

export function HomeView({ t }: HomeViewProps): JSX.Element {
  return (
    <div className={css.view}>
      <header className={css.viewHeader}>
        <h2 className={css.viewTitle}>{t('view.home.title')}</h2>
        <p className={css.viewSubtitle}>{t('view.home.subtitle')}</p>
      </header>

      <MetricCards t={t} />

      <div className={css.twoColumn}>
        <ActivityStream t={t} />
        <TeamOverview t={t} />
      </div>
    </div>
  )
}
