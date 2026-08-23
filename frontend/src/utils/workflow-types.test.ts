import { describe, expect, it } from 'vitest'
import {
  normalizeWorkflowType,
  workflowTypeColor,
  workflowTypeLabel,
  WORKFLOW_TYPE_META,
} from './workflow-types'

describe('workflow-type 工具', () => {
  it('类型 id 返回中文标签与颜色', () => {
    expect(workflowTypeLabel('text-to-image')).toBe('文生图')
    expect(workflowTypeColor('image-to-video')).toBe('info')
    expect(workflowTypeLabel('unknown-type')).toBe('unknown-type')
    expect(workflowTypeColor('unknown-type')).toBe('default')
  })

  it('normalizeWorkflowType：id 原样保留', () => {
    expect(normalizeWorkflowType('text-to-image')).toBe('text-to-image')
    expect(normalizeWorkflowType('image-edit')).toBe('image-edit')
  })

  it('normalizeWorkflowType：中文标签映射回类型 id（兼容旧数据）', () => {
    expect(normalizeWorkflowType('文生图')).toBe('text-to-image')
    expect(normalizeWorkflowType('图片编辑')).toBe('image-edit')
    expect(normalizeWorkflowType('图生视频')).toBe('image-to-video')
    expect(normalizeWorkflowType('TTS音色设计')).toBe('tts-voice-design')
    expect(normalizeWorkflowType('TTS音色克隆')).toBe('tts-voice-clone')
  })

  it('normalizeWorkflowType：未知值原样返回', () => {
    expect(normalizeWorkflowType('unknown')).toBe('unknown')
  })

  it('WORKFLOW_TYPE_META 覆盖全部内置类型', () => {
    expect(Object.keys(WORKFLOW_TYPE_META)).toEqual([
      'text-to-image',
      'image-edit',
      'image-to-video',
      'tts-voice-design',
      'tts-voice-clone',
    ])
  })
})
