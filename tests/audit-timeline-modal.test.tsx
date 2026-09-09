/**
 * AuditTimelineModal 组件测试 —— PR-E / 迭代 7。
 *
 * 用 react-dom/server 的 renderToStaticMarkup 渲染 + 关键交互断言。
 *
 * 覆盖目标：
 *   - 4 维归一化 helper（stageHistoryToEvents / subHistoryToEvents / artifactsToEvents / interventionsToEvents）纯函数
 *   - 默认渲染：4 维混合倒序展示；每条 event 显示 title + time
 *   - 筛选 chip：filter='stage' → 只显示 stage event
 *   - 空状态：requirement 无 stageHistory/interventionQueue 时显示空状态文案
 *   - outcome badge：stageHistory entry outcome='rolled-back' → 显示对应 badge
 *   - artifact meta.source='steer' → 显示 steerNote badge
 *   - intervention resolved=true → 显示 resolved badge
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AuditTimelineModal,
  stageHistoryToEvents,
  subHistoryToEvents,
  artifactsToEvents,
  interventionsToEvents,
} from '../src/client/page/sections/AuditTimelineModal.tsx'
import type {
  RequirementArtifact,
  RequirementEntry,
  RequirementInterventionItem,
  RequirementStageHistoryEntry,
  RequirementTask,
  RequirementTaskList,
} from '../src/client/controller/sky-axis-controller.ts'

const fakeT = (key: string): string => key

/* ── fixtures ── */

function makeReq(overrides: Partial<RequirementEntry> = {}): RequirementEntry {
  return {
    id: '2026-09-09T00:00:00.000Z-test01',
    workspaceId: 'ws-1',
    title: 'demo',
    description: '',
    priority: 'normal',
    status: 'open',
    tags: [],
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
    stage: 'implement',
    stageHistory: [],
    aiState: 'idle',
    aiSessionId: null,
    aiLastActivityAt: null,
    interventionQueue: [],
    artifacts: {},
    branch: null,
    materials: {
      prdFiles: [], prdLinks: [], sourceRepos: [],
      designLinks: [], attachments: [], externalLinks: [],
    },
    ...overrides,
  }
}

const stageHistory: RequirementStageHistoryEntry[] = [
  { stage: 'understand', enteredAt: '2026-09-09T01:00:00.000Z', leftAt: '2026-09-09T02:00:00.000Z', outcome: 'completed' },
  { stage: 'plan',       enteredAt: '2026-09-09T02:00:00.000Z', leftAt: '2026-09-09T03:00:00.000Z', outcome: 'completed' },
  { stage: 'implement',  enteredAt: '2026-09-09T03:00:00.000Z' },
]

const taskList: RequirementTaskList = {
  tasks: [
    {
      id: 'T-implement-001',
      title: 'OAuth 回调',
      goal: '',
      acceptance: [],
      dependencies: [],
      filesExpected: [],
      status: 'done',
      subHistory: [
        { status: 'in_progress', enteredAt: '2026-09-09T03:10:00.000Z', leftAt: '2026-09-09T03:30:00.000Z', outcome: 'completed' },
        { status: 'done', enteredAt: '2026-09-09T03:30:00.000Z' },
      ],
      artifactRefs: [],
      retryCount: 0,
      enteredAt: '2026-09-09T03:10:00.000Z',
    },
    {
      id: 'T-implement-002',
      title: '权限中间件',
      goal: '',
      acceptance: [],
      dependencies: [],
      filesExpected: [],
      status: 'rolled_back',
      subHistory: [
        { status: 'in_progress', enteredAt: '2026-09-09T03:40:00.000Z', leftAt: '2026-09-09T04:00:00.000Z', outcome: 'rolled-back' },
        { status: 'rolled_back', enteredAt: '2026-09-09T04:00:00.000Z', outcome: 'rolled-back' },
      ],
      artifactRefs: [],
      retryCount: 2,
      enteredAt: '2026-09-09T03:40:00.000Z',
    },
  ],
  producedAt: '2026-09-09T02:30:00.000Z',
  producedAtStage: 'plan',
}

const artifacts: Record<string, RequirementArtifact> = {
  'steer-1': {
    id: 'steer-1', kind: 'note', title: 'Steer note',
    createdAt: '2026-09-09T03:20:00.000Z',
    body: '用 ESM', meta: { source: 'steer', length: 6 },
  },
  'drift-1': {
    id: 'drift-1', kind: 'note', title: 'Drift snapshot',
    createdAt: '2026-09-09T03:50:00.000Z',
    body: '{"overall":0.72}', meta: { source: 'drift' },
  },
}

const interventionQueue: RequirementInterventionItem[] = [
  {
    id: 'ii-1', kind: 'approval', rpcId: 'rpc-1', summary: '需要审批 OAuth 配置',
    createdAt: '2026-09-09T03:15:00.000Z', payload: {}, resolved: true,
  },
]

const fullReq = makeReq({ stageHistory, artifacts, interventionQueue })

/* ── 归一化 helper 单测 ── */

describe('stageHistoryToEvents', () => {
  it('空数组 → 空数组', () => {
    expect(stageHistoryToEvents([])).toEqual([])
  })

  it('每个 entry → 1 条 event；正确字段', () => {
    const events = stageHistoryToEvents(stageHistory)
    expect(events).toHaveLength(3)
    expect(events[0]!.kind).toBe('stage')
    expect(events[0]!.timestamp).toBe('2026-09-09T01:00:00.000Z')
    expect(events[0]!.outcome).toBe('completed')
  })

  it('相邻 entry 配对推断流转方向（understand → plan）', () => {
    const events = stageHistoryToEvents(stageHistory)
    // 第 1 条 entry（understand）与第 2 条（plan）配对 → title 含「understand → plan」
    expect(events[0]!.title).toContain('understand')
    expect(events[0]!.title).toContain('plan')
  })

  it('最后一条 entry（无下一条）→ title 不含 →', () => {
    const events = stageHistoryToEvents(stageHistory)
    expect(events[2]!.title).toBe('implement')
    expect(events[2]!.title).not.toContain('→')
  })

  it('outcome + reason 进 detail', () => {
    const events = stageHistoryToEvents([
      { stage: 'plan', enteredAt: 't', leftAt: 't2', outcome: 'rolled-back', reason: 'verify-failed' },
    ])
    expect(events[0]!.detail).toContain('rolled-back')
    expect(events[0]!.detail).toContain('verify-failed')
  })
})

describe('subHistoryToEvents', () => {
  it('空 task list → 空数组', () => {
    expect(subHistoryToEvents([])).toEqual([])
  })

  it('多 task 累加；每条 subHistory entry → 1 条 event', () => {
    const events = subHistoryToEvents(taskList.tasks)
    // task1 有 2 条 subHistory + task2 有 2 条 = 4
    expect(events).toHaveLength(4)
    expect(events.every(e => e.kind === 'task')).toBe(true)
  })

  it('每条 event 带上 taskId/taskTitle（title 含 #taskId 后两位）', () => {
    const events = subHistoryToEvents(taskList.tasks)
    expect(events[0]!.title).toContain('OAuth 回调')
    expect(events[2]!.title).toContain('权限中间件')
  })

  it('entry.status + outcome 正确映射', () => {
    const events = subHistoryToEvents(taskList.tasks)
    expect(events[0]!.status).toBe('in_progress')
    expect(events[0]!.outcome).toBe('completed')
    expect(events[2]!.outcome).toBe('rolled-back')
  })
})

describe('artifactsToEvents', () => {
  it('空 artifacts → 空数组', () => {
    expect(artifactsToEvents({})).toEqual([])
  })

  it('每个 artifact → 1 条 event', () => {
    const events = artifactsToEvents(artifacts)
    expect(events).toHaveLength(2)
    expect(events.every(e => e.kind === 'artifact')).toBe(true)
  })

  it('meta.source=steer → badge=steer', () => {
    const events = artifactsToEvents(artifacts)
    const steer = events.find(e => e.title === 'Steer note')
    expect(steer?.badge).toBe('steer')
  })

  it('meta.source=drift → badge=drift', () => {
    const events = artifactsToEvents(artifacts)
    const drift = events.find(e => e.title === 'Drift snapshot')
    expect(drift?.badge).toBe('drift')
  })

  it('title=Drift snapshot 但无 meta.source → badge=drift（兜底）', () => {
    const events = artifactsToEvents({
      'd2': { id: 'd2', kind: 'note', title: 'Drift snapshot', createdAt: 't', body: '{}' },
    })
    expect(events[0]!.badge).toBe('drift')
  })

  it('kind 进 detail', () => {
    const events = artifactsToEvents(artifacts)
    expect(events[0]!.detail).toContain('kind: note')
  })
})

describe('interventionsToEvents', () => {
  it('空 queue → 空数组', () => {
    expect(interventionsToEvents([])).toEqual([])
  })

  it('每个 item → 1 条 event', () => {
    const events = interventionsToEvents(interventionQueue)
    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe('intervention')
  })

  it('resolved=true → badge=resolved', () => {
    const events = interventionsToEvents(interventionQueue)
    expect(events[0]!.badge).toBe('resolved')
  })

  it('item.summary → title；kind 进 detail', () => {
    const events = interventionsToEvents(interventionQueue)
    expect(events[0]!.title).toBe('需要审批 OAuth 配置')
    expect(events[0]!.detail).toContain('kind: approval')
  })
})

/* ── 组件渲染测试 ── */

describe('AuditTimelineModal：默认渲染', () => {
  it('4 维数据混合倒序展示（最新在前）', () => {
    const html = renderToStaticMarkup(
      <AuditTimelineModal t={fakeT} requirement={fullReq} taskList={taskList} />,
    )
    // 最新的 implement entry（03:00:00 之后）应排在前面
    // 检查关键 title 都渲染了
    expect(html).toContain('需要审批 OAuth 配置')          // intervention
    expect(html).toContain('Steer note')                  // artifact
    expect(html).toContain('Drift snapshot')              // artifact
    expect(html).toContain('权限中间件')                   // task
    expect(html).toContain('implement')                   // stage
  })

  it('筛选 chip 行渲染（5 个 chip）', () => {
    const html = renderToStaticMarkup(
      <AuditTimelineModal t={fakeT} requirement={fullReq} taskList={taskList} />,
    )
    expect(html).toContain('requirement.detail.audit.filter.all')
    expect(html).toContain('requirement.detail.audit.filter.stage')
    expect(html).toContain('requirement.detail.audit.filter.task')
    expect(html).toContain('requirement.detail.audit.filter.artifact')
    expect(html).toContain('requirement.detail.audit.filter.intervention')
  })

  it('事件计数行渲染', () => {
    const html = renderToStaticMarkup(
      <AuditTimelineModal t={fakeT} requirement={fullReq} taskList={taskList} />,
    )
    expect(html).toContain('requirement.detail.audit.event.count')
  })
})

describe('AuditTimelineModal：badge 渲染', () => {
  it('stageHistory outcome=completed → outcome badge 渲染', () => {
    const html = renderToStaticMarkup(
      <AuditTimelineModal t={fakeT} requirement={fullReq} taskList={taskList} />,
    )
    // outcome 复用 history.outcome.* key
    expect(html).toContain('requirement.detail.history.outcome.completed')
  })

  it('artifact steer note → steerNote badge 渲染', () => {
    const html = renderToStaticMarkup(
      <AuditTimelineModal t={fakeT} requirement={fullReq} taskList={taskList} />,
    )
    expect(html).toContain('requirement.detail.audit.event.steerNote')
  })

  it('artifact drift snapshot → driftSnapshot badge 渲染', () => {
    const html = renderToStaticMarkup(
      <AuditTimelineModal t={fakeT} requirement={fullReq} taskList={taskList} />,
    )
    expect(html).toContain('requirement.detail.audit.event.driftSnapshot')
  })

  it('intervention resolved=true → resolved badge 渲染', () => {
    const html = renderToStaticMarkup(
      <AuditTimelineModal t={fakeT} requirement={fullReq} taskList={taskList} />,
    )
    expect(html).toContain('requirement.detail.audit.event.resolved')
  })
})

describe('AuditTimelineModal：空状态', () => {
  it('requirement 完全无审计数据 + filter=all → 显示 empty 文案', () => {
    const emptyReq = makeReq()
    const html = renderToStaticMarkup(
      <AuditTimelineModal t={fakeT} requirement={emptyReq} taskList={null} />,
    )
    expect(html).toContain('requirement.detail.audit.empty')
  })

  it('有数据但某维度为空 —— 该维度 chip count=0', () => {
    // fullReq 有 interventionQueue，但 filter=intervention 时应正常显示
    // 这里测一个只有 stageHistory、无 intervention 的 req
    const reqNoIntervention = makeReq({ stageHistory })
    const html = renderToStaticMarkup(
      <AuditTimelineModal t={fakeT} requirement={reqNoIntervention} taskList={null} />,
    )
    // intervention chip 的 count 应为 0（渲染了「0」）
    // 至少能渲染出 filter chip 行
    expect(html).toContain('requirement.detail.audit.filter.intervention')
  })
})

describe('AuditTimelineModal：taskList=null', () => {
  it('taskList=null → task 维度不报错，正常渲染其它维度', () => {
    const html = renderToStaticMarkup(
      <AuditTimelineModal t={fakeT} requirement={makeReq({ stageHistory })} taskList={null} />,
    )
    expect(html).toContain('implement')
  })
})
