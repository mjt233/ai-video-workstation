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
}

export interface WorkflowParams<TVars extends WorkflowVarsBase = WorkflowVarsBase> {
  project: string;
  /** Read a file from the project's prompt/ directory */
  readFile(relPath: string): Promise<string>;
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
