/**
 * Dashboard section 1 — 顶部 4 个指标卡片。
 *
 * 数据全部 mock（DSH ctx 不暴露待办任务 / MR / 告警等业务域），
 * 数字写在组件文件顶部 const，便于将来切换为真实数据源时
 * 把 useEffect 接入 ctx.* 即可，props 接口不变。
 *
 * 布局：≥900px 4 列横排，<900px 2×2 堆叠。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './dashboard.module.css'

type MetricKey = 'todo' | 'progress' | 'mr' | 'alert'
type UnitKey = 'item' | 'piece' | 'count'

interface MetricCardData {
  key: MetricKey
  icon: string
  number: number
  unitKey: UnitKey
}

/** 演示指标数据 —— 真实数据接入时把这里换成 useEffect(ctx.get('xxx'))。 */
const METRICS: readonly MetricCardData[] = [
  { key: 'todo',     icon: '📋', number: 7, unitKey: 'item' },
  { key: 'progress', icon: '🔄', number: 3, unitKey: 'item' },
  { key: 'mr',       icon: '🔀', number: 5, unitKey: 'piece' },
  { key: 'alert',    icon: '⚠️', number: 2, unitKey: 'count' },
] as const

export interface MetricCardsProps {
  /** Locale 文案函数（'hello' 命名空间）。 */
  t: PropsLocale<'hello'>['t']
}

/** 顶部 4 个指标卡（响应式：≥900px 4 列，<900px 2×2）。 */
export function MetricCards({ t }: MetricCardsProps): JSX.Element {
  return (
    <div className={css.metricRow}>
      {METRICS.map((m) => (
        <article key={m.key} className={css.metricCard}>
          <div className={css.metricIcon} aria-hidden="true">{m.icon}</div>
          <div className={css.metricBody}>
            <p className={css.metricLabel}>{t(`dashboard.metric.${m.key}.label`)}</p>
            <p className={css.metricNumber}>
              <span className={css.metricNumberMain}>{m.number}</span>
              <span className={css.metricNumberUnit}>{t(`dashboard.unit.${m.unitKey}`)}</span>
            </p>
          </div>
        </article>
      ))}
    </div>
  )
}
