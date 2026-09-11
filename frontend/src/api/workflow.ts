import client from './client'
import type { CanvasTarget } from '../canvas/api'

/** 工作流用户可手动传入的参数类型 */
export type WorkflowUserParamType = 'boolean' | 'integer' | 'float' | 'string'

/** 工作流用户参数的值类型（表单提交时保持原生类型） */
export type WorkflowUserParamValue = boolean | number | string

/** 下拉候选项（label 用于界面展示，value 为实际提交值） */
export interface WorkflowUserParamCandidate {
  /** 选项展示名（表单中可见文本）；缺省时回退为 value */
  label: string
  /** 选项提交值（写入 vars / 传给工作流的实际值） */
  value: string
}

/**
 * 工作流用户参数声明（注册工作流时声明，前端据此渲染输入表单）。
 *
 * 下拉候选项仅对 string 类型生效：candidates 非空时表单渲染下拉控件，
 * multiple 声明单选/多选（多选时各选中项 value 以英文逗号 "," 拼接为一个字符串提交），
 * allowCustom 声明是否允许自由输入候选项之外的值（未声明默认允许）。
 */
export interface WorkflowUserParamDeclaration {
  /** 参数名称（供阅读），如 "图片宽度" */
  name: string
  /** 参数字段 key（写入 vars 的字段名），如 width */
  key: string
  /** 参数类型：boolean / integer / float / string */
  type: WorkflowUserParamType
  /** 默认值（表单初始值）；空字符串表示"不传"，由工作流/项目配置决定；多选字段可为逗号拼接串（如 "a,b"） */
  defaultValue: WorkflowUserParamValue
  /** 可选说明文案（表单 hint） */
  description?: string
  /** 下拉候选项（仅 string 类型生效；非空时表单渲染下拉控件，空/缺省按普通文本框渲染） */
  candidates?: WorkflowUserParamCandidate[]
  /** 是否多选（仅配置了候选项时生效）；true 时各选中项 value 以英文逗号 "," 拼接为一个字符串提交 */
  multiple?: boolean
  /** 是否允许自由输入候选项之外的值（仅配置了候选项时生效）；未声明默认允许，显式 false 时为严格下拉 */
  allowCustom?: boolean
}

/**
 * 统一尺寸配置（用户选择的原始完整尺寸）。
 *
 * 用户在前端统一尺寸组件中选定比例/尺寸档（可为 "auto"/"adaptive" 表示自适应），
 * 并可选指定自定义宽高；随任务提交（params.sizeConfig 或 video.sizeConfig）并持久化，
 * 工作流实现据此消费（如 MiniMax ratio、火山方舟档位、OpenAI 兼容 WxH）。
 */
export interface WorkflowSizeConfig {
  /** 比例档（如 "16:9" / "auto"；MiniMax 场景可为 "adaptive"） */
  ratio?: string
  /** 尺寸档（如 "1K" / "auto"） */
  size?: string
  /** 自定义宽度（像素；仅支持指定任意高宽的工作流携带） */
  width?: number
  /** 自定义高度（像素；仅支持指定任意高宽的工作流携带） */
  height?: number
}

/** 工作流实现信息 */
export interface WorkflowImplementation {
  impl: string
  name: string
  description?: string
  /** 该实现使用的 Provider 插件 ID（如 comfyui-bridge） */
  provider?: string
  /** 服务商实例 ID（执行时引擎按此解析配置创建客户端） */
  providerInstanceId?: string
  /** 服务商实例显示名（工作流下拉 v-chip 展示） */
  providerName?: string
  /** 可由用户手动传入的参数声明 */
  params?: WorkflowUserParamDeclaration[]
  /**
   * 工作流能力声明（前端据此展示导演台等能力入口）。
   * - director：是否支持导演台模式（true 时引擎才会注入 director 负载）
   * - audio：是否支持传入外部音频（如导演台混音产物）
   * - cancelable：是否支持中断（true 时前端可调用取消接口）
   * - video：视频生成能力声明（支持的生成模式组合与参考模式素材上限）
   * - size：输出尺寸能力声明（统一尺寸组件据此渲染比例/尺寸按钮组与自定义宽高）
   */
  capabilities?: {
    director?: boolean
    audio?: boolean
    cancelable?: boolean
    video?: {
      /** 支持的生成模式组合（导演台/首尾帧/参考；未声明时默认仅导演台） */
      modes?: Array<'director' | 'first-last-frame' | 'reference'>
      /** 是否支持传入音频（如导演台混音产物） */
      audio?: boolean
      /** 最大输出时长（秒） */
      maxDuration?: number
      /** 首尾帧模式限制（modes 含 first-last-frame 时可选声明） */
      firstLastFrame?: {
        /** 最大帧数（默认 3） */
        maxFrames?: number
      }
      /** 参考模式素材上限声明 */
      reference?: {
        /** 各类型素材数量上限 */
        types?: {
          /** 图片：数量上限 */
          image?: { max?: number }
          /** 视频：数量上限与单段时长限制 */
          video?: { max?: number; minDuration?: number; maxDuration?: number }
          /** 音频：数量上限与单段时长限制 */
          audio?: { max?: number; minDuration?: number; maxDuration?: number }
        }
        /** 混合输入合计上限 */
        maxTotal?: number
        /** 音频是否必须与图像/视频一同输入（不能作为唯一输入） */
        audioRequiresVisual?: boolean
      }
    }
    size?: {
      /** 支持的比例（如 "16:9"、"auto"；未声明默认全量） */
      ratio?: string[]
      /** 支持的尺寸（如 "1K"、"auto"；未声明默认全量） */
      size?: string[]
      /** 是否允许指定任意宽高（默认 true） */
      supportCustomSize?: boolean
    }
  }
}

/**
 * 工作流类型及其实现列表（/api/workflows 返回结构）。
 *
 * type 为工作流类型（如 image-to-video）；同一类型下可有多个实现（implementations），
 * 每个实现的 impl 是其唯一 ID、name 是其阅读友好名称。
 */
export interface WorkflowInfo {
  /** 工作流类型（如 image-to-video / text-to-image） */
  type: string
  /** 该类型下的全部实现（impl 为唯一 ID，name 为阅读友好名称） */
  implementations: WorkflowImplementation[]
}

export interface TaskParams {
  vars: Record<string, string>
  promptPaths: string[]
  outputPath: string
  /** 发起节点 id（画布节点提交时持久化；画布恢复 Loading 用） */
  nodeId?: string
  /** 画布定位（画布节点提交时持久化；画布恢复 Loading 用） */
  canvas?: CanvasTarget
}

export interface TaskResponse {
  taskId: string
  workflowId: string
  impl: string
  status: string
  result: { path: string } | null
  errorMsg?: string
  createdAt: string
  updatedAt: string
  params?: TaskParams
}

export interface LogEntry {
  /** 日志自增主键（列表稳定 key 与增量拉取用） */
  id: number
  level: string
  message: string
  metadata?: string
  created_at: string
}

/** 视频自包含提交参数（wire 形态，与后端 VideoWorkflowSubmitParams 对齐） */
export interface VideoWorkflowSubmitParams {
  /** 生成模式：导演台 / 首尾帧 / 参考 */
  mode: 'director' | 'first-last-frame' | 'reference'
  /** 输出分辨率（像素） */
  resolution: { width: number; height: number }
  /** 帧率（可选） */
  fps?: number
  /** 输出时长（秒） */
  duration: number
  /** 生成提示词 */
  prompt: string
  /** 随机种子（可选） */
  seed?: number
  /** 导演台/首尾帧模式：有序关键帧 + 可选音频 */
  director?: { frames: Array<{ path: string; cursor: number }>; audio?: { path: string } }
  /** 参考模式：按类型分组的引用素材 */
  references?: Array<{ type: 'image' | 'video' | 'audio'; path: string }>
  /** 统一尺寸配置（用户选择的原始完整尺寸；画布视频节点随 video wire 携带） */
  sizeConfig?: WorkflowSizeConfig
  /** 透传给工作流实现的额外参数（seed 已剥离） */
  extraParams: Record<string, unknown>
}

export interface WorkflowRunParams {
  project: string
  workflowId: string
  impl?: string
  params: {
    vars: Record<string, string>
    promptPaths?: string[]
    outputPath: string
    /** 用户手动传入的工作流参数（按所选实现的声明 key） */
    userParams?: Record<string, WorkflowUserParamValue>
    /** 视频自包含提交参数（画布【生成视频】节点提交） */
    video?: VideoWorkflowSubmitParams
    /** 统一尺寸配置（用户选择的原始完整尺寸：比例/尺寸档 + 可选自定义宽高） */
    sizeConfig?: WorkflowSizeConfig
    /**
     * 发起节点 id（画布节点提交时携带）。
     *
     * 随任务 params 持久化并登记进统一任务注册表：画布加载/切换/刷新后按
     * 「项目 + 画布 scope + 节点仍在画布上」恢复节点 Loading，任务未结束则保持加载中。
     */
    nodeId?: string
    /** 画布定位（画布节点提交时携带；与 nodeId 配对用于恢复过滤） */
    canvas?: CanvasTarget
  }
}

export async function getWorkflows(): Promise<WorkflowInfo[]> {
  const { data } = await client.get<{ workflows: WorkflowInfo[] }>('/workflows')
  return data.workflows
}

export interface BatchRunParams {
  project: string
  assetTypes: string[]
  concurrency?: number
  overwrite?: boolean
  /** 资产类型 → 工作流实现（前端勾选资产类型后手动选择） */
  implByAssetType?: Record<string, string>
  /** 资产类型 → 用户手动传入的工作流参数（按该资产类型所选实现的声明 key） */
  userParamsByAssetType?: Record<string, Record<string, WorkflowUserParamValue>>
  /** 资产类型 → 统一尺寸配置（用户选择的原始完整尺寸） */
  sizeConfigByAssetType?: Record<string, WorkflowSizeConfig>
}

export interface BatchSummary {
  batch_id: string
  project: string
  total: number
  completed: number
  failed: number
  running: number
  pending: number
}

export async function runWorkflow(body: WorkflowRunParams): Promise<{ taskId: string; status: string }> {
  const { data } = await client.post<{ taskId: string; status: string }>('/workflow/run', body)
  return data
}

export async function runBatch(body: BatchRunParams): Promise<{ batchId: string | null; totalTasks: number; project: string }> {
  const { data } = await client.post<{ batchId: string | null; totalTasks: number; project: string }>('/workflow/batch-run', body)
  return data
}

export async function getBatchStatus(batchId: string): Promise<BatchSummary> {
  const { data } = await client.get<BatchSummary>(`/workflow/batch/${batchId}`)
  return data
}

export async function getTaskStatus(taskId: string): Promise<TaskResponse> {
  const { data } = await client.get<TaskResponse>(`/workflow/tasks/${taskId}`)
  return data
}

/**
 * 查询任务列表（支持项目 / 状态 / 批次 / 时间范围过滤与分页）。
 *
 * 任务管理器「进行中」走统一任务注册表（WS），「历史」页签走本接口（SQLite 持久化权威）。
 *
 * @param options.project 项目名过滤
 * @param options.status 状态过滤（pending / running / completed / failed）
 * @param options.batchId 批次 id 过滤
 * @param options.since 创建时间下界（ISO 字符串或 `YYYY-MM-DD`）
 * @param options.until 创建时间上界（ISO 字符串或 `YYYY-MM-DD`）
 * @param options.limit 分页大小（省略 = 不分页）
 * @param options.offset 分页偏移（仅 limit 生效时有意义）
 * @returns 当前页任务与满足条件的总数
 */
export async function listTasks(options: {
  project?: string
  status?: string
  batchId?: string
  since?: string
  until?: string
  limit?: number
  offset?: number
} = {}): Promise<{ tasks: TaskResponse[]; total: number }> {
  const params = new URLSearchParams()
  if (options.project) params.set('project', options.project)
  if (options.status) params.set('status', options.status)
  if (options.batchId) params.set('batchId', options.batchId)
  if (options.since) params.set('since', options.since)
  if (options.until) params.set('until', options.until)
  if (options.limit) params.set('limit', String(options.limit))
  if (options.offset) params.set('offset', String(options.offset))
  const { data } = await client.get<{ tasks: TaskResponse[]; total: number }>(`/workflow/tasks?${params}`)
  return { tasks: data.tasks, total: data.total ?? data.tasks.length }
}

/** 任务日志读取结果 */
export interface TaskLogsResult {
  /** 日志条目（按写入顺序正序） */
  logs: LogEntry[]
  /** 该任务日志总行数（不受 limit 影响） */
  total: number
  /** 本次生效的条数上限（0 = 全量） */
  limit: number
  /** 是否因 limit 截断（true 时 logs 只是尾部片段） */
  truncated: boolean
}

/**
 * 读取任务日志。
 *
 * @param taskId 任务 id
 * @param options.limit 只取最后 N 条（省略或 0 = 全量）：
 *   画布节点轮询用 1（只要最后一条用于展示），日志查看器用 200 起步
 * @returns 日志条目与截断信息
 */
export async function getTaskLogs(taskId: string, options: { limit?: number } = {}): Promise<TaskLogsResult> {
  const params = new URLSearchParams()
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  const query = params.toString()
  const { data } = await client.get<{ logs: LogEntry[]; total?: number; limit?: number; truncated?: boolean }>(
    `/workflow/tasks/${taskId}/log${query ? `?${query}` : ''}`,
  )
  return {
    logs: data.logs,
    total: data.total ?? data.logs.length,
    limit: data.limit ?? 0,
    truncated: data.truncated ?? false,
  }
}

export async function retryTask(taskId: string): Promise<{ taskId: string; status: string }> {
  const { data } = await client.post<{ taskId: string; status: string }>(`/workflow/retry/${taskId}`)
  return data
}

/** 中断工作流任务的返回结果 */
export interface CancelWorkflowResult {
  /** 被中断的任务 id */
  taskId: string
  /** 中断后的任务状态（如 failed/cancelled） */
  status: string
}

/**
 * 中断工作流任务（调用后端 cancel 端点：本地排队直接失败 / 运行中调 Bridge cancel）。
 * 仅对 capabilities.cancelable 的工作流有效，其余后端返回 400。
 *
 * @param taskId 要中断的任务 id
 * @returns 中断结果（taskId + 中断后状态）
 */
export async function cancelWorkflow(taskId: string): Promise<CancelWorkflowResult> {
  const { data } = await client.post<CancelWorkflowResult>(`/workflow/tasks/${taskId}/cancel`)
  return data
}
