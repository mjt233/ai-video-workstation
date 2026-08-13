/**
 * 工作流业务变量类型定义。
 *
 * 工作流按执行类型统一管理：
 * - text-to-image（文生图）
 * - image-edit（图片编辑）
 * - tts-voice-design（音色设计）
 * - tts-voice-clone（音色克隆）
 * - image-to-video（图生视频）
 *
 * 各类型声明专用 interface；调用方通过 vars 字段区分具体资产用途。
 */

/** 所有工作流 vars 的公共字段（引擎可注入 seed） */
export interface WorkflowVarsBase {
  /** 随机种子（引擎注入，字符串形式以兼容 API/DB 序列化） */
  seed?: string;
}

// ── 文生图 text-to-image ─────────────────────────────────────────────

/**
 * 文生图工作流变量。
 *
 * 用于角色外观、场景图等纯文本生成图片的场景。
 * 调用方提供 promptPath；引擎/工作流读取该路径作为 prompt。
 * 可选 enable_specified_size + width/height 覆盖 projectConfig 默认分辨率。
 */
export interface TextToImageVars extends WorkflowVarsBase {
  /**
   * 提示词文件相对路径（相对 design/{project}/）。
   * 例：`prompt/character/陈书文/appearance.md`
   * 例：`prompt/stage/现代商场/现代商场-白天-平视-正门入口.md`
   */
  promptPath: string;
  /**
   * 可选：提示词强化开关（"true"/"false"）。
   * 由用户通过工作流参数声明传入；引擎将其以布尔值提交给 ComfyUI 工作流，不修改提示词内容。
   */
  enhance_prompt?: string;
  /**
   * 可选：是否启用指定输出尺寸（"true"/"false"）。
   * 由用户通过工作流参数声明传入；仅当为 "true" 时 width/height 生效，否则回退 projectConfig。
   */
  enable_specified_size?: string;
  /**
   * 可选：覆盖默认宽度（像素，字符串形式）。
   * 角色外观通常固定 1280；场景图默认使用 projectConfig.width。
   * 仅当 enable_specified_size 为 "true" 时生效。
   */
  width?: string;
  /**
   * 可选：覆盖默认高度（像素，字符串形式）。
   * 角色外观通常固定 720；场景图默认使用 projectConfig.height。
   * 仅当 enable_specified_size 为 "true" 时生效。
   */
  height?: string;
  /**
   * 可选：资产用途标签，仅用于日志/展示，不参与生成。
   * 例：`character-appearance` | `stage-image`
   */
  purpose?: string;
  /**
   * 可选：角色名（purpose=character-appearance 时便于展示）。
   */
  name?: string;
  /**
   * 可选：场景名（purpose=stage-image 时便于展示）。
   */
  stageName?: string;
  /**
   * 可选：子场景标签（purpose=stage-image 时便于展示）。
   */
  label?: string;
}

// ── 图片编辑 image-edit ─────────────────────────────────────────────

/**
 * 图片编辑工作流变量。
 *
 * 用于分镜场景图合成、衍生变体编辑等。
 * 调用方提供 prompt 与输入图路径列表；引擎加载 assert 文件后提交。
 */
export interface ImageEditVars extends WorkflowVarsBase {
  /**
   * 编辑描述 / 合成提示词。
   * 图像编号约定：图像1=第一张输入图，图像2=第二张，以此类推。
   */
  prompt: string;
  /**
   * 输入图片相对路径列表（JSON 数组字符串）。
   * 例：`["assert/stage/现代商场/xxx.jpg","assert/character/陈书文/appearance.jpg"]`
   * 顺序与 prompt 中的图像编号一致。
   */
  imagePaths: string;
  /**
   * 可选：资产用途标签。
   * 例：`scene-stage-image` | `variant-edit`
   */
  purpose?: string;
  /** 可选：分镜集数（purpose=scene-stage-image） */
  episode?: string;
  /** 可选：分镜编号（purpose=scene-stage-image） */
  shot?: string;
  /** 可选：分镜场景索引（purpose=scene-stage-image） */
  index?: string;
  /** 可选：衍生变体所属资产类型 character | stage */
  variantKind?: string;
  /** 可选：衍生变体所属主体名（角色名或场景名） */
  variantOwner?: string;
  /** 可选：衍生变体 id / 标签 */
  variantId?: string;
  /** 可选：基础场景标签（stage 衍生时） */
  baseLabel?: string;
  /**
   * 可选：是否启用指定输出尺寸（"true"/"false"）。
   * 由用户通过工作流参数声明传入；仅当为 "true" 时 width/height 生效。
   */
  enable_specified_size?: string;
  /**
   * 可选：输出宽度（像素，字符串形式）。
   * enable_specified_size 为 "true" 时提交给 Bridge。
   */
  width?: string;
  /**
   * 可选：输出高度（像素，字符串形式）。
   * enable_specified_size 为 "true" 时提交给 Bridge。
   */
  height?: string;
}

// ── 音色设计 tts-voice-design ───────────────────────────────────────

/**
 * 音色设计 / TTS 工作流变量。
 *
 * 用于角色声音样本、分镜台词语音等。
 * 调用方提供 prompt（声线描述）与 text（朗读文本）。
 */
export interface TtsVoiceDesignVars extends WorkflowVarsBase {
  /**
   * 声线描述（自然语言）。
   * 角色声音：来自 voice.md；
   * 分镜台词：voice.md + 可选情绪后缀（可由引擎注入）。
   */
  prompt: string;
  /**
   * 待合成的朗读文本。
   * 角色声音：固定试听句；分镜台词：script.json 中的台词。
   */
  text: string;
  /**
   * 可选：资产用途标签。
   * 例：`character-voice` | `scene-tts`
   */
  purpose?: string;
  /** 可选：角色名 */
  character?: string;
  /** 可选：分镜集数（purpose=scene-tts） */
  episode?: string;
  /** 可选：分镜编号（purpose=scene-tts） */
  shot?: string;
  /** 可选：台词序号（purpose=scene-tts） */
  index?: string;
  /** 可选：情绪（purpose=scene-tts，引擎可注入） */
  emotion?: string;
}

// ── 音色克隆 tts-voice-clone ────────────────────────────────────────

/**
 * 音色克隆 / TTS 工作流变量。
 *
 * 用于资产画布「TTS声音生成」节点音色克隆模式。
 * 调用方提供 text（朗读文本）、refText（参考音频文字内容）与 refAudioPath（参考音频路径）。
 */
export interface TtsVoiceCloneVars extends WorkflowVarsBase {
  /** 待合成的朗读文本 */
  text: string;
  /** 参考音频的语音内容文字 */
  refText: string;
  /** 参考音频文件相对路径（JSON 数组字符串，与 imagePaths 同约定） */
  refAudioPath: string;
  /** 可选：资产用途标签，如 `canvas-tts` */
  purpose?: string;
}

// ── 图生视频 image-to-video ─────────────────────────────────────────

/**
 * 图生视频工作流变量。
 *
 * 调用方只需提供 episode / shot。
 * 引擎会：
 * - 读取分镜 overview.json 注入 duration（秒，正整数）
 * - 按 stage.json 顺序收集已生成的场景图路径，注入 stageImages（JSON 数组字符串）
 * 分辨率与帧率通过 projectConfig.width / height / fps 提供。
 */
export interface ImageToVideoVars extends WorkflowVarsBase {
  /** 集数 */
  episode: string;
  /** 分镜编号 */
  shot: string;
  /** 分镜时长（秒，正整数；引擎从 overview.json 注入） */
  duration?: string;
  /**
   * 分镜场景图相对路径列表（JSON 数组字符串；引擎注入）
   * 例：`["assert/scene/1/1/stage/0.jpg","assert/scene/1/1/stage/1.jpg"]`
   * 顺序与 stage.json 数组下标一致。
   */
  stageImages?: string;
  /**
   * 用户编辑并合并的音频文件相对路径（引擎从 audio-edit.json + merged.flac 注入）
   * 例：`assert/scene/1/1/audio/merged.flac`
   */
  audioPath?: string;
}

// ── 兼容别名（旧代码迁移期可选） ────────────────────────────────────

/** @deprecated 使用 TextToImageVars */
export type CharacterAppearanceVars = TextToImageVars;
/** @deprecated 使用 TtsVoiceDesignVars */
export type CharacterVoiceVars = TtsVoiceDesignVars;
/** @deprecated 使用 TextToImageVars */
export type StageImageVars = TextToImageVars;
/** @deprecated 使用 ImageEditVars */
export type SceneStageImageVars = ImageEditVars;
/** @deprecated 使用 TtsVoiceDesignVars */
export type SceneTtsVars = TtsVoiceDesignVars;
/** @deprecated 使用 ImageToVideoVars */
export type VideoGenerateVars = ImageToVideoVars;
