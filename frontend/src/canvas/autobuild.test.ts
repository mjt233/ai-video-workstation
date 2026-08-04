import { describe, expect, it } from 'vitest'
import { createCanvasData } from './types'
import {
  buildAutoCanvas,
  buildShotRefsFromStage,
  buildSubSceneAutoCanvas,
  deriveStageRefFromAssetPath,
  mergePrompt,
  normalizeLegacyVariantPath,
  resolveCharacterRef,
  resolveShotStageRef,
  type StageVariantRef,
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

  it('非精确 prev（如 previous/白天）不被当作 prev 跳过', () => {
    expect(resolveShotStageRef('previous/白天')).toEqual({
      assetPath: 'assert/stage/previous/白天.jpg',
      label: 'previous/白天',
    })
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

describe('deriveStageRefFromAssetPath', () => {
  it('普通场景图路径 → 场景/标签', () => {
    expect(deriveStageRefFromAssetPath('assert/stage/街角/白天.jpg')).toBe('街角/白天')
  })

  it('变体路径 → 场景/标签@变体', () => {
    expect(deriveStageRefFromAssetPath('assert/stage/街角/variants/白天/门已打开.jpg')).toBe('街角/白天@门已打开')
  })

  it('非 assert/stage 路径返回空串', () => {
    expect(deriveStageRefFromAssetPath('assert/character/张三/appearance.jpg')).toBe('')
  })

  it('畸形路径返回空串', () => {
    expect(deriveStageRefFromAssetPath('assert/stage/只有场景名.jpg')).toBe('')
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

describe('normalizeLegacyVariantPath', () => {
  it('识别旧版错误变体路径并返回规范路径', () => {
    expect(
      normalizeLegacyVariantPath('assert/stage/商场门外/商场门外-白天-平视-晴-入口外街道@推进贴地视角.jpg'),
    ).toEqual({
      legacy: 'assert/stage/商场门外/商场门外-白天-平视-晴-入口外街道@推进贴地视角.jpg',
      canonical: 'assert/stage/商场门外/variants/商场门外-白天-平视-晴-入口外街道/推进贴地视角.jpg',
    })
  })

  it('普通路径返回 null', () => {
    expect(normalizeLegacyVariantPath('assert/stage/商场门外/白天.jpg')).toBeNull()
    expect(normalizeLegacyVariantPath('assert/character/陈书文/appearance.jpg')).toBeNull()
    expect(normalizeLegacyVariantPath('assert/stage/商场门外/variants/白天/门已打开.jpg')).toBeNull()
  })
})

describe('buildSubSceneAutoCanvas', () => {
  const base = 'assert/stage/街角/白天.jpg'

  it('空画布全搭：基础加载节点 + 每变体生成节点 + 连线', () => {
    const data = createCanvasData('stage')
    const variants: StageVariantRef[] = [
      { id: '门已打开', desc: '将门打开', refs: [] },
      { id: '夜间', desc: '改为夜晚', refs: [] },
    ]
    const r = buildSubSceneAutoCanvas(data, '白天', base, variants, 80, 80)
    // 1 基础加载 + 2 生成
    expect(r.nodes).toHaveLength(3)
    expect(r.nodes.filter((n) => n.prototypeId === 'image-loader')).toHaveLength(1)
    expect(r.nodes.filter((n) => n.prototypeId === 'image-generate')).toHaveLength(2)
    // 根变体都接到基础加载节点
    expect(r.connections).toHaveLength(2)
    const baseId = r.nodes.find((n) => n.config.assetPath === base)?.id
    expect(r.connections.every((c) => c.fromNodeId === baseId)).toBe(true)
    // 生成节点 prompt = desc，且带 autoRef
    const gen = r.nodes.find((n) => n.config.autoRef === 'stage:白天@门已打开')
    expect(gen?.config.prompt).toBe('将门打开')
  })

  it('嵌套变体接父变体生成节点', () => {
    const data = createCanvasData('stage')
    const variants: StageVariantRef[] = [
      { id: 'A', desc: 'A', refs: [] },
      { id: 'A2', desc: 'A 的子', parentId: 'A', refs: [] },
    ]
    const r = buildSubSceneAutoCanvas(data, '白天', base, variants, 80, 80)
    const aId = r.nodes.find((n) => n.config.autoRef === 'stage:白天@A')?.id
    const a2Id = r.nodes.find((n) => n.config.autoRef === 'stage:白天@A2')?.id
    const baseId = r.nodes.find((n) => n.config.assetPath === base)?.id
    expect(aId).toBeTruthy()
    expect(a2Id).toBeTruthy()
    // A → A2 连线存在
    expect(r.connections.some((c) => c.fromNodeId === aId && c.toNodeId === a2Id)).toBe(true)
    // A 接基础图
    expect(r.connections.some((c) => c.fromNodeId === baseId && c.toNodeId === aId)).toBe(true)
  })

  it('变体 refs 使用加载图片节点，同资产共享一个节点', () => {
    const data = createCanvasData('stage')
    const shared = 'assert/custom/道具/伞.png'
    const variants: StageVariantRef[] = [
      { id: 'A', desc: 'A', refs: [shared] },
      { id: 'B', desc: 'B', refs: [shared] },
    ]
    const r = buildSubSceneAutoCanvas(data, '白天', base, variants, 80, 80)
    // 基础加载 + 2 生成 + 1 共享 ref 加载
    expect(r.nodes).toHaveLength(4)
    const refLoaders = r.nodes.filter((n) => n.config.assetPath === shared)
    expect(refLoaders).toHaveLength(1)
    // ref 加载节点同时连到 A、B 两个生成节点
    const loaderId = refLoaders[0]?.id
    const aId = r.nodes.find((n) => n.config.autoRef === 'stage:白天@A')?.id
    const bId = r.nodes.find((n) => n.config.autoRef === 'stage:白天@B')?.id
    expect(r.connections.some((c) => c.fromNodeId === loaderId && c.toNodeId === aId)).toBe(true)
    expect(r.connections.some((c) => c.fromNodeId === loaderId && c.toNodeId === bId)).toBe(true)
  })

  it('幂等：应用一次后再调用不新增节点', () => {
    const data = createCanvasData('stage')
    const variants: StageVariantRef[] = [
      { id: '门已打开', desc: '开门', refs: [] },
      { id: 'A2', desc: 'A 的子', parentId: '门已打开', refs: [] },
    ]
    const first = buildSubSceneAutoCanvas(data, '白天', base, variants, 80, 80)
    const merged = createCanvasData('stage')
    merged.nodes = [...first.nodes]
    merged.connections = [...first.connections]
    const second = buildSubSceneAutoCanvas(merged, '白天', base, variants, 80, 80)
    expect(second.nodes).toHaveLength(0)
    expect(second.connections).toHaveLength(0)
  })

  it('已有生成节点但缺连线时补连', () => {
    const data = createCanvasData('stage')
    const variants: StageVariantRef[] = [{ id: 'A', desc: 'A', refs: [] }]
    const first = buildSubSceneAutoCanvas(data, '白天', base, variants, 80, 80)
    // 手动删除 first 里的连线，模拟「节点在、连线被删」
    const merged = createCanvasData('stage')
    merged.nodes = [...first.nodes]
    merged.connections = []
    const second = buildSubSceneAutoCanvas(merged, '白天', base, variants, 80, 80)
    expect(second.nodes).toHaveLength(0)
    expect(second.connections).toHaveLength(1)
  })

  it('无变体时只搭基础加载节点', () => {
    const data = createCanvasData('stage')
    const r = buildSubSceneAutoCanvas(data, '白天', base, [], 80, 80)
    expect(r.nodes).toHaveLength(1)
    expect(r.nodes[0]?.prototypeId).toBe('image-loader')
    expect(r.nodes[0]?.config.assetPath).toBe(base)
    expect(r.connections).toHaveLength(0)
  })

  it('不同变体的不同 refs 不重叠（各自独立 y 坐标）', () => {
    const data = createCanvasData('stage')
    const variants: StageVariantRef[] = [
      { id: 'A', desc: 'A', refs: ['assert/custom/道具/伞.png'] },
      { id: 'B', desc: 'B', refs: ['assert/custom/道具/扇子.png'] },
    ]
    const r = buildSubSceneAutoCanvas(data, '白天', base, variants, 80, 80)
    // 基础加载 + 2 生成 + 2 个不同 ref 加载
    expect(r.nodes).toHaveLength(5)
    const refLoaders = r.nodes.filter((n) => n.prototypeId === 'image-loader' && n.config.assetPath !== base)
    expect(refLoaders).toHaveLength(2)
    // 两个 ref 加载节点 y 坐标不同（不重叠）
    const ys = refLoaders.map((n) => n.y)
    expect(new Set(ys).size).toBe(2)
  })
})
