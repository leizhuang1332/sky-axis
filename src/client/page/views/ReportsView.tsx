/**
 * ReportsView —— 报表 + SVG 图表（mock）。
 *
 * 子块：
 *   - 关键指标（4 个 SVG 图表：柱状图 / 折线图 / 饼图 / 雷达图）
 *   - 报表列表（3 条 mock 报表）
 *
 * 图表全部用 inline SVG 手绘 —— 颜色走 --dsw-* 设计令牌，自动跟随
 * light/dark/skins。目的：演示「原生 SVG 绘图」能力（与线框图要求一致），
 * 不引入第三方图表库。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './views.module.css'

export interface ReportsViewProps {
  t: PropsLocale<'sky-axis'>['t']
}

interface BarSeries {
  label: string
  value: number
}

/** 柱状图数据：本周代码提交数。 */
const BARS: readonly BarSeries[] = [
  { label: '周一', value: 12 },
  { label: '周二', value: 28 },
  { label: '周三', value: 18 },
  { label: '周四', value: 32 },
  { label: '周五', value: 24 },
  { label: '周六', value: 6 },
  { label: '周日', value: 4 },
] as const

/** 折线图数据：本月活跃度（每日消息数）。 */
const LINE = [22, 18, 25, 30, 28, 24, 32, 36, 28, 22, 26, 30, 34, 32, 29, 31, 35, 40, 38, 33, 28, 24, 26, 30, 34, 38, 36, 32, 28, 30] as const

interface PieSlice {
  label: string
  value: number
  color: string
}

/** 饼图数据：任务分布。 */
const PIE: readonly PieSlice[] = [
  { label: 'Feature',  value: 42, color: 'var(--dsw-alias-state-business-primary)' },
  { label: 'Bug',      value: 18, color: 'var(--dsw-alias-state-business-warning, #f59e0b)' },
  { label: 'Refactor', value: 24, color: 'var(--dsw-alias-state-business-success, #22c55e)' },
  { label: 'Docs',     value: 16, color: 'var(--dsw-alias-state-business-info, #06b6d4)' },
] as const

/** 雷达图数据：团队负载（5 个维度）。 */
const RADAR_AXES = ['代码', 'Review', '会议', 'On-call', '设计'] as const
const RADAR_VALUES = [80, 65, 50, 30, 55] as const // 0..100

interface ReportItem {
  title: string
  meta: string
  tag: string
}

const REPORTS: readonly ReportItem[] = [
  { title: '迭代 34 周报',           meta: '生成于 3 小时前', tag: '周报'   },
  { title: '客户端崩溃率月报',       meta: '生成于 2 天前',   tag: '月报'   },
  { title: '团队 MR 吞吐排行',       meta: '生成于 1 周前',   tag: '排行'   },
] as const

/** 折线图把 LINE 数组转成 SVG path d=。 */
function buildLinePath(values: readonly number[], width: number, height: number, padding: number): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const stepX = (width - padding * 2) / (values.length - 1)
  return values
    .map((v, i) => {
      const x = padding + i * stepX
      const y = padding + (1 - (v - min) / range) * (height - padding * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

/** 折线图 path + 对应的 area path（下方闭合区域）。 */
function buildAreaPath(values: readonly number[], width: number, height: number, padding: number): string {
  if (values.length === 0) return ''
  const line = buildLinePath(values, width, height, padding)
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const stepX = (width - padding * 2) / (values.length - 1)
  const lastX = padding + (values.length - 1) * stepX
  const lastY = padding + (1 - (values[values.length - 1]! - min) / range) * (height - padding * 2)
  return `${line} L${lastX.toFixed(1)} ${(height - padding).toFixed(1)} L${padding.toFixed(1)} ${(height - padding).toFixed(1)} Z`
}

/** 饼图把 PIE 转成 SVG 弧线路径。 */
function buildPieArcs(slices: readonly PieSlice[]): Array<{ d: string; color: string; label: string; pct: number }> {
  const total = slices.reduce((s, x) => s + x.value, 0)
  const cx = 50, cy = 50, r = 38
  let acc = 0
  return slices.map((s) => {
    const startAngle = (acc / total) * Math.PI * 2 - Math.PI / 2
    acc += s.value
    const endAngle = (acc / total) * Math.PI * 2 - Math.PI / 2
    const x1 = cx + Math.cos(startAngle) * r
    const y1 = cy + Math.sin(startAngle) * r
    const x2 = cx + Math.cos(endAngle) * r
    const y2 = cy + Math.sin(endAngle) * r
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0
    const d = `M${cx} ${cy} L${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
    return { d, color: s.color, label: s.label, pct: Math.round((s.value / total) * 100) }
  })
}

function buildRadarPolygon(values: readonly number[], sides: number, cx: number, cy: number, radius: number): string {
  return values
    .map((v, i) => {
      const angle = (i / sides) * Math.PI * 2 - Math.PI / 2
      const r = (v / 100) * radius
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ') + ' Z'
}

function buildRadarGrid(sides: number, cx: number, cy: number, radius: number, levels: number): string {
  const out: string[] = []
  for (let l = 1; l <= levels; l++) {
    const r = (l / levels) * radius
    out.push(buildRadarPolygon(Array.from({ length: sides }, () => 100), sides, cx, cy, r))
  }
  return out.join(' ')
}

function buildRadarAxes(sides: number, cx: number, cy: number, radius: number): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  return Array.from({ length: sides }, (_, i) => {
    const angle = (i / sides) * Math.PI * 2 - Math.PI / 2
    return {
      x1: cx,
      y1: cy,
      x2: cx + Math.cos(angle) * radius,
      y2: cy + Math.sin(angle) * radius,
    }
  })
}

export function ReportsView({ t }: ReportsViewProps): JSX.Element {
  const W = 320, H = 140, P = 8
  const lineD = buildLinePath(LINE, W, H, P)
  const areaD = buildAreaPath(LINE, W, H, P)
  const arcs = buildPieArcs(PIE)
  const radarCx = 50, radarCy = 50, radarR = 36
  const radarPoly = buildRadarPolygon(RADAR_VALUES, RADAR_AXES.length, radarCx, radarCy, radarR)
  const radarGrid = buildRadarGrid(RADAR_AXES.length, radarCx, radarCy, radarR, 4)
  const radarAxes = buildRadarAxes(RADAR_AXES.length, radarCx, radarCy, radarR)
  const barMax = Math.max(...BARS.map((b) => b.value), 1)
  const barW = (W - P * 2) / BARS.length - 6

  return (
    <div className={css.view}>
      <header className={css.viewHeader}>
        <h2 className={css.viewTitle}>{t('view.reports.title')}</h2>
        <p className={css.viewSubtitle}>{t('view.reports.subtitle')}</p>
      </header>

      {/* 子块 1：关键指标（4 图） */}
      <section className={css.viewBlock}>
        <h3 className={css.viewBlockTitle}>{t('view.reports.charts.title')}</h3>
        <div className={css.chartGrid}>
          {/* 柱状图：本周提交 */}
          <div className={css.chartCard}>
            <div className={css.chartTitle}>
              <span>本周代码提交</span>
              <span className={css.chartLegend}>{BARS.reduce((s, b) => s + b.value, 0)} 次</span>
            </div>
            <svg className={css.svgChart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
              {/* baseline */}
              <line x1={P} y1={H - P} x2={W - P} y2={H - P} className={css.svgChartAxis} />
              {BARS.map((b, i) => {
                const x = P + i * ((W - P * 2) / BARS.length) + 3
                const h = (b.value / barMax) * (H - P * 2)
                const y = H - P - h
                return (
                  <g key={b.label}>
                    <rect x={x} y={y} width={barW} height={h} rx={2} className={css.svgChartBar} />
                    <text x={x + barW / 2} y={H - 1} className={css.svgChartLabel} textAnchor="middle">
                      {b.label}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>

          {/* 折线图：本月活跃度 */}
          <div className={css.chartCard}>
            <div className={css.chartTitle}>
              <span>本月活跃度</span>
              <span className={css.chartLegend}>日均 {Math.round(LINE.reduce((s, v) => s + v, 0) / LINE.length)}</span>
            </div>
            <svg className={css.svgChart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
              <path d={areaD} className={css.svgChartArea} />
              <path d={lineD} className={css.svgChartLine} />
              <line x1={P} y1={H - P} x2={W - P} y2={H - P} className={css.svgChartAxis} />
            </svg>
          </div>

          {/* 饼图：任务分布 */}
          <div className={css.chartCard}>
            <div className={css.chartTitle}>
              <span>任务分布</span>
              <span className={css.chartLegend}>本月</span>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <svg className={css.svgChart} style={{ height: 100, maxWidth: 100 }} viewBox="0 0 100 100" aria-hidden="true">
                {arcs.map((a) => (
                  <path key={a.label} d={a.d} fill={a.color} className={css.svgChartSlice} />
                ))}
              </svg>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                {arcs.map((a) => (
                  <li key={a.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: a.color, flex: 'none' }} />
                    <span style={{ flex: 1 }}>{a.label}</span>
                    <span style={{ color: 'var(--dsw-alias-label-tertiary)' }}>{a.pct}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 雷达图：团队负载 */}
          <div className={css.chartCard}>
            <div className={css.chartTitle}>
              <span>团队负载</span>
              <span className={css.chartLegend}>本周</span>
            </div>
            <svg className={css.svgChart} viewBox="0 0 100 100" aria-hidden="true">
              <path d={radarGrid} className={css.svgChartRadarGrid} />
              {radarAxes.map((a, i) => (
                <line key={i} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} className={css.svgChartRadarAxis} />
              ))}
              <path d={radarPoly} className={css.svgChartRadar} />
              {RADAR_AXES.map((label, i) => {
                const angle = (i / RADAR_AXES.length) * Math.PI * 2 - Math.PI / 2
                const lx = radarCx + Math.cos(angle) * (radarR + 8)
                const ly = radarCy + Math.sin(angle) * (radarR + 8)
                return (
                  <text key={label} x={lx} y={ly} className={css.svgChartLabel} textAnchor="middle" dominantBaseline="middle">
                    {label}
                  </text>
                )
              })}
            </svg>
          </div>
        </div>
      </section>

      {/* 子块 2：报表列表 */}
      <section className={css.viewBlock}>
        <h3 className={css.viewBlockTitle}>{t('view.reports.list.title')}</h3>
        <ul className={css.itemList}>
          {REPORTS.map((r) => (
            <li key={r.title} className={css.itemRow}>
              <span className={`${css.tagBadge} ${css.tagBadgeAccent}`}>{r.tag}</span>
              <span className={css.itemTitle}>{r.title}</span>
              <span className={css.itemMeta}>{r.meta}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
