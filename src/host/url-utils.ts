/**
 * sky-axis host 半区 —— git URL 归一化与提取。
 *
 * 两个核心 helper：
 *   - `extractRepoName(url)`：从 URL 末段拿 repo 名（destDir 用）
 *   - `canonicalizeRepoUrl(url)`：跨协议归一化为 host/path 形态（KV dedup 用）
 *
 * 边界覆盖：
 *   - HTTPS：`https://github.com/owner/repo.git`、`/repo`（无 `.git`）、`/repo/`（尾斜杠）
 *   - SSH 简写：`git@github.com:owner/repo.git`
 *   - SSH URL 形式：`ssh://git@github.com/owner/repo.git`
 *   - git+ 前缀：`git+https://github.com/owner/repo.git`
 *   - 大小写：host 与 path 都转小写
 *
 * 不解析的形态：
 *   - local path（file://...）：不视为 git URL，extractRepoName 返回 ''
 *   - 无 path（只有 host）：返回 ''（caller 应抛 validation-failed）
 *   - 完全无法解析的字符串：返回 ''
 */

/** 末段去掉 `.git` / 尾斜杠。 */
function trimTrailing(input: string): string {
  let s = input
  // 去尾 /
  while (s.endsWith('/')) s = s.slice(0, -1)
  // 去尾 .git（多次兜底,如 `.git/` 等）
  while (s.toLowerCase().endsWith('.git')) s = s.slice(0, -4)
  return s
}

/**
 * 把 git URL 拆成 (host, path) 二元组。
 * 失败时返回 null（caller 应抛 validation-failed）。
 *
 * 规则：
 *   - SSH 简写 `user@host:path` → host + path（去掉 user@）
 *   - SSH/HTTPS URL 形式 `scheme://[user@]host/path` → 解析 host + pathname
 *   - 去 `git+` 前缀
 *   - host 小写
 */
function splitHostPath(rawUrl: string): { host: string; path: string } | null {
  let s = rawUrl.trim()
  if (s === '') return null
  // 去 git+ 前缀（git+https://, git+ssh://）
  if (s.startsWith('git+')) s = s.slice(4)

  // SSH 简写：[user@]host:path（无 //）
  if (!s.includes('://')) {
    // 形如 `git@github.com:owner/repo.git`
    const atIdx = s.indexOf('@')
    const colonIdx = s.indexOf(':')
    if (atIdx !== -1 && colonIdx !== -1 && colonIdx > atIdx) {
      const host = s.slice(atIdx + 1, colonIdx).toLowerCase()
      const path = s.slice(colonIdx + 1)
      return { host, path }
    }
    // 形如 `github.com:owner/repo.git`（少见,但合法）
    if (colonIdx !== -1 && colonIdx > 0) {
      const host = s.slice(0, colonIdx).toLowerCase()
      const path = s.slice(colonIdx + 1)
      return { host, path }
    }
    // 没有任何 scheme / 分隔符 → 视为无效
    return null
  }

  // 标准 URL 形式
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  // 只允许 http / https / ssh / git 协议（其他如 file:// 视为无效）
  const proto = u.protocol
  if (proto !== 'http:' && proto !== 'https:' && proto !== 'ssh:' && proto !== 'git:') {
    return null
  }
  const host = u.hostname.toLowerCase()
  // pathname 不带前导 /
  const path = u.pathname.replace(/^\/+/, '')
  return { host, path }
}

/**
 * 从 git URL 提取仓库名（destDir 用）。
 *
 * 例：
 *   `https://github.com/leizhuang1332/mini_harness.git` → `mini_harness`
 *   `git@github.com:leizhuang1332/SPMA.git` → `SPMA`
 *   `https://gitlab.com/x/y/miner` → `miner`
 *
 * 失败（无 path / 非 http(s)/ssh(s) 协议）返回 '' —— caller 应抛 validation-failed。
 */
export function extractRepoName(rawUrl: string): string {
  const split = splitHostPath(rawUrl)
  if (split === null) return ''
  const trimmed = trimTrailing(split.path)
  if (trimmed === '') return ''
  // 末段
  const lastSlash = trimmed.lastIndexOf('/')
  const name = lastSlash === -1 ? trimmed : trimmed.slice(lastSlash + 1)
  if (name === '' || name === '.' || name === '..') return ''
  return name
}

/**
 * 把 git URL 归一化为 `<host>/<path>` 形态 —— 用于 KV 去重。
 *
 * 例（全部归一为同一个 key）：
 *   `https://github.com/leizhuang1332/mini_harness.git`
 *   `HTTPS://GitHub.COM/leizhuang1332/mini_harness.git/`
 *   `git@github.com:leizhuang1332/mini_harness.git`
 *   `git+https://github.com/leizhuang1332/mini_harness.git`
 *   → `github.com/leizhuang1332/mini_harness`
 *
 * 失败时返回 ''（caller 应视为无法 dedup,谨慎处理）。
 */
export function canonicalizeRepoUrl(rawUrl: string): string {
  const split = splitHostPath(rawUrl)
  if (split === null) return ''
  const path = trimTrailing(split.path).toLowerCase()
  if (path === '') return ''
  return `${split.host}/${path}`
}
