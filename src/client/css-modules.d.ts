/** CSS Modules 类型声明（供 tsdown 的 CSS 内联预设消费）。 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}