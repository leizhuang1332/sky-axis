/**
 * FormErrorBar —— 6 个 AddXxxForm 共用的错误条组件。
 *
 * 解决的问题（旧实现）：
 *   - 每个 form 自己渲染 `<div className={css.errorBar}>`，标题永远硬编码
 *     「此项为必填」（`errorRequired` 这个 key）。但 server 抛回来的
 *     dedup / git-clone-failed / network-error 等错误也走同一个 errorBar，
 *     标题与实际语义错位，误导用户以为字段没填。
 *   - 错误条在表单顶部（`<form>` 第一个子元素），用户提交时视线在底部
 *     按钮 spinner 上，host reject 后 spinner 消失，错误条出现在视线之外，
 *     用户感觉「什么都没发生」。
 *
 * 修复：
 *   - 标题统一为「操作失败 / Action failed」，不再写「此项为必填」
 *   - 字段必填错误仍走 `<Field error={...}>`，不进 errorBar —— 两类错误
 *     物理隔离，互不干扰
 *   - ref + useEffect 触发 scrollIntoView，自动把错误条滚到可视区中心
 *
 * 用法：
 *   <FormErrorBar error={error} t={t} />
 *   其中 `error` 来自 form 的 `useState<RequirementError | null>`，只在
 *   server 抛错 / 网络异常时 setError，提交校验失败不进这里。
 */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useEffect, useRef } from 'react'
import type { RequirementError } from '../../../controller/sky-axis-controller.ts'
import css from './forms.module.css'

export interface FormErrorBarProps {
  t: PropsLocale<'sky-axis'>['t']
  error: RequirementError | null
}

export function FormErrorBar({ t, error }: FormErrorBarProps): JSX.Element | null {
  const ref = useRef<HTMLDivElement | null>(null)

  // error 从 null 变非空时,把错误条滚到可视区中心 —— 解决 spinner 消失后
  // 用户视线跟不上、感觉「没有提示」的问题。smooth 行为让滚动更自然。
  useEffect(() => {
    if (error !== null) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [error])

  if (error === null) return null

  // code → locale 文案;key 已在 locales.ts 预注册(中英两套),这里直接取。
  const message = t(`requirement.error.${error.code}` as never)

  return (
    <div ref={ref} className={css.errorBar} role="alert">
      <strong className={css.errorTitle}>
        {t('requirement.detail.materials.form.errorTitle')}
      </strong>
      <span>{message}</span>
      {error.detail !== undefined && (
        <code className={css.errorDetail}>{error.detail}</code>
      )}
    </div>
  )
}
