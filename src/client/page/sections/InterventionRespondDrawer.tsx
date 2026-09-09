/**
 * InterventionRespondDrawer —— 介入点 #3「应答介入队列项」（PR-D / 迭代 6）。
 *
 * 设计意图：用户在 InterventionQueuePane 任意 item 上点 approve/reject → 父级打开此 drawer；
 * drawer 根据 item.kind 渲染不同表单：
 *   - 'approval'：显示 tool call 摘要（payload.toolCall）+ 「批准 / 拒绝」二选一
 *   - 'question'：显示 payload.question（type 决定输入控件：text / single / multi / confirm）
 *   - 'review'  ：显示 payload.summary + 「通过 / 需修改」二选一；needModify=true 弹 modifyReason textarea
 *
 * 提交时把 answer 传给 controller.respondIntervention（乐观从队列中移除该 rpcId 项）。
 *
 * 视觉/交互契约：
 *   - 顶部显示 item.summary
 *   - 中部表单按 kind 切换
 *   - 底部 footer 由 RightDrawer 渲染，drawer 内部只放内容
 *
 * 数据契约：
 *   - onSubmit(answer: unknown)：把表单状态打包成 answer 给 parent
 *   - onCancel(): void：父级 footer 触发
 *   - submitting: boolean：提交中禁用所有输入 + 关闭按钮
 *
 * i18n：所有 label 都用 t(key) 拿，遵循包级 zh/en 双语规则。
 */
import { useState, type JSX } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RequirementInterventionItem } from '../../controller/sky-axis-controller.ts'
import css from './InterventionRespondDrawer.module.css'

/** 试图从 payload 读取 question 字段。
 *  任意一层类型不对都返回 null，UI 显示 fallback。 */
function readQuestionField(payload: unknown): {
  question: string
  type: 'text' | 'single' | 'multi' | 'confirm'
  options?: string[]
} | null {
  if (payload === null || typeof payload !== 'object') return null
  const obj = payload as Record<string, unknown>
  const q = obj.question
  const t = obj.type
  if (typeof q !== 'string') return null
  let type: 'text' | 'single' | 'multi' | 'confirm' = 'text'
  if (t === 'single' || t === 'multi' || t === 'confirm' || t === 'text') type = t
  const opts = obj.options
  const options = Array.isArray(opts) ? opts.filter((s): s is string => typeof s === 'string') : undefined
  return { question: q, type, options }
}

/** 读取 review payload 的 diff / summary（容错读取）。 */
function readReviewSummary(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return ''
  const obj = payload as Record<string, unknown>
  if (typeof obj.summary === 'string') return obj.summary
  if (typeof obj.diff === 'string') return obj.diff
  return ''
}

/** 读取 approval payload 的 tool call 描述。 */
function readApprovalDesc(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return ''
  const obj = payload as Record<string, unknown>
  if (typeof obj.toolCall === 'string') return obj.toolCall
  if (typeof obj.action === 'string') return obj.action
  return ''
}

export interface InterventionRespondDrawerProps {
  t: PropsLocale<'sky-axis'>['t']
  /** 介入项；drawer 据其 kind 渲染表单。 */
  item: RequirementInterventionItem
  /** 父级 footer 触发；drawer 把 answer 交给 controller.respondIntervention。 */
  onSubmit: (answer: unknown) => void
  /** 父级 footer「取消」触发。 */
  onCancel: () => void
  /** 提交中状态：禁用所有输入 + 关闭按钮。 */
  submitting: boolean
}

export function InterventionRespondDrawer(props: InterventionRespondDrawerProps): JSX.Element {
  const { t, item, onSubmit, onCancel, submitting } = props
  const tAny = t as unknown as (k: string) => string

  /* ── question 表单 state ── */
  const qMeta = readQuestionField(item.payload)
  const [textAnswer, setTextAnswer] = useState<string>('')
  const [singleChoice, setSingleChoice] = useState<string>('')
  const [multiChoice, setMultiChoice] = useState<string[]>([])
  const [confirmChoice, setConfirmChoice] = useState<boolean | null>(null)

  /* ── review 表单 state ── */
  const reviewSummary = readReviewSummary(item.payload)
  const [reviewPassed, setReviewPassed] = useState<boolean | null>(null)
  const [modifyReason, setModifyReason] = useState<string>('')

  /* ── approval 表单：无额外 state，答案固定为 {approved: true} | {approved: false} ── */

  /* ── 校验 + 提交 ── */
  const canSubmit = ((): boolean => {
    if (submitting) return false
    if (item.kind === 'approval') return true  // 始终可点（由按钮区分 approved: true/false）
    if (item.kind === 'question') {
      if (qMeta === null) return true  // payload 无 question 字段 → 不需要 answer（包成空对象即可）
      if (qMeta.type === 'text') return textAnswer.trim() !== ''
      if (qMeta.type === 'single') return singleChoice !== ''
      if (qMeta.type === 'multi') return multiChoice.length > 0
      if (qMeta.type === 'confirm') return confirmChoice !== null
    }
    if (item.kind === 'review') {
      if (reviewPassed === null) return false
      if (reviewPassed === false && modifyReason.trim() === '') return false
      return true
    }
    return false
  })()

  /** 点击 footer 的「提交 / 批准 / 拒绝 / 通过 / 需修改 / 取消」按钮时触发。 */
  const handleSubmit = (answer: unknown): void => {
    onSubmit(answer)
  }

  /* ── 渲染 ── */
  return (
    <div className={css.root}>
      <p className={css.summary}>{item.summary}</p>

      {item.kind === 'approval' && (
        <section className={css.kindBlock}>
          <h3 className={css.kindTitle}>{tAny('requirement.detail.queue.respond.approvalTitle')}</h3>
          <div className={css.toolCall}>
            <pre className={css.toolCallBody}>
              {readApprovalDesc(item.payload) || tAny('requirement.detail.queue.respond.toolCallUnknown')}
            </pre>
          </div>
          <p className={css.kindHint}>{tAny('requirement.detail.queue.respond.approvalHint')}</p>
          <div className={css.decisionRow}>
            <button
              type="button"
              className={css.dangerButton}
              disabled={submitting}
              onClick={(): void => { handleSubmit({ approved: false }) }}
            >
              {tAny('requirement.detail.queue.respond.reject')}
            </button>
            <button
              type="button"
              className={css.primaryButton}
              disabled={submitting}
              onClick={(): void => { handleSubmit({ approved: true }) }}
            >
              {tAny('requirement.detail.queue.respond.approve')}
            </button>
          </div>
        </section>
      )}

      {item.kind === 'question' && (
        <section className={css.kindBlock}>
          <h3 className={css.kindTitle}>{tAny('requirement.detail.queue.respond.questionTitle')}</h3>
          {qMeta === null ? (
            <p className={css.warning}>{tAny('requirement.detail.queue.respond.questionMissing')}</p>
          ) : (
            <>
              <p className={css.questionText}>{qMeta.question}</p>
              {qMeta.type === 'text' && (
                <textarea
                  className={css.textarea}
                  rows={4}
                  maxLength={2000}
                  placeholder={tAny('requirement.detail.queue.respond.questionTextPlaceholder')}
                  value={textAnswer}
                  disabled={submitting}
                  onChange={(e): void => { setTextAnswer(e.target.value) }}
                />
              )}
              {qMeta.type === 'single' && qMeta.options !== undefined && (
                <div className={css.choiceGroup}>
                  {qMeta.options.map(opt => (
                    <label key={opt} className={css.choiceOption}>
                      <input
                        type="radio"
                        name="intervention-single"
                        value={opt}
                        checked={singleChoice === opt}
                        disabled={submitting}
                        onChange={(): void => { setSingleChoice(opt) }}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              )}
              {qMeta.type === 'multi' && qMeta.options !== undefined && (
                <div className={css.choiceGroup}>
                  {qMeta.options.map(opt => (
                    <label key={opt} className={css.choiceOption}>
                      <input
                        type="checkbox"
                        value={opt}
                        checked={multiChoice.includes(opt)}
                        disabled={submitting}
                        onChange={(e): void => {
                          if (e.target.checked) setMultiChoice(prev => [...prev, opt])
                          else setMultiChoice(prev => prev.filter(s => s !== opt))
                        }}
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              )}
              {qMeta.type === 'confirm' && (
                <div className={css.decisionRow}>
                  <button
                    type="button"
                    className={css.secondaryButton}
                    disabled={submitting}
                    onClick={(): void => { setConfirmChoice(false) }}
                  >
                    {tAny('requirement.detail.queue.respond.confirmNo')}
                  </button>
                  <button
                    type="button"
                    className={css.primaryButton}
                    disabled={submitting}
                    onClick={(): void => { setConfirmChoice(true) }}
                  >
                    {tAny('requirement.detail.queue.respond.confirmYes')}
                  </button>
                </div>
              )}
            </>
          )}
          <div className={css.footer}>
            <button
              type="button"
              className={css.cancelButton}
              onClick={onCancel}
              disabled={submitting}
            >
              {tAny('requirement.detail.queue.respond.cancel')}
            </button>
            <button
              type="button"
              className={css.confirmButton}
              disabled={!canSubmit}
              onClick={(): void => {
                if (qMeta === null) {
                  handleSubmit({})
                  return
                }
                switch (qMeta.type) {
                  case 'text':    handleSubmit({ answer: textAnswer.trim() }); break
                  case 'single':  handleSubmit({ choice: singleChoice }); break
                  case 'multi':   handleSubmit({ choices: multiChoice }); break
                  case 'confirm': handleSubmit({ confirmed: confirmChoice === true }); break
                }
              }}
            >
              {tAny('requirement.detail.queue.respond.confirm')}
            </button>
          </div>
        </section>
      )}

      {item.kind === 'review' && (
        <section className={css.kindBlock}>
          <h3 className={css.kindTitle}>{tAny('requirement.detail.queue.respond.reviewTitle')}</h3>
          {reviewSummary !== '' && (
            <pre className={css.toolCallBody}>{reviewSummary}</pre>
          )}
          <div className={css.decisionRow}>
            <button
              type="button"
              className={`${css.secondaryButton} ${reviewPassed === false ? css.selected : ''}`}
              disabled={submitting}
              onClick={(): void => { setReviewPassed(false) }}
            >
              {tAny('requirement.detail.queue.respond.needModify')}
            </button>
            <button
              type="button"
              className={`${css.primaryButton} ${reviewPassed === true ? css.selected : ''}`}
              disabled={submitting}
              onClick={(): void => { setReviewPassed(true) }}
            >
              {tAny('requirement.detail.queue.respond.confirm')}
            </button>
          </div>
          {reviewPassed === false && (
            <fieldset className={css.field}>
              <legend className={css.legend}>
                {tAny('requirement.detail.queue.respond.modifyReasonLabel')}
              </legend>
              <textarea
                className={css.textarea}
                rows={3}
                maxLength={500}
                value={modifyReason}
                disabled={submitting}
                onChange={(e): void => { setModifyReason(e.target.value) }}
              />
            </fieldset>
          )}
          <div className={css.footer}>
            <button
              type="button"
              className={css.cancelButton}
              onClick={onCancel}
              disabled={submitting}
            >
              {tAny('requirement.detail.queue.respond.cancel')}
            </button>
            <button
              type="button"
              className={css.confirmButton}
              disabled={!canSubmit}
              onClick={(): void => {
                if (reviewPassed === true) {
                  handleSubmit({ passed: true })
                } else if (reviewPassed === false) {
                  handleSubmit({ passed: false, modifyReason: modifyReason.trim() })
                }
              }}
            >
              {tAny('requirement.detail.queue.respond.confirm')}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
