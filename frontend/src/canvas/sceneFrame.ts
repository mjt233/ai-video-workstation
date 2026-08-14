/**
 * 「设为分镜场景图」纯函数：场景帧列表构建与新帧定义推导。
 * 与网络/DOM 解耦（接收输入资产信息与现有场景帧定义），便于单元测试。
 */

import { deriveStageRefFromAssetPath } from './autobuild'
import type { CanvasInputInfo } from './generate'

/** 分镜场景帧选项（设为分镜场景图对话框展示项） */
export interface SceneFrameOption {
  /** 帧下标（对应 stage.json 数组位置与产物文件 stage/{index}.jpg） */
  index: number
  /** 展示名（基础场景 > prompt > 「分镜场景图 N」） */
  label: string
  /** 预览 URL（带 ?t= 防缓存参数） */
  imageUrl: string
  /** 预览图加载失败标记（404 时显示占位） */
  broken: boolean
}

/** 新场景帧定义（stage.json 单帧结构；服务端约束：基础场景必填，有登场角色时必须填 prompt） */
export interface SceneFrameBody {
  /** 基础场景引用（场景名/标签 或 prev） */
  基础场景: string
  /** 登场角色列表 */
  登场角色: string[]
  /** 生成提示词 */
  prompt: string
}

/**
 * 把 stage.json 场景帧定义映射为对话框展示选项。
 * label 优先级：基础场景 > 非空 prompt > 「分镜场景图 N」。
 *
 * @param defs 现有场景帧定义（可为空数组）
 * @param urlOf 由帧下标生成预览 URL 的函数（调用方拼项目/集数/分镜与防缓存参数）
 * @returns 场景帧选项列表
 */
export function buildSceneFrameOptions(
  defs: { 基础场景?: string; prompt?: string }[],
  urlOf: (index: number) => string,
): SceneFrameOption[] {
  return defs.map((d, i) => {
    const label = d.基础场景 || (typeof d.prompt === 'string' && d.prompt ? d.prompt : `分镜场景图 ${i + 1}`)
    return { index: i, label, imageUrl: urlOf(i), broken: false }
  })
}

/**
 * 从生成节点的输入推导新场景帧的 stage.json 定义（无可用基础场景时返回 null）。
 * 基础场景优先取输入图中的 `assert/stage/{场景}/{标签}`（含变体路径），
 * 否则复用现有帧中第一个非空基础场景；登场角色取自 `assert/character/{角色}` 输入（去重）。
 * 有登场角色但无 prompt 时清空角色（服务端校验约束）。
 *
 * @param inputs 生成节点的输入资产信息
 * @param stageDefs 现有场景帧定义（基础场景回退来源）
 * @param nodePrompt 生成节点 config.prompt（原始值，函数内做类型收敛）
 * @returns 新帧定义或 null
 */
export function deriveStageFrameBody(
  inputs: CanvasInputInfo[],
  stageDefs: { 基础场景?: string }[],
  nodePrompt: unknown,
): SceneFrameBody | null {
  let baseScene = ''
  const characters: string[] = []
  for (const inp of inputs) {
    if (inp.path.startsWith('assert/stage/')) {
      const ref = deriveStageRefFromAssetPath(inp.path)
      if (ref && !baseScene) baseScene = ref
    } else if (inp.path.startsWith('assert/character/')) {
      const name = inp.path.slice('assert/character/'.length).split('/')[0]
      if (name && !characters.includes(name)) characters.push(name)
    }
  }
  if (!baseScene) {
    const first = stageDefs.find((d) => d.基础场景 && d.基础场景.trim())
    baseScene = first?.基础场景?.trim() ?? ''
  }
  if (!baseScene) return null
  const prompt = typeof nodePrompt === 'string' ? nodePrompt : ''
  // 有登场角色时必须提供 prompt，否则清空角色（服务端校验约束）
  const chars = characters.length > 0 && !prompt.trim() ? [] : characters
  return { 基础场景: baseScene, 登场角色: chars, prompt }
}
