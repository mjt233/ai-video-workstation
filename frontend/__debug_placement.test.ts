import { describe, expect, it } from 'vitest'
import { clipboardPlacementOffset } from './src/canvas/pastePlacement'
import { rectsOverlap } from './src/canvas/groups'

describe('debug', () => {
  it('probe', () => {
    const node = { id: 'n', prototypeId: 'text', name: 'n', x: 0, y: 0, width: 100, height: 100, config: {} }
    const blocker = { id: 'other', name: 'other', color: '#1976D2', x: 120, y: 0, width: 100, height: 100 }
    const target = { x: node.x + 130, y: node.y + 130, width: 100, height: 100 }
    console.log('overlap primary/blocker', rectsOverlap(target, blocker))
    const p = clipboardPlacementOffset({ nodes: [node], connections: [], groups: [] }, { nodes: [node], groups: [blocker] })
    console.log('placement', JSON.stringify(p))
    expect(true).toBe(true)
  })
})
