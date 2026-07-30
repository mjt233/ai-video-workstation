/**
 * useVariantTree — 从平铺的 VariantInfo 列表构建树结构，维护扁平映射表。
 */
import { computed, type Ref } from 'vue'
import type { VariantInfo } from '../api/assets'

export interface VariantTreeNode extends VariantInfo {
  children: VariantTreeNode[]
  depth: number
}

export function useVariantTree(variants: Ref<VariantInfo[]>) {
  /** ID → VariantInfo 扁平映射 */
  const variantMap = computed(() => {
    const map = new Map<string, VariantInfo>()
    for (const v of variants.value) {
      map.set(v.id, v)
    }
    return map
  })

  /** 构建树结构 */
  const tree = computed<VariantTreeNode[]>(() => {
    const map = new Map<string, VariantTreeNode>()
    const roots: VariantTreeNode[] = []

    // 先构造所有节点
    for (const v of variants.value) {
      map.set(v.id, { ...v, children: [], depth: 0 })
    }

    // 建立父子关系
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        const parent = map.get(node.parentId)!
        node.depth = parent.depth + 1
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    }

    return roots
  })

  /** 获取某个变体的所有祖先（从根到自身） */
  function getAncestors(id: string): VariantTreeNode[] {
    for (const root of tree.value) {
      const path: VariantTreeNode[] = []
      if (collectPath(root, id, path)) {
        return path
      }
    }
    return []
  }

  return { variantMap, tree, getAncestors }
}

function collectPath(node: VariantTreeNode, target: string, path: VariantTreeNode[]): boolean {
  path.push(node)
  if (node.id === target) return true
  for (const child of node.children) {
    if (collectPath(child, target, path)) return true
  }
  path.pop()
  return false
}
