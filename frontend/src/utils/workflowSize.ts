import type {
  WorkflowSizeConfig,
  WorkflowUserParamDeclaration,
  WorkflowUserParamValue,
} from '../api/workflow'

/**
 * 工作流输出尺寸换算与回显工具。
 *
 * 纯函数模块（无 Vue/DOM 依赖），供统一尺寸组件 `WorkflowSizePicker`
 * 与参数表单 `WorkflowParamsForm` 使用：
 * - `computePresetSize`：比例 × 分辨率档 → 具体宽高
 * - `resolvePresetSize`：按任意字符串比例/尺寸档换算宽高（含不存在/自适应档返回 null）
 * - `normalizeSizeCapabilities`：工作流 capabilities.size 声明归一化（补默认值）
 * - `normalizeSizeConfig` / `inferSizeConfigFromWidthHeight`：组件内部状态与旧数据回显
 * - `clampSizeConfigState`：按工作流能力声明钳制档位（仅能力真实加载后调用）
 * - `formatSizeConfigText`：单行显示文案（如 `16:9 / 1K`、`自动 / 自动 / 1024x1024`）
 * - `resolveSizeMode`：根据已保存的宽高推断尺寸组件的模式
 * - `findSizeParamKeys`：约定式检测声明中是否含 width/height 用户参数
 */

/** 尺寸选择模式 */
export type SizeMode = 'preset' | 'manual' | 'project' | 'none'

/** 比例档 key（含 3:2 / 2:3 / 21:9 等横向扩展档） */
export type SizeRatioKey = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3' | '21:9'

/** 分辨率档 key（含 480P / 768P / 1K / 1.5K / 3K 等扩展档） */
export type SizeResolutionKey = '360P' | '480P' | '720P' | '768P' | '1080P' | '1K' | '1.5K' | '2K' | '3K' | '4K' | '8K'

export interface SizeRatio {
  /** 比例档 key（展示用） */
  key: SizeRatioKey
  /** 宽高比（width / height） */
  ratio: number
}

/** 比例档（宽高比） */
export const SIZE_RATIOS: SizeRatio[] = [
  { key: '1:1', ratio: 1 },
  { key: '4:3', ratio: 4 / 3 },
  { key: '3:4', ratio: 3 / 4 },
  { key: '16:9', ratio: 16 / 9 },
  { key: '9:16', ratio: 9 / 16 },
  { key: '3:2', ratio: 3 / 2 },
  { key: '2:3', ratio: 2 / 3 },
  { key: '21:9', ratio: 21 / 9 },
]

export interface SizeResolution {
  key: SizeResolutionKey
  /** 基准像素值：P 档为高度基准、K 档为宽度基准 */
  base: number
  /** 'height' = 以高度为基准；'width' = 以宽度为基准 */
  baseOn: 'height' | 'width'
}

/** 分辨率档（P 档按高度、K 档按宽度为基准） */
export const SIZE_RESOLUTIONS: SizeResolution[] = [
  { key: '360P', base: 360, baseOn: 'height' },
  { key: '480P', base: 480, baseOn: 'height' },
  { key: '720P', base: 720, baseOn: 'height' },
  { key: '768P', base: 768, baseOn: 'height' },
  { key: '1080P', base: 1080, baseOn: 'height' },
  { key: '1K', base: 1024, baseOn: 'width' },
  { key: '1.5K', base: 1536, baseOn: 'width' },
  { key: '2K', base: 2560, baseOn: 'width' },
  { key: '3K', base: 3072, baseOn: 'width' },
  { key: '4K', base: 3840, baseOn: 'width' },
  { key: '8K', base: 7680, baseOn: 'width' },
]

export interface SizeValue {
  /** 宽度（像素） */
  width: number
  /** 高度（像素） */
  height: number
}

/**
 * 按比例×分辨率档换算宽高。
 * - P 档（360P/720P/1080P）：以高度为基准（横向/方形）——
 *   `height = 基准`、`width = round(高 × 比例)`；
 *   竖屏（比例 < 1）时基准实为「短边」，落在宽度上——`width = 基准`、`height = round(宽 ÷ 比例)`
 *   （如 9:16 + 1080P → 1080×1920，即竖屏视频标准 1080P）。
 * - K 档（2K/4K/8K）：以宽度为基准——`width = 基准`、`height = round(宽 ÷ 比例)`。
 *
 * @param ratioKey 比例档 key
 * @param resolutionKey 分辨率档 key
 * @returns 换算出的宽高（像素）
 */
export function computePresetSize(ratioKey: SizeRatioKey, resolutionKey: SizeResolutionKey): SizeValue {
  const r = SIZE_RATIOS.find((x) => x.key === ratioKey)!
  const res = SIZE_RESOLUTIONS.find((x) => x.key === resolutionKey)!
  if (res.baseOn === 'height') {
    if (r.ratio < 1) {
      // 竖屏：P 档基准落在短边（宽度）上
      return { width: res.base, height: Math.round(res.base / r.ratio) }
    }
    return { height: res.base, width: Math.round(res.base * r.ratio) }
  }
  return { width: res.base, height: Math.round(res.base / r.ratio) }
}

export interface SizeEchoInput {
  /** enable_specified_size 的值（前端表单原生类型） */
  enableSpecifiedSize?: boolean | number | string
  /** 宽度值（可为空串） */
  width?: number | string
  /** 高度值（可为空串） */
  height?: number | string
  /** 项目尺寸（project.json），读取失败为 null */
  projectSize?: { width: number; height: number } | null
}

/**
 * 根据外部值推断尺寸组件的初始模式。
 *
 * - 未启用或宽高无效 → 'none'
 * - 宽高恰好等于项目尺寸 → 'project'
 * - 宽高能匹配某个比例+分辨率档 → 'preset'
 * - 其余 → 'manual'
 *
 * 启用判定：enable_specified_size 为 truthy 即启用；该字段缺失（undefined，如
 * ComfyUI Bridge 动态注册工作流未声明此参数）但宽高有效时同样视为启用——
 * 否则已保存的宽高无法回显，会误判为「不指定」。
 *
 * @param input 外部传入的值
 * @returns 推断出的模式
 */
export function resolveSizeMode(input: SizeEchoInput): SizeMode {
  const rawEnable = input.enableSpecifiedSize
  const enabled =
    rawEnable === true ||
    rawEnable === 'true' ||
    rawEnable === 1 ||
    rawEnable === '1'
  const w = Number(input.width)
  const h = Number(input.height)
  const hasSize =
    input.width !== undefined && input.width !== '' &&
    input.height !== undefined && input.height !== '' &&
    Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
  // 工作流未声明 enable_specified_size（如 ComfyUI Bridge 动态注册工作流）时，
  // 宽高存在即视为已启用，否则已保存的尺寸无法回显（会误判为「不指定」）。
  const effectiveEnabled = enabled || (rawEnable === undefined && hasSize)
  if (!effectiveEnabled || !hasSize) return 'none'
  if (input.projectSize && w === input.projectSize.width && h === input.projectSize.height) {
    return 'project'
  }
  const ratio = w / h
  const matchedRatio = SIZE_RATIOS.find((r) => Math.abs(r.ratio - ratio) < 0.01)
  // 分辨率档基准可落在宽或高：P 档横屏基准为高度、竖屏基准为宽度；K 档基准恒为宽度。
  // 各档 base 值唯一（360/720/1080/2560/3840/7680），用“任一维等于 base”即可初步匹配；
  // 最终以 computePresetSize 计算结果反查确认，避免“基准落在错误一侧”的误判
  // （如 1080×810 会被误认为预设，但没有任何预设产出该尺寸）。
  const matchedRes = SIZE_RESOLUTIONS.find(
    (res) => res.base === w || res.base === h,
  )
  if (
    matchedRatio &&
    matchedRes &&
    computePresetSize(matchedRatio.key, matchedRes.key).width === w &&
    computePresetSize(matchedRatio.key, matchedRes.key).height === h
  ) {
    return 'preset'
  }
  return 'manual'
}

export interface SizeParamKeys {
  widthKey: string
  heightKey: string
  enableKey?: string
}

/**
 * 约定式检测：声明列表中是否同时存在 width 与 height 用户参数。
 * 存在时返回三个相关 key（enable_specified_size 可选），供表单渲染尺寸组件。
 *
 * @param declarations 工作流参数声明列表
 * @returns 尺寸相关 key；不满足约定时返回 null
 */
export function findSizeParamKeys(
  declarations: WorkflowUserParamDeclaration[],
): SizeParamKeys | null {
  const width = declarations.find((d) => d.key === 'width')
  const height = declarations.find((d) => d.key === 'height')
  if (!width || !height) return null
  const enable = declarations.find((d) => d.key === 'enable_specified_size')
  return {
    widthKey: width.key,
    heightKey: height.key,
    enableKey: enable?.key,
  }
}

/**
 * 将尺寸组件输出的值合并进表单值。
 *
 * - 先清除 values 中旧的尺寸相关 key（width/height/enable）
 * - 再并入 incoming 中属于已声明尺寸 key 的新值
 *   （组件固定输出 enable_specified_size，但若工作流未声明该参数则不并入）
 * - 返回新对象，不修改入参
 *
 * @param values 当前表单值（key → 值）
 * @param sizeKeys 已检测到的尺寸相关 key
 * @param incoming 尺寸组件输出的新值
 * @returns 合并后的新表单值
 */
export function mergeSizeValues(
  values: Record<string, WorkflowUserParamValue>,
  sizeKeys: SizeParamKeys,
  incoming: Record<string, WorkflowUserParamValue>,
): Record<string, WorkflowUserParamValue> {
  const next = { ...values }
  const allowed = new Set([sizeKeys.widthKey, sizeKeys.heightKey])
  if (sizeKeys.enableKey) allowed.add(sizeKeys.enableKey)
  for (const k of Object.keys(next)) {
    if (allowed.has(k)) delete next[k]
  }
  for (const k of Object.keys(incoming)) {
    if (allowed.has(k)) next[k] = incoming[k]
  }
  return next
}

// ── 统一尺寸配置（sizeConfig）纯函数 ────────────────────────────────────────

/** 自适应比例/尺寸档的显示标签（auto / adaptive → 「自动」） */
export const AUTO_SIZE_LABEL = '自动'

/** 尺寸能力声明的默认值（与后端 WorkflowCapabilities.size 默认一致） */
export const DEFAULT_SIZE_CAPABILITIES = {
  ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', 'auto'],
  size: ['360P', '720P', '1080P', '2K', '4K', 'auto'],
  supportCustomSize: true,
} as const

/** 工作流输出尺寸能力声明（归一化后） */
export interface WorkflowSizeCapabilities {
  /** 支持的比例档（含 "auto" 表示自适应） */
  ratio: string[]
  /** 支持的尺寸档（含 "auto" 表示自适应） */
  size: string[]
  /** 是否允许指定任意宽高 */
  supportCustomSize: boolean
}

/**
 * 归一化工作流 capabilities.size 声明：缺失的 key 补默认值。
 *
 * 数组为空（声明了但未提供条目）同样回退默认全量，避免渲染出空按钮组。
 *
 * @param raw 工作流声明的原始尺寸能力（可为 undefined）
 * @returns 归一化后的尺寸能力（恒含有效清单与 supportCustomSize 布尔值）
 */
export function normalizeSizeCapabilities(
  raw?: { ratio?: string[]; size?: string[]; supportCustomSize?: boolean },
): WorkflowSizeCapabilities {
  return {
    ratio:
      Array.isArray(raw?.ratio) && raw!.ratio.length > 0
        ? [...raw!.ratio]
        : [...DEFAULT_SIZE_CAPABILITIES.ratio],
    size:
      Array.isArray(raw?.size) && raw!.size.length > 0
        ? [...raw!.size]
        : [...DEFAULT_SIZE_CAPABILITIES.size],
    supportCustomSize: raw?.supportCustomSize !== false,
  }
}

/**
 * 比例档显示标签：auto / adaptive 归一为「自动」，其余原样返回。
 *
 * @param ratio 原始比例档值（如 "16:9" / "auto" / "adaptive"）
 * @returns 展示用文案
 */
export function ratioLabel(ratio: string): string {
  return ratio === 'auto' || ratio === 'adaptive' ? AUTO_SIZE_LABEL : ratio
}

/**
 * 尺寸档显示标签：auto 归一为「自动」，其余原样返回。
 *
 * @param size 原始尺寸档值（如 "1K" / "auto"）
 * @returns 展示用文案
 */
export function sizeLabel(size: string): string {
  return size === 'auto' ? AUTO_SIZE_LABEL : size
}

/**
 * 统一尺寸组件内部状态（归一化后的尺寸配置）。
 */
export interface SizeConfigState {
  /** 比例档（恒非空；缺省 "auto"） */
  ratio: string
  /** 尺寸档（恒非空；缺省 "auto"） */
  size: string
  /** 宽度（像素；未指定为 null） */
  width: number | null
  /** 高度（像素；未指定为 null） */
  height: number | null
}

/** 尺寸配置外部输入（width/height 允许字符串数字，来自表单标量/持久化数据） */
export interface SizeConfigInput {
  /** 比例档（如 "16:9" / "auto"） */
  ratio?: string
  /** 尺寸档（如 "1K" / "auto"） */
  size?: string
  /** 宽度（像素，可为字符串数字） */
  width?: number | string
  /** 高度（像素，可为字符串数字） */
  height?: number | string
}

/**
 * 归一化外部传入的尺寸配置为组件内部状态。
 *
 * - ratio/size 缺失或为空串 → "auto"
 * - width/height 非法（非正数）→ null
 * - 合法数字四舍五入取整
 *
 * @param raw 外部尺寸配置（可为 null / 部分字段）
 * @returns 归一化后的组件内部状态
 */
export function normalizeSizeConfig(raw?: SizeConfigInput | null): SizeConfigState {
  const ratio = typeof raw?.ratio === 'string' && raw.ratio !== '' ? raw.ratio : 'auto'
  const size = typeof raw?.size === 'string' && raw.size !== '' ? raw.size : 'auto'
  const pick = (v: unknown): number | null => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null
  }
  return { ratio, size, width: pick(raw?.width), height: pick(raw?.height) }
}

/**
 * 把尺寸配置状态钳制到工作流能力声明的合法档位（宽高不参与钳制，原样保留）。
 *
 * 持久化值可能来自旧数据或另一个工作流实现（如 "1.5K" 而当前声明只允许 1K/2K），
 * 越界档位回退到声明清单的第一项，保证按钮组恒有选中项。
 *
 * 注意：
 * - 「auto」/「adaptive」（自适应）视为「未选择」状态，不参与钳制——部分工作流
 *   （如 Seedream、ComfyUI Bridge）声明清单不含 auto，未选择时仍应保持 自动/自动 默认；
 * - 声明清单为空时该维度不钳制（`normalizeSizeCapabilities` 已保证非空，此处为防御）。
 *
 * **调用前提：能力声明必须已真实加载**。工作流列表是异步拉取的，未加载完成时
 * `normalizeSizeCapabilities(undefined)` 返回的是默认全量清单而非该工作流的真实清单，
 * 此时钳制会把合法的已保存档位改成错值（见 `WorkflowSizePicker` 的 `capsKnown`）。
 *
 * @param state 待钳制的尺寸配置状态
 * @param caps 归一化后的工作流尺寸能力声明
 * @returns 钳制后的新状态（不修改入参）
 */
export function clampSizeConfigState(
  state: SizeConfigState,
  caps: WorkflowSizeCapabilities,
): SizeConfigState {
  const next = { ...state }
  if (
    next.ratio !== 'auto' &&
    next.ratio !== 'adaptive' &&
    caps.ratio.length > 0 &&
    !caps.ratio.includes(next.ratio)
  ) {
    next.ratio = caps.ratio[0]
  }
  if (
    next.size !== 'auto' &&
    caps.size.length > 0 &&
    !caps.size.includes(next.size)
  ) {
    next.size = caps.size[0]
  }
  return next
}

/**
 * 按比例 × 尺寸档换算宽高；档位不存在或任一项为自适应（auto/adaptive）时返回 null。
 *
 * 统一尺寸组件与显示文案拼接用它判断「当前宽高是否等于所选预设」，
 * 从而决定是否追加 `/ 宽x高` 的自定义后缀。
 *
 * @param ratio 比例档（可为 "auto" / "adaptive" / 未注册档）
 * @param size 尺寸档（可为 "auto" / 未注册档）
 * @returns 换算出的宽高；无法换算返回 null
 */
export function resolvePresetSize(ratio: string, size: string): SizeValue | null {
  const r = SIZE_RATIOS.find((x) => x.key === ratio)
  const res = SIZE_RESOLUTIONS.find((x) => x.key === size)
  if (!r || !res) return null
  return computePresetSize(r.key, res.key)
}

/**
 * 由已保存/回显的宽高反推尺寸配置（旧数据兼容：仅存了 width/height 的任务或节点）。
 *
 * - 无效宽高 → 全部回退默认（ratio/size 为 "auto"，宽高为 null）
 * - 宽高命中某个比例 + 尺寸档组合 → ratio/size 取该档
 * - 否则 ratio/size 回退 "auto"，宽高原样保留（显示为自定义宽高）
 *
 * @param rawWidth 宽度（可为空/字符串数字/表单标量）
 * @param rawHeight 高度（可为空/字符串数字/表单标量）
 * @returns 反推后的配置状态
 */
export function inferSizeConfigFromWidthHeight(
  rawWidth?: unknown,
  rawHeight?: unknown,
): SizeConfigState {
  const w = Number(rawWidth)
  const h = Number(rawHeight)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { ratio: 'auto', size: 'auto', width: null, height: null }
  }
  const r = SIZE_RATIOS.find((x) => Math.abs(x.ratio - w / h) < 0.01)
  const ratio = r ? r.key : 'auto'
  // 尺寸档以「某基准刻度命中 + 反查预设完全一致」双重确认，避免误判
  const res = SIZE_RESOLUTIONS.find((x) => x.base === w || x.base === h)
  let size = 'auto'
  if (res) {
    const preset = computePresetSize((r ?? SIZE_RATIOS[0]).key, res.key)
    if (preset.width === Math.round(w) && preset.height === Math.round(h)) {
      size = res.key
    }
  }
  return { ratio, size, width: Math.round(w), height: Math.round(h) }
}

/**
 * 组件输出为可提交/持久化的尺寸配置（自动省略 null 宽高）。
 *
 * @param state 组件内部状态
 * @param supportCustomSize 工作流是否支持自定义宽高（false 时不输出宽高）
 * @returns 尺寸配置对象（供 params.sizeConfig / 节点 config 持久化）
 */
export function toSizeConfig(state: SizeConfigState, supportCustomSize: boolean): WorkflowSizeConfig {
  const out: WorkflowSizeConfig = { ratio: state.ratio, size: state.size }
  if (supportCustomSize && state.width != null && state.height != null) {
    out.width = state.width
    out.height = state.height
  }
  return out
}

/**
 * 拼接尺寸组件的单行显示文案（如 `16:9 / 1K`、`自动 / 自动`、`1:1 / 2K / 1024x1024`）。
 *
 * 仅当工作流支持自定义宽高、且当前宽高不等于所选比例×尺寸档换算结果时，
 * 才追加 `/ 宽x高` 后缀（对应「手动改过宽高」的状态）。
 *
 * @param state 组件内部状态
 * @param caps 工作流尺寸能力（未声明按支持自定义处理）
 * @returns 展示用单行文案
 */
export function formatSizeConfigText(state: SizeConfigState, caps?: WorkflowSizeCapabilities): string {
  const text = `${ratioLabel(state.ratio)} / ${sizeLabel(state.size)}`
  const supportCustom = caps ? caps.supportCustomSize : true
  if (!supportCustom) return text
  const preset = resolvePresetSize(state.ratio, state.size)
  const custom =
    state.width != null &&
    state.height != null &&
    (!preset || preset.width !== state.width || preset.height !== state.height)
  return custom ? `${text} / ${state.width}x${state.height}` : text
}
