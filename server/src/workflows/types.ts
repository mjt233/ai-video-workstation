import type { WorkflowVarsBase } from './vars.js';

export type {
  WorkflowVarsBase,
  CharacterAppearanceVars,
  CharacterVoiceVars,
  StageImageVars,
  SceneStageImageVars,
  SceneTtsVars,
  VideoGenerateVars,
} from './vars.js';

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

export interface WorkflowParams<TVars extends WorkflowVarsBase = WorkflowVarsBase> {
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

export interface WorkflowBaseDefinition {
  id: string;
  name: string;
  impl: string;
  description?: string;
}

export interface WorkflowDefinition<
  TVars extends WorkflowVarsBase = WorkflowVarsBase,
  TPollResult = Record<string, unknown>,
> extends WorkflowBaseDefinition {

  /** Submit task to AI API, return remote task ID */
  submit(params: WorkflowParams<TVars>): Promise<{ taskId: string }>;

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
