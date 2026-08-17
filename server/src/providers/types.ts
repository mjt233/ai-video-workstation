/**
 * Provider 插件系统类型定义。
 *
 * Provider 是工作流的「传输层插件」：负责提交任务、轮询状态、获取输出、中断任务，
 * 并声明自己的配置 schema（configSchema）供设置界面渲染表单。
 * 工作流通过 baseDefinition.provider 声明使用哪个 provider；引擎按请求读取配置、
 * 创建 ProviderClient 并注入 WorkflowRunContext。
 */

/**
 * Provider 配置字段声明（驱动设置表单 + 校验 + 环境变量兜底）。
 */
export interface ProviderConfigField {
  /** 配置键，如 baseUrl / password / apiKey */
  key: string;
  /** 中文标签 */
  label: string;
  /** 字段类型（决定前端表单控件与后端类型强转） */
  type: 'string' | 'password' | 'number' | 'boolean' | 'select';
  /** 是否必填（文件值 / 环境变量 / 默认值均缺失时报错） */
  required?: boolean;
  /** 默认值（表单初始值；文件与环境变量均未提供时使用） */
  defaultValue?: string | number | boolean;
  /** 输入框占位文案 */
  placeholder?: string;
  /** 敏感字段：GET 返回时脱敏为 '__set__'；保存时空串 = 保留原值 */
  secret?: boolean;
  /** select 类型可选项 */
  options?: { label: string; value: string }[];
  /** 字段说明（表单 hint） */
  description?: string;
  /** 环境变量兜底名，如 COMFYUI_BRIDGE_URL；文件值优先 */
  envVar?: string;
}

/** 已解析的 Provider 配置值（文件值 > envVar > defaultValue 合并后） */
export type ResolvedProviderConfig = Record<string, string | number | boolean>;

/**
 * Provider 插件定义：配置 schema + 客户端工厂。
 */
export interface ProviderDefinition {
  /** Provider 唯一 ID，如 comfyui-bridge */
  id: string;
  /** 中文显示名 */
  name: string;
  /** 可选描述 */
  description?: string;
  /** 配置字段声明（设置界面据此渲染表单） */
  configSchema: ProviderConfigField[];
  /** 按已解析配置创建传输客户端（每次调用返回独立实例，token 缓存等按实例持有） */
  createClient(config: ResolvedProviderConfig): ProviderClient;
  /** 返回该实例可提供的工作流列表（Bridge 动态拉取 / 静态返回注册表候选） */
  listWorkflows(config: ResolvedProviderConfig): Promise<ProviderWorkflowEntry[]>;
  /** 连接测试：返回是否成功与提示信息（不抛 5xx，失败返回 ok:false） */
  testConnection(config: ResolvedProviderConfig): Promise<{ ok: boolean; message: string }>;
}

/**
 * Provider 客户端：统一传输能力（工作流/引擎只依赖这四个方法）。
 */
export interface ProviderClient {
  /**
   * 提交一个工作流执行。
   * @param p.workflowId 提供商侧的工作流标识（如 ComfyUI Bridge 的 workflowId）
   * @param p.params 工作流参数（键值对）
   * @param p.files 需要上传的文件（键为工作流参数的文件字段别名）
   * @returns 远端任务 ID
   */
  execute(p: {
    workflowId: string;
    params?: Record<string, unknown>;
    files?: Record<string, File>;
    /**
     * 本次执行显式指定的执行端实例 ID（如 ComfyUI Easy Bridge 执行接口的保留键
     * providerId）。仅支持该语义的 provider 使用；其余 provider 忽略此字段。
     */
    providerId?: string;
  }): Promise<{ taskId: string }>;

  /**
   * 轮询任务状态。
   * @param taskId 远端任务 ID
   * @returns 状态、进度与是否结束（completed / failed 视为 done）
   */
  poll(taskId: string): Promise<{
    status: string;
    progress?: number;
    done: boolean;
    errorMessage?: string | null;
  }>;

  /**
   * 获取任务输出规格（下载请求或 base64）。
   * @param taskId 远端任务 ID
   * @returns 输出规格；无输出文件时返回 null（引擎将报错）
   */
  getOutput(taskId: string): Promise<WorkflowOutput | null>;

  /** 中断任务（幂等即可；取消失败抛错由调用方处理） */
  cancel(taskId: string): Promise<void>;
}

/**
 * 工作流输出规格（由 provider 的 getOutput 返回）。
 *
 * 从 workflows/types.ts 移入本文件（传输职责归 provider）；workflows/types.ts 再导出。
 */
export type WorkflowOutput =
  | { type: 'download'; url: string; filename: string }
  | { type: 'fetch'; request: { url: string; method: string; headers?: Record<string, string> }; filename: string }
  | { type: 'body'; contentType: string; data: string; filename: string };

/** 服务商实例（多实例模型的核心抽象） */
export interface ProviderInstance {
  /** 自动生成的唯一 ID（uuid），用户不可改 */
  id: string;
  /** 服务商类型 id，如 volcengine-ark / comfyui-bridge / minimax-h3 */
  type: string;
  /** 用户手填的显示名，如「火山方舟-主账号」 */
  name: string;
  /** 该实例的配置参数（secret 字段保存时脱敏处理） */
  config: Record<string, string | number | boolean>;
  /** 启用的工作流键列表（默认全选）：静态为 `类型:实现`，Bridge 为 `ceb-{bridgeId}` */
  enabledWorkflows: string[];
}

/** 服务商实例可提供的工作流条目（listWorkflows 返回） */
export interface ProviderWorkflowEntry {
  /** 工作流键（不含实例 id）：静态为 `类型:实现`，Bridge 为 `ceb-{bridgeId}` */
  key: string;
  /** 显示名 */
  name: string;
  /** 工作流类型（text-to-image / image-edit / image-to-video / tts-*）；Bridge 可在同步时推导 */
  type?: string;
  /** 可选描述 */
  description?: string;
}
