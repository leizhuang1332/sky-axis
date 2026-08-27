# `src/client/` —— 浏览器半区代码

Hello 插件运行在 DSH web GUI 的浏览器进程里。所有 DOM 挂载、React 树、locale 文案、跨 panel 协调逻辑都在这一层。

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
│   └── hello-controller.ts      # pageOpen 状态 + subscribe / open / close / toggle
│
├── mount/                       # DOM 挂载胶水（与 controller + view 解耦）
│   ├── hello-page-mount.tsx     # 主列整页 mount（接管 conversation 列）
│   ├── sidebar-entry.ts         # sidebar entry thin wrapper（调 shared 工具）
│   └── sidebar-entry.module.css # sidebar entry 样式
│
└── page/                        # 整页表现层（纯 React + CSS）
    ├── HelloPage.tsx            # 整页根组件
    ├── HelloPage.module.css     # 整页骨架 + center-column takeover CSS
    └── sections/                # 页面内 4 个 section 卡片
        ├── ClockSection.tsx     # 当前时间
        ├── GreetingSection.tsx  # hero 大字
        ├── QuoteSection.tsx     # 今日一言
        ├── SessionSection.tsx   # 当前会话
        ├── types.ts             # Section 间共享的类型
        └── sections.module.css  # 4 个 section 卡片共用的样式
```

## 分层契约

| 层 | 入向依赖 | 出向依赖 | 责任 |
|----|---------|---------|------|
| `index.ts` | cordis / runtime | controller、mount、locales | 把所有部件装配起来 |
| `mount/` | controller、page、shared | runtime、locale、slots | DOM 直挂 + 跨 panel 协调 |
| `controller/` | （无） | （无） | 纯状态机，可单测 |
| `page/` | （无） | locale、widgets（sections） | 纯 React UI |
| `page/sections/` | types | locale | 4 个 section 卡片 |
| `shared/` | （无） | （无） | vendored 上游工具 |
| `locales.ts` | （无） | （无） | i18n 字典 |

依赖方向 **永远从 mount 流向 controller / page**，反向不允许。

## 为什么不用 `widgets/` 而用 `sections/`？

DSH 内置的 `widgets/` 是「可复用 UI 部件」语义（例如 sidebar 入口那种通用壳）。Hello 页面里的 4 个区块（greeting / clock / session / quote）不是通用 widget，而是**专属于 HelloPage 的内部 section**——它们：
- 依赖 [HelloPage.tsx](page/HelloPage.tsx) 的 `t` 函数（locale）
- 共享 `sections.module.css` 的卡片视觉
- 跟随 [HelloPage.module.css](page/HelloPage.module.css) 的页面布局

用 `sections/` 命名避免与 DSH 内部 widget 体系混淆。

## 添加新 section

1. 在 [sections/](page/sections/) 下新建 `XxxSection.tsx` + 在 [sections.module.css](page/sections/sections.module.css) 里加 `.xxxSection`
2. 在 [HelloPage.tsx](page/HelloPage.tsx) 里 import + 挂到 `<main>` grid
3. 在 [locales.ts](locales.ts) 加 `section.xxx.*` 文案

## 添加新 panel / 模块

1. 在 `controller/` 下建 `<name>-controller.ts`
2. 在 `mount/` 下建 `<name>-mount.tsx`（DOM 挂载逻辑）
3. 在 `page/` 下建表现层（参考 [HelloPage.tsx](page/HelloPage.tsx)）
4. 在 [index.ts](index.ts) 装配 + 在 [locales.ts](locales.ts) 加字典

## 协调协议

跨 panel（hello ↔ task-board ↔ ssh）共用：

- 事件：`dsh-panel-activate`，`detail` = 激活方名字
- `<html>` 属性：`data-dsh-{panel}-active`
- 互相 evict：打开自己时移除兄弟 panel 的 active 属性

详见 [hello-page-mount.tsx](mount/hello-page-mount.tsx) 的 `applyActive` / `onOtherActivate`。

## 调试入口

`src/client/index.ts` 的 `apply()` 是 cordis 启动入口——所有 console.error 都会在这里兜底，绝不 throw（沿用 task-board / ssh 失败策略）。