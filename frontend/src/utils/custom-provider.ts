/**
 * 自定义服务商前端工具：代码模板与 Monaco TypeScript 类型库生成。
 *
 * 类型库与服务端 providers/custom/runtime.ts 的运行时契约保持一致：
 * WorkflowCallContext / WorkflowCallRequestConfig / WorkflowCallResult / WorkflowResult，
 * 以及按工作流类型组合的 ctx.params 类型提示。
 */
import { FALLBACK_WORKFLOW_TYPES, normalizeWorkflowType } from './workflow-types'

/** 通用代码块默认模板（新增自定义服务商时的起始代码） */
export const COMMON_CODE_TEMPLATE = [
  'export function getBaseCallConfig(ctx: WorkflowCallContext, model: string) {',
  '  return {',
  '    url: ctx.providerConfig.baseUrl,',
  "    header: {",
  "      Authorization: 'Bearer ' + ctx.providerConfig.apiKey",
  '    },',
  "    method: 'post',",
  '    data: {',
  '      model: model',
  '    }',
  '  }',
  '}',
].join('\n')

/** 【调用发起】默认模板（新增工作流时的起始代码） */
export const CALL_CODE_TEMPLATE = [
  '// ctx.session 类型为 Record<string, any>，ctx 在实例化时就默认赋值',
  '// ctx 在整个工作流发起调用、结果轮询与提取中都是同一个实例',
  '// 通用代码中导出的函数在这里可直接全局调用，且具有 monaco 编辑器代码提示',
  'export default async function(ctx: WorkflowCallContext) {',
  '  // 返回发起工作流调用的 http 请求配置',
  "  const conf = getBaseCallConfig(ctx, 'gpt-image-2')",
  '',
  '  // ctx.params 会根据工作流支持的类型动态提示 ts 类型',
  '  conf.data.prompt = ctx.params.prompt',
  '',
  '  // 需要返回一个 http 调用配置',
  '  return conf',
  '}',
].join('\n')

/** 【结果提取】默认模板 */
export const EXTRACT_CODE_TEMPLATE = [
  '// callResult 为【调用发起】的 http 请求响应对象',
  'export default async function(ctx: WorkflowCallContext, callResult: WorkflowCallResult): Promise<WorkflowResult> {',
  '  const taskId = callResult.data.task_id',
  '',
  '  const res = await ctx.request({',
  '    url: ctx.providerConfig.baseUrl + "/v1/tasks/" + taskId,',
  "    method: 'get',",
  '    header: {',
  "      Authorization: 'Bearer ' + ctx.providerConfig.apiKey",
  '    }',
  '  })',
  '',
  "  if (res.data.status == 'in_progress') {",
  '    return {',
  '      // 是否已完成',
  '      isFinish: false,',
  '      // 任务百分比进度，0~100。小于0或undefined或null表示未知',
  '      progress: res.data.progress',
  '    }',
  "  } else if (res.data.status == 'failed') {",
  '    return {',
  '      // 生成失败：failed 隐含已完成（无需返回 isFinish: true），轮询立即终止并标记任务失败',
  '      failed: true,',
  '      // 失败原因文案，会透传给任务失败信息',
  '      errorMessage: res.data.error',
  '    }',
  '  } else {',
  '    return {',
  '      isFinish: true,',
  '      // 工作流执行结果产物，http url 数组（仅取第一个写入产物）',
  '      outputs: res.data.data.map((e: any) => e.url)',
  '    }',
  '  }',
  '}',
].join('\n')

/** 【取消调用】默认模板 */
export const CANCEL_CODE_TEMPLATE = [
  '// ctx 与 callResult 与【调用发起】【结果提取】是同一个实例/响应',
  'export default async function(ctx: WorkflowCallContext, callResult: WorkflowCallResult) {',
  '  // 调用远端取消接口，如：',
  '  const taskId = callResult.data.task_id',
  '  await ctx.request({',
  '    url: ctx.providerConfig.baseUrl + "/v1/tasks/" + taskId + "/cancel",',
  "    method: 'post',",
  '    header: {',
  "      Authorization: 'Bearer ' + ctx.providerConfig.apiKey",
  '    }',
  '  })',
  '}',
].join('\n')

/** 测试代码默认模板 */
export const TEST_CODE_TEMPLATE = [
  '// 返回 true / false，或 { ok: boolean, message?: string }',
  'export default async function(ctx: WorkflowCallContext) {',
  '  const res = await ctx.request({',
  "    url: ctx.providerConfig.baseUrl + '/health',",
  "    method: 'get',",
  '    header: {',
  "      Authorization: 'Bearer ' + ctx.providerConfig.apiKey",
  '    }',
  '  })',
  '  return res.status === 200',
  '}',
].join('\n')

/** 用户配置字段支持的类型（与服务端 CUSTOM_USER_CONFIG_FIELD_TYPES 一致） */
export const USER_CONFIG_FIELD_TYPES = ['boolean', 'integer', 'float', 'string'] as const

/** 用户配置字段类型标识 */
export type UserConfigFieldType = (typeof USER_CONFIG_FIELD_TYPES)[number]

/** 尺寸配置候选全集：比例（与服务端 CUSTOM_SIZE_RATIO_OPTIONS 一致，亦为统一尺寸组件注册表子集；auto/adaptive 均表示自适应） */
export const SIZE_CONFIG_RATIO_OPTIONS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', 'auto', 'adaptive'] as const

/** 尺寸配置候选全集：尺寸档（与服务端 CUSTOM_SIZE_SIZE_OPTIONS 一致） */
export const SIZE_CONFIG_SIZE_OPTIONS = ['360P', '480P', '720P', '768P', '1080P', '1K', '1.5K', '2K', '3K', '4K', '8K', 'auto'] as const

/**
 * 工作流输出尺寸配置（工作流条目内配置；适用于生图/生视频类型）。
 *
 * 运行表单限定统一尺寸组件的可选比例/尺寸与自定义分辨率开关；
 * 代码中通过 ctx.params.sizeConfig（比例/尺寸档 + 可选自定义宽高）读取，
 * 编辑器按本配置生成 CustomSizeConfig 的字面量联合类型提示。
 */
export interface CustomWorkflowSizeConfigDef {
  /** 允许的比例清单（含 "auto" 表示自适应；空数组 = 使用默认全量） */
  ratio: string[]
  /** 允许的尺寸清单（含 "auto"；空数组 = 使用默认全量） */
  size: string[]
  /** 是否允许指定任意宽高（自定义分辨率） */
  supportCustomSize: boolean
}

/**
 * 用户配置字段声明（工作流条目内配置）。
 *
 * 运行工作流时前端按声明渲染输入表单；代码编辑器中按声明生成
 * ctx.userConfig 的类型提示（boolean → boolean，integer/float → number，string → string）。
 */
export interface UserConfigFieldDef {
  /** 字段 key（条目内唯一；ctx.userConfig 的键名） */
  key: string
  /** 显示名（表单标签） */
  name: string
  /** 字段类型 */
  type: UserConfigFieldType
  /** 默认值（字符串形式） */
  defaultValue: string
  /** 可选说明文案（表单 hint） */
  description?: string
}

/** 各工作流类型 params 接口（按需包含进上下文库） */
const PARAM_INTERFACES: Record<string, string> = {
  'text-to-image': [
    'declare interface TextToImageParams {',
    '  /** 提示词（服务端已从 promptPath 读取） */',
    '  prompt: string',
    '  /** 输出宽度（像素，可选） */',
    '  width?: number',
    '  /** 输出高度（像素，可选） */',
    '  height?: number',
    '  /** 输出尺寸配置（比例/尺寸档 + 可选自定义宽高；用户在工作流表单限定可选档位） */',
    '  sizeConfig?: CustomSizeConfig',
    '  /** 随机种子（字符串） */',
    '  seed?: string',
    '  /** 其他业务变量（字符串键值） */',
    '  [key: string]: any',
    '}',
  ].join('\n'),
  'image-edit': [
    'declare interface ImageEditParams {',
    '  /** 编辑描述 / 合成提示词 */',
    '  prompt: string',
    '  /** 输入图片相对路径列表（服务端已解析为数组） */',
    '  imagePaths: string[]',
    '  /** 输出宽度（像素，可选） */',
    '  width?: number',
    '  /** 输出高度（像素，可选） */',
    '  height?: number',
    '  /** 输出尺寸配置（比例/尺寸档 + 可选自定义宽高；用户在工作流表单限定可选档位） */',
    '  sizeConfig?: CustomSizeConfig',
    '  /** 随机种子（字符串） */',
    '  seed?: string',
    '  [key: string]: any',
    '}',
  ].join('\n'),
  'tts-voice-design': [
    'declare interface TtsVoiceDesignParams {',
    '  /** 声线描述 */',
    '  prompt: string',
    '  /** 待合成朗读文本 */',
    '  text: string',
    '  /** 随机种子（字符串） */',
    '  seed?: string',
    '  [key: string]: any',
    '}',
  ].join('\n'),
  'tts-voice-clone': [
    'declare interface TtsVoiceCloneParams {',
    '  /** 待合成朗读文本 */',
    '  text: string',
    '  /** 参考音频文字内容 */',
    '  refText: string',
    '  /** 参考音频相对路径列表（服务端已解析为数组） */',
    '  refAudioPath: string[]',
    '  /** 随机种子（字符串） */',
    '  seed?: string',
    '  [key: string]: any',
    '}',
  ].join('\n'),
  'image-to-video': [
    'declare interface ImageToVideoParams {',
    '  /** 视频生成提示词 */',
    '  prompt: string',
    '  /** 生成模式：director / first-last-frame / reference */',
    '  mode: string',
    '  /** 视频时长（秒） */',
    '  duration: number',
    '  /** 输出分辨率 */',
    '  resolution: { width: number; height: number }',
    '  /** 输出尺寸配置（比例/尺寸档 + 可选自定义宽高；用户在工作流表单限定可选档位） */',
    '  sizeConfig?: CustomSizeConfig',
    '  /** 帧率（可选） */',
    '  fps?: number',
    '  /** 随机种子 */',
    '  seed?: number | string',
    '  /** 导演台/首尾帧数据（mode 为 director / first-last-frame 时存在） */',
    '  director?: { frames: Array<{ file: File; cursor: number }>; audio?: File }',
    '  /** 参考素材（mode=reference 时存在） */',
    "  references?: Array<{ type: 'image' | 'video' | 'audio'; file: File }>",
    '  [key: string]: any',
    '}',
  ].join('\n'),
}

/** 核心类型库（WorkflowCallRequestConfig / WorkflowCallResult / WorkflowResult） */
const CORE_LIB = [
  'declare interface WorkflowCallRequestConfig {',
  '  /** 请求地址（必填） */',
  '  url: string',
  "  /** 请求方法，默认 post */",
  '  method?: string',
  '  /** 请求头（键值对） */',
  '  header?: Record<string, string>',
  '  /** 请求体：普通对象按 JSON 序列化；FormData（含 File）按 multipart 上传 */',
  '  data?: any',
  '  /** URL 查询参数（自动拼接到 url） */',
  '  params?: Record<string, unknown>',
  '  /** 单次请求超时（毫秒），默认 120000 */',
  '  timeout?: number',
  '}',
  'declare interface WorkflowCallResult {',
  '  /** 响应体：JSON 自动反序列化，否则为原文 */',
  '  data: any',
  '  /** HTTP 状态码 */',
  '  status: number',
  '  /** 响应头（键值对） */',
  '  headers: Record<string, string>',
  '}',
  'declare interface WorkflowResult {',
  '  /** 工作流是否已执行完成（failed: true 时隐含已完成，可省略） */',
  '  isFinish?: boolean',
  '  /** 本次生成是否失败：true 时任务立即判定失败并结束（隐含已完成，无需 isFinish: true） */',
  '  failed?: boolean',
  '  /** 失败原因文案（failed 为 true 时透传给任务失败信息；可选） */',
  '  errorMessage?: string',
  '  /** 任务进度百分比（0~100）；小于 0 / undefined / null 表示未知 */',
  '  progress?: number | null',
  '  /** 工作流执行结果产物（http url 数组，仅取第一个写入产物） */',
  '  outputs?: string[]',
  '}',
].join('\n')

/**
 * 生成 ctx.userConfig 的类型声明库。
 *
 * 有字段时生成带可选键的 interface（按字段类型映射：boolean → boolean，
 * integer/float → number，string → string）；无字段时回退宽松索引签名。
 *
 * @param fields 用户配置字段声明
 * @returns d.ts 片段（CustomUserConfig 类型）
 */
export function buildUserConfigLib(fields: UserConfigFieldDef[] | undefined): string {
  const list = Array.isArray(fields) ? fields : []
  if (list.length === 0) {
    return 'type CustomUserConfig = Record<string, boolean | number | string>'
  }
  const lines: string[] = []
  for (const field of list) {
    if (!field.key?.trim()) continue
    // 单引号包裹 key（转义其中的单引号与反斜杠），保证非法标识符也能作属性名
    const key = "'" + field.key.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
    const jsType = field.type === 'boolean'
      ? 'boolean'
      : field.type === 'integer' || field.type === 'float'
        ? 'number'
        : 'string'
    const doc = [field.name, field.description].filter(Boolean).join('：').replace(/\*\//g, '＊/').replace(/\n/g, ' ')
    if (doc) lines.push('  /** ' + doc + ' */')
    lines.push('  ' + key + '?: ' + jsType)
  }
  return 'declare interface CustomUserConfig {\n' + lines.join('\n') + '\n}'
}

/**
 * 生成 ctx.params.sizeConfig 的类型声明库（CustomSizeConfig）。
 *
 * ratio/size 按该条目配置的允许清单生成字面量联合（如 "'16:9' | '4:3' | 'auto'"）；
 * 清单为空（= 使用默认全量）时回退全部候选全集；均未配置时回退 string 宽松提示。
 *
 * @param sizeConfig 工作流条目的输出尺寸配置（可选）
 * @returns d.ts 片段（CustomSizeConfig 类型）
 */
export function buildSizeConfigLib(sizeConfig?: CustomWorkflowSizeConfigDef | undefined): string {
  const ratioList = sizeConfig?.ratio?.length
    ? sizeConfig.ratio
    : [...SIZE_CONFIG_RATIO_OPTIONS]
  const sizeList = sizeConfig?.size?.length
    ? sizeConfig.size
    : [...SIZE_CONFIG_SIZE_OPTIONS]
  const ratioUnion =
    ratioList
      .filter((v) => typeof v === 'string' && v !== '')
      .map((v) => "'" + v + "'")
      .join(' | ') || 'string'
  const sizeUnion =
    sizeList
      .filter((v) => typeof v === 'string' && v !== '')
      .map((v) => "'" + v + "'")
      .join(' | ') || 'string'
  return [
    'declare interface CustomSizeConfig {',
    '  /** 比例档（如 "16:9"；"auto"/"adaptive" 表示自适应） */',
    '  ratio?: ' + ratioUnion,
    '  /** 尺寸档（如 "2K"；"auto" 表示自适应） */',
    '  size?: ' + sizeUnion,
    '  /** 输出宽度（像素；仅支持自定义分辨率的工作流携带） */',
    '  width?: number',
    '  /** 输出高度（像素；仅支持自定义分辨率的工作流携带） */',
    '  height?: number',
    '}',
  ].join('\n')
}

/**
 * 构建 WorkflowCallContext 类型库。
 *
 * 按所选工作流类型动态组合 ctx.params 类型：
 * type CustomParams = TextToImageParams & ImageEditParams & ...
 * 未选类型时回退 Record<string, any>；
 * ctx.userConfig 按用户配置字段声明生成类型提示；
 * ctx.params.sizeConfig 按工作流条目输出尺寸配置生成字面量联合类型提示。
 *
 * @param types 该工作流支持的系统工作流类型
 * @param userConfigFields 用户配置字段声明（可选）
 * @param sizeConfig 工作流条目输出尺寸配置（可选）
 * @returns d.ts 库文本
 */
export function buildContextLib(
  types: string[],
  userConfigFields?: UserConfigFieldDef[],
  sizeConfig?: CustomWorkflowSizeConfigDef | undefined,
): string {
  const picked = (types ?? []).filter((t) => PARAM_INTERFACES[t])
  const paramLibs = picked.map((t) => PARAM_INTERFACES[t]).join('\n\n')
  const paramsType = picked.length > 0
    ? picked.map((t) => t === 'text-to-image' ? 'TextToImageParams' : t === 'image-edit' ? 'ImageEditParams' : t === 'tts-voice-design' ? 'TtsVoiceDesignParams' : t === 'tts-voice-clone' ? 'TtsVoiceCloneParams' : 'ImageToVideoParams').join(' & ')
    : 'Record<string, any>'
  return [
    CORE_LIB,
    paramLibs,
    buildSizeConfigLib(sizeConfig),
    buildUserConfigLib(userConfigFields),
    // 系统支持的工作流类型联合（与 WORKFLOW_TYPE_META / FALLBACK_WORKFLOW_TYPES 保持一致）
    'type CustomWorkflowTypeId = ' + FALLBACK_WORKFLOW_TYPES.map((t) => "'" + t + "'").join(' | '),
    'type CustomParams = ' + paramsType,
    'declare interface WorkflowCallContext {',
    '  /** 服务商已解析配置（含 baseUrl / apiKey / timeout 及其他字段） */',
    '  providerConfig: { baseUrl?: string; apiKey?: string; [key: string]: any }',
    '  /** 发起 http 调用（axios 风格返回） */',
    '  request(conf: WorkflowCallRequestConfig): Promise<WorkflowCallResult>',
    '  /** 本次工作流调用的输入参数（按支持的类型动态组合） */',
    '  params: CustomParams',
    '  /** 任务级共享存储（实例化时默认赋值 {}） */',
    '  session: Record<string, any>',
    '  /** 项目配置（画面宽高/帧率，可选） */',
    '  projectConfig?: { width?: number; height?: number; fps?: number }',
    '  /** 读取项目内文本文件（UTF-8） */',
    '  readFile?(relPath: string): Promise<string>',
    '  /** 读取项目 assert/ 下二进制文件为 File 对象 */',
    '  readAssertFile?(relPath: string): Promise<File>',
    '  /** 读取项目内任意文件并转为 Base64；withDataPrefix 为 true 时自动添加 data:<mime>;base64, 前缀（MIME 按扩展名推断） */',
    '  readFileToBase64?(relPath: string, withDataPrefix?: boolean): Promise<string>',
    '  /** 本次调用的工作流类型（系统支持的类型之一） */',
    '  workflowType?: CustomWorkflowTypeId',
    '  /** 用户配置字段值（按声明类型自动提示；未填写时用声明默认值） */',
    '  userConfig: CustomUserConfig',
    '}',
  ].join('\n')
}

/**
 * 从通用代码块生成全局声明库（供工作流代码编辑器补全通用代码导出的函数）。
 *
 * 实现：识别 export function（保留签名、去掉函数体）、export const（声明为 any）、
 * export interface / type（去掉 export 关键字），输出为 ambient 全局声明；
 * 解析失败静默跳过（仅影响代码提示，不影响执行）。
 *
 * @param code 通用代码块文本
 * @returns d.ts 库文本
 */
export function buildCommonGlobalsLib(code: string): string {
  const src = typeof code === 'string' ? code : ''
  if (!src.trim()) return ''
  const out: string[] = []

  // export [async] function name(...): Type {  → declare function name(...): Type;
  const fnRe = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = fnRe.exec(src)) !== null) {
    const name = m[1]
    const openParen = m.index + m[0].length - 1
    let depth = 0
    let closeParen = -1
    for (let i = openParen; i < src.length; i++) {
      const ch = src[i]
      if (ch === '(') depth++
      else if (ch === ')') {
        depth--
        if (depth === 0) {
          closeParen = i
          break
        }
      }
    }
    if (closeParen < 0) continue
    const tail = src.slice(closeParen + 1, closeParen + 300)
    const braceIdx = tail.indexOf('{')
    let returnType = 'any'
    if (braceIdx >= 0) {
      const annot = tail.slice(0, braceIdx).trim()
      if (annot.startsWith(':')) returnType = annot.slice(1).trim() || 'any'
    }
    out.push('declare function ' + name + '(' + src.slice(openParen + 1, closeParen) + '): ' + returnType)
    fnRe.lastIndex = closeParen
  }

  // export const name = ...  → declare const name: any;
  const constRe = /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g
  while ((m = constRe.exec(src)) !== null) {
    out.push('declare const ' + m[1] + ': any')
  }

  // export interface X { ... } → 去掉 export（顶层级大括号配对）
  const interfaceRe = /export\s+interface\s+([A-Za-z_$][\w$]*)\s*\{/g
  while ((m = interfaceRe.exec(src)) !== null) {
    const open = src.indexOf('{', m.index)
    let depth = 0
    let close = -1
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') {
        depth--
        if (depth === 0) {
          close = i
          break
        }
      }
    }
    if (close < 0) continue
    out.push('interface ' + m[1] + ' ' + src.slice(open, close + 1))
    interfaceRe.lastIndex = close
  }

  // export type X = ...; → 去掉 export（到第一个分号或换行+非续行）
  const typeRe = /export\s+type\s+[A-Za-z_$][\w$]*[^;\n]*;?/g
  while ((m = typeRe.exec(src)) !== null) {
    out.push(m[0].replace(/^export\s+/, ''))
  }

  return out.filter((line) => line.trim()).join('\n')
}

/** 自定义工作流条目（前端表单结构，与服务端 CustomWorkflowEntry 对齐） */
export interface CustomWorkflowFormEntry {
  /** 工作流名称（提供商侧唯一） */
  name: string
  /** 支持的系统工作流类型 */
  types: string[]
  /** 是否异步请求 */
  async: boolean
  /** 是否支持取消 */
  cancelable: boolean
  /** 【调用发起】代码 */
  callCode: string
  /** 【结果提取】代码 */
  extractCode: string
  /** 【取消调用】代码 */
  cancelCode: string
  /** 用户配置字段声明（运行工作流时由用户填写，经 ctx.userConfig 读取） */
  userConfigFields?: UserConfigFieldDef[]
  /** 输出尺寸配置（生图/生视频类型；缺省 undefined = 使用默认全量，经 ctx.params.sizeConfig 读取） */
  sizeConfig?: CustomWorkflowSizeConfigDef | undefined
}

/**
 * 把外部 v-model 规范为工作流条目数组（非法值回退为空数组，避免渲染崩溃）。
 *
 * @param value 外部传入值
 * @returns 可用于编辑的条目数组
 */
export function normalizeWorkflowEntries(value: unknown): CustomWorkflowFormEntry[] {
  if (!Array.isArray(value)) return []
  const out: CustomWorkflowFormEntry[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    out.push({
      name: typeof rec.name === 'string' ? rec.name : '',
      // 兼容旧数据：把误存的中文标签（如「文生图」）规范回类型 id
      types: Array.isArray(rec.types)
        ? rec.types
            .filter((t): t is string => typeof t === 'string')
            .map(normalizeWorkflowType)
        : [],
      async: rec.async === true,
      cancelable: rec.cancelable === true,
      // 缺省为空串：代码模板不再默认注入，由用户点击「插入模板」按钮自行插入
      callCode: typeof rec.callCode === 'string' ? rec.callCode : '',
      extractCode: typeof rec.extractCode === 'string' ? rec.extractCode : '',
      cancelCode: typeof rec.cancelCode === 'string' ? rec.cancelCode : '',
      userConfigFields: normalizeUserConfigFields(rec.userConfigFields),
      sizeConfig: normalizeWorkflowSizeConfig(rec.sizeConfig),
    })
  }
  return out
}

/**
 * 把外部值规范为工作流输出尺寸配置（非法项丢弃；未配置返回 undefined = 使用默认全量）。
 *
 * 校验依据候选全集（与服务端 CUSTOM_SIZE_*_OPTIONS 一致）：未知档位过滤，
 * 支持向前兼容未来新增档位；supportCustomSize 按 === true 解析。
 *
 * @param value 原始值（条目 sizeConfig 字段）
 * @returns 尺寸配置；未配置/非法返回 undefined
 */
export function normalizeWorkflowSizeConfig(value: unknown): CustomWorkflowSizeConfigDef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const rec = value as Record<string, unknown>
  const pick = (raw: unknown, allowed: readonly string[]): string[] => {
    if (!Array.isArray(raw)) return []
    const out: string[] = []
    for (const item of raw) {
      if (typeof item === 'string' && (allowed as readonly string[]).includes(item) && !out.includes(item)) {
        out.push(item)
      }
    }
    return out
  }
  return {
    ratio: pick(rec.ratio, SIZE_CONFIG_RATIO_OPTIONS),
    size: pick(rec.size, SIZE_CONFIG_SIZE_OPTIONS),
    supportCustomSize: rec.supportCustomSize === true,
  }
}

/**
 * 把外部值规范为用户配置字段声明数组（非法项丢弃，type 非法回退 'string'）。
 *
 * @param value 原始值（条目 userConfigFields 字段）
 * @returns 用户配置字段声明数组（可为空）
 */
export function normalizeUserConfigFields(value: unknown): UserConfigFieldDef[] {
  if (!Array.isArray(value)) return []
  const out: UserConfigFieldDef[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const key = typeof rec.key === 'string' ? rec.key.trim() : ''
    if (!key) continue
    const type = USER_CONFIG_FIELD_TYPES.includes(rec.type as UserConfigFieldType)
      ? (rec.type as UserConfigFieldType)
      : 'string'
    out.push({
      key,
      name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : key,
      type,
      defaultValue: typeof rec.defaultValue === 'string' ? rec.defaultValue : '',
      ...(typeof rec.description === 'string' && rec.description.trim()
        ? { description: rec.description.trim() }
        : {}),
    })
  }
  return out
}

/**
 * 插入代码模板：空编辑器直接填充模板；已有代码则在末尾追加（不覆盖用户内容）。
 *
 * @param current 当前代码文本
 * @param template 模板文本
 * @returns 插入后的代码文本
 */
export function insertCodeTemplate(current: string, template: string): string {
  if (!current.trim()) return template
  return current.replace(/\s+$/, '') + '\n' + template
}

/**
 * 为复制出的工作流生成不与现有名称冲突的新名称。
 *
 * 规则：空名回退为「未命名」；首次加「 副本」，已被占用则追加序号（「 副本 2」起）。
 *
 * @param sourceName 被复制工作流的原名称
 * @param existingNames 当前列表中已占用的名称
 * @returns 不冲突的新名称
 */
export function nextDuplicatedWorkflowName(sourceName: string, existingNames: Iterable<string>): string {
  const taken = new Set(existingNames)
  const base = sourceName.trim() || '未命名'
  const first = base + ' 副本'
  if (!taken.has(first)) return first
  let n = 2
  while (taken.has(base + ' 副本 ' + n)) n++
  return base + ' 副本 ' + n
}

/**
 * 深拷贝一条工作流，并换成不冲突的新名称（用于列表原地复制）。
 *
 * @param entry 被复制的工作流条目
 * @param existingNames 当前列表中已占用的名称
 * @returns 可直接插入列表的新条目
 */
export function duplicateWorkflowEntry(
  entry: CustomWorkflowFormEntry,
  existingNames: Iterable<string>,
): CustomWorkflowFormEntry {
  return {
    name: nextDuplicatedWorkflowName(entry.name, existingNames),
    types: [...entry.types],
    async: entry.async,
    cancelable: entry.cancelable,
    callCode: entry.callCode,
    extractCode: entry.extractCode,
    cancelCode: entry.cancelCode,
    userConfigFields: (entry.userConfigFields ?? []).map((field) => ({ ...field })),
    ...(entry.sizeConfig
      ? {
          sizeConfig: {
            ratio: [...entry.sizeConfig.ratio],
            size: [...entry.sizeConfig.size],
            supportCustomSize: entry.sizeConfig.supportCustomSize,
          },
        }
      : {}),
  }
}

/**
 * 校验工作流表单条目，返回错误文案（空数组 = 通过）。
 *
 * @param entry 待保存的条目
 * @returns 错误文案列表
 */
export function validateWorkflowEntry(entry: CustomWorkflowFormEntry): string[] {
  const errors: string[] = []
  if (!entry.name.trim()) errors.push('请填写工作流名称')
  if (entry.types.length === 0) errors.push('请至少选择一个工作流类型')
  if (!entry.callCode.trim()) errors.push('请编写「调用发起」代码')
  if (!entry.extractCode.trim()) errors.push('请编写「结果提取」代码')
  if (entry.cancelable && !entry.cancelCode.trim()) errors.push('勾选「支持取消」后必须编写「取消调用」代码')
  const fields = entry.userConfigFields ?? []
  for (const field of fields) {
    if (!field.key.trim()) errors.push('用户配置字段存在空的 key')
    if (!USER_CONFIG_FIELD_TYPES.includes(field.type)) errors.push('用户配置字段「' + (field.key || '未命名') + '」类型非法')
  }
  const keys = fields.map((field) => field.key.trim()).filter(Boolean)
  if (new Set(keys).size !== keys.length) errors.push('用户配置字段 key 不能重复')
  return errors
}
