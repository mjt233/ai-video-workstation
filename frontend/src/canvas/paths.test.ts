import { describe, expect, it } from 'vitest'
import {
  canvasAssetDir,
  canvasNodeOutputPath,
  canvasNodeAssetPath,
  isCanvasNodeOutputPath,
  sceneCanvasRelPath,
  stageCanvasRelPath,
} from './paths'

describe('stageCanvasRelPath', () => {
  it('返回场景画布定义路径（含子场景标签）', () => {
    expect(stageCanvasRelPath('便利店内部', '便利店内部-白天-平视-晴-收银台')).toBe(
      'prompt/stage/便利店内部/canvas/便利店内部-白天-平视-晴-收银台.json',
    )
  })
})

describe('sceneCanvasRelPath', () => {
  it('返回分镜画布定义路径', () => {
    expect(sceneCanvasRelPath('1', '3')).toBe('prompt/scene/1/3/canvas.json')
  })
})

describe('canvasAssetDir', () => {
  it('场景画布产物目录（含子场景标签）', () => {
    expect(canvasAssetDir({ kind: 'stage', primary: '便利店内部', label: '白天' })).toBe(
      'assert/stage/便利店内部/canvas/白天',
    )
  })

  it('分镜画布产物目录', () => {
    expect(canvasAssetDir({ kind: 'scene', primary: '1', secondary: '3' })).toBe('assert/scene/1/3/canvas')
  })
})

describe('canvasNodeAssetPath', () => {
  it('节点产物带版本号（旧格式，仅供迁移兼容）', () => {
    expect(canvasNodeAssetPath({ kind: 'scene', primary: '1', secondary: '3' }, 'node-a', 2)).toBe(
      'assert/scene/1/3/canvas/node-a/v2.jpg',
    )
  })
})

describe('canvasNodeOutputPath', () => {
  it('分镜画布节点固定产物路径', () => {
    expect(canvasNodeOutputPath({ kind: 'scene', primary: '1', secondary: '3' }, 'node-a', 'jpg')).toBe(
      'assert/scene/1/3/canvas/node-a/output.jpg',
    )
  })

  it('场景画布（含子场景标签）节点固定产物路径', () => {
    expect(canvasNodeOutputPath({ kind: 'stage', primary: '便利店内部', label: '白天' }, 'n2', 'png')).toBe(
      'assert/stage/便利店内部/canvas/白天/n2/output.png',
    )
  })

  it('扩展名可任意（mp4/flac 由原型决定）', () => {
    expect(canvasNodeOutputPath({ kind: 'scene', primary: '1', secondary: '2' }, 'vg', 'mp4')).toBe(
      'assert/scene/1/2/canvas/vg/output.mp4',
    )
    expect(canvasNodeOutputPath({ kind: 'scene', primary: '1', secondary: '2' }, 'tg', 'flac')).toBe(
      'assert/scene/1/2/canvas/tg/output.flac',
    )
  })
})

describe('isCanvasNodeOutputPath', () => {
  it('识别分镜/场景画布节点固定产物路径（jpg / mp4）', () => {
    expect(isCanvasNodeOutputPath('assert/scene/1/2/canvas/n1/output.jpg')).toBe(true)
    expect(isCanvasNodeOutputPath('assert/scene/12/3/canvas/abc/output.mp4')).toBe(true)
    expect(isCanvasNodeOutputPath('assert/stage/现代商场/canvas/正门入口/n1/output.jpg')).toBe(true)
    expect(isCanvasNodeOutputPath('assert/stage/现代商场/canvas/正门入口/n1/output.mp4')).toBe(true)
  })

  it('统一反斜杠为斜杠后识别', () => {
    expect(isCanvasNodeOutputPath('assert\\scene\\1\\2\\canvas\\n1\\output.jpg')).toBe(true)
  })

  it('拒绝加载节点上传目标（assert/custom/ 下）', () => {
    expect(isCanvasNodeOutputPath('assert/custom/canvas/xxx.jpg')).toBe(false)
  })

  it('拒绝非固定产物路径（版本号/其它扩展名/其它资产）', () => {
    expect(isCanvasNodeOutputPath('assert/scene/1/2/canvas/n1/v2.jpg')).toBe(false)
    expect(isCanvasNodeOutputPath('assert/scene/1/2/canvas/n1/output.png')).toBe(false)
    expect(isCanvasNodeOutputPath('assert/scene/1/2/canvas/n1/output.flac')).toBe(false)
    expect(isCanvasNodeOutputPath('assert/scene/1/2/video/0.mp4')).toBe(false)
    expect(isCanvasNodeOutputPath('assert/character/陈书文/appearance.jpg')).toBe(false)
  })

  it('拒绝非法结构（集数/分镜非正整数、含 ..、非 assert/ 前缀）', () => {
    expect(isCanvasNodeOutputPath('assert/scene/a/b/canvas/n1/output.jpg')).toBe(false)
    expect(isCanvasNodeOutputPath('assert/scene/1/2/canvas/n1/../output.jpg')).toBe(false)
    expect(isCanvasNodeOutputPath('prompt/scene/1/2/canvas.json')).toBe(false)
    expect(isCanvasNodeOutputPath('')).toBe(false)
  })
})
