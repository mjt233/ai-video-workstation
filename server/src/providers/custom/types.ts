/**
 * 自定义服务商（custom provider）的数据结构定义与校验。
 *
 * 用户在「自定义服务商」实例配置中以 TypeScript 代码描述工作流接口的
 * 调用发起 / 结果提取 / 取消调用；本模块负责把 config.workflows 组件的
 * 原始 JSON 值解析为强类型条目，并在解析期给出中文错误提示。
 */

/** 系统支持的工作流类型（与 workflows/types.ts 的 WorkflowTypeId 一致） */
export const CUSTOM_WORKFLOW_TYPES = [
  'text-to-image',
  'image-edit',
  'tts-voice-design',
  'tts-voice-clone',
  'image-to-video',
] as const;

/** 系统支持的工作流类型标识 */
export type CustomWorkflowType = (typeof CUSTOM_WORKFLOW_TYPES)[number];

/** 用户配置字段支持的类型（与 workflows/types.ts 的 WorkflowUserParamType 一致，便于复用运行表单） */
export const CUSTOM_USER_CONFIG_FIELD_TYPES = [
  'boolean',
  'integer',
  'float',
  'string',
] as const;

/** 用户配置字段类型标识 */
export type CustomUserConfigFieldType = (typeof CUSTOM_USER_CONFIG_FIELD_TYPES)[number];

/**
 * 用户配置字段声明。
 *
 * 运行工作流时，前端按声明渲染输入表单（默认值回填），用户填写后经 vars
 * 进入自定义工作流 ctx.userConfig（按类型转换为原生值）。编辑器据此生成
 * ctx.userConfig 的类型提示。
 */
export interface CustomUserConfigField {
  /** 字段 key（在工作流条目内唯一；运行时 ctx.userConfig 的键名） */
  key: string;
  /** 显示名（表单标签） */
  name: string;
  /** 字段类型（决定表单控件与 ctx.userConfig 的原生值类型） */
  type: CustomUserConfigFieldType;
  /** 默认值（字符串形式；用户未填写时使用） */
  defaultValue: string;
  /** 可选说明文案（表单 hint） */
  description?: string;
}

/** 尺寸配置候选全集：比例（与前端 custom-provider.ts 的 SIZE_CONFIG_*_OPTIONS 一致，亦为统一尺寸组件注册表子集；auto/adaptive 均表示自适应） */
export const CUSTOM_SIZE_RATIO_OPTIONS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', 'auto', 'adaptive'] as const;

/** 尺寸档候选全集（与前端 custom-provider.ts 的 SIZE_CONFIG_*_OPTIONS 一致） */
export const CUSTOM_SIZE_SIZE_OPTIONS = ['360P', '480P', '720P', '768P', '1080P', '1K', '1.5K', '2K', '3K', '4K', '8K', 'auto'] as const;

/** 尺寸配置默认值（与 WorkflowCapabilities.size 默认一致；未配置条目使用） */
export const DEFAULT_CUSTOM_WORKFLOW_SIZE_CONFIG: CustomWorkflowSizeConfig = {
  ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', 'auto'],
  size: ['360P', '720P', '1080P', '2K', '4K', 'auto'],
  supportCustomSize: true,
};

/**
 * 工作流输出尺寸配置（条目级，适用于该条目声明的全部生图/生视频类型）。
 *
 * 用户在「新增/编辑工作流」表单中配置允许使用的比例/尺寸/自定义分辨率；
 * 注册时映射为 WorkflowCapabilities.size（前端统一尺寸组件据此渲染选项），
 * 执行时经 ctx.params.sizeConfig（比例/尺寸档 + 可选自定义宽高）供自定义脚本读取。
 */
export interface CustomWorkflowSizeConfig {
  /** 允许的比例清单（含 "auto" 表示自适应）；空数组 = 使用默认全量 */
  ratio: string[];
  /** 允许的尺寸清单（含 "auto"）；空数组 = 使用默认全量 */
  size: string[];
  /** 是否允许指定任意宽高（自定义分辨率） */
  supportCustomSize: boolean;
}

/**
 * 解析工作流条目的尺寸配置（原始 JSON 值）。
 *
 * 缺失 / null / 空串 → 返回 null（使用默认全量，兼容旧条目）；
 * 非对象抛中文错误；ratio/size 非数组抛错；元素非候选全集内字符串时过滤并告警
 * （向前兼容未来新增档位）；supportCustomSize 按 === true 解析。
 *
 * @param raw 原始值（条目 sizeConfig 字段）
 * @param where 错误提示前缀（条目位置 + 名称）
 * @returns 尺寸配置；未配置返回 null
 */
export function parseCustomWorkflowSizeConfig(
  raw: unknown,
  where: string,
): CustomWorkflowSizeConfig | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(where + '的输出尺寸配置需要是对象');
  }
  const rec = raw as Record<string, unknown>;
  return {
    ratio: parseSizeOptionList(rec.ratio, CUSTOM_SIZE_RATIO_OPTIONS, where + '的「比例」'),
    size: parseSizeOptionList(rec.size, CUSTOM_SIZE_SIZE_OPTIONS, where + '的「尺寸」'),
    supportCustomSize: rec.supportCustomSize === true,
  };
}

/**
 * 解析允许的比例/尺寸清单：非数组抛错；字符串项须在候选全集内（未知项过滤并告警）；去重。
 *
 * @param raw 原始值（允许清单）
 * @param allowed 候选全集
 * @param label 错误提示标签（如 条目名「比例」）
 * @returns 解析后的清单（可为空数组 = 使用默认全量）
 */
function parseSizeOptionList(
  raw: unknown,
  allowed: readonly string[],
  label: string,
): string[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) {
    throw new Error(label + '需要是数组');
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new Error(label + '的每项需要是字符串');
    }
    if (allowed.includes(item)) {
      if (!out.includes(item)) out.push(item);
    } else {
      // 未知档位（未来新增）：过滤并告警，保证旧配置可用、新档位向前兼容
      console.warn(`[custom] 忽略不支持的尺寸档位: ${item}`);
    }
  }
  return out;
}

/**
 * 自定义工作流条目（工作流配置组件的一行）。
 *
 * 一个条目可同时声明多个系统工作流类型（如 gpt-image-2 同时支持文生图与
 * 图片编辑）；实例同步器按「条目 × 类型」为每个类型注册一个可执行实现。
 */
export interface CustomWorkflowEntry {
  /** 工作流名称（在提供商侧唯一；同时作为 execute 的 workflowId 透传给用户代码） */
  name: string;
  /** 支持的系统工作流类型（非空；只允许 CUSTOM_WORKFLOW_TYPES 中的值） */
  types: CustomWorkflowType[];
  /** 是否异步请求：true 时【结果提取】被反复调用直到 isFinish，false 时仅调用一次 */
  async: boolean;
  /** 是否支持取消：true 时声明 cancelable 能力并必须提供【取消调用】代码 */
  cancelable: boolean;
  /** 【调用发起】TypeScript 代码：export default async function(ctx) 返回 http 请求配置 */
  callCode: string;
  /** 【结果提取】TypeScript 代码：export default async function(ctx, callResult) 返回 WorkflowResult */
  extractCode: string;
  /** 【取消调用】TypeScript 代码：export default async function(ctx, callResult) 调用远端取消接口 */
  cancelCode: string;
  /** 用户配置字段声明（运行工作流时由用户填写，经 ctx.userConfig 读取） */
  userConfigFields: CustomUserConfigField[];
  /** 输出尺寸配置（生图/生视频类型；缺省 null = 使用默认全量，代码中经 ctx.params.sizeConfig 读取） */
  sizeConfig: CustomWorkflowSizeConfig | null;
}

/** 判断值是否为系统支持的工作流类型 */
export function isCustomWorkflowType(value: unknown): value is CustomWorkflowType {
  return typeof value === 'string' && (CUSTOM_WORKFLOW_TYPES as readonly string[]).includes(value);
}

/**
 * 把工作流名称规范为可安全拼进 impl 标识的字符串。
 *
 * impl = custom-{sanitize(name)}-{instanceId}；只保留字母/数字/中文/下划线/连字符，
 * 其余字符替换为连字符，结果为空时回退为 'wf'。
 *
 * @param name 工作流名称
 * @returns 规范化后的名称片段
 */
export function sanitizeWorkflowName(name: string): string {
  const cleaned = name.replace(/[^0-9a-zA-Z\u4e00-\u9fa5_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned !== '' ? cleaned : 'wf';
}

/**
 * 解析单个工作流条目（原始 JSON 值）。
 *
 * 缺省字段补默认值；非法值抛出带条目位置的中文错误。
 *
 * @param raw 原始值（config.workflows 数组元素）
 * @param index 条目下标（仅用于错误提示）
 * @returns 解析后的条目
 */
export function parseCustomWorkflowEntry(raw: unknown, index: number): CustomWorkflowEntry {
  const where = '工作流配置第 ' + (index + 1) + ' 项';
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(where + '需要是对象');
  }
  const rec = raw as Record<string, unknown>;
  const name = typeof rec.name === 'string' ? rec.name.trim() : '';
  if (!name) {
    throw new Error(where + '缺少工作流名称');
  }
  const typesRaw = rec.types;
  if (!Array.isArray(typesRaw) || typesRaw.length === 0 || !typesRaw.every(isCustomWorkflowType)) {
    throw new Error(where + '（' + name + '）的类型必须至少选择一个系统支持的工作流类型');
  }
  const types = [...new Set(typesRaw as CustomWorkflowType[])];
  const isAsync = rec.async === true;
  const cancelable = rec.cancelable === true;
  const codeOf = (key: 'callCode' | 'extractCode' | 'cancelCode'): string =>
    typeof rec[key] === 'string' ? rec[key] : '';
  const callCode = codeOf('callCode');
  const extractCode = codeOf('extractCode');
  const cancelCode = codeOf('cancelCode');
  if (cancelable && !cancelCode.trim()) {
    throw new Error(where + '（' + name + '）勾选了「支持取消」，必须编写「取消调用」代码');
  }
  const userConfigFields = parseUserConfigFields(rec.userConfigFields, where + '（' + name + '）');
  const sizeConfig = parseCustomWorkflowSizeConfig(rec.sizeConfig, where + '（' + name + '）');
  return {
    name,
    types,
    async: isAsync,
    cancelable,
    callCode,
    extractCode,
    cancelCode,
    userConfigFields,
    sizeConfig,
  };
}

/**
 * 解析用户配置字段声明（原始 JSON 值）。
 *
 * 缺失 / null / 空串视为未配置，返回空数组；每项必须是对象，
 * key 非空且不重复，type 非法时回退为 'string'。
 *
 * @param raw 原始值（条目 userConfigFields 字段）
 * @param where 错误提示前缀（条目位置 + 名称）
 * @returns 用户配置字段声明数组（可为空）
 */
export function parseUserConfigFields(
  raw: unknown,
  where: string,
): CustomUserConfigField[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) {
    throw new Error(where + '的用户配置字段需要是数组');
  }
  const out: CustomUserConfigField[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(where + '用户配置字段第 ' + (i + 1) + ' 项需要是对象');
    }
    const rec = item as Record<string, unknown>;
    const key = typeof rec.key === 'string' ? rec.key.trim() : '';
    if (!key) {
      throw new Error(where + '用户配置字段第 ' + (i + 1) + ' 项缺少 key');
    }
    if (seen.has(key)) {
      throw new Error(where + '用户配置字段 key 重复: ' + key);
    }
    seen.add(key);
    const type = typeof rec.type === 'string'
      && (CUSTOM_USER_CONFIG_FIELD_TYPES as readonly string[]).includes(rec.type)
      ? rec.type as CustomUserConfigFieldType
      : 'string';
    const name = typeof rec.name === 'string' && rec.name.trim() !== ''
      ? rec.name.trim()
      : key;
    const defaultValue = typeof rec.defaultValue === 'string' ? rec.defaultValue : '';
    const description = typeof rec.description === 'string' && rec.description.trim() !== ''
      ? rec.description.trim()
      : undefined;
    out.push({
      key,
      name,
      type,
      defaultValue,
      ...(description !== undefined ? { description } : {}),
    });
  }
  return out;
}

/**
 * 解析 config.workflows 原始值为工作流条目数组。
 *
 * 缺失 / 空数组 / 空串均视为「未配置工作流」，返回空数组；
 * 名称重复时报错（同步器与执行客户端均按名称查找条目）。
 *
 * @param raw config.workflows 的原始 JSON 值
 * @returns 工作流条目数组（可为空）
 */
export function parseCustomWorkflows(raw: unknown): CustomWorkflowEntry[] {
  if (raw === undefined || raw === null || raw === '') return [];
  if (!Array.isArray(raw)) {
    throw new Error('工作流配置需要是数组');
  }
  const entries = raw.map((item, i) => parseCustomWorkflowEntry(item, i));
  const names = new Set<string>();
  for (const e of entries) {
    if (names.has(e.name)) {
      throw new Error('工作流名称重复: ' + e.name);
    }
    names.add(e.name);
  }
  return entries;
}
