/**
 * 资产选择器（asset-picker）共享类型定义。
 *
 * 供 AssetPickerDialog 及各页签子组件（EntityAssetTree、CustomAssetsGrid、
 * SceneStagePicker、AudioPicker 等）复用，避免类型在各组件间重复声明。
 */

/** 资产分类标签 */
export type AssetTab = 'character' | 'stage' | 'prop' | 'custom' | 'audio' | 'scene-stage' | 'video'

/**
 * 道具页签媒体过滤类型：
 * 加载图片节点 → image（只列道具图片产物）、加载视频 → video、加载音频 → audio；
 * 道具详情页关联资产选择 → image（图生视频输入为图片）。
 */
export type PropMediaFilter = 'image' | 'video' | 'audio'

/** 树形资产条目（角色/场景树、自定义资产网格、分镜场景图等通用条目） */
export interface AssetItem {
  /** 资产相对路径（project 根） */
  path: string
  /** 显示标签 */
  label: string
  /** 缩略图直链（音频条目为空） */
  thumbnail: string
  /** 缩进层级（0 = 根） */
  depth: number
  /** 分区标题（如「自定义资产」「音色」）；仅 header 条目使用 */
  section?: string
  /** 是否为分区标题条目（不可选择、不渲染缩略图） */
  header?: boolean
  /** 是否为音频条目（渲染音频图标行而非图片缩略图） */
  audio?: boolean
  /** 是否为视频条目（渲染视频图标行而非图片缩略图） */
  video?: boolean
}

/** 角色/场景页签左侧实体列表条目 */
export interface EntityItem {
  /** 实体唯一键（角色名/场景名） */
  key: string
  /** 实体显示名称 */
  name: string
}

/** 台词音频条目：一条台词 + 其语音文件是否存在 */
export interface VoiceLineItem {
  /** script.json 中的下标 */
  index: number
  /** 角色名 */
  角色名: string
  /** 台词内容 */
  台词: string
  /** 对应语音文件是否存在（仅存在的可选） */
  hasFile: boolean
  /** 语音文件相对路径 */
  path: string
  /** 可加入已选列表的资产条目 */
  item: AssetItem
}
