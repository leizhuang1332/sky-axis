/**
 * Locale dictionaries for the hello plugin. zh 为 key 集真源，en 完整对照
 * （包级双语文案规则）。通过 ctx.locale.register(NS, { zh, en }) 注册。
 *
 * 命名空间分层：
 *   - entry.* / page.*     DSH shell 入口与整页框架
 *   - dashboard.*          dashboard section 共用文案（MetricCards / Activity / Team / QuickActions）
 *   - sidebar.*            hello 内部 sidebar 的 5 entry 标签
 *   - view.*               5 个视图的标题、副标题与子块标题
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

  // 内部 sidebar
  'sidebar.ariaLabel': '工作台导航',
  'sidebar.home.label': '首页',
  'sidebar.team.label': '团队',
  'sidebar.personal.label': '个人',
  'sidebar.reports.label': '报表',
  'sidebar.settings.label': '设置',
  'sidebar.quickActions.label': '快捷操作',
  'sidebar.toggle.collapse': '收起',
  'sidebar.toggle.expand': '展开',

  // 视图标题 / 副标题
  'view.home.title': '工作台首页',
  'view.home.subtitle': '今日工作总览',
  'view.team.title': '团队',
  'view.team.subtitle': '查看团队动态与迭代',
  'view.personal.title': '个人',
  'view.personal.subtitle': '我的工作与统计',
  'view.reports.title': '报表',
  'view.reports.subtitle': '数据可视化与历史',
  'view.settings.title': '设置',
  'view.settings.subtitle': '偏好与个人信息',

  // Team view 子块
  'view.team.members.title': '团队成员',
  'view.team.iteration.title': '本周迭代',
  'view.team.wiki.title': '团队文档',
  'view.team.calendar.title': '近期活动',

  // Personal view 子块
  'view.personal.tasks.title': '我的任务',
  'view.personal.mrs.title': '我的 MR',
  'view.personal.stats.title': '我的统计',
  'view.personal.calendar.title': '今日安排',

  // Reports view 子块
  'view.reports.charts.title': '关键指标',
  'view.reports.list.title': '报表列表',

  // Settings view 子块
  'view.settings.preference.title': '偏好',
  'view.settings.notifications.title': '通知',
  'view.settings.profile.title': '个人信息',

  // Settings view 表单 label（mock，但要走 locale 演示全 i18n）
  'view.settings.preference.theme': '主题',
  'view.settings.preference.themeLight': '浅色',
  'view.settings.preference.themeDark': '深色',
  'view.settings.preference.language': '语言',
  'view.settings.preference.compactDensity': '紧凑布局',
  'view.settings.notifications.bugAlert': 'Bug 告警',
  'view.settings.notifications.mrReview': 'MR 审查请求',
  'view.settings.notifications.mention': '被 @ 提及',
  'view.settings.notifications.weeklyDigest': '每周汇总',
  'view.settings.profile.name': '姓名',
  'view.settings.profile.employeeId': '工号',
  'view.settings.profile.joinedAt': '入职日期',
  'view.settings.profile.team': '所属团队',
  'view.settings.profile.role': '角色',
  'view.settings.profile.email': '邮箱',
  'view.settings.save': '保存',
  'view.settings.saveToast': '（演示）保存按钮未实现',
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

  // Internal sidebar
  'sidebar.ariaLabel': 'Workbench navigation',
  'sidebar.home.label': 'Home',
  'sidebar.team.label': 'Team',
  'sidebar.personal.label': 'Personal',
  'sidebar.reports.label': 'Reports',
  'sidebar.settings.label': 'Settings',
  'sidebar.quickActions.label': 'Quick actions',
  'sidebar.toggle.collapse': 'Collapse',
  'sidebar.toggle.expand': 'Expand',

  // View titles / subtitles
  'view.home.title': 'Workbench home',
  'view.home.subtitle': "Today's overview",
  'view.team.title': 'Team',
  'view.team.subtitle': 'Team activity & iteration',
  'view.personal.title': 'Personal',
  'view.personal.subtitle': 'My work & stats',
  'view.reports.title': 'Reports',
  'view.reports.subtitle': 'Charts & history',
  'view.settings.title': 'Settings',
  'view.settings.subtitle': 'Preferences & profile',

  // Team view sub-blocks
  'view.team.members.title': 'Team members',
  'view.team.iteration.title': "This week's sprint",
  'view.team.wiki.title': 'Team docs',
  'view.team.calendar.title': 'Recent activity',

  // Personal view sub-blocks
  'view.personal.tasks.title': 'My tasks',
  'view.personal.mrs.title': 'My MRs',
  'view.personal.stats.title': 'My stats',
  'view.personal.calendar.title': 'Today schedule',

  // Reports view sub-blocks
  'view.reports.charts.title': 'Key metrics',
  'view.reports.list.title': 'Report list',

  // Settings view sub-blocks
  'view.settings.preference.title': 'Preferences',
  'view.settings.notifications.title': 'Notifications',
  'view.settings.profile.title': 'Profile',

  // Settings form labels (mock but locale-aware)
  'view.settings.preference.theme': 'Theme',
  'view.settings.preference.themeLight': 'Light',
  'view.settings.preference.themeDark': 'Dark',
  'view.settings.preference.language': 'Language',
  'view.settings.preference.compactDensity': 'Compact density',
  'view.settings.notifications.bugAlert': 'Bug alerts',
  'view.settings.notifications.mrReview': 'MR review requests',
  'view.settings.notifications.mention': 'Mentions',
  'view.settings.notifications.weeklyDigest': 'Weekly digest',
  'view.settings.profile.name': 'Name',
  'view.settings.profile.employeeId': 'Employee ID',
  'view.settings.profile.joinedAt': 'Joined at',
  'view.settings.profile.team': 'Team',
  'view.settings.profile.role': 'Role',
  'view.settings.profile.email': 'Email',
  'view.settings.save': 'Save',
  'view.settings.saveToast': '(demo) Save is not implemented',
}
