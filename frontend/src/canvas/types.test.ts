import { describe, expect, it, vi } from 'vitest'
import { CANVAS_SCHEMA_VERSION, createCanvasData, migrateCanvasData, newId, nextVersion } from './types'

describe('createCanvasData', () => {
  it('创建空画布且 version 为当前 schema', () => {
    const data = createCanvasData('scene')
    expect(data.kind).toBe('scene')
    expect(data.version).toBe(CANVAS_SCHEMA_VERSION)
    expect(data.nodes).toEqual([])
    expect(data.connections).toEqual([])
    expect(data.groups).toEqual([])
    expect(data.createdAt).toBeTruthy()
  })

  it('stage 类型同样生效', () => {
    expect(createCanvasData('stage').kind).toBe('stage')
  })
})

describe('nextVersion', () => {
  it('空历史返回 1', () => {
    expect(nextVersion([])).toBe(1)
  })

  it('3 条历史返回 4', () => {
    expect(nextVersion([{ version: 1 }, { version: 2 }, { version: 3 }])).toBe(4)
  })
})

describe('newId', () => {
  it('连续生成 id 不重复', () => {
    const ids = new Set([newId(), newId(), newId()])
    expect(ids.size).toBe(3)
  })
})

describe('migrateCanvasData', () => {
  it('合法数据原样迁移', () => {
    const raw = {
      version: 1,
      kind: 'scene',
      nodes: [{ id: 'a', prototypeId: 'text', name: 'x', x: 0, y: 0, width: 10, height: 10, config: {} }],
      connections: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const data = migrateCanvasData(raw)
    expect(data.nodes).toHaveLength(1)
    expect(data.connections).toEqual([])
  })

  it('非对象抛出错误', () => {
    expect(() => migrateCanvasData(null)).toThrow()
    expect(() => migrateCanvasData('str')).toThrow()
  })

  it('缺失字段补齐默认值', () => {
    const data = migrateCanvasData({ kind: 'stage' })
    expect(data.version).toBe(CANVAS_SCHEMA_VERSION)
    expect(data.nodes).toEqual([])
    expect(data.connections).toEqual([])
    expect(data.groups).toEqual([])
    expect(data.createdAt).toBeTruthy()
  })

  // ── schema v2：持久分组（groups[]）─────────────────────────

  it('schema 版本为 2', () => {
    expect(CANVAS_SCHEMA_VERSION).toBe(2)
  })

  it('旧数据（无 groups 字段）迁移补空数组', () => {
    const data = migrateCanvasData({ version: 1, kind: 'scene', nodes: [], connections: [] })
    expect(data.version).toBe(2)
    expect(data.groups).toEqual([])
  })

  it('合法分组原样迁移（只保留已知字段）', () => {
    const data = migrateCanvasData({
      kind: 'scene',
      groups: [{ id: 'g1', name: '分组 1', color: '#1976D2', x: 1, y: 2, width: 3, height: 4, nodeIds: ['n1'] }],
    })
    expect(data.groups).toEqual([{ id: 'g1', name: '分组 1', color: '#1976D2', x: 1, y: 2, width: 3, height: 4 }])
  })

  it('非法分组项被丢弃并输出警告（不抛错）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const data = migrateCanvasData({
      kind: 'scene',
      groups: [{ id: 'ok', name: 'n', color: '#000', x: 0, y: 0, width: 10, height: 10 }, { id: 'bad' }, null],
    })
    expect(data.groups).toHaveLength(1)
    expect(data.groups[0].id).toBe('ok')
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('groups 非数组时按空数组处理并输出警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const data = migrateCanvasData({ kind: 'scene', groups: 'oops' })
    expect(data.groups).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
