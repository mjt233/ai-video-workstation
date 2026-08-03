import type { WorkflowUserParamDeclaration } from '../api/workflow'

/**
 * 工作流输出尺寸换算与回显工具。
 *
 * 纯函数模块（无 Vue/DOM 依赖），供通用尺寸选择组件 `WorkflowSizePicker`
 * 与参数表单 `WorkflowParamsForm` 使用：
 * - `computePresetSize`：比例 × 分辨率档 → 具体宽高
 * - `resolveSizeMode`：根据已保存的宽高推断组件应处于的模式
 * - `findSizeParamKeys`：约定式检测声明中是否含 width/height 用户参数
 */

/** 尺寸选择模式 */
export type SizeMode = 'preset' | 'manual' | 'project' | 'none'

/** 比例档 key */
export type SizeRatioKey = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'

/** 分辨率档 key */
export type SizeResolutionKey = '360P' | '720P' | '1080P' | '2K' | '4K' | '8K'

export interface SizeRatio {
  /** 比例档 key（展示用） */
  key: SizeRatioKey
  /** 宽高比（width / height） */
  ratio: number
}

/** 比例档（宽高比） */
export const SIZE_RATIOS: SizeRatio[] = [
  { key: '1:1', ratio: 1 },
  { key: '16:9', ratio: 16 / 9 },
  { key: '9:16', ratio: 9 / 16 },
  { key: '4:3', ratio: 4 / 3 },
  { key: '3:4', ratio: 3 / 4 },
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
  { key: '720P', base: 720, baseOn: 'height' },
  { key: '1080P', base: 1080, baseOn: 'height' },
  { key: '2K', base: 2560, baseOn: 'width' },
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
 * @param input 外部传入的值
 * @returns 推断出的模式
 */
export function resolveSizeMode(input: SizeEchoInput): SizeMode {
  const enabled =
    input.enableSpecifiedSize === true ||
    input.enableSpecifiedSize === 'true' ||
    input.enableSpecifiedSize === 1 ||
    input.enableSpecifiedSize === '1'
  const w = Number(input.width)
  const h = Number(input.height)
  const hasSize =
    input.width !== undefined && input.width !== '' &&
    input.height !== undefined && input.height !== '' &&
    Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
  if (!enabled || !hasSize) return 'none'
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
