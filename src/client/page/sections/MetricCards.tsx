/**
 * Dashboard section 1 — 顶部 4 个指标卡片。
 *
 * 数据全部 mock（DSH ctx 不暴露待办任务 / MR / 告警等业务域），
 * 数字写在组件文件顶部 const，便于将来切换为真实数据源时
 * 把 useEffect 接入 ctx.* 即可，props 接口不变。
 *
 * 图标：使用 src/client/icons/icons.tsx 提供的 SVG 组件（替代 emoji），
 *      自动跟随父级 color 切换 dark/light/skins。
 *
 * 布局：≥900px 4 列横排，<900px 2×2 堆叠。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  TodoIcon, ProgressIcon, MergeIcon, AlertIcon,
  type IconComponent,
} from '../../icons/icons.tsx'
import css from './dashboard.module.css'

type MetricKey = 'todo' | 'progress' | 'mr' | 'alert'
type UnitKey = 'item' | 'piece' | 'count'

interface MetricCardData {
  key: MetricKey
  Icon: IconComponent  // SVG 组件
  number: number
  unitKey: UnitKey
}

/** 演示指标数据 —— 真实数据接入时把这里换成 useEffect(ctx.get('xxx'))。 */
const METRICS: readonly MetricCardData[] = [
  { key: 'todo',     Icon: TodoIcon,     number: 7, unitKey: 'item' },
  { key: 'progress', Icon: ProgressIcon, number: 3, unitKey: 'item' },
  { key: 'mr',       Icon: MergeIcon,    number: 5, unitKey: 'piece' },
  { key: 'alert',    Icon: AlertIcon,    number: 2, unitKey: 'count' },
] as const

export interface MetricCardsProps {
  /** Locale 文案函数（'sky-axis' 命名空间）。 */
  t: PropsLocale<'sky-axis'>['t']
}

/** 顶部 4 个指标卡（响应式：≥900px 4 列，<900px 2×2）。 */
export function MetricCards({ t }: MetricCardsProps): JSX.Element {
  return (
    <div className={css.metricRow}>
      {METRICS.map((m) => {
        const Icon = m.Icon
        return (
          <article key={m.key} className={css.metricCard}>
            <div className={css.metricIcon}>
              <Icon size={22} />
            </div>
            <div className={css.metricBody}>
              <p className={css.metricLabel}>{t(`dashboard.metric.${m.key}.label`)}</p>
              <p className={css.metricNumber}>
                <span className={css.metricNumberMain}>{m.number}</span>
                <span className={css.metricNumberUnit}>{t(`dashboard.unit.${m.unitKey}`)}</span>
              </p>
            </div>
          </article>
        )
      })}
    </div>
  )
}
