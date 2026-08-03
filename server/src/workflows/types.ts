import type { WorkflowVarsBase } from './vars.js';

export type {
  WorkflowVarsBase,
  TextToImageVars,
  ImageEditVars,
  TtsVoiceDesignVars,
  ImageToVideoVars,
  // 兼容旧名
  CharacterAppearanceVars,
  CharacterVoiceVars,
  StageImageVars,
  SceneStageImageVars,
  SceneTtsVars,
  VideoGenerateVars,
} from './vars.js';

/**
 * 工作流执行类型（按 AI 能力分类，而非资产类型）。
 *
 * - text-to-image：文生图
 * - image-edit：图片编辑
 * - tts-voice-design：音色设计 / TTS
 * - image-to-video：图生视频
 */
export type WorkflowTypeId =
  | 'text-to-image'
  | 'image-edit'
  | 'tts-voice-design'
  | 'image-to-video';

/** Project-level structured config from design/{project}/project.json */
export interface ProjectConfig {
  /** 画面宽度（像素），如 1080 */
  width: number;
  /** 画面高度（像素），如 1920 */
  height: number;
  /** 画面比例，如 "9:16" */
  aspectRatio?: string;
  /** 帧率（fps），如 24；缺失时引擎默认 24 */
  fps?: number;
}

/**
 * 工作流执行参数。
 *
 * @typeParam TVars - 该工作流类型的业务变量 interface
 */
export interface WorkflowParams<TVars extends WorkflowVarsBase = WorkflowVarsBase> {
  /** 项目名（design 下子目录） */
  project: string;
  /** 读取项目内文本文件（UTF-8），路径相对 design/{project}/ */
  readFile(relPath: string): Promise<string>;
  /**
   * 读取项目 assert/ 下的二进制文件为 File 对象。
   * 路径须以 assert/ 开头，相对 design/{project}/。
   */
  readAssertFile(relPath: string): Promise<File>;
  /** 工作流业务变量（按工作流类型约束字段） */
  vars: TVars;
  /** Project configuration from design/{project}/project.json (auto-injected) */
  projectConfig: ProjectConfig;
}

/**
 * 统一执行上下文（submit 的入参，替代 WorkflowParams）。
 *
 * 由工作流引擎在提交时构建并注入：除业务变量（vars）与项目配置（projectConfig）外，
 * 引擎按需解析资产文件（assets）、导演台负载（director）与用户手动参数（userParams），
 * 工作流实现无需自行读取 project.json 或解析 director.json。
 *
 * @typeParam TVars - 该工作流类型的业务变量 interface
 */
export interface WorkflowRunContext<TVars extends WorkflowVarsBase = WorkflowVarsBase> {
  /** 项目名（design 下子目录） */
  project: string;
  /** Project configuration from design/{project}/project.json (auto-injected) */
  projectConfig: ProjectConfig;
  /** 业务变量（引擎已注入 enrich 结果，按工作流类型约束字段） */
  vars: TVars;
  /** 引擎按需解析的资产文件（预留，P1 可不使用） */
  assets?: Record<string, File>;
  /** 导演台负载：仅当 director.json 存在且所选实现声明 capabilities.director 时注入 */
  director?: DirectorPayload;
  /** 用户手动传入的工作流参数（按实现声明 key） */
  userParams?: Record<string, boolean | number | string>;
  /** 读取项目内文本文件（UTF-8），路径相对 design/{project}/ */
  readFile(relPath: string): Promise<string>;
  /** 读取项目 assert/ 下的二进制文件为 File 对象；路径须以 assert/ 开头，相对 design/{project}/ */
  readAssertFile(relPath: string): Promise<File>;
}

/** 工作流用户可手动传入的参数类型 */
export type WorkflowUserParamType = 'boolean' | 'integer' | 'float' | 'string';

/**
 * 工作流用户参数声明。
 *
 * 注册工作流时声明哪些参数可由用户手动传入；
 * 前端据此渲染参数输入表单，用户填写值最终写入任务 vars 的对应 key。
 */
export interface WorkflowUserParamDeclaration {
  /** 参数名称（供阅读），如 "图片宽度" */
  name: string;
  /** 参数字段 key（写入 vars 的字段名），如 width */
  key: string;
  /** 参数类型：boolean / integer / float / string */
  type: WorkflowUserParamType;
  /** 默认值（表单初始值）；空字符串表示“不传”，由工作流/项目配置决定 */
  defaultValue: boolean | number | string;
  /** 可选说明文案（表单 hint） */
  description?: string;
}

/** 工作流基础元信息 */
export interface WorkflowBaseDefinition {
  /** 工作流类型 ID，如 text-to-image */
  id: string;
  /** 展示名称 */
  name: string;
  /** 实现标识，如 default / flux / ltx */
  impl: string;
  /** 可选描述 */
  description?: string;
  /** 可由用户手动传入的参数声明（前端据此渲染输入表单，并写入 vars） */
  params?: WorkflowUserParamDeclaration[];
}

/**
 * 工作流能力声明（注册时声明，经 /api/workflows 透传前端）。
 *
 * 前端据此展示能力入口（如导演台模式、外部音频导入），
 * 引擎据此决定是否注入对应负载（如 director）。
 */
export interface WorkflowCapabilities {
  /** 是否支持导演台模式（true 时引擎才会注入 director 负载） */
  director?: boolean;
  /** 是否支持传入外部音频（如导演台混音产物） */
  audio?: boolean;
}

/**
 * 导演台执行负载（引擎从 director.json 解析并注入）。
 *
 * 由引擎调用 director 解析助手生成，工作流实现直接消费其中的
 * 时长、画幅、帧率与关键帧序列，无需自行读取 director.json。
 */
export interface DirectorPayload {
  /** 总时长（秒） */
  duration: number;
  /** 画面宽度（像素） */
  width: number;
  /** 画面高度（像素） */
  height: number;
  /** 帧率（fps） */
  fps: number;
  /** 关键帧：按 startOffset 升序，frameSeq=0..n，cursor=startOffset/duration（钳制 0~1） */
  frames: Array<{ file: File; frameSeq: number; cursor: number }>;
  /** 混音后的音频文件（可选） */
  audio?: File;
}

/**
 * 工作流完整定义。
 *
 * @typeParam TVars - 业务变量类型
 * @typeParam TPollResult - poll 返回的额外字段类型
 */
export interface WorkflowDefinition<
  TVars extends WorkflowVarsBase = WorkflowVarsBase,
  TPollResult = Record<string, unknown>,
> extends WorkflowBaseDefinition {
  /** 工作流能力声明（注册时声明，前端据此展示导演台等能力入口） */
  capabilities?: WorkflowCapabilities;

  /** Submit task to AI API, return remote task ID */
  submit(ctx: WorkflowRunContext<TVars>): Promise<{ taskId: string }>;

  /** Optional: poll task status. Not implementing = synchronous task */
  poll?(taskId: string): Promise<{ status: string; done: boolean } & TPollResult>;

  /** Extract output spec from completed task. response is the extra fields from poll's return (excluding status/done) */
  parseOutput(taskId: string, response?: TPollResult): Promise<WorkflowOutput>;
}

export type WorkflowOutput =
  | { type: 'download'; url: string; filename: string }
  | { type: 'fetch'; request: { url: string; method: string; headers?: Record<string, string> }; filename: string }
  | { type: 'body'; contentType: string; data: string; filename: string };

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';
