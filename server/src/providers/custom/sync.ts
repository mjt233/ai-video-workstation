/**
 * 自定义服务商实例工作流同步。
 *
 * 按实例配置中的工作流条目动态注册可执行工作流：
 * 每个条目 × 每个声明的工作流类型注册一个实现（impl = custom-{name}-{instanceId}），
 * submit 按工作流类型把引擎上下文组装为 ctx.params 后交给自定义客户端 execute。
 */
import { resolveInstanceConfig } from '../config-store.js';
import type { ProviderInstance } from '../types.js';
import { registerOrReplace, unregisterByInstance } from '../../workflows/registry.js';
import type {
  VideoWorkflowSubmitData,
  WorkflowDefinition,
  WorkflowRunContext,
  WorkflowVarsBase,
} from '../../workflows/types.js';
import type { CustomProviderClient } from './client.js';
import { parseCustomWorkflows, sanitizeWorkflowName, type CustomUserConfigFieldType, type CustomWorkflowEntry, type CustomWorkflowType } from './types.js';
import { toNativeUserParams } from '../../workflows/user-params.js';
import type { WorkflowUserParamDeclaration } from '../../workflows/types.js';

/** 自定义服务商 Provider 插件 id */
const PROVIDER_ID = 'custom';

/**
 * 解析字符串为正整数（非法/空返回 undefined）。
 *
 * @param value 原始值
 * @returns 正整数或 undefined
 */
function toPositiveNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * 解析 JSON 数组字符串（如 imagePaths / refAudioPath）。
 *
 * @param raw JSON 数组字符串
 * @param label 字段名（错误提示）
 * @returns 字符串数组
 */
function parseStringArray(raw: string | undefined, label: string): string[] {
  try {
    const parsed = JSON.parse(raw ?? '[]') as unknown;
    if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === 'string')) {
      throw new Error('须为字符串数组');
    }
    return parsed;
  } catch (e) {
    throw new Error(label + ' 无效: ' + raw + '（' + (e instanceof Error ? e.message : String(e)) + '）');
  }
}

/**
 * 按工作流类型组装自定义调用的 ctx.params（业务变量 + 类型化字段）。
 *
 * @param type 工作流类型
 * @param ctx 引擎运行上下文
 * @returns 自定义调用的输入参数
 */
async function buildCustomParams(
  type: string,
  ctx: WorkflowRunContext<WorkflowVarsBase>,
): Promise<Record<string, unknown>> {
  const vars = ctx.vars as Record<string, string | undefined>;
  const base: Record<string, unknown> = { ...vars };
  const seed = vars.seed;

  if (type === 'text-to-image') {
    const promptPath = (vars.promptPath ?? '').trim();
    if (!promptPath) throw new Error('text-to-image 需要 vars.promptPath');
    const prompt = await ctx.readFile(promptPath);
    const width = toPositiveNumber(vars.width);
    const height = toPositiveNumber(vars.height);
    return { ...base, prompt, ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}), seed };
  }

  if (type === 'image-edit') {
    const prompt = (vars.prompt ?? '').trim();
    if (!prompt) throw new Error('image-edit 需要 vars.prompt（编辑描述）');
    const imagePaths = parseStringArray(vars.imagePaths, 'imagePaths');
    const width = toPositiveNumber(vars.width);
    const height = toPositiveNumber(vars.height);
    return { ...base, prompt, imagePaths, ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}), seed };
  }

  if (type === 'tts-voice-design') {
    const prompt = (vars.prompt ?? '').trim();
    const text = (vars.text ?? '').trim();
    if (!prompt) throw new Error('tts-voice-design 需要 vars.prompt（声线描述）');
    if (!text) throw new Error('tts-voice-design 需要 vars.text（朗读文本）');
    return { ...base, prompt, text, seed };
  }

  if (type === 'tts-voice-clone') {
    const text = (vars.text ?? '').trim();
    const refText = (vars.refText ?? '').trim();
    if (!text) throw new Error('tts-voice-clone 需要 vars.text（朗读文本）');
    if (!refText) throw new Error('tts-voice-clone 需要 vars.refText（参考音频文字内容）');
    const refAudioPath = parseStringArray(vars.refAudioPath, 'refAudioPath');
    return { ...base, text, refText, refAudioPath, seed };
  }

  if (type === 'image-to-video') {
    const video = ctx.video as VideoWorkflowSubmitData | undefined;
    if (video) {
      return {
        ...base,
        prompt: video.prompt,
        mode: video.mode,
        duration: video.duration,
        resolution: video.resolution,
        ...(video.fps !== undefined ? { fps: video.fps } : {}),
        ...(video.seed !== undefined ? { seed: video.seed } : {}),
        ...(video.director
          ? {
              director: {
                frames: video.director.frames.map((f) => ({ file: f.file, cursor: f.cursor })),
                ...(video.director?.audio ? { audio: video.director.audio } : {}),
              },
            }
          : {}),
        ...(video.references
          ? { references: video.references.map((r) => ({ type: r.type, file: r.file })) }
          : {}),
      };
    }
    return { ...base, seed };
  }

  throw new Error('不支持的工作流类型: ' + type);
}

/**
 * 把条目的用户配置字段声明转为工作流用户参数声明（前端运行表单据此渲染）。
 *
 * @param entry 工作流条目
 * @returns 用户参数声明列表
 */
function toUserParamDeclarations(entry: CustomWorkflowEntry): WorkflowUserParamDeclaration[] {
  return entry.userConfigFields.map((f) => ({
    name: f.name,
    key: f.key,
    type: f.type,
    // 默认值按声明类型转为原生值（boolean 开关 / number 输入框需要，避免字符串默认值导致 UI 异常）
    defaultValue: coerceDefaultValue(f.type, f.defaultValue),
    ...(f.description !== undefined ? { description: f.description } : {}),
  }));
}

/**
 * 把用户配置字段的字符串默认值按类型转换为原生值。
 *
 * @param type 字段类型
 * @param raw 字符串默认值（可能为空串 = 无默认值）
 * @returns 原生默认值（无法转换时原样返回字符串）
 */
function coerceDefaultValue(
  type: CustomUserConfigFieldType,
  raw: string,
): boolean | number | string {
  if (type === 'boolean') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
  }
  if (type === 'integer' || type === 'float') {
    const n = Number(raw);
    if (raw !== '' && Number.isFinite(n)) return type === 'integer' ? Math.round(n) : n;
  }
  return raw;
}

/**
 * 组装 ctx.userConfig：按声明类型从 vars 提取并转换为原生值，
 * 用户未填写（vars 缺失/空）时回退声明默认值，保证每个声明字段都存在。
 *
 * @param entry 工作流条目
 * @param ctx 引擎运行上下文
 * @returns 用户配置字段值（key → boolean / number / string）
 */
function buildUserConfig(
  entry: CustomWorkflowEntry,
  ctx: WorkflowRunContext<WorkflowVarsBase>,
): Record<string, boolean | number | string> {
  const decls = toUserParamDeclarations(entry);
  const vars = ctx.vars as Record<string, string | undefined>;
  const raw: Record<string, string> = {};
  for (const f of entry.userConfigFields) {
    const v = vars[f.key];
    raw[f.key] = v !== undefined && v !== '' ? v : f.defaultValue;
  }
  return toNativeUserParams(decls, raw);
}

/**
 * 构建条目在某工作流类型下的 submit 实现。
 *
 * @param entry 工作流条目
 * @param type 工作流类型（决定 ctx.params 组装方式）
 * @returns submit 函数
 */
function buildSubmit(entry: CustomWorkflowEntry, type: CustomWorkflowType): WorkflowDefinition['submit'] {
  return async (ctx: WorkflowRunContext<WorkflowVarsBase>) => {
    const params = await buildCustomParams(type, ctx);
    const provider = ctx.provider as CustomProviderClient;
    return provider.execute({
      workflowId: entry.name,
      params,
      projectConfig: ctx.projectConfig,
      readFile: ctx.readFile,
      readAssertFile: ctx.readAssertFile,
      readFileToBase64: ctx.readFileToBase64,
      workflowType: type,
      userConfig: buildUserConfig(entry, ctx),
    });
  };
}

/**
 * 同步自定义服务商实例：按配置条目注册可执行工作流。
 *
 * 解析失败（结构/代码校验）抛错，由 instance-sync 记录日志；
 * 条目增删改后按 keepKeys 清理该实例下已消失的工作流。
 *
 * @param instance 服务商实例
 */
export async function syncCustomInstance(instance: ProviderInstance): Promise<void> {
  const config = resolveInstanceConfig(instance);
  const entries = parseCustomWorkflows(config.workflows);
  const keepKeys = new Set<string>();
  for (const entry of entries) {
    for (const type of entry.types) {
      const key = type + ':custom:' + entry.name;
      registerOrReplace<WorkflowVarsBase>({
        type,
        impl: 'custom-' + sanitizeWorkflowName(entry.name) + '-' + instance.id,
        name: entry.name,
        description: '自定义工作流（' + entry.name
          + (entry.async ? '，异步' : '，同步')
          + (entry.cancelable ? '，可取消' : '') + '）',
        provider: PROVIDER_ID,
        providerInstanceId: instance.id,
        providerName: instance.name,
        workflowKey: key,
        capabilities: { cancelable: entry.cancelable },
        // 用户配置字段声明 → 前端运行表单（WorkflowParamsForm）据此渲染输入
        params: toUserParamDeclarations(entry),
        submit: buildSubmit(entry, type),
      });
      keepKeys.add(key);
    }
  }
  unregisterByInstance(instance.id, keepKeys);
}
