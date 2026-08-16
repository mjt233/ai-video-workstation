/**
 * 自动搭画布组合式：根据分镜 stage.json 引用或子场景变体结构一键搭建画布。
 * 幂等应用（已存在节点只补缺连线）；纯函数在 canvas/autobuild.ts。
 */

import { ref } from 'vue'
import type { ComputedRef } from 'vue'
import type { CanvasTarget } from '../../../canvas/api'
import {
  buildAutoCanvas,
  buildShotRefsFromStage,
  buildSubSceneAutoCanvas,
  normalizeLegacyVariantPath,
  type AutoBuildRef,
  type StageVariantRef,
} from '../../../canvas/autobuild'
import { copyFs, existsFs, readFs, type DirResponse } from '../../../api/client'
import type { CanvasStoreApi, NodeMap, ShowSnackbar } from './types'

/** useCanvasAutobuild 参数 */
export interface UseCanvasAutobuildOptions {
  /** 画布数据 store（批量应用节点/连线、修复历史数据） */
  store: CanvasStoreApi
  /** 节点 id → 节点数据索引 */
  nodeMap: NodeMap
  /** 项目名 */
  project: string
  /** 当前画布目标（决定引用收集方式与产物目录） */
  target: ComputedRef<CanvasTarget>
  /** 操作反馈提示 */
  showSnackbar: ShowSnackbar
}

/**
 * 自动搭画布组合式。
 *
 * @param options 依赖注入参数
 * @returns 自动搭画布状态与触发函数
 */
export function useCanvasAutobuild(options: UseCanvasAutobuildOptions) {
  const { store, nodeMap, project, target, showSnackbar } = options

  /** 自动搭画布进行中标记（工具栏按钮 loading） */
  const autoBuilding = ref(false)

  /**
   * 修复旧版自动搭画布产生的错误变体路径加载节点（历史数据迁移）。
   * 旧代码把 `场景/标签@变体` 拼成 `assert/stage/{场景}/{标签}@{变体}.jpg`，
   * 规范路径为 `assert/stage/{场景}/variants/{标签}/{变体}.jpg`。
   * 仅当规范路径未被其他节点占用时修复，避免重复。
   */
  function repairLegacyVariantLoaders(): void {
    for (const node of [...store.nodes.value]) {
      const ap = typeof node.config.assetPath === 'string' ? node.config.assetPath : ''
      const legacy = normalizeLegacyVariantPath(ap)
      if (!legacy) continue
      const alreadyPresent = store.nodes.value.some(
        (n) => n.id !== node.id && n.config.assetPath === legacy.canonical,
      )
      if (alreadyPresent) continue
      store.updateNode(node.id, { config: { ...node.config, assetPath: legacy.canonical } })
    }
  }

  /**
   * 收集自动搭画布的资产引用：
   * - 分镜画布：读 stage.json 提取角色/场景引用（含变体/custom），并异步解析 prev
   * - 场景画布：见 collectStageBuild
   *
   * @returns 锚点引用列表
   */
  async function collectRefs(): Promise<AutoBuildRef[]> {
    const t = target.value
    if (t.kind === 'scene') {
      if (!t.episode || !t.shot) return []
      const raw = await readFs(project, `prompt/scene/${t.episode}/${t.shot}/stage.json`)
      const defs = Array.isArray(raw) ? (raw as unknown[]) : []
      const refs = buildShotRefsFromStage(defs)
      // prev：同集上一分镜最后一项 → assert/scene/{ep}/{shot-1}/stage/{last}.jpg
      const shotNum = Number(t.shot)
      const hasPrev = defs.some((d) => {
        const base = (d as { 基础场景?: string })?.基础场景
        return typeof base === 'string' && base.trim() === 'prev'
      })
      if (hasPrev && Number.isInteger(shotNum) && shotNum > 1) {
        const prevShot = String(shotNum - 1)
        try {
          const prevRaw = await readFs(project, `prompt/scene/${t.episode}/${prevShot}/stage.json`)
          if (Array.isArray(prevRaw) && prevRaw.length > 0) {
            refs.push({
              assetPath: `assert/scene/${t.episode}/${prevShot}/stage/${prevRaw.length - 1}.jpg`,
              label: '上一分镜场景图',
            })
          }
        } catch {
          // 读不到上一分镜定义则跳过 prev
        }
      }
      return refs
    }
    return []
  }

  /**
   * 收集场景画布自动搭所需数据：子场景基础图路径 + 该子场景全部衍生变体元数据。
   * 变体元数据：prompt/stage/{stage}/variants/{label}/{id}.json（desc/parentId/refs）。
   *
   * @returns 基础图路径与变体列表（variants 目录不存在时为空的变体列表）
   */
  async function collectStageBuild(): Promise<{ baseAssetPath: string; variants: StageVariantRef[] }> {
    const t = target.value
    const stage = t.stage ?? ''
    const label = t.label ?? ''
    const baseAssetPath = `assert/stage/${stage}/${label}.jpg`
    const variants: StageVariantRef[] = []
    const variantsDir = `prompt/stage/${stage}/variants/${label}`
    try {
      const dir = (await readFs(project, variantsDir)) as DirResponse
      const metaFiles = (dir?.entries ?? []).filter((e) => e.type === 'file' && e.name.endsWith('.json'))
      for (const f of metaFiles) {
        const id = f.name.replace(/\.json$/, '')
        try {
          const meta = (await readFs(project, `${variantsDir}/${f.name}`)) as {
            desc?: string
            parentId?: string
            refs?: string[]
          }
          // 变体是否已有生成图（决定自动搭画布时是否复制既有图片作为节点当前产物）
          const hasImage = await existsFs(
            project,
            `assert/stage/${stage}/variants/${label}/${id}.jpg`,
          )
          variants.push({
            id,
            desc: String(meta?.desc ?? ''),
            parentId: typeof meta?.parentId === 'string' ? meta.parentId : undefined,
            refs: Array.isArray(meta?.refs) ? (meta.refs as string[]) : [],
            hasImage,
          })
        } catch {
          // 单个变体元数据读取失败则跳过
        }
      }
    } catch {
      // variants 目录不存在 → 无变体，只搭基础图
    }
    return { baseAssetPath, variants }
  }

  /**
   * 收集生成节点 prompt 初稿（仅分镜画布；场景画布由各变体 desc 提供）。
   *
   * @returns prompt 文本
   */
  async function collectPrompt(): Promise<string> {
    const t = target.value
    if (t.kind !== 'scene' || !t.episode || !t.shot) return ''
    try {
      const raw = (await readFs(project, `prompt/scene/${t.episode}/${t.shot}/overview.json`)) as {
        visual?: unknown
      }
      return typeof raw?.visual === 'string' ? raw.visual : ''
    } catch {
      return ''
    }
  }

  /** 触发自动搭画布：分镜画布按 stage.json 引用；场景画布按子场景变体结构 */
  async function autoBuild(): Promise<void> {
    if (autoBuilding.value) return
    autoBuilding.value = true
    try {
      if (target.value.kind === 'stage') {
        const t = target.value
        const { baseAssetPath, variants } = await collectStageBuild()
        const result = buildSubSceneAutoCanvas(
          store.data.value,
          t.label ?? '',
          baseAssetPath,
          variants,
          80,
          80,
        )
        // 变体已有生成图：把既有图片复制到节点固定产物路径 output.jpg（复制失败不阻塞搭画布）
        for (const node of result.nodes) {
          if (node.prototypeId !== 'image-generate') continue
          const autoRef = typeof node.config.autoRef === 'string' ? node.config.autoRef : ''
          const vId = autoRef.slice(autoRef.lastIndexOf('@') + 1)
          if (!vId) continue
          try {
            await copyFs(
              project,
              `assert/stage/${t.stage ?? ''}/variants/${t.label ?? ''}/${vId}.jpg`,
              `assert/stage/${t.stage ?? ''}/canvas/${t.label ?? ''}/${node.id}/output.jpg`,
            )
          } catch {
            // 复制失败忽略（节点仍保留，用户可自行重新生成）
          }
        }
        store.applyNodes(result.nodes, result.connections)
        const anchorCount = result.nodes.filter((n) => n.prototypeId === 'image-loader').length
        showSnackbar(`已搭建 ${anchorCount} 个锚点节点`, 'success')
        return
      }
      const refs = await collectRefs()
      const prompt = await collectPrompt()
      // 修复旧版错误路径的加载节点（历史数据），避免与新规范路径重复
      repairLegacyVariantLoaders()
      const result = buildAutoCanvas(store.data.value, refs, prompt)
      store.applyNodes(result.nodes, result.connections)
      const g = nodeMap.value[result.generateNodeId]
      if (g) {
        store.updateNode(g.id, { config: { ...g.config, prompt: result.prompt } })
      }
      const anchorCount = result.nodes.filter((n) => n.prototypeId === 'image-loader').length
      showSnackbar(`已搭建 ${anchorCount} 个锚点节点`, 'success')
    } catch (e) {
      showSnackbar(e instanceof Error ? e.message : '自动搭画布失败', 'error')
    } finally {
      autoBuilding.value = false
    }
  }

  return { autoBuilding, autoBuild }
}
