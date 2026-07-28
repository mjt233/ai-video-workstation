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

/** 分镜台词 TTS */
export interface SceneTtsVars extends WorkflowVarsBase {
  episode: string;
  shot: string;
  character: string;
}

/** 视频生成 */
export interface VideoGenerateVars extends WorkflowVarsBase {
  episode: string;
  shot: string;
}
