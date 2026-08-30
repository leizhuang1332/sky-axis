# @leizhuang/sky-axis

English | [English](README.md)

一个纯浏览器的 DSH Web GUI 插件：在主列渲染「开发工作台」sky-axis SPA，
包括一个可折叠 icon rail 的 sidebar、个人二级目录（个人 → 需求列表）、
5 个顶层视图（首页 / 团队 / 个人 / 需求列表 / 报表 / 设置），以及基于
host 半区的需求 CRUD + SSE 同步。挂在 sidebar 主树 entry 席位（与 Chat
/ Skills 等同级），**无需修改 DSH 任何源码**。

## 功能

- 在 sidebar 主树添加 `SkyAxis` entry（36px 圆形图标）；点击 entry 切换
  主列 sky-axis 页面的打开 / 关闭。
- 页面内：
  - sidebar（208px / 48px 折叠态）含 5 entry + 「个人」group entry（点击
    展开 / 收起子菜单）+ 底部 QuickActions（新建需求 / 创建分支 / 发起合并请求）
  - viewArea 按 controller.viewKey 渲染：
    - HomeView（MetricCards + ActivityStream + TeamOverview）
    - TeamView（进度 / MR / 成员，mock）
    - PersonalView（个人资料 + 统计，mock）
    - RequirementsView（按 workspace 分组的需求列表，host CRUD + SSE 同步）
    - ReportsView（SVG 图表，mock）
    - SettingsView（主题 / 语言切换，mock）
- 支持中英双语：通过官方 `ctx.locale` 服务注册 `zh` / `en` 字典。
- host 半区：注册 `/api/sky-axis/...` webServer 路由（`ping` / `health` /
  `requirements` CRUD / SSE / `workspaces`）。

## 安装

### 从本地仓库（开发态）

```sh
dsh plugin --profile web add link:/Users/Ray/TraeProjects/sky-axis
```

重启 `dsh web`（或等待热重载），在 sidebar 主树即可看到 `SkyAxis`
entry。

### 从 npm（发布后）

```sh
dsh plugin --profile web add @leizhuang/sky-axis@latest
```

## 构建

```sh
pnpm install
pnpm run build         # tsc -p tsconfig.build.json && tsdown
pnpm run watch         # tsdown --watch
pnpm run typecheck     # tsc --noEmit
pnpm run test          # vitest run
```

构建产物落到 `lib/`：

- `lib/index.js` —— host 入口（注册 webServer 路由）
- `lib/invariant.js` —— invariant 伴生入口（空 apply）
- `lib/client.js` —— 浏览器 bundle，包装在 `window.__ModuleLoader__.load`
  闭包里（loader 模块表要求的格式）
- `lib/types/` —— TypeScript 类型声明

## 架构

```
src/
├── index.ts                         # Host apply：注册 webServer 路由
├── invariant.ts                     # Invariant 伴生入口（无断言）
├── protocol.ts                      # 跨面共享契约（端点 + zod schema）
└── client/
    ├── index.ts                     # Client apply：字典 + sidebar entry + page mount
    ├── locales.ts                   # zh / en 字典（zh 为 key 集真源）
    ├── controller/
    │   └── sky-axis-controller.ts   # 状态机（pageOpen / viewKey / sidebarCollapsed / personalExpanded / requirements）
    ├── mount/
    │   ├── sky-axis-page-mount.tsx  # 主列 React 根挂载
    │   └── sidebar-entry.ts         # sidebar 主树 entry 装配
    ├── api/
    │   └── requirement-client.ts    # fetch /api/sky-axis/... + EventSource
    ├── icons/
    │   └── icons.tsx                # 共享 SVG 图标库
    ├── shared/
    │   └── sidebar-entry-core.ts    # vendored DOM 注入核心
    └── page/
        ├── SkyAxisPage.tsx          # SPA 主体（sidebar + viewArea + modal）
        ├── SkyAxisPage.module.css   # 页面 takeover CSS（data-sky-axis-active）
        ├── sidebar/
        │   ├── SkyAxisSidebar.tsx   # 内部 sidebar（5 entry + 个人 group + QuickActions）
        │   └── sidebar.module.css
        ├── sections/                # MetricCards / ActivityStream / TeamOverview /
        │                            # RequirementsList / NewRequirementModal / QuickActions
        └── views/                   # HomeView / TeamView / PersonalView /
                                     # RequirementsView / ReportsView / SettingsView

shared/
├── tsdown.client.ts                 # 自包含 tsdown 预设（vendored from dsh-web-ui）
└── web-platform.ts                  # PLATFORM_MODULES 冻结模块表

cordis.patch.yml                     # bundle 层 —— 将 ui-sky-axis 行插入 web profile
tsdown.config.ts                     # clientBundle('@leizhuang/sky-axis', [...])
```

### 为什么无需修改源码

DSH 通过声明式 **slot 系统**暴露 sidebar 扩展点。sky-axis 以 id `sky-axis`
注册自己，由共享 `sidebar-entry-core` 把 entry 注入 sidebar 主树，再以
与 task-board / ssh 相同的 `dsh-panel-activate` 协议把页面挂入主列。

## 安全模型

本插件 host 侧只通过官方 DSH `apiProxy` + `webServer` + `storageDomain`
服务操作；只注册 `/api/sky-axis/...` 命名空间路由，且只读写自己的 storage
domain `sky_axis_requirements`。所有 UI 在浏览器侧渲染。

## 许可

MIT
