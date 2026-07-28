/** 所有工作流 vars 的公共字段（引擎可注入 seed） */
export interface WorkflowVarsBase {
  seed?: string;
}

/** 角色外观生成 */
export interface CharacterAppearanceVars extends WorkflowVarsBase {
  name: string;
}

/** 角色声音设计 */
export interface CharacterVoiceVars extends WorkflowVarsBase {
  name: string;
}

/** 场景图片生成 */
export interface StageImageVars extends WorkflowVarsBase {
  name: string;
  label: string;
}

/** 分镜场景图合成 */
export interface SceneStageImageVars extends WorkflowVarsBase {
  episode: string;
  shot: string;
  /** 分镜场景索引，字符串形式以兼容 API/DB 序列化 */
  index: string;
}

/**
 * 分镜台词 TTS
 *
 * 调用方只需提供 episode / shot / index（台词序号）。
 * 引擎会统一读取并注入：character / text / voiceDesc / emotion。
 */
export interface SceneTtsVars extends WorkflowVarsBase {
  episode: string;
  shot: string;
  /** 该分镜下的台词序号（script.json 数组下标，字符串形式） */
  index: string;
  /** 角色名称（引擎注入） */
  character?: string;
  /** 台词文本（引擎注入） */
  text?: string;
  /** 角色声线描述（引擎注入，来自 voice.md） */
  voiceDesc?: string;
  /** 台词情绪（引擎注入，可为空字符串） */
  emotion?: string;
}

/**
 * 视频生成
 *
 * 调用方只需提供 episode / shot。
 * 引擎会：
 * - 读取分镜 overview.json 注入 duration（秒，正整数）
 * - 按 stage.json 顺序收集已生成的场景图路径，注入 stageImages（JSON 数组字符串）
 * 分辨率与帧率通过 projectConfig.width / height / fps 提供。
 */
export interface VideoGenerateVars extends WorkflowVarsBase {
  episode: string;
  shot: string;
  /** 分镜时长（秒，正整数；引擎从 overview.json 注入） */
  duration?: string;
  /**
   * 分镜场景图相对路径列表（JSON 数组字符串；引擎注入）
   * 例：`["assert/scene/1/1/stage/0.jpg","assert/scene/1/1/stage/1.jpg"]`
   * 顺序与 stage.json 数组下标一致。
   */
  stageImages?: string;
}
