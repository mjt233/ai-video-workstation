import { describe, expect, it } from 'vitest'
import { createCanvasData } from './types'
import {
  buildAutoCanvas,
  buildShotRefsFromStage,
  mergePrompt,
  resolveCharacterRef,
  resolveShotStageRef,
} from './autobuild'

describe('buildAutoCanvas', () => {
  it('空画布创建锚点与生成节点并连线', () => {
    const data = createCanvasData('scene')
    const refs = [
      { assetPath: 'assert/stage/街角/白天.jpg', label: '街角/白天' },
      { assetPath: 'assert/character/张三/appearance.jpg', label: '张三' },
    ]
    const r = buildAutoCanvas(data, refs, '画面描述', 80, 80)
    expect(r.nodes).toHaveLength(3) // 2 锚点 + 1 生成
    expect(r.connections).toHaveLength(2)
    expect(r.generateNodeId).toBeTruthy()
  })

  it('幂等：已有同路径锚点不重复创建', () => {
    const data = createCanvasData('scene')
    const refs = [
      { assetPath: 'assert/character/张三/appearance.jpg', label: '张三' },
      { assetPath: 'assert/character/李四/appearance.jpg', label: '李四' },
    ]
    const first = buildAutoCanvas(data, refs, '', 80, 80)
    // 应用第一次结果后，再次调用应只补充缺失
    const merged = createCanvasData('scene')
    merged.nodes = [...first.nodes]
    merged.connections = [...first.connections]
    const second = buildAutoCanvas(merged, refs, '', 80, 80)
    expect(second.nodes).toHaveLength(0)
  })

  it('已有生成节点时复用', () => {
    const data = createCanvasData('scene')
    const refs = [{ assetPath: 'assert/character/张三/appearance.jpg', label: '张三' }]
    const r = buildAutoCanvas(data, refs, '', 80, 80)
    const data2 = createCanvasData('scene')
    data2.nodes = [...r.nodes]
    const r2 = buildAutoCanvas(data2, refs, '新prompt', 80, 80)
    expect(r2.nodes).toHaveLength(0)
    expect(r2.generateNodeId).toBe(r.generateNodeId)
  })
})

describe('mergePrompt', () => {
  it('空 prompt 取 extra', () => {
    expect(mergePrompt('', '描述A')).toBe('描述A')
  })

  it('已有 prompt 追加 extra', () => {
    expect(mergePrompt('已有', '追加')).toBe('已有\n追加')
  })
})

describe('resolveShotStageRef', () => {
  it('基础场景引用', () => {
    expect(resolveShotStageRef('街角/白天')).toEqual({
      assetPath: 'assert/stage/街角/白天.jpg',
      label: '街角/白天',
    })
  })

  it('场景衍生变体引用', () => {
    expect(resolveShotStageRef('街角/白天@门已打开')).toEqual({
      assetPath: 'assert/stage/街角/variants/白天/门已打开.jpg',
      label: '街角/白天@门已打开',
    })
  })

  it('custom 引用（含扩展名原样透传）', () => {
    expect(resolveShotStageRef('custom/stage/商场门外/门已打开.png')).toEqual({
      assetPath: 'assert/custom/stage/商场门外/门已打开.png',
      label: 'custom/stage/商场门外/门已打开.png',
    })
  })

  it('prev 返回 null（由调用方异步解析）', () => {
    expect(resolveShotStageRef('prev')).toBeNull()
  })

  it('无效格式返回 null', () => {
    expect(resolveShotStageRef('')).toBeNull()
    expect(resolveShotStageRef('只有场景名')).toBeNull()
  })
})

describe('resolveCharacterRef', () => {
  it('基础角色引用', () => {
    expect(resolveCharacterRef('张三')).toEqual({
      assetPath: 'assert/character/张三/appearance.jpg',
      label: '张三',
    })
  })

  it('角色衍生变体引用', () => {
    expect(resolveCharacterRef('李四@变体1')).toEqual({
      assetPath: 'assert/character/李四/variants/变体1.jpg',
      label: '李四@变体1',
    })
  })

  it('custom 引用', () => {
    expect(resolveCharacterRef('custom/character/张三/道具.png')).toEqual({
      assetPath: 'assert/custom/character/张三/道具.png',
      label: 'custom/character/张三/道具.png',
    })
  })
})

describe('buildShotRefsFromStage', () => {
  it('提取角色与场景引用（含场景变体 / 角色变体 / custom）', () => {
    const refs = buildShotRefsFromStage([
      { 基础场景: '街角/白天', 登场角色: ['张三', '李四@变体1'] },
      { 基础场景: '街角/白天@门已打开' },
      { 基础场景: 'custom/stage/商场门外/门已打开.png' },
      { 基础场景: 'prev' },
    ])
    expect(refs).toEqual([
      { assetPath: 'assert/stage/街角/白天.jpg', label: '街角/白天' },
      { assetPath: 'assert/character/张三/appearance.jpg', label: '张三' },
      { assetPath: 'assert/character/李四/variants/变体1.jpg', label: '李四@变体1' },
      { assetPath: 'assert/stage/街角/variants/白天/门已打开.jpg', label: '街角/白天@门已打开' },
      { assetPath: 'assert/custom/stage/商场门外/门已打开.png', label: 'custom/stage/商场门外/门已打开.png' },
    ])
  })

  it('空定义返回空', () => {
    expect(buildShotRefsFromStage([])).toEqual([])
  })
})
