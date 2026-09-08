/**
 * src/host/git-service.ts 沙箱断言单元测试。
 *
 * 测试目标（Phase 2.6 决策 + Sprint 1 工作区结构改造）：
 *   - clone() / removeSafe() 在 destDir 不在 `${workspaceRoot}/repos/`
 *     下时,必须抛 SkyAxisHostError('git-sandbox-violation'),防止 caller 误传
 *     或恶意 url 携带 `..` 写穿 workspace。
 *   - Sprint 1：沙箱锚点从 `.sky-axis/repos/` 顶层化为 `repos/`；语义不变，
 *     测试相应更新路径形态。
 *   - sandbox 检查发生在 `probeGit()` 之前,所以即使机器没装 git 也能验证。
 *
 * 不测试真 git 调用 —— 真实 clone 需要联网 + git 二进制,改在 e2e / 手动
 * 验证阶段覆盖(见 plan Step 11)。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGitService, SKY_AXIS_REPOS_DIR, gitSpawnEnv, cloneFailed } from '../src/host/git-service.ts'
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

  it('clone() 拒绝 destDir 在 workspace 根目录(非 repos/)', async () => {
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
    // Sprint 1：`${fakeRoot}/repos/../escaped` resolve 后是 `${fakeRoot}/escaped`,
    // 不命中 `repos/` 前缀,断言必须拒绝。
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
    // Sprint 1：顶层化后攻击路径也从 `${fakeRoot}/.sky-axis/repos-evil/target`
    //          改为 `${fakeRoot}/repos-evil/target` —— 验证顶层沙箱前缀仍生效。
    const prefixAttack = `${fakeRoot}/${SKY_AXIS_REPOS_DIR}-evil/target`
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

/**
 * 完整性判断测试（Phase 2.6 v2.1）：
 *
 * destDir 已存在 + 含 .git/ 但不是完整 git repo 时,clone 必须抛
 * `git-clone-incomplete`,而不是：
 *   - 默默复用半成品目录(rev-parse HEAD 失败时会抛 git-clone-failed,但
 *     错误信息完全看不出"上次残留"的本质)
 *   - 强行 git clone 覆盖(会留下 `.git/` 冲突,git 自己会报错但不友好)
 *
 * Sprint 1 演进：destDir 形态从 `.sky-axis/repos/<name>` 改为顶层 `repos/<name>`，
 * 用 SKY_AXIS_REPOS_DIR 常量拼接。
 *
 * 用真 fs + 真 git binary —— rev-parse HEAD 是核心探测,只能跑真 git 验证。
 */
describe('GitService 完整性判断', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'sky-axis-gitcomplete-'))
    await mkdir(join(workspaceRoot, SKY_AXIS_REPOS_DIR), { recursive: true })
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined)
  })

  it('destDir 含 .git/ 但 HEAD 指向不存在的 ref → 抛 git-clone-incomplete', async () => {
    // 模拟场景 a：上次 clone 异常终止，git 内部建了 .git/ 但 refs/heads/X 不全
    const destDir = join(workspaceRoot, SKY_AXIS_REPOS_DIR, 'minerbot-incomplete')
    await mkdir(join(destDir, '.git'), { recursive: true })
    await writeFile(join(destDir, '.git/HEAD'), 'ref: refs/heads/nonexistent\n')

    const svc = createGitService()
    await expect(svc.clone({
      url: 'https://example.com/foo.git',
      branch: 'feat/test',
      destDir,
      workspaceRoot,
    })).rejects.toMatchObject({ code: 'git-clone-incomplete' })
  })

  it('destDir 含 .git/ 但 .git/ 是空目录（git init 中途崩溃） → 抛 git-clone-incomplete', async () => {
    // 模拟场景 b：git clone 启动后立刻被 SIGTERM，.git/ 已创建但空
    const destDir = join(workspaceRoot, SKY_AXIS_REPOS_DIR, 'empty-gitdir')
    await mkdir(join(destDir, '.git'), { recursive: true })

    const svc = createGitService()
    await expect(svc.clone({
      url: 'https://example.com/foo.git',
      branch: 'feat/test',
      destDir,
      workspaceRoot,
    })).rejects.toMatchObject({ code: 'git-clone-incomplete' })
  })

  it('destDir 含 .git/ 且 HEAD 文件是默认 main ref（用户手动 init 没 commit） → 抛 git-clone-incomplete', async () => {
    // 模拟场景 c：用户 `git init` 一个空目录没 commit，HEAD 文件指向 refs/heads/main
    // 但 refs/heads/main 不存在
    const destDir = join(workspaceRoot, SKY_AXIS_REPOS_DIR, 'empty-init')
    await mkdir(join(destDir, '.git'), { recursive: true })
    await writeFile(join(destDir, '.git/HEAD'), 'ref: refs/heads/main\n')

    const svc = createGitService()
    await expect(svc.clone({
      url: 'https://example.com/foo.git',
      branch: 'feat/test',
      destDir,
      workspaceRoot,
    })).rejects.toMatchObject({ code: 'git-clone-incomplete' })
  })
})

/* ── Plan J：gitSpawnEnv + cloneFailed 单元测试 ── */

describe('gitSpawnEnv (Plan J)', () => {
  it('强制 GIT_TERMINAL_PROMPT=0,关闭 stdin 凭证提示', () => {
    const env = gitSpawnEnv()
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
  })

  it('继承 SSH_AUTH_SOCK(SSH clone 必须有 agent socket)', () => {
    const orig = process.env.SSH_AUTH_SOCK
    process.env.SSH_AUTH_SOCK = '/tmp/ssh-agent-test-sock'
    try {
      expect(gitSpawnEnv().SSH_AUTH_SOCK).toBe('/tmp/ssh-agent-test-sock')
    } finally {
      if (orig === undefined) delete process.env.SSH_AUTH_SOCK
      else process.env.SSH_AUTH_SOCK = orig
    }
  })

  it('继承 HTTP_PROXY(企业内网 git clone 走代理)', () => {
    const orig = process.env.HTTP_PROXY
    process.env.HTTP_PROXY = 'http://proxy.example.com:8080'
    try {
      expect(gitSpawnEnv().HTTP_PROXY).toBe('http://proxy.example.com:8080')
    } finally {
      if (orig === undefined) delete process.env.HTTP_PROXY
      else process.env.HTTP_PROXY = orig
    }
  })

  it('继承 HOME(credential helper 在 ~/.gitconfig 找配置)', () => {
    const origHome = process.env.HOME
    const origUserProfile = process.env.USERPROFILE
    process.env.HOME = '/tmp/fake-home'
    try {
      const env = gitSpawnEnv()
      expect(env.HOME).toBe('/tmp/fake-home')
    } finally {
      if (origHome === undefined) delete process.env.HOME
      else process.env.HOME = origHome
      if (origUserProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = origUserProfile
    }
  })

  it('返回值是 process.env 的浅拷贝,改 gitSpawnEnv() 不影响 process.env', () => {
    const orig = process.env.GIT_TERMINAL_PROMPT
    const env = gitSpawnEnv()
    env.GIT_TERMINAL_PROMPT = '1'
    expect(process.env.GIT_TERMINAL_PROMPT).toBe(orig)
  })
})

describe('cloneFailed (Plan J: GitLab HTTP 拒绝识别)', () => {
  it('识别 GitLab "Unencrypted HTTP is not supported" 改写 detail', () => {
    const e = cloneFailed(
      'fatal: unable to access …: Unencrypted HTTP is not supported for GitLab',
      128,
    )
    expect(e.code).toBe('git-clone-failed')
    expect(e.message).toMatch(/use https:\/\/ or ssh:\/\//)
    expect(e.message).toContain('Unencrypted HTTP')
  })

  it('识别无 "for GitLab" 后缀的版本(部分 GitLab 老版本)', () => {
    const e = cloneFailed(
      'fatal: unable to access: Unencrypted HTTP is not supported',
      128,
    )
    expect(e.message).toMatch(/use https:\/\/ or ssh:\/\//)
  })

  it('大小写不敏感识别', () => {
    const e = cloneFailed(
      'fatal: UNENCRYPTED HTTP IS NOT SUPPORTED',
      128,
    )
    expect(e.message).toMatch(/use https:\/\/ or ssh:\/\//)
  })

  it('未知 stderr 保持原样,不误改写', () => {
    const e = cloneFailed('Could not resolve host github.com', 128)
    expect(e.code).toBe('git-clone-failed')
    expect(e.message).toContain('Could not resolve host')
    expect(e.message).not.toMatch(/use https:\/\/ or ssh:\/\//)
  })

  it('空 stderr + code 提供 fallback', () => {
    const e = cloneFailed('', 128)
    expect(e.code).toBe('git-clone-failed')
    expect(e.message).toContain('exited with code 128')
  })

  it('长 stderr 被截断到 500 字符', () => {
    const long = 'a'.repeat(2000)
    const e = cloneFailed(long, 128)
    // 截断在 'a'.repeat(500) = 500 字符,加上 cloneFailed 包装前缀(< 50 字符)
    expect(e.message.length).toBeLessThan(600)
  })

  it('认证失败保持原样,不被改写成 https/ssh 提示', () => {
    const e = cloneFailed(
      'Permission denied (publickey).\r\nfatal: Could not read from remote repository.',
      128,
    )
    expect(e.message).not.toMatch(/use https:\/\/ or ssh:\/\//)
    expect(e.message).toContain('Permission denied')
  })
})