# AGENTS.md — sky-axis

DSH web GUI 插件 sky-axis：开发工作台 sidebar + 二级目录 + 5 视图 + 需求 CRUD/SSE。
包级规则：只写本包特有约定，不重复根 AGENTS.md 的全局规则。

## 本包要点

- 纯浏览器插件：host 半区（src/index.ts）注册 Requirement CRUD + SSE 路由；
  invariant 半区（src/invariant.ts）无断言；browser 半区（src/client/）挂
  sidebar 主树 entry + 主列整页。
- 自包含 tsdown 配置：`shared/tsdown.client.ts` 是从 dsh-web-ui 拷贝的
  简化版工厂（338 行），不依赖 deepseek-harness 仓库。新增 UI 插件
  请保留此模式，不要 `import` 自 deepseek-harness。
- 设计令牌优先：所有样式只用 `var(--dsw-alias-*)`，不写死颜色或尺寸。
- UI 文案：zh 为 key 源、en 完整对照（src/client/locales.ts），经
  `ctx.locale.register` 注册。
- React 组件实现细节不导出：/client 表面只导出 `apply`、`inject` 与类型。
- 语义属性：根 trigger 上 `data-dsh-plugin="sky-axis"`、`data-sky-axis-entry`。

## 提交前检查

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
```
