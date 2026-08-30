/**
 * Locale dictionaries for the hello plugin. zh 为 key 集真源，en 完整对照
 * （包级双语文案规则）。通过 ctx.locale.register(NS, { zh, en }) 注册。
 *
 * 新页面是「开发工作台」仪表板：4 个指标卡片 + 我的动态流 +
 * 团队概览 + 快捷入口。所有用户可见文案中文，技术术语保留英文原文。
 */

/** 简体中文字典（key 集真源）。 */
export const zh = {
  // Sidebar trigger —— sidebar-entry.ts hardcode 'Hello' 显示，文案保留以备动态切换 locale
  'entry.label': '打个招呼',
  'entry.tooltip': '点击打开 hello 页面',

  // 完整页面（占主列）
  'page.title': '开发工作台',
  'page.subtitle': '一个完整的演示仪表板',
  'page.close': '返回会话',
  'page.back': '返回',
  'page.badge': '插件',
  'page.footerMeta': '由 hello 插件提供 · 演示仪表板',

  // 顶部 4 个指标卡片
  'dashboard.metric.todo.label': '待办任务',
  'dashboard.metric.progress.label': '进行中',
  'dashboard.metric.mr.label': '代码 MR',
  'dashboard.metric.alert.label': '告警',
  'dashboard.unit.item': '项',
  'dashboard.unit.piece': '个',
  'dashboard.unit.count': '条',

  // 我的动态流
  'dashboard.activity.title': '我的动态流',

  // 团队概览
  'dashboard.team.title': '团队概览',
  'dashboard.team.members': '团队成员',
  'dashboard.team.status.online': '在线',
  'dashboard.team.status.away': '离开',
  'dashboard.team.status.offline': '离线',
  'dashboard.team.progress': '本周迭代进度',
  'dashboard.team.progressDesc': '完成 {done} / 总共 {total} 个任务',
  'dashboard.team.recentMr': '最近合并的 MR',

  // 快捷入口
  'dashboard.quickActions.newRequirement': '新建需求',
  'dashboard.quickActions.newBranch': '创建分支',
  'dashboard.quickActions.newMr': '发起合并请求',
  'dashboard.quickActions.toastPrefix': '（演示）这是一个 mock 按钮：',
}

/** hello 命名空间的 key 联合类型。 */
export type HelloKey = keyof typeof zh

/** 英文字典，与 zh 一一对应。 */
export const en: Record<HelloKey, string> = {
  // Sidebar trigger
  'entry.label': 'Say hello',
  'entry.tooltip': 'Click to open the hello page',

  // 完整页面（占主列）
  'page.title': 'Developer Workbench',
  'page.subtitle': 'A complete demo dashboard',
  'page.close': 'Back to chat',
  'page.back': 'Back',
  'page.badge': 'plugin',
  'page.footerMeta': 'Provided by the hello plugin · demo dashboard',

  // Top 4 metric cards
  'dashboard.metric.todo.label': 'To-dos',
  'dashboard.metric.progress.label': 'In progress',
  'dashboard.metric.mr.label': 'Code MRs',
  'dashboard.metric.alert.label': 'Alerts',
  'dashboard.unit.item': 'tasks',
  'dashboard.unit.piece': 'PRs',
  'dashboard.unit.count': 'alerts',

  // Activity stream
  'dashboard.activity.title': 'My activity',

  // Team overview
  'dashboard.team.title': 'Team overview',
  'dashboard.team.members': 'Team members',
  'dashboard.team.status.online': 'online',
  'dashboard.team.status.away': 'away',
  'dashboard.team.status.offline': 'offline',
  'dashboard.team.progress': "This week's sprint",
  'dashboard.team.progressDesc': '{done} of {total} tasks done',
  'dashboard.team.recentMr': 'Recently merged MRs',

  // Quick actions
  'dashboard.quickActions.newRequirement': 'New requirement',
  'dashboard.quickActions.newBranch': 'Create branch',
  'dashboard.quickActions.newMr': 'Open merge request',
  'dashboard.quickActions.toastPrefix': '(demo) This is a mock button:',
}
