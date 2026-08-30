/**
 * HomeView —— 工作台首页（dashboard）。
 *
 * 3 段拼装：
 *   - 顶部 4 个指标卡（复用 sections/MetricCards）
 *   - 中间 2 列网格：动态流 + 团队概览
 *
 * QuickActions 已迁移到 HelloSidebar 底部（语义升级为「全局快捷入口」），
 * 故本视图不再包含。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { MetricCards } from '../sections/MetricCards.tsx'
import { ActivityStream } from '../sections/ActivityStream.tsx'
import { TeamOverview } from '../sections/TeamOverview.tsx'
import css from './views.module.css'

export interface HomeViewProps {
  t: PropsLocale<'hello'>['t']
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
