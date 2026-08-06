import { describe, expect, it } from 'vitest'
import { canvasDirectorToProject, projectToCanvasDirector } from './videoDirectorBridge'

const config = {
  duration: 10,
  width: 1080,
  height: 1920,
  fps: 24,
  imageClips: [
    { id: 'ic1', sourceNodeId: 'img1', startOffset: 0, duration: 2 },
    { id: 'ic2', sourceNodeId: 'img2', startOffset: 4, duration: 3 },
  ],
  audioClips: [
    { id: 'ac1', sourceNodeId: 'aud1', startOffset: 1, trimStart: 0.2, trimEnd: 0.3, duration: 5 },
  ],
}

describe('videoDirectorBridge', () => {
  it('config → DirectorProject：sourceNodeId 映射为资产路径', () => {
    const inputs = { img1: 'assert/x/a.png', img2: 'assert/x/b.png', aud1: 'assert/x/c.flac' }
    const project = canvasDirectorToProject(config, inputs)
    expect(project.imageClips[0].path).toBe('assert/x/a.png')
    expect(project.audioClips[0].path).toBe('assert/x/c.flac')
    expect(project.audioClips[0].trimStart).toBe(0.2)
    expect(project.duration).toBe(10)
  })

  it('DirectorProject → config：按 path 反查 sourceNodeId，保留 id 与滑块位置', () => {
    const inputs = { img1: 'assert/x/a.png', img2: 'assert/x/b.png', aud1: 'assert/x/c.flac' }
    const project = canvasDirectorToProject(config, inputs)
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
  })
})
