import { describe, expect, it } from 'vitest'
import { canvasAssetDir, canvasNodeAssetPath, sceneCanvasRelPath, stageCanvasRelPath } from './paths'

describe('stageCanvasRelPath', () => {
  it('返回场景画布定义路径', () => {
    expect(stageCanvasRelPath('便利店内部')).toBe('prompt/stage/便利店内部/canvas.json')
  })
})

describe('sceneCanvasRelPath', () => {
  it('返回分镜画布定义路径', () => {
    expect(sceneCanvasRelPath('1', '3')).toBe('prompt/scene/1/3/canvas.json')
  })
})

describe('canvasAssetDir', () => {
  it('场景画布产物目录', () => {
    expect(canvasAssetDir({ kind: 'stage', primary: '便利店内部' })).toBe('assert/stage/便利店内部/canvas')
  })

  it('分镜画布产物目录', () => {
    expect(canvasAssetDir({ kind: 'scene', primary: '1', secondary: '3' })).toBe('assert/scene/1/3/canvas')
  })
})

describe('canvasNodeAssetPath', () => {
  it('节点产物带版本号', () => {
    expect(canvasNodeAssetPath({ kind: 'scene', primary: '1', secondary: '3' }, 'node-a', 2)).toBe(
      'assert/scene/1/3/canvas/node-a/v2.jpg',
    )
  })
})
