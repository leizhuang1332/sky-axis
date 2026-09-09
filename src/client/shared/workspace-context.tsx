/**
 * sky-axis 浏览器半区 React Context —— 把 `WorkspaceOps` 透传给子树。
 *
 * 0.1.2 迁移说明(dsh-upgrade-audit §2.1 / §4.4):
 *   - 原 0.1.1 是 module-level `workspaceOps` 同步变量,在 `apply(ctx)` 期间
 *     赋值,组件 mount 时通过 `getWorkspaceOps()` 读快照
 *   - 0.1.2 改为 React Context:`apply(ctx)` 期间构造 `WorkspaceOps`(持有
 *     `ctx.uiWorkspace.pickDirectory` + `ctx.remote.workspace.create` 的
 *     桥接),通过 `mountSkyAxisPage` 传给 React 根,Provider 在 mount 时
 *     把 `value` 灌进 context,子树用 `useWorkspaceOps()` 消费
 *
 * 本文件只管 **React 层 Context + 类型契约**;`WorkspaceOps` 怎么构造是
 * `apply(ctx)` 的责任,Provider 不感知 —— 这样测试可以传任意 mock 的
 * `WorkspaceOps` 进 Provider,不必 mock `ctx`。
 *
 * 设计动机:
 *   - 模块加载顺序与 effect 启动时序与 workspaceOps 解耦 —— Provider
 *     一定先于子树 mount(`mountSkyAxisPage` 包了 Provider 再 render children)
 *   - modal 里不再需要 `workspaceOps === undefined` 兜底守卫 —— Provider
 *     没 mount 的话子树根本不会渲染
 */
import { createContext, useContext, type ReactNode } from 'react'

/**
 * DSH 平台 workspace 创建能力透传 —— NewRequirementModal 的
 * 「+ 创建工作区」入口历史消费方。
 *
 * 0.1.2 hotfix:`pickDirectory` / `createWorkspace` **整组停用**,
 * 由 `buildWorkspaceOps` 实现成 async stub,任何调用立即 reject 一个
 * actionable Error,告诉用户改用 DSH 原生 sidebar 的 + 按钮。**类型仍保留**
 * 是为了(1)mountSkyAxisPage 的 workspaceOps 参数契约稳定,(2)历史代码
 * 误调时拿到清晰报错而不是 cordis trap。**接口签名不删**,因为后续 DSH
 * 升级后(若 host 半区补齐 dsh-host-directory-picker / dsh-api-gateway)
 * 也许会再启用 —— 那时换掉 stub 实现即可。
 *
 * 旧契约存档(已停用):
 *   - `pickDirectory()` 弹原生目录选择框,用户取消 → resolve `null`,
 *     modal 静默 return;选中目录 → resolve 目录绝对路径字符串
 *   - `createWorkspace({ path })` 失败 → resolve `{ ok: false, error }`,
 *     modal 把 error 写到 form
 *
 * 历史平台契约 + 降级链(已停用,存档供未来查阅 —— 详见 src/client/index.ts):
 *   - 主路径:`pickDirectory` 走 `ctx.uiWorkspace.pickDirectory()`
 *     (UiWorkspace service)
 *   - 降级:DSH bridge 不可用时自动降级到 webkitdirectory input
 *   - `createWorkspace` 走 `ctx.remote.workspace.create({ path })`(Typert Remote)
 */
export interface WorkspaceOps {
  pickDirectory: () => Promise<string | null>
  createWorkspace: (input: { path: string }) => Promise<{
    ok: boolean
    id?: string
    title?: string
    error?: { code: 'workspace-create-failed'; detail?: string }
  }>
}

const WorkspaceOpsContext = createContext<WorkspaceOps | null>(null)

export interface WorkspaceOpsProviderProps {
  /** 由 `apply(ctx)` 期间构造好的 WorkspaceOps 桥接(见 src/client/index.ts)。 */
  value: WorkspaceOps
  children: ReactNode
}

/**
 * 包裹整棵 sky-axis React 树,在 `mountSkyAxisPage` 内 render 时放在
 * 最外层,modal 组件(任意深度)都能通过 `useWorkspaceOps()` 拿到。
 */
export function WorkspaceOpsProvider(
  { value, children }: WorkspaceOpsProviderProps,
): JSX.Element {
  return <WorkspaceOpsContext.Provider value={value}>{children}</WorkspaceOpsContext.Provider>
}

/**
 * 消费 `WorkspaceOps`。Provider 缺失(老版本兼容 / 测试场景)时 throw ——
 * 子组件必须包在 Provider 内,这是显式契约。
 */
export function useWorkspaceOps(): WorkspaceOps {
  const value = useContext(WorkspaceOpsContext)
  if (value === null) {
    throw new Error(
      '[sky-axis] useWorkspaceOps must be used inside <WorkspaceOpsProvider>',
    )
  }
  return value
}
