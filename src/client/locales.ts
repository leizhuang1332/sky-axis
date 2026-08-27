/**
 * Locale dictionaries for the hello plugin. zh 为 key 集真源，en 完整对照
 * （包级双语文案规则）。通过 ctx.locale.register(NS, { zh, en }) 注册。
 */

/** 简体中文字典（key 集真源）。 */
export const zh = {
  'entry.label': '打个招呼',
  'entry.tooltip': '点击显示 hello world',
  'dialog.title': 'Hello',
  'dialog.greeting': 'hello world',
  'dialog.close': '关闭',
}

/** hello 命名空间的 key 联合类型。 */
export type HelloKey = keyof typeof zh

/** 英文字典，与 zh 一一对应。 */
export const en: Record<HelloKey, string> = {
  'entry.label': 'Say hello',
  'entry.tooltip': 'Click to show hello world',
  'dialog.title': 'Hello',
  'dialog.greeting': 'hello world',
  'dialog.close': 'Close',
}