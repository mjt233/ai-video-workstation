import { describe, expect, it } from 'vitest'
import { canvasDirectorToProject, projectToCanvasDirector } from './videoDirectorBridge'

const clips = {
  imageClips: [
    { id: 'ic1', sourceNodeId: 'img1', startOffset: 0, duration: 2 },
    { id: 'ic2', sourceNodeId: 'img2', startOffset: 4, duration: 3 },
  ],
  audioClips: [
    { id: 'ac1', sourceNodeId: 'aud1', startOffset: 1, trimStart: 0.2, trimEnd: 0.3, duration: 5 },
  ],
}

/** 输出规格（由 readVideoSpec 读取后传入，不再来自 config.director） */
const spec = { duration: 10, width: 1080, height: 1920, fps: 24 }

describe('videoDirectorBridge', () => {
  it('素材 + 规格 → DirectorProject：sourceNodeId 映射为资产路径，规格原样带入', () => {
    const inputs = { img1: 'assert/x/a.png', img2: 'assert/x/b.png', aud1: 'assert/x/c.flac' }
    const project = canvasDirectorToProject(clips, inputs, spec)
    expect(project.imageClips[0].path).toBe('assert/x/a.png')
    expect(project.audioClips[0].path).toBe('assert/x/c.flac')
    expect(project.audioClips[0].trimStart).toBe(0.2)
    expect(project.duration).toBe(10)
    expect(project.width).toBe(1080)
    expect(project.height).toBe(1920)
    expect(project.fps).toBe(24)
  })

  it('DirectorProject → 素材：按 path 反查 sourceNodeId，保留 id 与滑块位置，且不含规格字段', () => {
    const inputs = { img1: 'assert/x/a.png', img2: 'assert/x/b.png', aud1: 'assert/x/c.flac' }
    const project = canvasDirectorToProject(clips, inputs, spec)
    // 用户拖动 imageClip[1] 的 startOffset
    project.imageClips[1].startOffset = 5.5
    const back = projectToCanvasDirector(project, {
      'assert/x/a.png': 'img1',
      'assert/x/b.png': 'img2',
      'assert/x/c.flac': 'aud1',
    })
    expect(back.imageClips[1].sourceNodeId).toBe('img2')
    expect(back.imageClips[1].startOffset).toBe(5.5)
    expect(back.imageClips[1].id).toBe('ic2')
    expect(back.audioClips[0].sourceNodeId).toBe('aud1')
    // 规格不由本函数回写（时间轴编辑不影响时长/宽高/帧率）
    expect(Object.keys(back)).toEqual(['imageClips', 'audioClips'])
  })
})
