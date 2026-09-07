/**
 * 资产浏览器拖拽到资产画布：共享拖拽载荷与资产菜单构建逻辑。
 *
 * 左侧资产浏览器（AssetTree）在拖拽开始/结束时写入/清除模块级载荷，
 * 资产画布（AssetCanvas）在画布 drop 时读取载荷并构建菜单分组：
 * - 可拖拽实体：角色 / 子场景 / 道具（目录/分类/根节点不可拖）；
 * - 菜单按媒体类型（图片/音频/视频）分组，仅生成有可用资产的分组；
 * - 点击资产后在释放位置创建对应加载节点，命名规则见各 build* 函数。
 *
 * 纯函数（build* / variantChainName / stem / orderVariants）可脱离文件系统单测；
 * loadCanvasDropMenuGroups 为异步加载器（存在性判定 + API 列举）。
 */

import { ref } from 'vue'
import { existsFs } from '../api/client'
import {
  getCharacterVoiceFile,
  listCharacterVariants,
  listCharacterVoiceVariants,
  listStageVariants,
  type VariantInfo,
  type VoiceVariantInfo,
} from '../api/assets'
import {
  listAudioFilesRecursive,
  listImageFilesRecursive,
  listVideoFilesRecursive,
} from '../components/asset-picker/utils'

/** 可拖拽到画布的资产实体类型 */
export type CanvasDragEntity = 'character' | 'subscene' | 'prop'

/** 媒体类型（菜单分组） */
export type CanvasAssetMedia = 'image' | 'audio' | 'video'

/** 加载节点原型 id（按媒体类型对应） */
export type CanvasAssetLoaderPrototype = 'image-loader' | 'audio-loader' | 'video-loader'

/**
 * 资产浏览器拖拽到资产画布的载荷（AssetTree dragstart 写入，画布 drop 读取）。
 */
export interface CanvasAssetDragPayload {
  /** 实体类型 */
  entity: CanvasDragEntity
  /**
   * 实体显示名（角色名 / 子场景标签 / 道具名）：
   * 作为菜单标题与「基础资产」的节点名（基础资产节点名 = 实体名）。
   */
  entityName: string
  /** 场景名（entity = 'subscene' 时提供，用于推导 assert/stage/{场景}/{标签}.jpg） */
  stageName?: string
  /** 道具分类名（entity = 'prop' 时提供，用于推导 assert/prop/{分类}/{道具}/） */
  category?: string
}

/** dataTransfer 自定义 MIME（备份载荷用；同会话跨组件以模块级 ref 为准） */
export const CANVAS_ASSET_DRAG_MIME = 'application/x-canvas-asset'

/** 模块级共享拖拽载荷（同 SPA 会话内 AssetTree 写、AssetCanvas 读） */
export const canvasDragPayload = ref<CanvasAssetDragPayload | null>(null)

/** 写入共享拖拽载荷（AssetTree dragstart 调用） */
export function setCanvasDragPayload(payload: CanvasAssetDragPayload): void {
  canvasDragPayload.value = payload
}

/** 清除共享拖拽载荷（AssetTree dragend 调用） */
export function clearCanvasDragPayload(): void {
  canvasDragPayload.value = null
}

/** 菜单条目：一个可选资产（点击后创建对应加载节点） */
export interface CanvasDropMenuItem {
  /** 项目内相对路径（写入加载节点 config.assetPath） */
  path: string
  /** 菜单显示名（基础资产 = 实体名；变体/多文件 = 变体名或文件名；详见各 build* 函数注释） */
  label: string
  /** 创建节点时的名称（基础资产 = 实体名；变体/多文件 = 实体名-变体名） */
  nodeName: string
  /** 对应加载节点原型 id */
  prototypeId: CanvasAssetLoaderPrototype
}

/** 菜单分组：一种媒体类型一组；仅在有可用资产时生成 */
export interface CanvasDropMenuGroup {
  /** 媒体类型 */
  media: CanvasAssetMedia
  /** 分组标题（图片/音频/视频） */
  title: string
  /** 该媒体类型的可选资产条目 */
  items: CanvasDropMenuItem[]
}

/** 媒体类型 → 分组标题 */
export const MEDIA_TITLES: Record<CanvasAssetMedia, string> = {
  image: '图片',
  audio: '音频',
  video: '视频',
}

/** 媒体类型 → 加载节点原型 id */
export const MEDIA_LOADER_PROTOTYPES: Record<CanvasAssetMedia, CanvasAssetLoaderPrototype> = {
  image: 'image-loader',
  audio: 'audio-loader',
  video: 'video-loader',
}

/** 道具固定产物文件名（媒体类型 → 文件，作为「基础资产」识别） */
export const PROP_FIXED_FILES: Record<CanvasAssetMedia, string> = {
  image: 'image.jpg',
  audio: 'audio.flac',
  video: 'video.mp4',
}

// ── 纯函数（可单测） ──────────────────────────────────────────────────

/**
 * 从文件名（或路径）取出去扩展名的主干。
 *
 * @param fileName 文件名或路径（如 a.图片.png / tools/剑.jpg）
 * @returns 去掉最后一个扩展名的主干；无扩展名时原样返回
 */
export function stem(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName
  const idx = base.lastIndexOf('.')
  return idx > 0 ? base.slice(0, idx) : base
}

/**
 * 变体深度优先排序（父变体在前、子变体紧随其后，与资产选择器树形展示一致）。
 * parentId 指向不存在变体的孤儿项按原顺序追加在末尾。
 *
 * @param variants 变体列表
 * @returns 排序后的变体列表
 */
export function orderVariants(variants: VariantInfo[]): VariantInfo[] {
  const ordered: VariantInfo[] = []
  const byId = new Map<string, VariantInfo>()
  for (const v of variants) byId.set(v.id, v)
  const visit = (v: VariantInfo): void => {
    ordered.push(v)
    for (const child of variants.filter((x) => x.parentId === v.id)) visit(child)
  }
  for (const v of variants.filter((x) => !x.parentId)) visit(v)
  const visited = new Set(ordered.map((v) => v.id))
  for (const v of variants) {
    if (!visited.has(v.id)) ordered.push(v)
  }
  return ordered
}

/**
 * 计算变体的链式名称：从根变体到自身的 id 链，用 '-' 连接。
 * 单层变体返回自身 id；多级变体（少女 > 战斗）返回「少女-战斗」。
 * 父链断裂（parentId 无对应变体）时返回自身 id。
 *
 * @param variants 变体列表
 * @param v 目标变体
 * @returns 链式名称
 */
export function variantChainName(variants: VariantInfo[], v: VariantInfo): string {
  const byId = new Map<string, VariantInfo>()
  for (const x of variants) byId.set(x.id, x)
  const ids: string[] = [v.id]
  const seen = new Set<string>([v.id])
  let cur: VariantInfo | undefined = v
  while (cur?.parentId) {
    const parent = byId.get(cur.parentId)
    if (!parent || seen.has(parent.id)) break
    seen.add(parent.id)
    ids.unshift(parent.id)
    cur = parent
  }
  return ids.join('-')
}

/**
 * 构建角色图片资产条目：外观基础 + 衍生变体（仅列出已生成图片的变体 hasImage）。
 * - 基础：菜单显示实体名（角色名），节点名 = 角色名；
 * - 变体：菜单显示变体链式名称，节点名 = 角色名-变体链名。
 *
 * @param entityName 角色名
 * @param appearancePath 外观图路径（null = 未生成，跳过基础条目）
 * @param variants 按 listCharacterVariants 返回的变体列表
 * @returns 菜单条目列表
 */
export function buildCharacterImageItems(
  entityName: string,
  appearancePath: string | null,
  variants: VariantInfo[],
): CanvasDropMenuItem[] {
  const items: CanvasDropMenuItem[] = []
  if (appearancePath) {
    items.push({
      path: appearancePath,
      label: entityName,
      nodeName: entityName,
      prototypeId: 'image-loader',
    })
  }
  for (const v of orderVariants(variants)) {
    if (!v.hasImage) continue
    const chain = variantChainName(variants, v)
    items.push({
      path: v.imagePath,
      label: chain,
      nodeName: `${entityName}-${chain}`,
      prototypeId: 'image-loader',
    })
  }
  return items
}

/**
 * 构建角色音频资产条目：基础音色 + 声音变体（仅列出已生成音频的变体）。
 * - 基础：菜单显示实体名（角色名），节点名 = 角色名；
 * - 声音变体：菜单显示变体 id，节点名 = 角色名-变体id。
 *
 * @param entityName 角色名
 * @param voicePath 基础音色路径（null = 未生成，跳过基础条目）
 * @param voiceVariants 按 listCharacterVoiceVariants 返回的声音变体列表
 * @returns 菜单条目列表
 */
export function buildCharacterAudioItems(
  entityName: string,
  voicePath: string | null,
  voiceVariants: VoiceVariantInfo[],
): CanvasDropMenuItem[] {
  const items: CanvasDropMenuItem[] = []
  if (voicePath) {
    items.push({
      path: voicePath,
      label: entityName,
      nodeName: entityName,
      prototypeId: 'audio-loader',
    })
  }
  for (const v of voiceVariants) {
    if (!v.hasAudio || !v.audioPath) continue
    items.push({
      path: v.audioPath,
      label: v.id,
      nodeName: `${entityName}-${v.id}`,
      prototypeId: 'audio-loader',
    })
  }
  return items
}

/**
 * 构建子场景图片资产条目：基础场景图 + 衍生变体（仅列出已生成图片的变体 hasImage）。
 * - 基础：菜单显示实体名（子场景标签），节点名 = 子场景标签；
 * - 变体：菜单显示变体链式名称，节点名 = 子场景标签-变体链名。
 *
 * @param entityName 子场景标签
 * @param basePath 基础场景图路径（null = 未生成，跳过基础条目）
 * @param variants 按 listStageVariants 返回的变体列表
 * @returns 菜单条目列表
 */
export function buildSubsceneImageItems(
  entityName: string,
  basePath: string | null,
  variants: VariantInfo[],
): CanvasDropMenuItem[] {
  const items: CanvasDropMenuItem[] = []
  if (basePath) {
    items.push({
      path: basePath,
      label: entityName,
      nodeName: entityName,
      prototypeId: 'image-loader',
    })
  }
  for (const v of orderVariants(variants)) {
    if (!v.hasImage) continue
    const chain = variantChainName(variants, v)
    items.push({
      path: v.imagePath,
      label: chain,
      nodeName: `${entityName}-${chain}`,
      prototypeId: 'image-loader',
    })
  }
  return items
}

/**
 * 构建道具指定媒体类型的资产条目：
 * - 固定产物（image.jpg / audio.flac / video.mp4）优先：菜单显示实体名（道具名），节点名 = 道具名；
 * - 其它文件按中文名排序：菜单显示文件名（含扩展名），节点名 = 道具名-文件名主干。
 *
 * @param entityName 道具名
 * @param files 道具目录下该媒体类型的全部文件路径（相对项目根）
 * @param media 媒体类型
 * @returns 菜单条目列表
 */
export function buildPropItems(
  entityName: string,
  files: string[],
  media: CanvasAssetMedia,
): CanvasDropMenuItem[] {
  const fixed = PROP_FIXED_FILES[media]
  const sorted = [...files].sort((a, b) => {
    const fa = a.split('/').pop() ?? a
    const fb = b.split('/').pop() ?? b
    if (fa === fixed) return -1
    if (fb === fixed) return 1
    return fa.localeCompare(fb, 'zh')
  })
  return sorted.map((f) => {
    const fileName = f.split('/').pop() ?? f
    const isFixed = fileName === fixed
    return {
      path: f,
      label: isFixed ? entityName : fileName,
      nodeName: isFixed ? entityName : `${entityName}-${stem(fileName)}`,
      prototypeId: MEDIA_LOADER_PROTOTYPES[media],
    }
  })
}

// ── 异步加载器（文件系统存在性判定 + 资产 API 列举） ────────────────────

/**
 * 过滤掉 history 归档目录中的路径（重复生成/覆盖时的历史版本，不属于可选资产）。
 *
 * @param files 文件路径列表（相对项目根）
 * @returns 去除含 history 段的路径
 */
export function excludeHistoryPaths(files: string[]): string[] {
  return files.filter((p) => !p.split('/').includes('history'))
}

/**
 * 构建菜单分组：按实体类型列举图片/音频/视频资产，
 * 仅返回有可用资产的分组（无资产类型的菜单行整体隐藏）。
 * 各分区内部失败时降级为跳过该分区并向控制台输出日志（不影响其余分区）。
 *
 * @param project 项目名
 * @param payload 拖拽载荷
 * @returns 菜单分组列表（可能为空 = 实体暂无任何可用资产）
 */
export async function loadCanvasDropMenuGroups(
  project: string,
  payload: CanvasAssetDragPayload,
): Promise<CanvasDropMenuGroup[]> {
  const groups: CanvasDropMenuGroup[] = []

  if (payload.entity === 'character') {
    const name = payload.entityName
    // 图片：外观基础 + 衍生变体
    const imageItems = await loadCharacterImages(project, name)
    if (imageItems.length) groups.push({ media: 'image', title: MEDIA_TITLES.image, items: imageItems })
    // 音频：基础音色 + 声音变体
    const audioItems = await loadCharacterAudios(project, name)
    if (audioItems.length) groups.push({ media: 'audio', title: MEDIA_TITLES.audio, items: audioItems })
    return groups
  }

  if (payload.entity === 'subscene') {
    const stage = payload.stageName ?? ''
    const label = payload.entityName
    const imageItems = await loadSubsceneImages(project, stage, label)
    if (imageItems.length) groups.push({ media: 'image', title: MEDIA_TITLES.image, items: imageItems })
    return groups
  }

  // 道具：图片/音频/视频三类分别列举
  const category = payload.category ?? ''
  const propName = payload.entityName
  const dir = `assert/prop/${category}/${propName}`
  for (const media of ['image', 'audio', 'video'] as const) {
    const items = await loadPropMediaItems(project, dir, payload.entityName, media)
    if (items.length) groups.push({ media, title: MEDIA_TITLES[media], items })
  }
  return groups
}

/** 角色图片分区：外观基础（存在性判定）+ 衍生变体 */
async function loadCharacterImages(project: string, name: string): Promise<CanvasDropMenuItem[]> {
  const appearancePath = `assert/character/${name}/appearance.jpg`
  const existsAppearance = await existsFs(project, appearancePath)
  let variants: VariantInfo[] = []
  try {
    const res = await listCharacterVariants(project, name)
    variants = res.variants
  } catch (err) {
    // 单个角色变体列表读取失败：降级为仅外观基础，不影响其它分区
    console.error(`[asset-drop] 读取角色「${name}」衍生变体失败：`, err)
  }
  return buildCharacterImageItems(name, existsAppearance ? appearancePath : null, variants)
}

/** 角色音频分区：基础音色（实际路径探测）+ 声音变体 */
async function loadCharacterAudios(project: string, name: string): Promise<CanvasDropMenuItem[]> {
  let voicePath: string | null = null
  try {
    const res = await getCharacterVoiceFile(project, name)
    voicePath = res.path
  } catch (err) {
    // 基础音色读取失败：降级为仅声音变体，不影响其它分区
    console.error(`[asset-drop] 读取角色「${name}」基础音色失败：`, err)
  }
  let voiceVariants: VoiceVariantInfo[] = []
  try {
    const res = await listCharacterVoiceVariants(project, name)
    voiceVariants = res.variants
  } catch (err) {
    // 声音变体列表读取失败：降级为仅基础音色，不影响其它分区
    console.error(`[asset-drop] 读取角色「${name}」声音变体失败：`, err)
  }
  return buildCharacterAudioItems(name, voicePath, voiceVariants)
}

/** 子场景图片分区：基础场景图（存在性判定）+ 衍生变体 */
async function loadSubsceneImages(
  project: string,
  stage: string,
  label: string,
): Promise<CanvasDropMenuItem[]> {
  const basePath = `assert/stage/${stage}/${label}.jpg`
  const existsBase = await existsFs(project, basePath)
  let variants: VariantInfo[] = []
  try {
    const res = await listStageVariants(project, stage, label)
    variants = res.variants
  } catch (err) {
    // 子场景变体列表读取失败：降级为仅基础场景图，不影响其它分区
    console.error(`[asset-drop] 读取子场景「${stage}/${label}」衍生变体失败：`, err)
  }
  return buildSubsceneImageItems(label, existsBase ? basePath : null, variants)
}

/** 道具媒体分区：递归列举目录下该媒体类型的全部文件，并排除 history 归档目录 */
async function loadPropMediaItems(
  project: string,
  dir: string,
  propName: string,
  media: CanvasAssetMedia,
): Promise<CanvasDropMenuItem[]> {
  const files = media === 'image'
    ? await listImageFilesRecursive(project, dir)
    : media === 'audio'
      ? await listAudioFilesRecursive(project, dir)
      : await listVideoFilesRecursive(project, dir)
  // 目录下的 history/ 是重复生成/覆盖时归档的历史版本，不属于可选资产
  return buildPropItems(propName, excludeHistoryPaths(files), media)
}
