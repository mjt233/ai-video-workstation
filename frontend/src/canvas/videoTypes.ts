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

/**
 * 导演台配置（存于节点 config.director）。
 *
 * 注意：`duration/width/height/fps` 为**遗留字段**（导演台早期自成一套输出规格），
 * 现已由 `config.duration / config.resolution / config.sizeConfig / config.fps` 取代，
 * 仅作旧画布的读取回退（见 `videoSpec.readVideoSpec`），任何写入路径都不再更新它们；
 * 素材块（imageClips/audioClips）仍是导演台时间轴的唯一持久化形态。
 */
export interface CanvasDirectorConfig {
  /** 成片时长（秒；遗留字段，仅读取回退） */
  duration: number
  /** 输出宽度（像素；遗留字段，仅读取回退） */
  width: number
  /** 输出高度（像素；遗留字段，仅读取回退） */
  height: number
  /** 帧率（遗留字段，仅读取回退） */
  fps: number
  /** 图片轨素材块列表 */
  imageClips: CanvasDirectorImageClip[]
  /** 音频轨素材块列表 */
  audioClips: CanvasDirectorAudioClip[]
}

/**
 * 导演台时间轴素材（config.director 中仍参与读写的部分）。
 *
 * 视频导演台组件 ↔ 画布节点配置的转换（`videoDirectorBridge`）只处理素材块；
 * 输出规格由 `videoSpec.readVideoSpec` 统一读取并显式传入。
 */
export type CanvasDirectorClips = Pick<CanvasDirectorConfig, 'imageClips' | 'audioClips'>

/** 参考模式输出规格（存于节点 config） */
export interface CanvasVideoSpec {
  /** 输出分辨率 */
  resolution?: { width: number; height: number }
  /** 帧率 */
  fps?: number
  /** 时长（秒） */
  duration?: number
}
