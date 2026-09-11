/**
 * stage-prompts 单元测试。
 *
 * 覆盖目标：
 *   - STAGE_GOAL 5 阶段字面量都包含关键标记（阶段名 + 退出条件「advance_stage」）
 *   - STAGE_GOAL 各阶段**不**剧透其他阶段（plan 段不能出现 implement；implement 不能出现 deliver 等）
 *     —— 这是接入 2.3 的核心约束，防止重新用户「agent 在 understand 阶段提前看到 tasks.json 格式」问题
 *   - buildInitialPrompt：单阶段 + 当前 stage goal + 不剧透未来 stage
 *   - buildStageTransitionPrompt：toStage + 上一阶段产物摘要
 *   - summarizeArtifacts：plan (isTaskList=true) / note / patch / log 四种格式
 *   - mintSkyAxisRequestId：返回 `sky-axis-<uuid>` 格式
 */
import { describe, expect, it } from 'vitest'
import {
  STAGE_GOAL,
  COMMON_PREAMBLE,
  buildInitialPrompt,
  buildStageTransitionPrompt,
  mintSkyAxisRequestId,
  type Stage,
} from '../../../src/host/prompts/stage-prompts.ts'
import {
  WorkspaceIdSchema,
  type Artifact,
  type Requirement,
} from '../../../src/protocol.ts'

/** SAMPLE req —— understand stage 的 fixture。 */
const SAMPLE_REQ: Requirement = {
  id: '2026-09-11T06:39:24.321Z-68wbf3',
  workspaceId: WorkspaceIdSchema.parse('ws-1'),
  title: '第八需求',
  description: '',
  priority: 'normal',
  status: 'open',
  tags: [],
  createdAt: '2026-09-11T06:39:24.321Z',
  updatedAt: '2026-09-11T06:39:24.321Z',
  stage: 'understand',
  stageHistory: [{ stage: 'understand', enteredAt: '2026-09-11T06:39:24.321Z' }],
  aiState: 'running',
  aiSessionId: 'session-test',
  aiLastActivityAt: '2026-09-11T06:39:24.321Z',
  interventionQueue: [],
  artifacts: {},
  branch: null,
  materials: {
    prdFiles: [],
    prdLinks: [],
    sourceRepos: [],
    designLinks: [],
    attachments: [],
    externalLinks: [],
  },
}

/** Stage → 不应在本段出现的其他 stage 列表（用于剧透检测）。 */
const STAGE_LEAKAGE_FORBIDDEN: Readonly<Record<Stage, ReadonlyArray<string>>> = {
  // understand 段不应出现「tasks.json」「plan artifact」「advance_stage(toStage="plan"...)」之外的「推进到 plan」的强暗示
  // 但允许提到「通读 spec.md」「PRD」「浏览现有代码」这些通用动作
  understand: ['产出 tasks.json', 'Artifact(kind="plan")', 'TaskList JSON'],
  plan: ['按 plan artifact 的 tasks 逐项实现', '跑 typecheck', '提交 + 部署', '上线观测'],
  implement: ['通读 PRD', '产出 tasks.json', 'Artifact(kind="plan")', '提交 + 部署', '上线观测'],
  verify: ['通读 PRD', '产出 tasks.json', 'Artifact(kind="plan")', '逐项实现', '提交 + 部署'],
  deliver: ['通读 PRD', '产出 tasks.json', 'Artifact(kind="plan")', '逐项实现', '跑 typecheck'],
}

describe('STAGE_GOAL 字面量完整性', () => {
  it('5 个 stage 都有 STAGE_GOAL 定义', () => {
    const stages: Stage[] = ['understand', 'plan', 'implement', 'verify', 'deliver']
    for (const stage of stages) {
      expect(STAGE_GOAL[stage]).toBeTypeOf('string')
      expect(STAGE_GOAL[stage].length).toBeGreaterThan(20)
    }
  })

  it('每段都包含「advance_stage」退出条件', () => {
    const stages: Stage[] = ['understand', 'plan', 'implement', 'verify', 'deliver']
    for (const stage of stages) {
      // deliver 段是 pipeline 末端，按调研报告第 6.1 节说「无需再调 advance_stage」
      if (stage === 'deliver') continue
      expect(STAGE_GOAL[stage]).toMatch(/advance_stage/)
    }
  })

  it('每段都标注「你当前处于 ... 阶段」', () => {
    const stages: Stage[] = ['understand', 'plan', 'implement', 'verify', 'deliver']
    for (const stage of stages) {
      expect(STAGE_GOAL[stage]).toMatch(new RegExp(`\\*\\*${stage}\\*\\*`))
    }
  })
})

describe('STAGE_GOAL 不剧透其他阶段（接入 2.3 核心约束）', () => {
  it.each(['understand', 'plan', 'implement', 'verify', 'deliver'] as const)(
    '%s 段不剧透其他阶段的产物形态',
    (stage) => {
      const forbidden = STAGE_LEAKAGE_FORBIDDEN[stage]
      for (const phrase of forbidden) {
        expect(STAGE_GOAL[stage]).not.toContain(phrase)
      }
    },
  )
})

describe('COMMON_PREAMBLE', () => {
  it('包含 sky-axis 5 阶段协议概述', () => {
    expect(COMMON_PREAMBLE).toMatch(/understand.*plan.*implement.*verify.*deliver/)
  })

  it('列出 advance_stage tool（agent 必须知道）', () => {
    expect(COMMON_PREAMBLE).toMatch(/advance_stage/)
  })
})

describe('buildInitialPrompt', () => {
  it('包含需求 ID / 标题 / Workspace 路径', () => {
    const prompt = buildInitialPrompt(SAMPLE_REQ, 'D:\\WorkSpace\\temp\\天下第八')
    expect(prompt).toContain('2026-09-11T06:39:24.321Z-68wbf3')
    expect(prompt).toContain('第八需求')
    expect(prompt).toContain('D:\\WorkSpace\\temp\\天下第八')
  })

  it('只讲当前 stage 的目标（不剧透未来 stage）', () => {
    const prompt = buildInitialPrompt(SAMPLE_REQ, 'D:\\WorkSpace\\temp\\x')
    // understand 阶段不应出现 plan 阶段的强形态
    expect(prompt).not.toContain('TaskList JSON')
    expect(prompt).not.toContain('Artifact(kind="plan")')
    // 但应出现 understand 段的标识
    expect(prompt).toMatch(/\*\*understand\*\*/)
  })

  it('包含 COMMON_PREAMBLE（agent 基础认知）', () => {
    const prompt = buildInitialPrompt(SAMPLE_REQ, 'D:\\x')
    expect(prompt).toContain('sky-axis 协作 agent')
    expect(prompt).toMatch(/understand.*plan.*implement.*verify.*deliver/)
  })

  it('plan stage 时 prompt 包含 TaskList JSON 提示', () => {
    const planReq = { ...SAMPLE_REQ, stage: 'plan' as const }
    const prompt = buildInitialPrompt(planReq, 'D:\\x')
    expect(prompt).toMatch(/TaskList JSON/)
  })
})

describe('buildStageTransitionPrompt', () => {
  it('包含目标 stage-goal', () => {
    const reqWithPlanArtifact: Requirement = {
      ...SAMPLE_REQ,
      artifacts: {
        'plan-abc123': {
          id: 'plan-abc123',
          kind: 'plan',
          title: 'Tasks (5) for 68wbf3',
          createdAt: '2026-09-11T07:00:00.000Z',
          body: '{"tasks":[]}',
          meta: { isTaskList: true, taskCount: 5 },
        } satisfies Artifact,
      },
    }
    const prompt = buildStageTransitionPrompt(reqWithPlanArtifact, 'implement')
    expect(prompt).toMatch(/\*\*implement\*\*/)
    expect(prompt).toMatch(/逐项实现 plan artifact 的 tasks/)
  })

  it('包含上阶段产物摘要（plan artifact → task 数）', () => {
    const reqWithPlanArtifact: Requirement = {
      ...SAMPLE_REQ,
      artifacts: {
        'plan-abc123': {
          id: 'plan-abc123',
          kind: 'plan',
          title: 'Tasks (3) for 68wbf3',
          createdAt: '2026-09-11T07:00:00.000Z',
          body: '{}',
          meta: { isTaskList: true, taskCount: 3 },
        },
      },
    }
    const prompt = buildStageTransitionPrompt(reqWithPlanArtifact, 'implement')
    expect(prompt).toContain('3 tasks')
  })

  it('无 artifact 时显示「(无)」', () => {
    const prompt = buildStageTransitionPrompt(SAMPLE_REQ, 'plan')
    expect(prompt).toContain('(无)')
  })
})

describe('mintSkyAxisRequestId', () => {
  it('返回 `sky-axis-<uuid>` 格式', () => {
    const id = mintSkyAxisRequestId()
    expect(id).toMatch(/^sky-axis-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('支持自定义 prefix', () => {
    const id = mintSkyAxisRequestId('sky-axis-stage')
    expect(id).toMatch(/^sky-axis-stage-/)
  })

  it('两次调用产生不同 id', () => {
    const a = mintSkyAxisRequestId()
    const b = mintSkyAxisRequestId()
    expect(a).not.toBe(b)
  })
})