/**
 * 视频导演台数据模型。
 *
 * 与分镜目录下的 `prompt/scene/{ep}/{shot}/director.json` 一一对应，
 * 描述视频导演台组件的完整编辑状态：视频规格、图片轨素材块与音频轨素材块。
 * 前端组件/组合式函数直接操作此模型，保存时序列化为 director.json 供服务端
 * 解析（`parseDirectorJson`），生成视频时驱动 ltx-2.3-director 工作流。
 */

/** 图片轨素材块（关键帧来源） */
export interface DirectorImageClip {
  /** 唯一标识（前端编辑状态用：选中、复制粘贴与 v-for key，不写入 director.json） */
  id: string
  /** 图像文件路径（相对项目资产路径，如 `assert/scene/1/1/stage/0.jpg`） */
  path: string
  /** 起始偏移（秒），即该图片作为图生视频关键帧的时间轴位置 */
  startOffset: number
  /** 轨道占位长度（秒），可在轨道上边缘拉伸调整，不参与视频生成 */
  duration: number
}

/** 音频轨素材块 */
export interface DirectorAudioClip {
  /** 唯一标识（前端编辑状态用：选中、复制粘贴与 v-for key，不写入 director.json） */
  id: string
  /** 音频文件路径（相对项目资产路径，如 `assert/scene/1/1/audio/0.flac`） */
  path: string
  /** 在视频时间轴上的起始偏移（秒） */
  startOffset: number
  /** 音频原始时长（秒，来自音频文件本身，不可在轨道上拉伸） */
  duration: number
  /** 头部裁剪时长（秒）：从音频文件开头裁掉的部分 */
  trimStart: number
  /** 尾部裁剪时长（秒）：从音频文件末尾裁掉的部分 */
  trimEnd: number
}

/** 导演台项目（与 director.json 一一对应） */
export interface DirectorProject {
  /** 配置格式版本号（当前为 DIRECTOR_VERSION = 1） */
  version: number
  /** 视频总长（秒，整数），控制整个轨道长度 */
  duration: number
  /** 视频宽度（像素，正数） */
  width: number
  /** 视频高度（像素，正数） */
  height: number
  /** 视频帧率（fps，正数） */
  fps: number
  /** 图片轨素材块列表（按视频时间轴排列） */
  imageClips: DirectorImageClip[]
  /** 音频轨素材块列表 */
  audioClips: DirectorAudioClip[]
}

/** 导演台配置格式版本号 */
export const DIRECTOR_VERSION = 1

/** 图片块默认占位长度（秒） */
export const DEFAULT_IMAGE_CLIP_DURATION = 2

/**
 * 生成空白导演台项目。
 *
 * 创建一个空壳项目：版本号为当前 `DIRECTOR_VERSION`，两条轨道均为空数组，
 * `duration`/`width`/`height`/`fps` 默认 0 —— 由调用方按需填充
 * （如从 overview.json 取 duration、从 projectConfig 取 width/height/fps）。
 *
 * @returns 空白导演台项目对象
 */
export function createDirectorProject(): DirectorProject {
  return {
    version: DIRECTOR_VERSION,
    duration: 0,
    width: 0,
    height: 0,
    fps: 0,
    imageClips: [],
    audioClips: [],
  }
}
