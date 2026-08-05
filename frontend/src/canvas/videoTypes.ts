/**
 * 【生成视频】节点的配置 schema 类型。
 * 与画布持久化（canvas.json）一一对应。
 */

/** 视频生成模式（与后端 VideoGenerateMode 对齐） */
export type VideoGenerateMode = 'director' | 'first-last-frame' | 'reference'

/** 导演台图片轨素材块（以 sourceNodeId 引用连线输入） */
export interface CanvasDirectorImageClip {
  /** 前端编辑状态唯一标识 */
  id: string
  /** 来源节点 id（连线输入） */
  sourceNodeId: string
  /** 起始偏移（秒） */
  startOffset: number
  /** 轨道占位时长（秒） */
  duration: number
}

/** 导演台音频轨素材块（以 sourceNodeId 引用连线输入） */
export interface CanvasDirectorAudioClip {
  /** 前端编辑状态唯一标识 */
  id: string
  /** 来源节点 id（连线输入） */
  sourceNodeId: string
  /** 起始偏移（秒） */
  startOffset: number
  /** 裁剪起点（秒，0 表示不裁剪） */
  trimStart: number
  /** 裁剪终点（秒，0 表示不裁剪） */
  trimEnd: number
  /** 轨道占位时长（秒） */
  duration: number
}

/** 导演台配置（存于节点 config.director） */
export interface CanvasDirectorConfig {
  /** 成片时长（秒） */
  duration: number
  /** 输出宽度（像素） */
  width: number
  /** 输出高度（像素） */
  height: number
  /** 帧率 */
  fps: number
  /** 图片轨素材块列表 */
  imageClips: CanvasDirectorImageClip[]
  /** 音频轨素材块列表 */
  audioClips: CanvasDirectorAudioClip[]
}

/** 参考模式输出规格（存于节点 config） */
export interface CanvasVideoSpec {
  /** 输出分辨率 */
  resolution?: { width: number; height: number }
  /** 帧率 */
  fps?: number
  /** 时长（秒） */
  duration?: number
}
