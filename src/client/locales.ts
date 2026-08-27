/**
 * Locale dictionaries for the hello plugin. zh 为 key 集真源，en 完整对照
 * （包级双语文案规则）。通过 ctx.locale.register(NS, { zh, en }) 注册。
 *
 * 多 section 面板：每个 section 一个命名段，避免 key 冲突。
 */

/** 简体中文字典（key 集真源）。 */
export const zh = {
  // Sidebar trigger
  'entry.label': '打个招呼',
  'entry.tooltip': '点击打开 hello 面板',

  // Dialog shell
  'dialog.title': 'Hello 面板',
  'dialog.close': '关闭',

  // Section 1: greeting
  'section.greeting.title': '问候',
  'section.greeting.body': 'hello world 👋',

  // Section 2: clock
  'section.clock.title': '当前时间',
  'section.clock.locale': 'zh-CN',
  'section.clock.dateLabel': '日期',
  'section.clock.timeLabel': '时间',

  // Section 3: session
  'section.session.title': '当前会话',
  'section.session.none': '（暂无活跃会话）',
  'section.session.unknown': '（未命名）',

  // Section 4: quote
  'section.quote.title': '今日一言',
  'section.quote.refresh': '换一句',
  'section.quote.refreshing': '换…',
}

/** hello 命名空间的 key 联合类型。 */
export type HelloKey = keyof typeof zh

/** 英文字典，与 zh 一一对应。 */
export const en: Record<HelloKey, string> = {
  // Sidebar trigger
  'entry.label': 'Say hello',
  'entry.tooltip': 'Click to open the hello panel',

  // Dialog shell
  'dialog.title': 'Hello Panel',
  'dialog.close': 'Close',

  // Section 1: greeting
  'section.greeting.title': 'Greeting',
  'section.greeting.body': 'hello world 👋',

  // Section 2: clock
  'section.clock.title': 'Current time',
  'section.clock.locale': 'en-US',
  'section.clock.dateLabel': 'Date',
  'section.clock.timeLabel': 'Time',

  // Section 3: session
  'section.session.title': 'Current session',
  'section.session.none': '(no active session)',
  'section.session.unknown': '(untitled)',

  // Section 4: quote
  'section.quote.title': 'Quote of the moment',
  'section.quote.refresh': 'Next',
  'section.quote.refreshing': '...',
}

/**
 * 内置随机名言库（中英对照），每条带 author。
 * 数组顺序即随机游走顺序；刷新时由 index 自增取模循环，避免连续重复。
 */
export interface Quote {
  /** 简体中文版本。 */
  zh: string
  /** 英文版本。 */
  en: string
  /** 作者署名。 */
  author: string
}

/** 名言库 —— 12 条，覆盖工程师文化。 */
export const QUOTES: readonly Quote[] = [
  { zh: '保持简单。', en: 'Keep it simple.', author: 'Anthropic' },
  { zh: '代码是被读得最多的。', en: 'Code is read more than it is written.', author: 'Joel Spolsky' },
  { zh: '过早优化是万恶之源。', en: 'Premature optimization is the root of all evil.', author: 'Donald Knuth' },
  { zh: '做正确的事，而非容易的事。', en: 'Do the right thing. Not the easy thing.', author: 'Anon' },
  { zh: '先让它工作，再让它正确，最后让它快。', en: 'Make it work, make it right, make it fast.', author: 'Kent Beck' },
  { zh: '简单的代码也是难写出来的。', en: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci' },
  { zh: '今日事，今日毕。', en: 'Today is a good day to finish what you started.', author: 'Anon' },
  { zh: '问题是答案的一半。', en: 'The question is half the answer.', author: 'Anon' },
  { zh: '会读代码的人写得出好代码。', en: 'Reading code is what makes good code.', author: 'Anon' },
  { zh: '测试不是负担，是对话。', en: 'Tests are not a burden, they are a conversation.', author: 'Anon' },
  { zh: '人是目的，不是手段。', en: 'People are an end, not a means.', author: 'Kant' },
  { zh: '好奇心是最好的老师。', en: 'Curiosity is the best teacher.', author: 'Anon' },
]