import { describe, expect, it } from 'vitest'
import {
  FALLBACK_WORKFLOW_TYPES,
  normalizeWorkflowType,
  workflowEntryTypes,
  workflowTypeColor,
  workflowTypeLabel,
  WORKFLOW_TYPE_META,
} from './workflow-types'

describe('workflow-type 工具', () => {
  it('类型 id 返回中文标签与颜色', () => {
    expect(workflowTypeLabel('text-to-image')).toBe('文生图')
    expect(workflowTypeColor('image-to-video')).toBe('info')
    expect(workflowTypeLabel('text-generation')).toBe('文本生成')
    expect(workflowTypeColor('text-generation')).toBe('teal')
    expect(workflowTypeLabel('unknown-type')).toBe('unknown-type')
    expect(workflowTypeColor('unknown-type')).toBe('default')
  })

  it('normalizeWorkflowType：id 原样保留', () => {
    expect(normalizeWorkflowType('text-to-image')).toBe('text-to-image')
    expect(normalizeWorkflowType('image-edit')).toBe('image-edit')
    expect(normalizeWorkflowType('text-generation')).toBe('text-generation')
  })

  it('normalizeWorkflowType：中文标签映射回类型 id（兼容旧数据）', () => {
    expect(normalizeWorkflowType('文生图')).toBe('text-to-image')
    expect(normalizeWorkflowType('图片编辑')).toBe('image-edit')
    expect(normalizeWorkflowType('图生视频')).toBe('image-to-video')
    expect(normalizeWorkflowType('TTS音色设计')).toBe('tts-voice-design')
    expect(normalizeWorkflowType('TTS音色克隆')).toBe('tts-voice-clone')
    expect(normalizeWorkflowType('文本生成')).toBe('text-generation')
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
      'text-generation',
    ])
    // 兜底类型清单与元信息表保持一致（下拉拉取失败时仍能展示中文标签）
    expect(Object.keys(WORKFLOW_TYPE_META).sort()).toEqual([...FALLBACK_WORKFLOW_TYPES].sort())
  })

  it('workflowEntryTypes：多类型条目返回完整清单（并排多 chip）', () => {
    expect(workflowEntryTypes({ type: 'text-to-image', types: ['text-to-image', 'image-edit'] }))
      .toEqual(['text-to-image', 'image-edit'])
  })

  it('workflowEntryTypes：单类型 / 旧响应回退 [type]，无类型返回空数组', () => {
    expect(workflowEntryTypes({ type: 'image-edit' })).toEqual(['image-edit'])
    // 空数组视为未声明，回退 type（服务端恒不返回空数组，这里做防御）
    expect(workflowEntryTypes({ type: 'image-edit', types: [] })).toEqual(['image-edit'])
    expect(workflowEntryTypes({})).toEqual([])
  })
})
