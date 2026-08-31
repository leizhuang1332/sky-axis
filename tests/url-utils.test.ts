/**
 * src/host/url-utils.ts 单元测试。
 *
 * 覆盖目标:
 *   - extractRepoName: 从 URL 末段提取项目名,支持 https / ssh / git+ 等
 *   - canonicalizeRepoUrl: 跨协议归一化为 `<host>/<path>`,大小写无关 + 去尾 .git
 *
 * destDir 与 KV dedup 都依赖这两个函数 —— 覆盖边界确保线上行为符合预期。
 */
import { describe, expect, it } from 'vitest'
import { canonicalizeRepoUrl, extractRepoName } from '../src/host/url-utils.ts'

describe('extractRepoName', () => {
  it('HTTPS URL 末段去 .git', () => {
    expect(extractRepoName('https://github.com/leizhuang1332/mini_harness.git'))
      .toBe('mini_harness')
  })

  it('HTTPS URL 末段无 .git 后缀', () => {
    expect(extractRepoName('https://gitlab.com/x/y/miner'))
      .toBe('miner')
  })

  it('HTTPS URL 末段带尾斜杠', () => {
    expect(extractRepoName('https://github.com/foo/bar/'))
      .toBe('bar')
  })

  it('SSH 简写 `git@host:owner/repo.git`', () => {
    expect(extractRepoName('git@github.com:leizhuang1332/SPMA.git'))
      .toBe('SPMA')
  })

  it('SSH URL 形式 `ssh://git@host/owner/repo.git`', () => {
    expect(extractRepoName('ssh://git@github.com/owner/repo.git'))
      .toBe('repo')
  })

  it('git+ 前缀', () => {
    expect(extractRepoName('git+https://github.com/foo/bar.git'))
      .toBe('bar')
  })

  it('保留原始大小写(不强制 lowercase)', () => {
    // 大小写在 extractRepoName 不归一 —— destDir 是文件系统路径,保留原 case 更安全
    expect(extractRepoName('https://github.com/foo/MyRepo.git'))
      .toBe('MyRepo')
  })

  it('多层 owner 路径取最末段', () => {
    expect(extractRepoName('https://gitlab.com/group/subgroup/project.git'))
      .toBe('project')
  })

  it('空字符串返回空', () => {
    expect(extractRepoName('')).toBe('')
  })

  it('完全无 path 返回空', () => {
    expect(extractRepoName('https://github.com/')).toBe('')
  })

  it('file:// 协议视为无效', () => {
    // local path 不视为 git URL —— 防止后续 git clone 误用本地路径
    expect(extractRepoName('file:///tmp/foo/bar.git')).toBe('')
  })
})

describe('canonicalizeRepoUrl', () => {
  it('HTTPS URL 归一化为 host/path', () => {
    expect(canonicalizeRepoUrl('https://github.com/leizhuang1332/mini_harness.git'))
      .toBe('github.com/leizhuang1332/mini_harness')
  })

  it('host 与 path 都转小写', () => {
    expect(canonicalizeRepoUrl('HTTPS://GitHub.COM/Foo/Bar.git'))
      .toBe('github.com/foo/bar')
  })

  it('去尾斜杠', () => {
    expect(canonicalizeRepoUrl('https://github.com/foo/bar/'))
      .toBe('github.com/foo/bar')
  })

  it('去尾 .git（多次）', () => {
    expect(canonicalizeRepoUrl('https://github.com/foo/bar.git.git'))
      .toBe('github.com/foo/bar')
  })

  it('SSH 简写归一化为同一 key', () => {
    expect(canonicalizeRepoUrl('git@github.com:leizhuang1332/mini_harness.git'))
      .toBe('github.com/leizhuang1332/mini_harness')
  })

  it('SSH URL 形式归一化为同一 key', () => {
    expect(canonicalizeRepoUrl('ssh://git@github.com/owner/repo.git'))
      .toBe('github.com/owner/repo')
  })

  it('git+ 前缀归一化为同一 key', () => {
    expect(canonicalizeRepoUrl('git+https://github.com/foo/bar.git'))
      .toBe('github.com/foo/bar')
  })

  it('跨协议视为同一 repo(HTTPS vs SSH vs git+)', () => {
    const a = canonicalizeRepoUrl('https://github.com/foo/bar.git')
    const b = canonicalizeRepoUrl('git@github.com:foo/bar.git')
    const c = canonicalizeRepoUrl('git+https://github.com/foo/bar.git')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('不同 host 同 path 视为不同 repo', () => {
    const github = canonicalizeRepoUrl('https://github.com/foo/bar.git')
    const gitlab = canonicalizeRepoUrl('https://gitlab.com/foo/bar.git')
    expect(github).not.toBe(gitlab)
  })

  it('不同 owner 同 repo 名视为不同', () => {
    const a = canonicalizeRepoUrl('https://github.com/alice/foo.git')
    const b = canonicalizeRepoUrl('https://github.com/bob/foo.git')
    expect(a).not.toBe(b)
  })

  it('空字符串返回空', () => {
    expect(canonicalizeRepoUrl('')).toBe('')
  })

  it('file:// 视为无效', () => {
    expect(canonicalizeRepoUrl('file:///tmp/foo/bar.git')).toBe('')
  })

  it('完全无 path 返回空', () => {
    expect(canonicalizeRepoUrl('https://github.com/')).toBe('')
  })

  it('保留原 path 大小写归一化为小写', () => {
    expect(canonicalizeRepoUrl('https://github.com/foo/MyRepo.git'))
      .toBe('github.com/foo/myrepo')
  })
})
