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
  'requirement.list.open': '打开详情页',

  'requirement.workspace.removed': '（工作区已删除）',

  /* ── Phase 1.2：需求详情页 ── */
  'requirement.detail.title': '需求详情',
  'requirement.detail.back': '返回',
  'requirement.detail.notFound': '该需求已被删除或不存在。',
  'requirement.detail.errorPrefix': '详情加载失败：',

  'requirement.detail.meta.workspace': '工作区',
  'requirement.detail.meta.workspaceRemoved': '（已删除）',
  'requirement.detail.meta.branch': '分支',
  'requirement.detail.meta.id': 'ID',

  /* 5 阶段 */
  'requirement.detail.stage.understand.label': '理解',
  'requirement.detail.stage.understand.desc': '找歧义、搜代码、澄清问题',
  'requirement.detail.stage.understand.hint': 'AI 会自动搜集代码上下文并提出澄清问题；回答后可进入规划阶段。',
  'requirement.detail.stage.plan.label': '规划',
  'requirement.detail.stage.plan.desc': '多方案、风险、测试策略',
  'requirement.detail.stage.plan.hint': 'AI 会生成 2-3 个候选方案，标注风险与测试策略；选定方案后进入实现阶段。',
  'requirement.detail.stage.implement.label': '实现',
  'requirement.detail.stage.implement.desc': '按方案生成代码并 commit',
  'requirement.detail.stage.implement.hint': 'AI 按选定方案逐步生成代码，每个关键步骤会停下来让你审 diff。',
  'requirement.detail.stage.verify.label': '验证',
  'requirement.detail.stage.verify.desc': '跑测试、code review',
  'requirement.detail.stage.verify.hint': 'AI 自动跑 lint / typecheck / 测试，补缺失单测；review 通过后进入交付。',
  'requirement.detail.stage.deliver.label': '交付',
  'requirement.detail.stage.deliver.desc': 'MR、部署、监控',
  'requirement.detail.stage.deliver.hint': 'AI 跟踪 CI、回答 review、合并监控；可随时 hotfix 回退。',

  /* AI 协奏面板 */
  'requirement.detail.conductor.title': 'AI 协奏',
  'requirement.detail.conductor.subtitle': 'AI 持续运转，人在关键点拍板',
  'requirement.detail.conductor.lastActivity': '最近活动',
  'requirement.detail.conductor.neverActive': '从未启动',
  'requirement.detail.conductor.justNow': '刚刚',
  'requirement.detail.conductor.minutesAgo': '{n} 分钟前',
  'requirement.detail.conductor.hoursAgo': '{n} 小时前',
  'requirement.detail.conductor.start': '启动 AI',
  'requirement.detail.conductor.startHint': 'Phase 2 待接入 DSH agent session',
  'requirement.detail.conductor.pause': '暂停',
  'requirement.detail.conductor.pauseHint': 'Phase 2 待接入',
  'requirement.detail.conductor.resume': '恢复',
  'requirement.detail.conductor.resumeHint': 'Phase 2 待接入',
  'requirement.detail.conductor.cancel': '取消',
  'requirement.detail.conductor.cancelHint': 'Phase 2 待接入',
  'requirement.detail.conductor.restart': '重启 AI',
  'requirement.detail.conductor.restartHint': 'Phase 2 待接入',
  'requirement.detail.conductor.phase1Hint': 'Phase 1 演示版：界面骨架已就绪，AI 实际运行留待 Phase 2 接入 DSH agent session。',
  'requirement.detail.conductor.status.idle': '未启动',
  'requirement.detail.conductor.status.idleHint': 'AI 尚未启动；点上方「启动 AI」开始协作',
  'requirement.detail.conductor.status.running': '运转中',
  'requirement.detail.conductor.status.runningHint': 'AI 正在处理任务，可在中间介入',
  'requirement.detail.conductor.status.paused': '已暂停',
  'requirement.detail.conductor.status.pausedHint': 'AI 已暂停；点「恢复」继续',
  'requirement.detail.conductor.status.awaiting': '等待介入',
  'requirement.detail.conductor.status.awaitingHint': 'AI 等待审批 / 回答；请到右侧「介入队列」处理',
  'requirement.detail.conductor.status.errored': '异常',
  'requirement.detail.conductor.status.erroredHint': 'AI session 异常；可尝试重启',

  /* 阶段动作 */
  'requirement.detail.action.title': '阶段推进',
  'requirement.detail.action.autoAdvance': '自动推进',
  'requirement.detail.action.autoAdvanceHint': 'Phase 2 待接入',
  'requirement.detail.action.goBack': '暂回上阶段',
  'requirement.detail.action.goBackHint': 'Phase 2 待接入',

  /* 阶段工作区 */
  'requirement.detail.workspace.placeholder': '阶段产物即将显示',
  'requirement.detail.workspace.placeholderDesc': 'Phase 1 演示版：阶段产物展示逻辑待 Phase 4 接入 artifact 系统。',
  'requirement.detail.workspace.artifactCount': '{n} 个产物',

  /* 阶段历史 */
  'requirement.detail.history.title': '阶段流转',
  'requirement.detail.history.outcome.completed': '已完成',
  'requirement.detail.history.outcome.manual': '手动',
  'requirement.detail.history.outcome.rolled-back': '已回退',
  'requirement.detail.history.outcome.errored': '异常',

  /* 介入队列 */
  'requirement.detail.queue.title': '介入队列',
  'requirement.detail.queue.empty': '暂无待处理的介入项',
  'requirement.detail.queue.section.approval': '审批',
  'requirement.detail.queue.section.question': '提问',
  'requirement.detail.queue.section.review': '审阅',
  'requirement.detail.queue.approve': '批准',
  'requirement.detail.queue.approveHint': 'Phase 3 待接入',
  'requirement.detail.queue.reject': '拒绝',
  'requirement.detail.queue.rejectHint': 'Phase 3 待接入',
  'requirement.detail.queue.phase1Hint': 'Phase 1 演示版：approval/question 应答逻辑待 Phase 3 接入 DSH event mux。',

  /* 详情页 Tab Header + 需求物料 tab（Phase 1.13 新增）*/
  'requirement.detail.tabHeader.ariaLabel': '需求详情标签',
  'requirement.detail.tabHeader.materials': '需求物料',
  'requirement.detail.tabHeader.materialsBadge': '待配置',
  'requirement.detail.tabHeader.workbench': 'AI 工作台',
  'requirement.detail.materials.title': '需求物料',
  'requirement.detail.materials.subtitle': '管理 PRD / 源码关联 / 设计稿 / 附件 / 外部链接等原始资料；AI 工作台的所有阶段都会基于这些上下文运行。',
  'requirement.detail.materials.unconfiguredBadge': '未配置',
  'requirement.detail.materials.guidance': '建议先配齐物料再启动 AI 协作——缺物料的 AI 工作台是没有上下文的。',
  'requirement.detail.materials.statsLabel': '物料总数',
  'requirement.detail.materials.section.prd.title': 'PRD 文档',
  'requirement.detail.materials.section.repos.title': '源码关联',
  'requirement.detail.materials.section.design.title': '设计稿',
  'requirement.detail.materials.section.attachments.title': '附件',
  'requirement.detail.materials.section.links.title': '外部链接',
  'requirement.detail.materials.placeholder': 'Phase 2.5 待实现：上传文件 / 添加链接 / 关联 repo / 编辑元数据。',
  'requirement.detail.materials.phaseHint': 'Phase 1.13 演示版：物料 tab 占位骨架已就绪，真实交互（上传 / 链接 / 源码关联）待 Phase 2.5 接入。',

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
  'requirement.list.open': 'Open detail page',

  'requirement.workspace.removed': '(workspace removed)',

  /* ── Phase 1.2: requirement detail page ── */
  'requirement.detail.title': 'Requirement detail',
  'requirement.detail.back': 'Back',
  'requirement.detail.notFound': 'This requirement has been deleted or does not exist.',
  'requirement.detail.errorPrefix': 'Failed to load detail: ',

  'requirement.detail.meta.workspace': 'Workspace',
  'requirement.detail.meta.workspaceRemoved': '(removed)',
  'requirement.detail.meta.branch': 'Branch',
  'requirement.detail.meta.id': 'ID',

  /* 5 stages */
  'requirement.detail.stage.understand.label': 'Understand',
  'requirement.detail.stage.understand.desc': 'Find ambiguities, search code, ask clarifying questions',
  'requirement.detail.stage.understand.hint': 'AI will collect code context and raise clarifying questions; answer them to move to planning.',
  'requirement.detail.stage.plan.label': 'Plan',
  'requirement.detail.stage.plan.desc': 'Multiple approaches, risks, test strategy',
  'requirement.detail.stage.plan.hint': 'AI will generate 2-3 candidate approaches with risks and test strategy; choose one to enter implementation.',
  'requirement.detail.stage.implement.label': 'Implement',
  'requirement.detail.stage.implement.desc': 'Generate code per plan and commit',
  'requirement.detail.stage.implement.hint': 'AI writes code per the chosen plan and stops at key checkpoints for you to review the diff.',
  'requirement.detail.stage.verify.label': 'Verify',
  'requirement.detail.stage.verify.desc': 'Run tests and code review',
  'requirement.detail.stage.verify.hint': 'AI runs lint / typecheck / tests and fills missing unit tests; on review pass, move to delivery.',
  'requirement.detail.stage.deliver.label': 'Deliver',
  'requirement.detail.stage.deliver.desc': 'MR, deployment, monitoring',
  'requirement.detail.stage.deliver.hint': 'AI tracks CI, answers review feedback, monitors merge; hotfix rollback is available any time.',

  /* AI conductor pane */
  'requirement.detail.conductor.title': 'AI Conductor',
  'requirement.detail.conductor.subtitle': 'AI keeps working; you decide at key points',
  'requirement.detail.conductor.lastActivity': 'Last activity',
  'requirement.detail.conductor.neverActive': 'Never started',
  'requirement.detail.conductor.justNow': 'just now',
  'requirement.detail.conductor.minutesAgo': '{n} min ago',
  'requirement.detail.conductor.hoursAgo': '{n} h ago',
  'requirement.detail.conductor.start': 'Start AI',
  'requirement.detail.conductor.startHint': 'Phase 2: DSH agent session pending',
  'requirement.detail.conductor.pause': 'Pause',
  'requirement.detail.conductor.pauseHint': 'Phase 2 pending',
  'requirement.detail.conductor.resume': 'Resume',
  'requirement.detail.conductor.resumeHint': 'Phase 2 pending',
  'requirement.detail.conductor.cancel': 'Cancel',
  'requirement.detail.conductor.cancelHint': 'Phase 2 pending',
  'requirement.detail.conductor.restart': 'Restart AI',
  'requirement.detail.conductor.restartHint': 'Phase 2 pending',
  'requirement.detail.conductor.phase1Hint': 'Phase 1 demo: UI skeleton is ready; AI runtime will land in Phase 2 via DSH agent session.',
  'requirement.detail.conductor.status.idle': 'Idle',
  'requirement.detail.conductor.status.idleHint': 'AI not started yet; click "Start AI" to begin collaboration',
  'requirement.detail.conductor.status.running': 'Running',
  'requirement.detail.conductor.status.runningHint': 'AI is processing; you can intervene in the middle',
  'requirement.detail.conductor.status.paused': 'Paused',
  'requirement.detail.conductor.status.pausedHint': 'AI is paused; click "Resume" to continue',
  'requirement.detail.conductor.status.awaiting': 'Awaiting input',
  'requirement.detail.conductor.status.awaitingHint': 'AI is waiting for approval / answer; please handle items in the right "Intervention queue"',
  'requirement.detail.conductor.status.errored': 'Errored',
  'requirement.detail.conductor.status.erroredHint': 'AI session errored; you can try restart',

  /* stage actions */
  'requirement.detail.action.title': 'Stage control',
  'requirement.detail.action.autoAdvance': 'Auto advance',
  'requirement.detail.action.autoAdvanceHint': 'Phase 2 pending',
  'requirement.detail.action.goBack': 'Roll back stage',
  'requirement.detail.action.goBackHint': 'Phase 2 pending',

  /* stage workspace */
  'requirement.detail.workspace.placeholder': 'Stage artifacts will appear here',
  'requirement.detail.workspace.placeholderDesc': 'Phase 1 demo: artifact rendering logic lands in Phase 4.',
  'requirement.detail.workspace.artifactCount': '{n} artifacts',

  /* stage history */
  'requirement.detail.history.title': 'Stage history',
  'requirement.detail.history.outcome.completed': 'completed',
  'requirement.detail.history.outcome.manual': 'manual',
  'requirement.detail.history.outcome.rolled-back': 'rolled back',
  'requirement.detail.history.outcome.errored': 'errored',

  /* intervention queue */
  'requirement.detail.queue.title': 'Intervention queue',
  'requirement.detail.queue.empty': 'No pending interventions',
  'requirement.detail.queue.section.approval': 'Approval',
  'requirement.detail.queue.section.question': 'Question',
  'requirement.detail.queue.section.review': 'Review',
  'requirement.detail.queue.approve': 'Approve',
  'requirement.detail.queue.approveHint': 'Phase 3 pending',
  'requirement.detail.queue.reject': 'Reject',
  'requirement.detail.queue.rejectHint': 'Phase 3 pending',
  'requirement.detail.queue.phase1Hint': 'Phase 1 demo: approval/question reply lands in Phase 3 via DSH event mux.',

  /* Detail page tab header + Materials tab (Phase 1.13) */
  'requirement.detail.tabHeader.ariaLabel': 'Requirement detail tabs',
  'requirement.detail.tabHeader.materials': 'Materials',
  'requirement.detail.tabHeader.materialsBadge': 'pending',
  'requirement.detail.tabHeader.workbench': 'AI workbench',
  'requirement.detail.materials.title': 'Materials',
  'requirement.detail.materials.subtitle': 'Manage PRD, source repo links, design specs, attachments and external links. The AI workbench runs on these contexts across all 5 stages.',
  'requirement.detail.materials.unconfiguredBadge': 'unconfigured',
  'requirement.detail.materials.guidance': 'Configure materials before kicking off AI collaboration — without context the workbench is blind.',
  'requirement.detail.materials.statsLabel': 'Total materials',
  'requirement.detail.materials.section.prd.title': 'PRD documents',
  'requirement.detail.materials.section.repos.title': 'Source repositories',
  'requirement.detail.materials.section.design.title': 'Design specs',
  'requirement.detail.materials.section.attachments.title': 'Attachments',
  'requirement.detail.materials.section.links.title': 'External links',
  'requirement.detail.materials.placeholder': 'Phase 2.5 pending: upload files / add links / link repos / edit metadata.',
  'requirement.detail.materials.phaseHint': 'Phase 1.13 demo: materials tab skeleton in place. Real interactions (upload / link / repo) ship in Phase 2.5.',

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
