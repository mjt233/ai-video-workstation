/** 单条台词的音频编辑状态 */
export interface AudioClipState {
  /** script.json 中的索引 */
  index: number
  /** 角色名 */
  角色名: string
  /** 台词前几个字（用于显示） */
  label: string
  /** 原始音频文件时长（秒） */
  duration: number
  /** 在时间轴上的起始偏移（秒） */
  startOffset: number
  /** 头部裁剪（秒） */
  trimStart: number
  /** 尾部裁剪（秒） */
  trimEnd: number
}

/** 音频编辑项目（保存为 JSON 的格式） */
export interface AudioEditProject {
  version: number
  tracks: AudioClipState[]
}

/** 波形数据（从 AudioBuffer 降采样得到） */
export interface WaveformData {
  /** 峰值样本，每个元素代表一个时间段内的最大振幅 (0-1) */
  peaks: Float32Array
  /** 采样率（每秒峰值数） */
  sampleRate: number
  /** 对应音频的原始时长（秒） */
  duration: number
}

/** 播放状态 */
export type PlayState = 'idle' | 'playing' | 'paused'
