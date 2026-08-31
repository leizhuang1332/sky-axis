/**
 * src/host/git-service.ts 沙箱断言单元测试。
 *
 * 测试目标（Phase 2.6 决策）：
 *   - clone() / removeSafe() 在 destDir 不在 `${workspaceRoot}/.sky-axis/repos/`
 *     下时,必须抛 SkyAxisHostError('git-sandbox-violation'),防止 caller 误传
 *     或恶意 url 携带 `..` 写穿 workspace。
 *   - sandbox 检查发生在 `probeGit()` 之前,所以即使机器没装 git 也能验证。
 *
 * 不测试真 git 调用 —— 真实 clone 需要联网 + git 二进制,改在 e2e / 手动
 * 验证阶段覆盖(见 plan Step 11)。
 */
import { describe, expect, it } from 'vitest'
import { createGitService, SKY_AXIS_REPOS_DIR } from '../src/host/git-service.ts'
import { SkyAxisHostError } from '../src/host/requirement-service.ts'

/** 一个临时风格的 workspaceRoot(用 mkdtemp 同步创建过的真实目录更好,但
 *  这里只需要绝对路径,路径存在与否不影响沙箱断言结果)。*/
const fakeRoot = '/tmp/sky-axis-sandbox-test'

describe('GitService 沙箱断言', () => {
  it('clone() 拒绝 destDir 在 workspace 外', async () => {
    const svc = createGitService()
    const outside = '/tmp/evil-target'
    await expect(svc.clone({
      url: 'https://example.com/foo.git',
      branch: 'feat/test',
      destDir: outside,
      workspaceRoot: fakeRoot,
    })).rejects.toMatchObject({
      code: 'git-sandbox-violation',
    })
  })

  it('clone() 拒绝 destDir 在 workspace 根目录(非 .sky-axis/repos/)', async () => {
    const svc = createGitService()
    const wrongSubdir = `${fakeRoot}/some-other-dir`
    await expect(svc.clone({
      url: 'https://example.com/foo.git',
      branch: 'feat/test',
      destDir: wrongSubdir,
      workspaceRoot: fakeRoot,
    })).rejects.toMatchObject({
      code: 'git-sandbox-violation',
    })
  })

  it('clone() 拒绝 destDir 用 `..` 绕过沙箱', async () => {
    const svc = createGitService()
    // `${fakeRoot}/.sky-axis/repos/../escaped` 解析后是 `${fakeRoot}/.sky-axis/escaped`
    // —— 这不会命中 .sky-axis/repos/ 前缀,断言必须拒绝。
    const escapeAttempt = `${fakeRoot}/${SKY_AXIS_REPOS_DIR}/../escaped`
    await expect(svc.clone({
      url: 'https://example.com/foo.git',
      branch: 'feat/test',
      destDir: escapeAttempt,
      workspaceRoot: fakeRoot,
    })).rejects.toBeInstanceOf(SkyAxisHostError)
    // resolve() 后的真实路径可能已逃出 sandbox,断言 message 包含 sandbox-violation
    try {
      await svc.clone({
        url: 'https://example.com/foo.git',
        branch: 'feat/test',
        destDir: escapeAttempt,
        workspaceRoot: fakeRoot,
      })
    } catch (e) {
      expect((e as SkyAxisHostError).code).toBe('git-sandbox-violation')
    }
  })

  it('clone() 拒绝 prefix 攻击:`repos-other/` 不能匹配 `repos/`', async () => {
    const svc = createGitService()
    // 验证 SKY_AXIS_REPOS_DIR + sep 锚点生效 —— 仅 `repos/` 结尾可接受
    const prefixAttack = `${fakeRoot}/.sky-axis/repos-evil/target`
    await expect(svc.clone({
      url: 'https://example.com/foo.git',
      branch: 'feat/test',
      destDir: prefixAttack,
      workspaceRoot: fakeRoot,
    })).rejects.toMatchObject({
      code: 'git-sandbox-violation',
    })
  })

  it('removeSafe() 同样受沙箱保护', async () => {
    const svc = createGitService()
    // 即使要"删除",destDir 必须在 sandbox 内
    await expect(svc.removeSafe('/tmp/never-delete-me', fakeRoot))
      .rejects.toMatchObject({ code: 'git-sandbox-violation' })
  })
})
