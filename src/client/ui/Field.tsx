/**
 * Field —— 通用表单字段包装（label + input/select/textarea children + hint/error）。
 *
 * 用法：
 *   <Field label="标题" required error={touched && title === '' ? '此项为必填' : undefined}>
 *     <input className={formCss.input} value={title} onChange={...} />
 *   </Field>
 *
 * 设计：
 *   - 纯展示包装，不持有表单状态（state 留在 form 组件）
 *   - children 由调用方传入，让 Field 不绑死具体控件类型
 *   - required 渲染红色 *
 *   - error 优先于 hint 同时只显示一个（避免视觉噪声）
 *   - 与 NewRequirementModal 旧内联 Field 完全等价，扩展了 required / error
 */
import type { ReactNode } from 'react'
import css from './Field.module.css'

export interface FieldProps {
  /** 字段标签文本。 */
  label: string
  /** 输入控件（input / select / textarea / 自定义 React 节点）。 */
  children: ReactNode
  /** 字段下方提示文案（次要说明，无 error 时显示）。 */
  hint?: string
  /** 是否必填 —— 渲染 label 后的红色 *。 */
  required?: boolean
  /** 校验错误文案 —— 优先于 hint 显示。 */
  error?: string
}

export function Field({ label, hint, required, error, children }: FieldProps): JSX.Element {
  return (
    <label className={css.field}>
      <span className={css.fieldLabel}>
        {label}
        {required === true && (
          <span className={css.required} aria-label="required"> *</span>
        )}
      </span>
      {children}
      {error !== undefined
        ? <span className={css.fieldError} role="alert">{error}</span>
        : hint !== undefined && <span className={css.fieldHint}>{hint}</span>}
    </label>
  )
}