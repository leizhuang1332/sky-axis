/**
 * 共享 SVG 图标库 —— 替代所有 emoji / unicode 符号。
 *
 * 风格契约（沿用 HelloPage 的 BackIcon）：
 *   - viewBox 一律 `0 0 16 16`
 *   - stroke-width: 1.5（默认）；stroke-linecap/linejoin: round
 *   - fill: none + stroke: currentColor，自动跟随父级 color 切换 dark/light/skins
 *   - aria-hidden: true（装饰性图标；语义信息由旁边的文字承载）
 *
 * 命名约定（按使用场景分组）：
 *   - sidebar.*   侧栏 5 entry  —— size 16
 *   - metric.*    4 个指标卡    —— size 22
 *   - quick.*     3 个快捷入口  —— size 14
 *   - activity.*  动态流 5 个   —— size 14
 */
import type { JSX } from 'react'

/** 图标组件统一签名。 */
export interface IconProps {
  /** 渲染尺寸（px），默认 16。 */
  size?: number
  /** 透传 className（用于上色 / 定位）。 */
  className?: string
}

/** 图标组件类型（用于 sidebar / metric 列表的 IconComponent 字段）。 */
export type IconComponent = (props: IconProps) => JSX.Element

/** 统一 SVG 公共属性 helper —— 避免每个图标重复 viewBox / stroke 等。 */
function svgProps(size: number, className?: string): JSX.IntrinsicElements['svg'] {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className,
    'aria-hidden': true,
  }
}

/* ── Sidebar 图标（5 个，size 默认 16）── */

/** Chevron left —— sidebar 折叠/展开 toggle 按钮专用。
    折叠态由 CSS transform: rotate(180deg) 复用本图标，无需 ChevronRight。 */
export function ChevronLeftIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <polyline points="10 3 5 8 10 13" />
    </svg>
  )
}

/** Chevron down —— sidebar「个人」分组展开/收起指示器。
    展开态（默认）朝下表示「可展开」；收起态由 CSS transform: rotate(-90deg) 复用，朝右表示「可展开」。 */
export function ChevronDownIcon({ size = 12, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <polyline points="3 6 8 11 13 6" />
    </svg>
  )
}

/** 文档 + 勾号 —— sidebar 二级菜单「需求列表」专用。
    与 PersonalIcon 区分（个人 = 单人头像；需求列表 = 列表文档）。 */
export function RequirementIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="3.5" y="2.5" width="9" height="11" rx="1.2" />
      <path d="M6 6.5h4M6 9h4M6 11.5h2.5" />
    </svg>
  )
}

/** 房子 —— sidebar「首页」。 */
export function HomeIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M2.5 7L8 2.5 13.5 7v6a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5V7z" />
      <path d="M6.5 13.5V9.5h3v4" />
    </svg>
  )
}

/** 两个人头 —— sidebar「团队」。 */
export function TeamIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="6" cy="6" r="2.5" />
      <path d="M2 13.5c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5" />
      <circle cx="11" cy="6.5" r="2" />
      <path d="M9 12.5c0-1.5 1.2-2.5 3-2.5 1 0 2 .4 2.5 1" />
    </svg>
  )
}

/** 单人头 —— sidebar「个人」。 */
export function PersonalIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c0-2 2.2-4 5-4s5 2 5 4" />
    </svg>
  )
}

/** 柱状图 —— sidebar「报表」。 */
export function ReportsIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M2 13.5h12" />
      <rect x="3.5" y="8" width="2.5" height="5" rx="0.4" fill="currentColor" stroke="none" />
      <rect x="7" y="5" width="2.5" height="8" rx="0.4" fill="currentColor" stroke="none" />
      <rect x="10.5" y="3" width="2.5" height="10" rx="0.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 齿轮 —— sidebar「设置」。 */
export function SettingsIcon({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M3.3 12.7l1.4-1.4M11.3 4.7l1.4-1.4" />
    </svg>
  )
}

/* ── Metric 图标（4 个，size 默认 22）── */

/** 圆角列表 + 勾 —— MetricCard「待办」。 */
export function TodoIcon({ size = 22, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5 6.5l1.5 1.5L9 5.5" />
      <path d="M5 9.5h6M5 11.5h4" />
    </svg>
  )
}

/** 循环箭头 —— MetricCard「进行中」。 */
export function ProgressIcon({ size = 22, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3 8a5 5 0 0 1 9-3" />
      <path d="M12 2.5V5H9.5" />
      <path d="M13 8a5 5 0 0 1-9 3" />
      <path d="M4 13.5V11H6.5" />
    </svg>
  )
}

/** 分支 + 3 个圆点 —— MetricCard「代码 MR」。 */
export function MergeIcon({ size = 22, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="4" cy="3" r="1.4" />
      <circle cx="4" cy="13" r="1.4" />
      <circle cx="12" cy="8" r="1.4" />
      <path d="M4 4.5v7" />
      <path d="M4 10c0-3 4-3 4-2" />
      <path d="M4 6c0-3 4-3 4-2" />
    </svg>
  )
}

/** 三角警告 —— MetricCard「告警」。 */
export function AlertIcon({ size = 22, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M8 2L14.5 13h-13L8 2z" />
      <path d="M8 6.5v3.5" />
      <circle cx="8" cy="11.8" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  )
}

/* ── Quick action 图标（3 个，size 默认 14）── */

/** 十字 —— QuickAction「新建需求」。 */
export function PlusIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)} strokeWidth={2}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

/** 分支 —— QuickAction「创建分支」。 */
export function BranchIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="4" cy="3" r="1.3" />
      <circle cx="4" cy="13" r="1.3" />
      <circle cx="12" cy="6" r="1.3" />
      <path d="M4 4.5v7" />
      <path d="M4 10c0-3 4-3.5 4-4" />
    </svg>
  )
}

/** 左右双箭头 + 中竖线 —— QuickAction「发起合并请求」。 */
export function MergeRequestIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M3 5l3 3-3 3" />
      <path d="M13 5l-3 3 3 3" />
      <path d="M8 2v12" />
    </svg>
  )
}

/* ── Activity 图标（5 个，size 默认 14）── */

/** 大头针 —— Activity「分配需求」。 */
export function PinIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M8 1.5v4" />
      <path d="M5 5.5L3.5 9.5l3 1 1.5 3.5 1.5-3.5 3-1-1.5-4z" />
    </svg>
  )
}

/** git commit 圆点 —— Activity「提交」。 */
export function GitCommitIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 2v3.5M8 10.5V14" />
    </svg>
  )
}

/** Bug —— Activity「Bug 告警」。 */
export function BugIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="4" y="6" width="8" height="6.5" rx="3" />
      <path d="M6 6V4.5a2 2 0 0 1 4 0V6" />
      <path d="M2 8h2M12 8h2M2 11h2M12 11h2M5.5 2l1 1.5M10.5 2l-1 1.5" />
    </svg>
  )
}

/** 眼睛 —— Activity「审查 MR」。 */
export function EyeIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4z" />
      <circle cx="8" cy="8" r="1.7" />
    </svg>
  )
}

/** 勾号 —— Activity「合并 MR」。 */
export function CheckIcon({ size = 14, className }: IconProps): JSX.Element {
  return (
    <svg {...svgProps(size, className)} strokeWidth={2}>
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  )
}
