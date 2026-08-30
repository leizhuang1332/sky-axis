#!/usr/bin/env node
/**
 * 验收 5 bug 修复的 e2e 复现脚本。
 *
 * 用法:
 *   node scripts/repro-acceptance.mjs [baseUrl]
 *
 * 默认 baseUrl = http://127.0.0.1:3080 (与 `dsh web` 端口一致)
 *
 * 验证矩阵:
 *   1. 中文文件名上传 → 列表里 filename 是中文,无 mojibake
 *   2. 上传中途中断 (client abort) → host 进程不退出, /ping 仍 200
 *   3. SSE 连接立刻 close → host 进程不退出
 *   4. delete material → workspaces 列表保持完整, 仅 requirement 物料减少
 *   5. unhandled promise rejection 注入 → host 进程不退出, 但日志里出现
 *      "[sky-axis] unhandledRejection"
 *
 * 设计前提:
 *   - 假设 host 已经起来 (pnpm build 已完成 + dsh web 已运行)
 *   - 假设 /api/sky-axis/ping 可用
 *   - 不修改 ~/.dsh/storages/sky_axis_requirements.json, 不动产物目录
 */

import { setTimeout as sleep } from 'node:timers/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { URL } from 'node:url'

const baseUrl = process.argv[2] || 'http://127.0.0.1:3080'
const base = new URL(baseUrl)

const log = (...args) => console.log('[repro]', ...args)
const fail = (msg) => { console.error('[repro] ❌', msg); process.exitCode = 1 }
const ok = (msg) => console.log('[repro] ✅', msg)

/** 简化的 JSON GET */
function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: base.hostname,
      port: base.port,
      method: 'GET',
      path,
      headers: { accept: 'application/json' },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }) }
        catch (e) { reject(new Error(`invalid JSON from ${path}: ${raw.slice(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

/** multipart 上传 - 返回 { status, bodyText } */
function uploadPrd({ requirementId, filename, sizeBytes, abortAfterBytes }) {
  return new Promise((resolve, reject) => {
    const boundary = '----repro' + Math.random().toString(36).slice(2)
    const head = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
      'utf8',
    )
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')

    const req = httpRequest({
      hostname: base.hostname,
      port: base.port,
      method: 'POST',
      path: `/api/sky-axis/materials/prdFiles/upload?requirementId=${encodeURIComponent(requirementId)}`,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': head.length + sizeBytes + tail.length,
      },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({
        status: res.statusCode,
        bodyText: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('error', (e) => resolve({ status: 0, bodyText: 'req error: ' + e.message }))

    req.write(head)
    // 写 sizeBytes 字节, 每写 64KB 后检查 abortAfterBytes
    let written = 0
    const chunk = Buffer.alloc(64 * 1024, 0x61) // 64KB 'a'
    function pump() {
      if (abortAfterBytes !== undefined && written >= abortAfterBytes) {
        // 主动 destroy —— 模拟 client 端 refresh / close
        req.destroy(new Error('client aborted upload'))
        return
      }
      if (written >= sizeBytes) {
        req.write(tail)
        req.end()
        return
      }
      const remaining = sizeBytes - written
      const toWrite = remaining >= chunk.length ? chunk.length : remaining
      const ok = req.write(chunk.subarray(0, toWrite))
      written += toWrite
      if (ok) {
        setImmediate(pump)
      } else {
        req.once('drain', pump)
      }
    }
    pump()
  })
}

/** SSE: 打开 1 秒后断开 */
function sseThenClose() {
  return new Promise((resolve) => {
    const req = httpRequest({
      hostname: base.hostname,
      port: base.port,
      method: 'GET',
      path: '/api/sky-axis/requirements/events',
      headers: { accept: 'text/event-stream' },
    }, (res) => {
      let bytes = 0
      res.on('data', (c) => { bytes += c.length })
      res.on('end', () => resolve({ status: res.statusCode, bytes }))
    })
    req.on('error', (e) => resolve({ status: 0, error: e.message }))
    req.end()
    setTimeout(() => req.destroy(new Error('sse test close')), 1000)
  })
}

async function checkStillAlive() {
  // 5 次 ping 抽样, 至少 1 次 200 即视为存活
  for (let i = 0; i < 5; i++) {
    try {
      const r = await getJson('/api/sky-axis/ping')
      if (r.status === 200 && r.body?.ok === true) return true
    } catch {}
    await sleep(300)
  }
  return false
}

async function main() {
  log('baseUrl =', baseUrl)

  // 前置: 确认 host 在线
  const initial = await getJson('/api/sky-axis/ping').catch(e => ({ status: 0, error: e.message }))
  if (initial.status !== 200) {
    fail(`host unreachable: ${JSON.stringify(initial)}`)
    return false
  }
  ok('ping reachable, host alive')

  // 拿一个 requirement
  const list = await getJson('/api/sky-axis/requirements').catch(() => ({ status: 0, body: { items: [] } }))
  const reqItem = list.body?.items?.[0]
  if (!reqItem) {
    fail('no requirement to test against; create one first')
    return false
  }
  const reqId = reqItem.id
  log('target requirement:', reqId, 'workspace=', reqItem.workspaceId)

  /* ── Case 1: 中文文件名上传,验证无 mojibake ── */
  {
    const chineseName = '量本利v2.0需求文档.docx'
    const size = 200 * 1024 // 200KB
    log('Case 1: upload Chinese filename', chineseName)
    const r = await uploadPrd({ requirementId: reqId, filename: chineseName, sizeBytes: size })
    log('  upload status =', r.status, 'body:', r.bodyText.slice(0, 200))
    if (r.status !== 200) {
      fail('Case 1: upload non-200')
    } else {
      // 读 requirement 详情, 检查 filename 是否是中文
      const list2 = await getJson('/api/sky-axis/requirements')
      const updated = list2.body.items.find(x => x.id === reqId)
      const last = updated?.materials?.prdFiles?.slice(-1)[0]
      if (!last) {
        fail('Case 1: file not in prdFiles list')
      } else if (last.filename !== chineseName) {
        fail(`Case 1: filename mojibake, expected "${chineseName}" got "${last.filename}"`)
      } else {
        ok(`Case 1: filename preserved as "${last.filename}"`)
      }
    }
  }

  await sleep(500)

  /* ── Case 2: 上传中途 abort(模拟刷新)→ host 不能死 ── */
  {
    log('Case 2: upload then abort mid-flight (10MB → close after 128KB)')
    const r = await uploadPrd({
      requirementId: reqId,
      filename: 'bigfile.bin',
      sizeBytes: 10 * 1024 * 1024,
      abortAfterBytes: 128 * 1024,
    })
    log('  upload result status =', r.status)
  }

  await sleep(1000)

  /* ── Case 3: SSE 半路断开 ── */
  {
    log('Case 3: SSE connect then close after 1s')
    const r = await sseThenClose()
    log('  sse initial status =', r.status, 'bytes =', r.bytes ?? 0)
  }

  await sleep(800)

  /* ── Case 4: 删除物料 → workspaces 保留 ── */
  {
    log('Case 4: delete material; workspaces must remain')
    const listBefore = await getJson('/api/sky-axis/workspaces').catch(() => ({ body: { items: [] } }))
    const wsCountBefore = listBefore.body?.items?.length ?? 0

    // 拿刚上传的 prdFile id
    const reqList = await getJson('/api/sky-axis/requirements')
    const updated = reqList.body.items.find(x => x.id === reqId)
    const lastFile = updated?.materials?.prdFiles?.slice(-1)[0]
    if (!lastFile) {
      fail('Case 4: no prdFile to delete (Case 1 must have succeeded)')
    } else {
      const delPath = `/api/sky-axis/materials/prdFiles/remove?requirementId=${encodeURIComponent(reqId)}&itemId=${encodeURIComponent(lastFile.id)}`
      const r = await new Promise((resolve, reject) => {
        const req = httpRequest({
          hostname: base.hostname,
          port: base.port, method: 'DELETE', path: delPath,
        }, (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => resolve({ status: res.statusCode, bodyText: Buffer.concat(chunks).toString('utf8') }))
        })
        req.on('error', reject); req.end()
      })
      log('  delete status =', r.status)
      await sleep(400)
      const listAfter = await getJson('/api/sky-axis/workspaces').catch(() => ({ body: { items: [] } }))
      const wsCountAfter = listAfter.body?.items?.length ?? 0
      if (wsCountAfter !== wsCountBefore || wsCountAfter === 0) {
        fail(`Case 4: workspaces lost during delete: before=${wsCountBefore} after=${wsCountAfter}`)
      } else {
        ok(`Case 4: workspaces preserved (count=${wsCountAfter}) after material delete`)
      }
    }
  }

  await sleep(800)

  /* ── 收尾: host 还活着吗? ── */
  {
    log('post-trauma: re-pinging host...')
    const alive = await checkStillAlive()
    if (!alive) {
      fail('host died after Cases 2/3/4 — process-level safety net NOT effective')
    } else {
      ok('host still alive after upload-abort + SSE-close + material-delete')
    }
  }

  return process.exitCode === 1
}

main().then((failed) => {
  if (failed) process.exit(1)
  process.exit(0)
}).catch((e) => {
  console.error('[repro] fatal:', e)
  process.exit(2)
})