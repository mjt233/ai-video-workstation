import { describe, expect, it } from 'vitest'
import type { TaskResponse } from '../../api/workflow'
import {
  artifactName,
  formatDateTime,
  locationText,
  previewUrlOf,
  rowSecondaryText,
  rowSecondaryTooltip,
  shortImpl,
  thumbKindOf,
  thumbPathOf,
} from './historyFormat'

/** 构造历史行测试用的任务响应（只填必要字段，其余按需覆盖） */
function makeTask(over: Partial<TaskResponse> = {}): TaskResponse {
  return {
    taskId: 't1',
    project: 'AI的第一天',
    workflowId: 'image-to-video',
    impl: 'ceb-412a1e15-be24-4904-aa30-123716d04c45-minimax-h3-r2v',
    status: 'completed',
    result: { path: 'assert/scene/3/19/canvas/016c743d/output.mp4' },
    createdAt: '2025-09-16 03:39:00',
    updatedAt: '2025-09-16 03:41:20',
    ...over,
  }
}

describe('shortImpl', () => {
  it('剥掉 Bridge 动态注册的实例 UUID 与 ceb- 前缀', () => {
    expect(shortImpl('ceb-412a1e15-be24-4904-aa30-123716d04c45-minimax-h3-r2v')).toBe('minimax-h3-r2v')
  })

  it('剥掉静态实例副本形式里尾部的实例 UUID', () => {
    expect(shortImpl('minimax-h3-r2v-412a1e15-be24-4904-aa30-123716d04c45')).toBe('minimax-h3-r2v')
  })

  it('无可剥离部分时原样返回（含大写 UUID 与纯 UUID 串）', () => {
    expect(shortImpl('minimax-h3-r2v')).toBe('minimax-h3-r2v')
    expect(shortImpl('CEB-412A1E15-BE24-4904-AA30-123716D04C45-minimax-h3-r2v')).toBe('minimax-h3-r2v')
    // 只有 UUID、没有后续实现名时不剥（保持原样比返回空串更有信息量）
    expect(shortImpl('ceb-412a1e15-be24-4904-aa30-123716d04c45')).toBe('ceb-412a1e15-be24-4904-aa30-123716d04c45')
  })

  it('空值/空白 → 空串', () => {
    expect(shortImpl('')).toBe('')
    expect(shortImpl('   ')).toBe('')
    expect(shortImpl(undefined)).toBe('')
    expect(shortImpl(null)).toBe('')
  })
})

describe('locationText', () => {
  it('分镜画布 → 「分镜 集-镜」+ 节点前 8 位', () => {
    expect(
      locationText(
        makeTask({
          params: {
            vars: {},
            promptPaths: [],
            outputPath: 'assert/x',
            nodeId: '016c743d-aaaa-bbbb-cccc-dddddddddddd',
            canvas: { kind: 'scene', episode: '3', shot: '19' },
          },
        }),
      ),
    ).toBe('分镜 3-19 · 节点 016c743d')
  })

  it('场景画布 → 「场景 场景名/子场景」', () => {
    expect(
      locationText(
        makeTask({ params: { vars: {}, promptPaths: [], outputPath: 'assert/x', canvas: { kind: 'stage', stage: '舞台A', label: '子场景B' } } }),
      ),
    ).toBe('场景 舞台A/子场景B')
  })

  it('无定位信息 → 空串', () => {
    expect(locationText(makeTask())).toBe('')
  })
})

describe('artifactName', () => {
  it('取路径最后一段作为文件名', () => {
    expect(artifactName(makeTask())).toBe('output.mp4')
  })

  it('无产物 → 「产物」兜底', () => {
    expect(artifactName(makeTask({ result: null }))).toBe('产物')
  })
})

describe('thumbPathOf / thumbKindOf', () => {
  it('已完成且产物为图片/视频 → 返回路径与类型', () => {
    expect(thumbPathOf(makeTask())).toBe('assert/scene/3/19/canvas/016c743d/output.mp4')
    expect(thumbKindOf(makeTask())).toBe('video')
    const image = makeTask({ result: { path: 'assert/a/output.png' } })
    expect(thumbPathOf(image)).toBe('assert/a/output.png')
    expect(thumbKindOf(image)).toBe('image')
  })

  it('音频产物 / 失败 / 运行中 / 无产物 → 不渲染缩略图', () => {
    expect(thumbPathOf(makeTask({ result: { path: 'assert/a/output.flac' } }))).toBe('')
    expect(thumbPathOf(makeTask({ status: 'failed' }))).toBe('')
    expect(thumbPathOf(makeTask({ status: 'running' }))).toBe('')
    expect(thumbPathOf(makeTask({ result: null }))).toBe('')
    // 无法判定类型时回退图片（仅影响预览对话框用哪种播放器）
    expect(thumbKindOf(makeTask({ result: { path: 'assert/a/output.flac' } }))).toBe('image')
  })
})

describe('previewUrlOf', () => {
  it('以 updatedAt 作缓存键（同一任务多次渲染 URL 稳定）', () => {
    const task = makeTask()
    const expected = Date.parse('2025-09-16T03:41:20Z')
    expect(previewUrlOf(task)).toBe(`/api/fs/AI的第一天/assert/scene/3/19/canvas/016c743d/output.mp4?t=v${expected}`)
    expect(previewUrlOf(task)).toBe(previewUrlOf(task))
  })

  it('无产物 / 无项目名 → 空串', () => {
    expect(previewUrlOf(makeTask({ result: null }))).toBe('')
    expect(previewUrlOf(makeTask({ project: '' }))).toBe('')
  })

  it('updatedAt 无法解析 → 缓存键回退 0（不抛错）', () => {
    expect(previewUrlOf(makeTask({ updatedAt: '' }))).toBe(
      '/api/fs/AI的第一天/assert/scene/3/19/canvas/016c743d/output.mp4?t=v0',
    )
  })
})

describe('rowSecondaryText / rowSecondaryTooltip', () => {
  it('定位 + 实现简称 + 产物文件名', () => {
    const task = makeTask({ params: { vars: {}, promptPaths: [], outputPath: 'assert/x', canvas: { kind: 'scene', episode: '3', shot: '19' } } })
    expect(rowSecondaryText(task)).toBe('分镜 3-19 · minimax-h3-r2v · output.mp4')
    // 悬浮提示用完整实现 id 与完整产物路径
    expect(rowSecondaryTooltip(task)).toBe(
      '分镜 3-19 · ceb-412a1e15-be24-4904-aa30-123716d04c45-minimax-h3-r2v · assert/scene/3/19/canvas/016c743d/output.mp4',
    )
  })

  it('无画布定位时用「无画布定位」兜底', () => {
    expect(rowSecondaryText(makeTask())).toBe('无画布定位 · minimax-h3-r2v · output.mp4')
  })

  it('错误原因优先于产物路径（失败任务没有产物）', () => {
    const failed = makeTask({ status: 'failed', result: null, errorMsg: "No module named 'sageattention'" })
    expect(rowSecondaryText(failed)).toBe('无画布定位 · minimax-h3-r2v · No module named \'sageattention\'')
    expect(rowSecondaryTooltip(failed)).toContain("No module named 'sageattention'")
  })
})

describe('formatDateTime', () => {
  it('SQLite UTC 串（无 T）按 UTC 解析后转本地 MM-DD HH:MM', () => {
    const d = new Date(Date.parse('2025-09-16T03:39:00Z'))
    const pad = (n: number): string => String(n).padStart(2, '0')
    const expected = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    expect(formatDateTime('2025-09-16 03:39:00')).toBe(expected)
  })

  it('ISO 串（带 T）原样解析', () => {
    expect(formatDateTime('2025-09-16T03:39:00.000Z')).toBe(formatDateTime('2025-09-16 03:39:00'))
  })

  it('无法解析或为空 → 原样返回', () => {
    expect(formatDateTime('不是时间')).toBe('不是时间')
    expect(formatDateTime('')).toBe('')
  })
})
