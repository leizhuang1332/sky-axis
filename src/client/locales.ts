/**
 * Locale dictionaries for the sky-axis plugin. zh 为 key 集真源，en 完整对照
 * （包级双语文案规则）。通过 ctx.locale.register(NS, { zh, en }) 注册。
 *
 * 命名空间分层：
 *   - entry.* / page.*     DSH shell 入口与整页框架
 *   - dashboard.*          dashboard section 共用文案（MetricCards / Activity / Team / QuickActions）
 *   - sidebar.*            sky-axis 内部 sidebar 的 5 entry 标签
 *   - view.*               5 个视图的标题、副标题与子块标题
 */

/** 简体中文字典（key 集真源）。 */
export const zh = {
  // Sidebar trigger —— sidebar-entry.ts hardcode 'SkyAxis' 显示，文案保留以备动态切换 locale
  'entry.label': '打个招呼',
  'entry.tooltip': '点击打开 sky-axis 页面',

  // 完整页面（占主列）
  'page.title': '开发工作台',
  'page.subtitle': '一个完整的演示仪表板',
  'page.close': '返回会话',
  'page.back': '返回',
  'page.badge': '插件',
  'page.footerMeta': '由 sky-axis 插件提供 · 演示仪表板',

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
  'dashboard.quickActions.newRequirementDisabledHint': '请先在 DSH 工作区管理创建一个工作区',

  // 内部 sidebar
  'sidebar.ariaLabel': '工作台导航',
  'sidebar.home.label': '首页',
  'sidebar.team.label': '团队',
  'sidebar.personal.label': '个人',
  'sidebar.reports.label': '报表',
  'sidebar.settings.label': '设置',
  'sidebar.requirements.label': '需求列表',
  'sidebar.personalOverview.label': '概览',
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
  'view.requirements.title': '需求列表',
  'view.requirements.subtitle': '按工作区分组，支持新建、查看与删除',
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

  /* ── Requirement 新建 / 列表 / 错误 / 状态 / 优先级 ── */
  'requirement.list.title': '需求列表',
  'requirement.list.subtitle': '按工作区分组，支持新建、查看与删除',
  'requirement.list.loading': '加载中…',
  'requirement.list.empty': '暂无需求。点击左侧「新建需求」创建第一条。',
  'requirement.list.errorPrefix': '加载失败：',
  'requirement.list.delete': '删除需求',

  'requirement.workspace.removed': '（工作区已删除）',

  'requirement.new.title': '新建需求',
  'requirement.new.workspace': '工作区',
  'requirement.new.workspaceHint': '该需求产生的文件和产物将保存到此工作区',
  'requirement.new.workspacePlaceholder': '请选择工作区',
  'requirement.new.titleLabel': '标题',
  'requirement.new.titleHint': '1-120 字',
  'requirement.new.titlePlaceholder': '简要描述需求',
  'requirement.new.descriptionLabel': '描述',
  'requirement.new.descriptionHint': '可选，最多 4000 字',
  'requirement.new.descriptionPlaceholder': '详细需求内容、验收标准、参考链接…',
  'requirement.new.priorityLabel': '优先级',
  'requirement.new.tagsLabel': '标签',
  'requirement.new.tagsHint': '逗号或空格分隔，每个 1-32 字，最多 20 个',
  'requirement.new.tagsPlaceholder': '例如：前端, 紧急, 优化',
  'requirement.new.noWorkspace': '当前 DSH 没有可用工作区。请先在 DSH 工作区管理创建一个工作区。',
  'requirement.new.createWorkspace': '创建工作区',
  'requirement.new.createWorkspaceHint': '在主机文件系统创建一个新的工作区目录',
  'requirement.new.creatingWorkspace': '创建中…',
  'requirement.new.errorPrefix': '提交失败：',
  'requirement.new.cancel': '取消',
  'requirement.new.submit': '创建',
  'requirement.new.submitting': '创建中…',

  'requirement.status.open': '待处理',
  'requirement.status.in_progress': '进行中',
  'requirement.status.done': '已完成',
  'requirement.status.cancelled': '已取消',

  'requirement.priority.low': '低',
  'requirement.priority.normal': '中',
  'requirement.priority.high': '高',
  'requirement.priority.urgent': '紧急',

  'requirement.error.validation-failed': '输入校验失败',
  'requirement.error.workspace-not-found': '工作区不存在，请刷新工作区列表',
  'requirement.error.workspace-list-failed': '无法获取工作区列表',
  'requirement.error.workspace-create-failed': '创建工作区失败',
  'requirement.error.requirement-not-found': '需求不存在或已被删除',
  'requirement.error.invalid-record': '存储数据校验失败',
  'requirement.error.internal-error': '服务器内部错误',
  'requirement.error.network-error': '网络请求失败',
}

/** sky-axis 命名空间的 key 联合类型。 */
export type SkyAxisKey = keyof typeof zh

/** 英文字典，与 zh 一一对应。 */
export const en: Record<SkyAxisKey, string> = {
  // Sidebar trigger
  'entry.label': 'Say sky-axis',
  'entry.tooltip': 'Click to open the sky-axis page',

  // 完整页面（占主列）
  'page.title': 'Developer Workbench',
  'page.subtitle': 'A complete demo dashboard',
  'page.close': 'Back to chat',
  'page.back': 'Back',
  'page.badge': 'plugin',
  'page.footerMeta': 'Provided by the sky-axis plugin · demo dashboard',

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
  'dashboard.quickActions.newRequirementDisabledHint': 'Please create a workspace in DSH workspace manager first',

  // Internal sidebar
  'sidebar.ariaLabel': 'Workbench navigation',
  'sidebar.home.label': 'Home',
  'sidebar.team.label': 'Team',
  'sidebar.personal.label': 'Personal',
  'sidebar.reports.label': 'Reports',
  'sidebar.settings.label': 'Settings',
  'sidebar.requirements.label': 'Requirements',
  'sidebar.personalOverview.label': 'Overview',
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
  'view.requirements.title': 'Requirements',
  'view.requirements.subtitle': 'Grouped by workspace — create, view and delete',
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

  /* ── Requirement new / list / error / status / priority ── */
  'requirement.list.title': 'Requirements',
  'requirement.list.subtitle': 'Grouped by workspace — create, view and delete',
  'requirement.list.loading': 'Loading…',
  'requirement.list.empty': 'No requirements yet. Click "New requirement" in the sidebar to create one.',
  'requirement.list.errorPrefix': 'Failed to load: ',
  'requirement.list.delete': 'Delete requirement',

  'requirement.workspace.removed': '(workspace removed)',

  'requirement.new.title': 'New requirement',
  'requirement.new.workspace': 'Workspace',
  'requirement.new.workspaceHint': 'Files and artifacts produced by this requirement will be saved to this workspace',
  'requirement.new.workspacePlaceholder': 'Select a workspace',
  'requirement.new.titleLabel': 'Title',
  'requirement.new.titleHint': '1-120 chars',
  'requirement.new.titlePlaceholder': 'Brief description of the requirement',
  'requirement.new.descriptionLabel': 'Description',
  'requirement.new.descriptionHint': 'Optional, up to 4000 chars',
  'requirement.new.descriptionPlaceholder': 'Detailed description, acceptance criteria, references…',
  'requirement.new.priorityLabel': 'Priority',
  'requirement.new.tagsLabel': 'Tags',
  'requirement.new.tagsHint': 'Comma or whitespace separated, each 1-32 chars, up to 20',
  'requirement.new.tagsPlaceholder': 'e.g. frontend, urgent, perf',
  'requirement.new.noWorkspace': 'No DSH workspace available. Please create one in DSH workspace manager first.',
  'requirement.new.createWorkspace': 'Create workspace',
  'requirement.new.createWorkspaceHint': 'Create a new workspace directory in the host filesystem',
  'requirement.new.creatingWorkspace': 'Creating…',
  'requirement.new.errorPrefix': 'Submit failed: ',
  'requirement.new.cancel': 'Cancel',
  'requirement.new.submit': 'Create',
  'requirement.new.submitting': 'Creating…',

  'requirement.status.open': 'Open',
  'requirement.status.in_progress': 'In progress',
  'requirement.status.done': 'Done',
  'requirement.status.cancelled': 'Cancelled',

  'requirement.priority.low': 'Low',
  'requirement.priority.normal': 'Normal',
  'requirement.priority.high': 'High',
  'requirement.priority.urgent': 'Urgent',

  'requirement.error.validation-failed': 'Input validation failed',
  'requirement.error.workspace-not-found': 'Workspace does not exist; please refresh the workspace list',
  'requirement.error.workspace-list-failed': 'Failed to fetch workspace list',
  'requirement.error.workspace-create-failed': 'Failed to create workspace',
  'requirement.error.requirement-not-found': 'Requirement does not exist or has been deleted',
  'requirement.error.invalid-record': 'Stored data validation failed',
  'requirement.error.internal-error': 'Internal server error',
  'requirement.error.network-error': 'Network request failed',
}
