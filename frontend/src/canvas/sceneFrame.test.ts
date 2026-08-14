import { describe, expect, it } from 'vitest'
import type { CanvasInputInfo } from './generate'
import { buildSceneFrameOptions, deriveStageFrameBody } from './sceneFrame'

/** 构造输入资产信息 */
function inp(path: string, nodeId = 'n'): CanvasInputInfo {
  return { nodeId, path, label: path.split('/').pop() ?? path }
}

describe('deriveStageFrameBody', () => {
  it('基础场景取 assert/stage 输入推导的引用', () => {
    const body = deriveStageFrameBody([inp('assert/stage/公园/白天.jpg')], [], '画一个少年')
    expect(body).toEqual({ 基础场景: '公园/白天', 登场角色: [], prompt: '画一个少年' })
  })

  it('变体路径推导为 场景/标签@变体', () => {
    const body = deriveStageFrameBody([inp('assert/stage/公园/variants/白天/v2.jpg')], [], '')
    expect(body?.基础场景).toBe('公园/白天@v2')
  })

  it('收集登场角色并去重', () => {
    const body = deriveStageFrameBody(
      [
        inp('assert/stage/公园/白天.jpg'),
        inp('assert/character/小明/appearance.jpg', 'c1'),
        inp('assert/character/小明/appearance.jpg', 'c2'),
        inp('assert/character/小红/appearance.jpg', 'c3'),
      ],
      [],
      '小明与小红',
    )
    expect(body?.登场角色).toEqual(['小明', '小红'])
  })

  it('无基础场景时回退现有帧第一个非空基础场景', () => {
    const body = deriveStageFrameBody([inp('assert/character/小明/appearance.jpg')], [{ 基础场景: '' }, { 基础场景: '公园/白天' }], '')
    expect(body?.基础场景).toBe('公园/白天')
  })

  it('完全无基础场景返回 null', () => {
    expect(deriveStageFrameBody([], [{ 基础场景: '' }], 'prompt')).toBeNull()
  })

  it('有登场角色但无 prompt 时清空角色（服务端约束）', () => {
    const body = deriveStageFrameBody(
      [inp('assert/stage/公园/白天.jpg'), inp('assert/character/小明/appearance.jpg')],
      [],
      '',
    )
    expect(body?.登场角色).toEqual([])
  })

  it('非字符串 prompt 视为空', () => {
    const body = deriveStageFrameBody([inp('assert/stage/公园/白天.jpg')], [], 123)
    expect(body?.prompt).toBe('')
  })
})

describe('buildSceneFrameOptions', () => {
  const defs = [
    { 基础场景: '公园/白天', prompt: 'P1' },
    { prompt: '只写 prompt' },
    {},
  ]

  it('label 优先级：基础场景 > prompt > 分镜场景图 N', () => {
    const options = buildSceneFrameOptions(defs, (i) => `/s/${i}.jpg`)
    expect(options.map((o) => o.label)).toEqual(['公园/白天', '只写 prompt', '分镜场景图 3'])
  })

  it('通过 urlOf 生成预览 URL，初始 broken=false', () => {
    const options = buildSceneFrameOptions(defs, (i) => `/s/${i}.jpg?t=1`)
    expect(options.map((o) => o.imageUrl)).toEqual(['/s/0.jpg?t=1', '/s/1.jpg?t=1', '/s/2.jpg?t=1'])
    expect(options.every((o) => o.broken === false)).toBe(true)
    expect(options.map((o) => o.index)).toEqual([0, 1, 2])
  })
})
