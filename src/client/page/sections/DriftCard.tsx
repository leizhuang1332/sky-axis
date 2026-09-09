/**
 * DriftCard —— AI 协奏面板顶部的 drift 占位卡。
 *
 * 视觉契约：
 *   - 折叠态（默认）：一行紧凑 chip = 「Drift 检测 0.72 ⚠」 + 右侧 chevron
 *   - 展开态：3 行 layer（静态 / 动态 / 语义）+ 每行 score + 描述 + 重跑按钮
 *   - severity：<0.3 ok（绿） / 0.3-0.6 warn（黄） / ≥0.6 bad（红）
 *
 * PR-C 迭代 5：
 *   - 重跑按钮可点击（onRerunDrift 回调）
 *   - loading=true 时显示「正在检测…」+ 按钮 disabled + 隐藏 phase1Hint
 *   - 数据由 parent 传 driftSnapshot + onRerunDrift + loading
 *   - 当 driftSnapshot 为 null 时整卡不渲染（无意义）
 *
 * 数据来源：受控 props。父组件传 t + driftSnapshot。
 */
import { useState, type JSX } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { AlertIcon, ChevronDownIcon, ChevronRightIcon, RefreshIcon } from '../../icons/icons.tsx'
import type { DriftSnapshot } from '../views/requirement-detail.mock.ts'
import css from './DriftCard.module.css'

export interface DriftCardProps {
  t: PropsLocale<'sky-axis'>['t']
  /** null → 不渲染整张卡。 */
  driftSnapshot: DriftSnapshot | null
  /** 重跑按钮回调（PR-C：父级注入 controller.rerunDriftDetection）。
   *  未注入时按钮 disabled 并显示原 phase1Hint。 */
  onRerunDrift?: () => void
  /** 重跑进行中：按钮 disabled + 文案切换为「正在检测…」+ 隐藏 phase1Hint。 */
  loading?: boolean
}

type Severity = 'ok' | 'warn' | 'bad'

function severityOf(score: number): Severity {
  if (score >= 0.6) return 'bad'
  if (score >= 0.3) return 'warn'
  return 'ok'
}

/** 格式化 score 为 0.00（保留 2 位小数）。 */
function fmtScore(score: number): string {
  return score.toFixed(2)
}

export function DriftCard({ t, driftSnapshot, onRerunDrift, loading }: DriftCardProps): JSX.Element | null {
  // 默认折叠（不让卡占太多左列空间；用户可点开看详情）
  const [expanded, setExpanded] = useState(false)
  if (driftSnapshot === null) return null

  const tAny = t as unknown as (k: string) => string
  const overall = driftSnapshot.overall
  const overallSev = severityOf(overall)
  const ChevronIcon = expanded ? ChevronDownIcon : ChevronRightIcon
  const rerunDisabled = onRerunDrift === undefined || loading === true

  return (
    <section className={`${css.card} ${css[`sev_${overallSev}` as 'sev_ok']}`}>
      <button
        type="button"
        className={css.header}
        onClick={(): void => { setExpanded(v => !v) }}
        aria-expanded={expanded}
      >
        <div className={css.headerLeft}>
          <span className={css.headerIcon} aria-hidden="true">
            <AlertIcon size={12} />
          </span>
          <span className={css.headerTitle}>{tAny('requirement.detail.drift.title')}</span>
        </div>
        <div className={css.headerRight}>
          <span className={`${css.scorePill} ${css[`scorePill_${overallSev}` as 'scorePill_ok']}`}>
            {fmtScore(overall)}
          </span>
          <span className={`${css.sevLabel} ${css[`sevLabel_${overallSev}` as 'sevLabel_ok']}`}>
            {tAny(`requirement.detail.drift.severity.${overallSev}`)}
          </span>
          <ChevronIcon size={12} className={css.chevron} />
        </div>
      </button>

      <p className={css.subtitle}>{tAny('requirement.detail.drift.subtitle')}</p>

      {expanded && (
        <div className={css.body}>
          <LayerRow
            t={t}
            layerKey="static"
            score={driftSnapshot.staticLayer}
            sourceTaskId={driftSnapshot.sourceTaskId}
          />
          <LayerRow
            t={t}
            layerKey="dynamic"
            score={driftSnapshot.dynamicLayer}
            sourceTaskId={driftSnapshot.sourceTaskId}
          />
          <LayerRow
            t={t}
            layerKey="semantic"
            score={driftSnapshot.semanticLayer}
            sourceTaskId={driftSnapshot.sourceTaskId}
          />
          <button
            type="button"
            className={css.rerunBtn}
            disabled={rerunDisabled}
            onClick={(): void => {
              if (!rerunDisabled) onRerunDrift!()
            }}
            title={rerunDisabled
              ? tAny('requirement.detail.drift.action.rerunHint')
              : tAny('requirement.detail.drift.action.rerun')}
          >
            <RefreshIcon size={11} className={css.rerunIcon} />
            <span>
              {loading === true
                ? tAny('requirement.detail.drift.detecting')
                : tAny('requirement.detail.drift.action.rerun')}
            </span>
          </button>
          {loading !== true && onRerunDrift === undefined && (
            <p className={css.phase1Hint}>{tAny('requirement.detail.drift.phase1Hint')}</p>
          )}
        </div>
      )}
    </section>
  )
}

/* ── 子组件：单行 layer ── */

interface LayerRowProps {
  t: PropsLocale<'sky-axis'>['t']
  layerKey: 'static' | 'dynamic' | 'semantic'
  score: number
  sourceTaskId: string | null
}

function LayerRow({ t, layerKey, score, sourceTaskId }: LayerRowProps): JSX.Element {
  const tAny = t as unknown as (k: string) => string
  const sev = severityOf(score)
  return (
    <div className={`${css.layerRow} ${css[`layerRow_${sev}` as 'layerRow_ok']}`}>
      <div className={css.layerMain}>
        <span className={css.layerLabel}>{tAny(`requirement.detail.drift.layer.${layerKey}`)}</span>
        <span className={css.layerDesc}>{tAny(`requirement.detail.drift.layer.${layerKey}Desc`)}</span>
      </div>
      <div className={css.layerRight}>
        <span className={`${css.scorePill} ${css[`scorePill_${sev}` as 'scorePill_ok']}`}>
          {fmtScore(score)}
        </span>
        {sourceTaskId !== null && layerKey === 'semantic' && (
          <span className={css.layerSource} title={`来源 task ${sourceTaskId}`}>
            {sourceTaskId}
          </span>
        )}
      </div>
    </div>
  )
}

/** 让 component 标识别名在 DevTools 友好。 */
DriftCard.displayName = 'DriftCard'