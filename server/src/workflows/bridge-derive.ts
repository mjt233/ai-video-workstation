import type { BridgeDeclaredParam, BridgeTagGroup } from '../providers/comfyui-bridge/client.js';
import type {
  VideoCapabilities,
  VideoGenerateMode,
  VideoReferenceCapability,
  WorkflowCapabilities,
  WorkflowUserParamDeclaration,
} from './types.js';

/** 动态注册可映射的工作流类型（与 types.js 的 WorkflowTypeId 一致的子集） */
export type BridgeDerivedType = 'text-to-image' | 'image-edit' | 'tts-voice-design' | 'image-to-video';

/** 预设类型标签 → 系统工作流类型（优先级即数组顺序，靠前命中优先） */
const TYPE_TAGS: Array<{ tag: string; type: BridgeDerivedType }> = [
  { tag: 'text-to-image', type: 'text-to-image' },
  { tag: 'image-edit', type: 'image-edit' },
  { tag: 'tts-voice-design', type: 'tts-voice-design' },
  { tag: 'image-to-video', type: 'image-to-video' },
];

/**
 * 展平标签分组：返回工作流实际打上的全部标签 id（父 + 子）。
 *
 * @param tags Bridge 工作流详情返回的标签分组数组（可能嵌套）
 * @returns 全部标签 id 的数组（含每个分组的 id 及其所有子分组 id）
 */
export function collectTagIds(tags: BridgeTagGroup[]): string[] {
  const out: string[] = [];
  for (const g of tags) {
    out.push(g.id);
    for (const c of g.tags ?? []) out.push(c.id);
  }
  return out;
}

/**
 * 从工作流标签推导系统工作流类型。
 *
 * 按 TYPE_TAGS 优先级顺序，在工作流打上的全部标签（父 + 子）中查找匹配；
 * 未知类型（如 text-to-video）返回 null，由调用方跳过并告警。
 *
 * @param tags Bridge 工作流详情返回的标签分组数组
 * @returns 匹配的系统工作流类型；无匹配返回 null
 */
export function deriveWorkflowType(tags: BridgeTagGroup[]): BridgeDerivedType | null {
  const ids = new Set(collectTagIds(tags));
  for (const { tag, type } of TYPE_TAGS) {
    if (ids.has(tag)) return type;
  }
  return null;
}

/**
 * 取某标签（父或子）的合并元数据。
 *
 * @param tags Bridge 工作流详情返回的标签分组数组
 * @param id 要查找的标签 id（父或子均可）
 * @returns 该标签的 metadata（缺省为空对象）
 */
function tagMetadata(tags: BridgeTagGroup[], id: string): Record<string, unknown> {
  for (const g of tags) {
    if (g.id === id) return g.metadata ?? {};
    const child = (g.tags ?? []).find((c) => c.id === id);
    if (child) return child.metadata ?? {};
  }
  return {};
}

/**
 * 从工作流标签推导能力声明（WorkflowCapabilities）。
 *
 * - 仅 image-to-video 类型解析视频能力，其余类型只返回 { cancelable: true }；
 * - image-to-video 子标签语义：
 *   - reference → modes 含 reference，并用该标签 metadata 的上限（maxTotalCount /
 *     maxImageCount / maxVideoCount / maxAudioCount，缺省 12/9/3/3）填充 reference 能力；
 *   - director → modes 含 director；
 *   - first-frame / first-last-frame → modes 含 first-last-frame，maxFrames 分别 1 / 2；
 *   - audio-input / audio-output → video.audio = true；
 * - cancelable 恒 true（Bridge 支持中断）。
 *
 * @param tags Bridge 工作流详情返回的标签分组数组
 * @param type 由 deriveWorkflowType 推导出的系统工作流类型
 * @returns 能力声明对象
 */
export function deriveCapabilities(tags: BridgeTagGroup[], type: string): WorkflowCapabilities {
  const ids = new Set(collectTagIds(tags));
  const caps: WorkflowCapabilities = { cancelable: true };
  if (type !== 'image-to-video') return caps;
  const modes: VideoGenerateMode[] = [];
  const video: VideoCapabilities = { modes };
  if (ids.has('reference')) {
    modes.push('reference');
    const m = tagMetadata(tags, 'reference');
    const reference: VideoReferenceCapability = {
      maxTotal: Number(m.maxTotalCount ?? 12),
      types: {
        image: { max: Number(m.maxImageCount ?? 9) },
        video: { max: Number(m.maxVideoCount ?? 3) },
        audio: { max: Number(m.maxAudioCount ?? 3) },
      },
    };
    video.reference = reference;
  }
  if (ids.has('director')) modes.push('director');
  if (ids.has('first-last-frame') || ids.has('first-frame')) {
    modes.push('first-last-frame');
    video.firstLastFrame = { maxFrames: ids.has('first-frame') ? 1 : 2 };
  }
  if (ids.has('audio-input') || ids.has('audio-output')) video.audio = true;
  caps.video = video;
  return caps;
}

/**
 * Bridge paramType → 系统参数类型映射。
 *
 * @param t Bridge 详情接口的参数类型（text / number / boolean / image / video / audio）
 * @returns 系统用户参数类型（string / integer / boolean）；文件类型（image/video/audio）
 *   返回 null，表示不作为用户手动参数
 */
function mapParamType(t: BridgeDeclaredParam['paramType']): WorkflowUserParamDeclaration['type'] | null {
  switch (t) {
    case 'text': return 'string';
    case 'number': return 'integer';
    case 'boolean': return 'boolean';
    default: return null; // image / video / audio：文件字段，不作为用户参数
  }
}

/**
 * 将 Bridge 参数字段的原始默认值转换为系统参数类型的默认值。
 *
 * 默认值来源：defaultValue 非 null 时优先使用；为 null 时取 nodeRawValue；
 * 两者均缺省（undefined/null）时返回类型缺省值（布尔 false，其余空串表示“不传”）。
 * 原始值一律是字符串，number/boolean 需要做类型转换：
 * - integer：Number(raw)，非法数值回退 0；
 * - boolean：'true' / '1' 视为 true，其余 false；
 * - string：原样返回（缺省空串）。
 *
 * @param type 系统参数类型（string / integer / boolean）
 * @param raw 原始默认值字符串（defaultValue ?? nodeRawValue，可为 null/undefined）
 * @returns 转换后的默认值
 */
function coerceDefaultValue(
  type: WorkflowUserParamDeclaration['type'],
  raw: string | null | undefined,
): boolean | number | string {
  if (raw == null) {
    return type === 'boolean' ? false : '';
  }
  if (type === 'boolean') {
    return raw === 'true' || raw === '1';
  }
  if (type === 'integer') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return raw;
}

/**
 * 按 expose_field（逗号分隔别名）过滤工作流参数字段映射为用户参数声明。
 *
 * 字段信息来源：params 优先（工作流本身固定参数字段），declaredParams（额外声明的
 * 动态构建字段）兜底——同一别名以 params 为准，仅存在于 declaredParams 的别名仍可用。
 * 默认值：defaultValue 非 null 优先；为 null 时取 nodeRawValue；number/boolean 做类型转换。
 *
 * @param exposeField 自动注册标签元数据 expose_field（可为 undefined；空串/缺省返回空数组）
 * @param params 工作流本身固定参数字段（BridgeWorkflowDetail.params，优先）
 * @param declaredParams 额外声明的动态构建字段（BridgeWorkflowDetail.declaredParams，兜底）
 * @returns 用户参数声明数组（仅含 expose_field 命中的非文件类型参数）
 */
export function deriveParams(
  exposeField: string | undefined,
  params: BridgeDeclaredParam[],
  declaredParams: BridgeDeclaredParam[],
): WorkflowUserParamDeclaration[] {
  const names = new Set((exposeField ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  if (names.size === 0) return [];
  // params 优先合并：同一别名 params 在前，declaredParams 仅补充缺失别名
  const seen = new Set<string>();
  const merged: BridgeDeclaredParam[] = [];
  for (const src of [params, declaredParams]) {
    for (const p of src) {
      if (seen.has(p.alias)) continue;
      seen.add(p.alias);
      merged.push(p);
    }
  }
  const out: WorkflowUserParamDeclaration[] = [];
  for (const p of merged) {
    if (!names.has(p.alias)) continue;
    const type = mapParamType(p.paramType);
    if (!type) continue;
    out.push({
      key: p.alias,
      name: p.label ?? p.alias,
      type,
      defaultValue: coerceDefaultValue(type, p.defaultValue ?? p.nodeRawValue),
    });
  }
  return out;
}
