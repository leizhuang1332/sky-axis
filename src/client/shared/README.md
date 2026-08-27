# `shared/` —— Vendored 上游工具

本目录里的文件**不是项目自有代码**，是从上游 `dsh-web-ui` 仓库的 `shared/` 目录同步过来的副本。它们与上游保持**逐字符一致**（仅顶部多了 `Vendored from` 注释）。

## 目录约定

```
shared/
├── README.md                    # 本文件
└── sidebar-entry-core.ts        # 来自 dsh-web-ui/shared/client/sidebar-entry-core.ts
```

## 为什么 vendored 而不是 npm 依赖？

`dsh-web-ui/shared/` 是 DSH 团队**未发布到 npm** 的内部共享工具。第三方插件要用：

1. ❌ 不能直接 `import '@deepseek-ai/dsh-web-ui/shared/...'` —— 没有公开包
2. ❌ 不能 fork + 改 —— 改了之后会跟其他插件（task-board / ssh）行为漂移
3. ✅ 只能 vendored copy —— 与上游同步，行为契约一致

这是 DSH 生态所有第三方插件（task-board、ssh、skill-explorer）的统一做法。

## 同步策略

`sidebar-entry-core.ts` 顶部注释标了源路径（`Vendored from /.../shared/client/sidebar-entry-core.ts`）。当 DSH 团队升级上游版本时：

1. 从上游把新版本复制过来，覆盖本目录
2. 比对 diff，确认是上游 dsh-web-ui 团队的预期改动（而非 sync 失误）
3. 跑 `pnpm run build` 验证 bundle 通过
4. 在 commit message 里标注 upstream 版本 / commit

## ⚠️ 不要在本目录单独修改

**禁止**在这个目录里改 vendored 文件：

- 上游没有同步机制，本地改了会**永久漂移**
- 跟其他插件（task-board、ssh）的 sidebar entry 行为不再一致
- 下次 sync 时本地修改会被覆盖

如果发现上游有 bug，正确的流程是：到 dsh-web-ui 仓库提 issue / PR，**等上游修**，再 sync 过来。

## 与项目自有代码的边界

`shared/` 里的代码不依赖项目内部任何文件（controller、mount、page、locales）。它通过参数注入（`SidebarEntryOptions`）由调用方传入所有行为。

调用方（本项目里的 [mount/sidebar-entry.ts](../mount/sidebar-entry.ts)）负责把 vendored 工具与项目自有 controller / 视觉契约对接。