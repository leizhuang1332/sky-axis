# @deepseek-ai/dsh-client-ui-hello

English | [English](README.md)

一个纯浏览器的 DSH Web GUI 插件：在 sidebar 底部加一个按钮，点击后弹出居中
弹窗显示 **hello world**。挂载在官方 sidebar footer 席位
（`sidebar.footer.action`），**无需修改 DSH 任何源码**，host 端零行为。

## 功能

- 在 sidebar 底部设置按钮旁添加一个 36px 圆形图标触发器（👋）；56px 窄
  轨与宽列两种状态下都可见，按钮文字作为可访问名与 hover tooltip。
- 点击触发器弹出居中模态弹窗，显示 **hello world**；点击遮罩、关闭按钮
  或按 Esc 即可关闭。
- 支持中英双语：通过官方 `ctx.locale` 服务注册 `zh` / `en` 字典；切换语言
  时按钮 tooltip 与弹窗标题/关闭按钮同步更新。

## 安装

### 从本地仓库（开发态）

```sh
dsh plugin --profile web add link:/Users/Ray/TraeProjects/dsh-hello
```

重启 `dsh web`（或等待热重载），在 sidebar 底部即可看到 👋 按钮。

### 从 npm（发布后）

```sh
dsh plugin --profile web add @deepseek-ai/dsh-client-ui-hello@latest
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

- `lib/index.js` —— host 入口（空 apply）
- `lib/invariant.js` —— invariant 伴生入口（空 apply）
- `lib/client.js` —— 浏览器 bundle，包装在 `window.__ModuleLoader__.load`
  闭包里（loader 模块表要求的格式）
- `lib/types/` —— TypeScript 类型声明

## 架构

```
src/
├── index.ts                 # Host apply（空实现；纯浏览器插件）
├── invariant.ts             # Invariant 伴生入口（无断言）
└── client/
    ├── index.ts             # Client apply：注册字典 + sidebar.footer.action 占用者
    ├── HelloButton.tsx      # 触发按钮 + portal 弹窗（React 组件）
    ├── hello.module.css     # 样式（仅使用设计令牌）
    ├── css-modules.d.ts     # CSS Modules 类型声明
    └── locales.ts           # zh / en 字典（zh 为 key 集真源）

shared/
├── tsdown.client.ts         # 自包含 tsdown 预设（vendored from dsh-web-ui）
└── web-platform.ts          # PLATFORM_MODULES 冻结模块表

cordis.patch.yml             # bundle 层 —— 将 ui-hello 行插入 web profile
tsdown.config.ts             # clientBundle('@deepseek-ai/dsh-client-ui-hello', [...])
```

### 为什么无需修改源码

DSH 通过声明式 **slot 系统**暴露 sidebar 扩展点。`ui-sidebar` 把
`sidebar.footer.action` 声明为 `kind: 'list'` 槽位，多个插件可以叠加占用
而不需要修改 sidebar。本插件注册唯一一个 id 为 `hello`、组件为 `HelloButton`
的占用者。

## 安全模型

本插件只渲染一个静态按钮和一个静态弹窗。无网络请求、不读取 host 状态、
不写日志。完全运行在浏览器侧。

## 许可

MIT