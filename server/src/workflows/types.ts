export interface WorkflowParams {
  project: string;
  /** Read a file from the project's prompt/ directory */
  readFile(relPath: string): Promise<string>;
  /** Variable substitution values, e.g. { name } → "小霓" */
  vars: Record<string, string>;
}

export interface WorkflowDefinition<TPollResult = any> {
  id: string;
  name: string;
  impl: string;
  description?: string;

  /** Submit task to AI API, return remote task ID */
  submit(params: WorkflowParams): Promise<{ taskId: string }>;

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
