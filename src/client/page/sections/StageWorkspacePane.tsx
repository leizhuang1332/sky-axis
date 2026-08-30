/**
 * StageWorkspacePane —— 详情页中 50% 列「当前阶段工作区」。
 *
 * Phase 1 范围：
 *   - 显示当前 stage 标题 + 描述 + 阶段历史
 *   - 按 stage 切换 mock 内容（不同 stage 渲染不同说明卡）
 *   - 当前 stage 工作区为空时显示引导文案
 *
 * Phase 2+：
 *   - 接入 ai-event-bridge 的 tool/result → 自动归类到 artifact
 *   - 阶段产物列表接入 artifacts map
 *   - DiffView / Markdown 自渲染
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  RequirementEntry,
  RequirementStage,
} from '../../controller/sky-axis-controller.ts'
import {
  ClockIcon, FlagIcon, WorkflowIcon, PlayIcon, PauseIcon,
} from '../../icons/icons.tsx'
import css from './StageWorkspacePane.module.css'

export interface StageWorkspacePaneProps {
  t: PropsLocale<'sky-axis'>['t']
  requirement: RequirementEntry
}

const STAGE_ICONS: Record<RequirementStage, (p: { size?: number; className?: string }) => JSX.Element> = {
  understand: ClockIcon,
  plan: FlagIcon,
  implement: WorkflowIcon,
  verify: PlayIcon,
  deliver: PauseIcon,
}

/** 格式化 stageHistory 条目的 enteredAt/leftAt 为「YYYY-MM-DD HH:mm」。 */
function formatTime(iso: string | undefined): string {
  if (iso === undefined) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const pad = (n: number): string => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

/** 按 stage 渲染对应的「本阶段产物提示」内容。Phase 1 全部是引导文案。 */
function renderStageContent(
  stage: RequirementStage,
  t: (k: string) => string,
): JSX.Element {
  const stageKey = stage
  return (
    <div className={css.stageContent}>
      <div className={css.stageHint}>
        <span className={css.stageHintIcon} aria-hidden="true">💡</span>
        <p className={css.stageHintText}>{t(`requirement.detail.stage.${stageKey}.hint`)}</p>
      </div>
      <div className={css.placeholder}>
        <span className={css.placeholderLabel}>{t('requirement.detail.workspace.placeholder')}</span>
        <p className={css.placeholderText}>{t('requirement.detail.workspace.placeholderDesc')}</p>
      </div>
    </div>
  )
}

export function StageWorkspacePane({ t, requirement }: StageWorkspacePaneProps): JSX.Element {
  // t 强转为 (k: string) => string —— renderStageContent 与模板字符串都是动态 key
  const tAny = t as unknown as (k: string) => string
  const stage: RequirementStage = requirement.stage ?? 'understand'
  const Icon = STAGE_ICONS[stage]
  const history = requirement.stageHistory ?? []
  const artifactCount = Object.keys(requirement.artifacts ?? {}).length

  return (
    <div className={css.pane}>
      <header className={css.header}>
        <div className={css.headerIcon}>
          <Icon size={16} className={css.headerIconSvg} />
        </div>
        <div className={css.headerText}>
          <h3 className={css.title}>{tAny(`requirement.detail.stage.${stage}.label`)}</h3>
          <p className={css.subtitle}>{tAny(`requirement.detail.stage.${stage}.desc`)}</p>
        </div>
        <div className={css.headerMeta}>
          <span className={css.metaBadge}>{tAny('requirement.detail.workspace.artifactCount').replace('{n}', String(artifactCount))}</span>
        </div>
      </header>

      {/* 当前阶段内容 */}
      {renderStageContent(stage, tAny)}

      {/* 阶段历史时间线 */}
      {history.length > 0 && (
        <section className={css.history}>
          <h4 className={css.historyTitle}>{tAny('requirement.detail.history.title')}</h4>
          <ol className={css.historyList}>
            {history.map((entry, idx) => (
              <li key={`${entry.stage}-${idx}`} className={css.historyItem}>
                <span className={`${css.historyDot} ${entry.stage === stage ? css.historyDotCurrent : ''}`} aria-hidden="true" />
                <span className={css.historyStage}>{tAny(`requirement.detail.stage.${entry.stage}.label`)}</span>
                <span className={css.historyTime}>{formatTime(entry.enteredAt)}</span>
                {entry.leftAt !== undefined && (
                  <span className={css.historyOutcome}>{tAny(`requirement.detail.history.outcome.${entry.outcome ?? 'completed'}`)}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

/** 让 component 标识别名在 DevTools 友好。 */
StageWorkspacePane.displayName = 'StageWorkspacePane'