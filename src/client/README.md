# `src/client/` —— 浏览器半区代码

sky-axis 插件运行在 DSH web GUI 的浏览器进程里。所有 DOM 挂载、React 树、locale 文案、跨 panel 协调逻辑都在这一层。

## 目录结构

按**抽象层次**分组，从入口向叶子方向：

```
src/client/
├── index.ts                     # cordis apply 入口
├── locales.ts                   # zh / en 字典 + 内置名言库
├── css-modules.d.ts             # CSS Module 全局类型声明
│
├── shared/                      # 第三方 / 上游工具（vendored copy）
│   ├── README.md
│   └── sidebar-entry-core.ts    # 来自 dsh-web-ui/shared/ 的 sidebar 挂载工具
│
├── controller/                  # 纯状态机（无 DOM、无 React）
│   └── sky-axis-controller.ts   # pageOpen 状态 + subscribe / open / close / toggle
│
├── mount/                       # DOM 挂载胶水（与 controller + view 解耦）
│   ├── sky-axis-page-mount.tsx  # 主列整页 mount（接管 conversation 列）
│   ├── sidebar-entry.ts         # sidebar entry thin wrapper（调 shared 工具）
│   └── sidebar-entry.module.css # sidebar entry 样式
│
└── page/                        # 整页表现层（纯 React + CSS）
    ├── SkyAxisPage.tsx          # 整页根组件
    ├── SkyAxisPage.module.css   # 整页骨架 + center-column takeover CSS
    └── sidebar/
        └── SkyAxisSidebar.tsx   # 内部 sidebar（5 一级 + 个人二级 + QuickActions）
    └── views/                   # 6 个内部视图
        ├── HomeView.tsx
        ├── TeamView.tsx
        ├── PersonalView.tsx
        ├── RequirementsView.tsx
        ├── ReportsView.tsx
        └── SettingsView.tsx
    └── sections/                # 通用 / HomeView 用 section 卡片
        ├── MetricCards.tsx
        ├── ActivityStream.tsx
        ├── TeamOverview.tsx
        ├── QuickActions.tsx
        ├── RequirementsList.tsx
        └── NewRequirementModal.tsx
```

## 分层契约

| 层 | 入向依赖 | 出向依赖 | 责任 |
|----|---------|---------|------|
| `index.ts` | cordis / runtime | controller、mount、locales | 把所有部件装配起来 |
| `mount/` | controller、page、shared | runtime、locale、slots | DOM 直挂 + 跨 panel 协调 |
| `controller/` | （无） | （无） | 纯状态机，可单测 |
| `page/` | （无） | locale、widgets（sections） | 纯 React UI |
| `page/sections/` | types | locale | 通用 section 卡片 |
| `shared/` | （无） | （无） | vendored 上游工具 |
| `locales.ts` | （无） | （无） | i18n 字典 |

依赖方向 **永远从 mount 流向 controller / page**，反向不允许。

## 为什么不用 `widgets/` 而用 `sections/`？

DSH 内置的 `widgets/` 是「可复用 UI 部件」语义（例如 sidebar 入口那种通用壳）。sky-axis 页面里 HomeView 的 4 个区块（MetricCards / ActivityStream / TeamOverview / QuickActions）不是通用 widget，而是**专属于 SkyAxisPage 的内部 section**——它们：

- 依赖 [SkyAxisPage.tsx](page/SkyAxisPage.tsx) 的 `t` 函数（locale）
- 共享 `dashboard.module.css` 的卡片视觉
- 跟随 [SkyAxisPage.module.css](page/SkyAxisPage.module.css) 的页面布局

用 `sections/` 命名避免与 DSH 内部 widget 体系混淆。

## 添加新 section

1. 在 [sections/](page/sections/) 下新建 `XxxSection.tsx` + 在 [dashboard.module.css](page/sections/dashboard.module.css) 里加 `.xxxSection`
2. 在 [SkyAxisPage.tsx](page/SkyAxisPage.tsx) 里 import + 挂到对应 view 组件
3. 在 [locales.ts](locales.ts) 加 `dashboard.xxx.*` 文案

## 添加新视图

1. 在 `views/` 下建 `<Name>View.tsx`
2. 在 [SkyAxisPage.tsx](page/SkyAxisPage.tsx) 加 `viewKey === '<key>'` 分支
3. 在 [SkyAxisSidebar.tsx](page/sidebar/SkyAxisSidebar.tsx) `ENTRIES` 表里加 entry
4. 在 [sky-axis-controller.ts](controller/sky-axis-controller.ts) `SkyAxisViewKey` 联合加成员
5. 在 [locales.ts](locales.ts) 加 `view.<key>.title` 等文案

## 协调协议

跨 panel（sky-axis ↔ task-board ↔ ssh）共用：

- 事件：`dsh-panel-activate`，`detail` = 激活方名字
- `<html>` 属性：`data-dsh-{panel}-active`
- 互相 evict：打开自己时移除兄弟 panel 的 active 属性

详见 [sky-axis-page-mount.tsx](mount/sky-axis-page-mount.tsx) 的 `applyActive` / `onOtherActivate`。

## 调试入口

`src/client/index.ts` 的 `apply()` 是 cordis 启动入口——所有 console.error 都会在这里兜底，绝不 throw（沿用 task-board / ssh 失败策略）。