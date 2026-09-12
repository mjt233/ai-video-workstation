/**
 * 「图片修剪与扩展」节点（image-crop）纯逻辑：选区数据模型、百分比↔像素换算、
 * 八向拖拽几何、背景色/输出格式净化。
 *
 * **核心语义：选区即画布** —— 用户在框选器里拖出的矩形就是最终输出画布：
 * - 向内拖 → 裁掉外围（输出变小）；
 * - 向外拖 → 输出变大，超出原图的区域填背景色（或透明）。
 *
 * config 相关字段（均为可选，兼容旧数据；非法值一律净化回缺省）：
 * - `crop`：选区，**归一化到原图**的百分比四元组 `{ xPct, yPct, wPct, hPct }`，
 *   允许 `< 0` / `> 100`（表示向外扩展）；缺省 `{0,0,100,100}` = 原图整幅。
 *   用百分比而非像素存储的原因：节点缩放、蓝图复用、更换源图（不同分辨率）后
 *   选区语义不失真，且节点主体渲染不需要先知道源图尺寸。
 * - `background`：扩展区域背景色，`#RRGGBB` 或 `#RRGGBBAA`（alpha=00 即透明），缺省 `#FFFFFF`；
 * - `format`：输出格式 `'png'`（默认，支持透明）/ `'jpg'`；
 * - `outputExt`：**镜像字段**（静默维护、不入撤销栈），记录最近一次成功产出的扩展名，
 *   供无输入链路上下文处推导固定产物路径（画布加载刷新 node-info、保存为/自定义资产、
 *   下游输入收集等）——与「裁剪音频」节点同一套约定（见 canvas/audioTrim.ts）。
 *
 * 几何口径统一由 `resolveCropGeometry` 提供：**配置面板预览与节点主体渲染共用同一份取整规则**，
 * 保证「用户看到的数字」与「实际产出像素」永远一致。
 */

import type { NodeConfig } from './types'

/** 选区（归一化到原图的百分比；可越界表示向外扩展） */
export interface ImageCropRect {
  /** 选区左边界（原图宽度的百分比，可为负 = 向左扩展） */
  xPct: number
  /** 选区上边界（原图高度的百分比，可为负 = 向上扩展） */
  yPct: number
  /** 选区宽度（原图宽度的百分比，> 0） */
  wPct: number
  /** 选区高度（原图高度的百分比，> 0） */
  hPct: number
}

/** 输出格式：png 支持透明；jpg 不支持透明（透明区域统一回落白色） */
export type ImageCropFormat = 'png' | 'jpg'

/** 支持透明输出的格式白名单（jpeg 无 alpha 通道） */
export const IMAGE_CROP_TRANSPARENT_FORMATS: readonly ImageCropFormat[] = ['png']

/** 输出格式选项（下拉/按钮组展示用；value 持久化到 config.format） */
export const IMAGE_CROP_FORMAT_OPTIONS: ReadonlyArray<{ value: ImageCropFormat; label: string }> = [
  { value: 'png', label: 'PNG' },
  { value: 'jpg', label: 'JPG' },
]

/** 缺省背景色（不透明白） */
export const IMAGE_CROP_BACKGROUND_DEFAULT = '#FFFFFF'

/** 缺省输出格式（PNG：无损且支持透明扩展） */
export const IMAGE_CROP_FORMAT_DEFAULT: ImageCropFormat = 'png'

/** 缺省选区（原图整幅，即「不改动」） */
export const IMAGE_CROP_RECT_DEFAULT: ImageCropRect = { xPct: 0, yPct: 0, wPct: 100, hPct: 100 }

/** 选区相对原图的最小像素尺寸（低于此值视为无效选区） */
export const IMAGE_CROP_MIN_PX = 1

/**
 * 框选器舞台每边的留白比例（= 1，即每边留出「与源图显示尺寸等大」的空白）：
 * 尽可能为「向外拖拽扩展」预留操作空间——源图 1000px 时最多可向每侧扩展 1000px
 * （输出最大 3 倍边长），够用且不至于让源图在默认缩放下小到看不清。
 *
 * 与 `IMAGE_CROP_STAGE_MARGIN_FACTOR` 成对使用的约定（**两轴等比放大**）：
 * 舞台 = 源图显示尺寸 × `IMAGE_CROP_STAGE_MARGIN_FACTOR`（横向与纵向同一个倍数），
 * 因此**舞台宽高比恒等于源图宽高比**——使用方给 `ImageCropStage` 传的 `aspect`
 * 必须是源图宽高比本身（曾误传「源图宽高比 × 系数」，舞台比源图更扁，纵向留白被吃成 0）。
 *
 * 留白多了自然会让默认缩放下的源图变小，补偿手段是**显示缩放**（`IMAGE_CROP_ZOOM_*`，
 * 面板内滚轮缩放）：默认 1 倍 = 整块「源图 + 留白」完整放进面板宽度（看得见还能扩多少），
 * 需要精细拖拽时滚轮放大。
 */
export const IMAGE_CROP_STAGE_MARGIN_RATIO = 1

/** 舞台尺寸相对源图显示尺寸的放大系数（= 1 + 2 × IMAGE_CROP_STAGE_MARGIN_RATIO，两轴同取） */
export const IMAGE_CROP_STAGE_MARGIN_FACTOR = 1 + 2 * IMAGE_CROP_STAGE_MARGIN_RATIO

/** 框选器显示缩放下限（1 = 整块舞台恰好适配容器宽度，即「全部留白可见」） */
export const IMAGE_CROP_ZOOM_MIN = 1

/** 框选器显示缩放上限（8 倍：源图 500px 显示宽时可得 4000px 的像素级拖拽精度） */
export const IMAGE_CROP_ZOOM_MAX = 8

/** 滚轮/按钮每档缩放倍率（连续滚轮按此比例连乘，手感与画布缩放一致） */
export const IMAGE_CROP_ZOOM_STEP = 1.15

/**
 * 「一档」对应的归一化滚轮位移（像素）：Chrome 鼠标滚轮一格 `deltaY` ≈ 100，
 * 恰好放大/缩小 `IMAGE_CROP_ZOOM_STEP` 一档。
 */
export const IMAGE_CROP_ZOOM_WHEEL_UNIT = 100

/** 行模式（`deltaMode = 1`）下每行折合的像素数（W3C 未规定，沿用浏览器惯例 16px/行） */
const WHEEL_LINE_PX = 16
/** 页模式（`deltaMode = 2`）下每页折合的像素数（沿用画布滚动惯例 400px/页） */
const WHEEL_PAGE_PX = 400

/**
 * 输出画布的像素上限（超限时浏览器 `drawImage` 不抛异常而是**静默画出空白**，
 * 因此必须在合成前显式拦截并给出可执行提示）。
 * - 单边上限：主流浏览器 canvas 最大边长约 32767（超出即失效）；
 * - 总像素上限：约 1 亿像素（保守值，避免占用过大内存导致移动端/低配机崩溃或空白）。
 */
export const IMAGE_CROP_MAX_SIDE = 32767
/** 输出画布的总像素上限（宽 × 高） */
export const IMAGE_CROP_MAX_PIXELS = 1e8

/** 背景色预设（编辑器快捷色块） */
export const IMAGE_CROP_BACKGROUND_PRESETS: readonly string[] = ['#FFFFFF', '#000000', '#808080', '#FF0000']

/** 选区像素矩形（原图坐标系，可为负/越界） */
export interface ImageCropPixels {
  /** 左边界（像素，可为负） */
  x: number
  /** 上边界（像素，可为负） */
  y: number
  /** 宽度（像素，≥ 1） */
  width: number
  /** 高度（像素，≥ 1） */
  height: number
}

/** 解析后的裁剪几何（画布合成与预览共用） */
export interface ImageCropGeometry {
  /** 源图可绘制区域左边界（像素，已钳制到 [0, srcW)） */
  sx: number
  /** 源图可绘制区域上边界（像素，已钳制到 [0, srcH)） */
  sy: number
  /** 源图可绘制区域宽度（像素，≥ 0；完全越界时为 0） */
  sw: number
  /** 源图可绘制区域高度（像素，≥ 0） */
  sh: number
  /** 输出画布宽度（像素，≥ 1） */
  outW: number
  /** 输出画布高度（像素，≥ 1） */
  outH: number
  /** 源图在输出画布中的绘制偏移 X（可为负；完全越界时钳制为 0） */
  padX: number
  /** 源图在输出画布中的绘制偏移 Y（可为负） */
  padY: number
  /** 是否发生裁切（选区部分/全部落在原图外，即含扩展区域） */
  extended: boolean
}

/**
 * 数值净化：有限数字原样返回，否则回退缺省值。
 *
 * @param v 待净化值
 * @param fallback 缺省值
 * @returns 净化后的数字
 */
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * 读取并净化节点选区配置（缺省/非法一律回退「原图整幅」）。
 *
 * 宽度/高度必须 > 0，否则整体回退缺省，避免出现零尺寸选区导致无法合成。
 *
 * @param config 节点 config（可为空）
 * @returns 净化后的选区
 */
export function cropRectOf(config?: NodeConfig | null): ImageCropRect {
  const raw = config?.crop as Partial<ImageCropRect> | undefined
  if (!raw || typeof raw !== 'object') return { ...IMAGE_CROP_RECT_DEFAULT }
  const wPct = num(raw.wPct, IMAGE_CROP_RECT_DEFAULT.wPct)
  const hPct = num(raw.hPct, IMAGE_CROP_RECT_DEFAULT.hPct)
  if (!(wPct > 0) || !(hPct > 0)) return { ...IMAGE_CROP_RECT_DEFAULT }
  return {
    xPct: num(raw.xPct, IMAGE_CROP_RECT_DEFAULT.xPct),
    yPct: num(raw.yPct, IMAGE_CROP_RECT_DEFAULT.yPct),
    wPct,
    hPct,
  }
}

/**
 * 判断值是否为合法输出格式。
 *
 * @param v 待判断值
 * @returns 是否合法
 */
export function isImageCropFormat(v: unknown): v is ImageCropFormat {
  return v === 'png' || v === 'jpg'
}

/**
 * 读取并净化节点输出格式（缺省/非法回退 png）。
 *
 * @param config 节点 config（可为空）
 * @returns 输出格式
 */
export function cropFormatOf(config?: NodeConfig | null): ImageCropFormat {
  return isImageCropFormat(config?.format) ? config.format : IMAGE_CROP_FORMAT_DEFAULT
}

/**
 * 解析节点产物的文件扩展名（output.{ext}）。
 *
 * 与产物路径推导（generate.ts）共用，保证「格式选择」与「固定产物路径」始终一致。
 *
 * @param config 节点 config（可为空）
 * @returns 扩展名（png / jpg）
 */
export function cropOutputExt(config?: NodeConfig | null): ImageCropFormat {
  return cropFormatOf(config)
}

/**
 * 判断值是否为允许的产物扩展名（config.outputExt 镜像合法性校验）。
 *
 * @param v 待判断值
 * @returns 是否合法
 */
export function isImageCropOutputExt(v: unknown): v is ImageCropFormat {
  return v === 'png' || v === 'jpg'
}

/**
 * 解析十六进制颜色为 {r,g,b,a}（alpha 为 0~1 浮点）。
 *
 * 支持 `#RGB` / `#RRGGBB` / `#RRGGBBAA`（不带 `#` 亦可）；非法返回 null。
 *
 * @param value 颜色字符串
 * @returns 分量对象；非法时 null
 */
export function parseHexColor(value: unknown): { r: number; g: number; b: number; a: number } | null {
  if (typeof value !== 'string') return null
  const hex = value.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null
  const expand = (s: string): string => s.split('').map((c) => c + c).join('')
  let full: string
  if (hex.length === 3) full = expand(hex)
  else if (hex.length === 4) full = expand(hex)
  else if (hex.length === 6 || hex.length === 8) full = hex
  else return null
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1
  if ([r, g, b].some((n) => !Number.isFinite(n))) return null
  return { r, g, b, a: Number.isFinite(a) ? a : 1 }
}

/**
 * 规范化背景色为 `#RRGGBBAA` 形式（大写；alpha=FF 时仍保留 8 位便于编辑）。
 *
 * @param value 颜色字符串（`#RGB` / `#RRGGBB` / `#RRGGBBAA`）
 * @param fallback 非法时的回退颜色（缺省 IMAGE_CROP_BACKGROUND_DEFAULT）
 * @returns 规范化后的颜色
 */
export function normalizeHexColor(value: unknown, fallback = IMAGE_CROP_BACKGROUND_DEFAULT): string {
  const c = parseHexColor(value)
  if (!c) return normalizeHexColor(fallback, IMAGE_CROP_BACKGROUND_DEFAULT)
  const to2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  const a = Math.max(0, Math.min(255, Math.round(c.a * 255)))
  return `#${to2(c.r)}${to2(c.g)}${to2(c.b)}${to2(a)}`.toUpperCase()
}

/**
 * 判断背景色是否完全不透明（用于「JPG 不支持透明」提示与合成时的格式回落）。
 *
 * @param value 颜色字符串
 * @returns 完全不透明返回 true；非法颜色按不透明处理（缺省白）
 */
export function isOpaqueColor(value: unknown): boolean {
  const c = parseHexColor(value)
  if (!c) return true
  return c.a >= 1
}

/**
 * 把颜色与透明度原子组装为 `#RRGGBBAA`（编辑器「颜色 + 透明度滑杆」写回用）。
 *
 * @param color 基色（`#RGB` / `#RRGGBB` / `#RRGGBBAA`；其 alpha 被忽略）
 * @param alpha 透明度 0~1（越界钳制）
 * @returns 组装后的颜色
 */
export function colorWithAlpha(color: unknown, alpha: number): string {
  const c = parseHexColor(color) ?? parseHexColor(IMAGE_CROP_BACKGROUND_DEFAULT)!
  const a = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1
  const to2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${to2(c.r)}${to2(c.g)}${to2(c.b)}${to2(a * 255)}`.toUpperCase()
}

/**
 * 取背景色的 alpha（0~1）；非法颜色按 1（不透明）处理。
 *
 * @param value 颜色字符串
 * @returns alpha（0~1）
 */
export function colorAlpha(value: unknown): number {
  return parseHexColor(value)?.a ?? 1
}

/**
 * 合成时实际使用的背景色：JPG 等不支持透明的格式下，透明背景统一回落为不透明白
 * （否则浏览器会用黑色填充 alpha=0 区域，与用户预期不符）。
 *
 * @param config 节点 config（可为空）
 * @returns 用于 canvas `fillStyle` 的颜色（`#RRGGBBAA`）
 */
export function effectiveBackgroundColor(config?: NodeConfig | null): string {
  const bg = normalizeHexColor(config?.background)
  const format = cropFormatOf(config)
  const allowTransparent = IMAGE_CROP_TRANSPARENT_FORMATS.includes(format)
  if (!allowTransparent && !isOpaqueColor(bg)) {
    const c = parseHexColor(bg)!
    const to2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
    return `#${to2(c.r)}${to2(c.g)}${to2(c.b)}FF`.toUpperCase()
  }
  return bg
}

/**
 * 选区百分比 → 原图像素矩形（四舍五入取整；宽高至少 1px）。
 *
 * @param rect 归一化选区
 * @param srcW 原图宽度（像素，> 0）
 * @param srcH 原图高度（像素，> 0）
 * @returns 像素矩形（可为负/越界）
 */
export function cropRectToPixels(rect: ImageCropRect, srcW: number, srcH: number): ImageCropPixels {
  const w = Math.max(IMAGE_CROP_MIN_PX, Math.round((rect.wPct / 100) * srcW))
  const h = Math.max(IMAGE_CROP_MIN_PX, Math.round((rect.hPct / 100) * srcH))
  return {
    x: Math.round((rect.xPct / 100) * srcW),
    y: Math.round((rect.yPct / 100) * srcH),
    width: w,
    height: h,
  }
}

/**
 * 原图像素矩形 → 归一化选区（百分比；宽高至少 1px 对应值）。
 *
 * 编辑器「手动输入输出尺寸」经此换算写回 config，保证再次读出的像素数与用户输入一致。
 *
 * @param px 像素矩形
 * @param srcW 原图宽度（像素，> 0）
 * @param srcH 原图高度（像素，> 0）
 * @returns 归一化选区
 */
export function pixelsToCropRect(px: ImageCropPixels, srcW: number, srcH: number): ImageCropRect {
  const w = Math.max(IMAGE_CROP_MIN_PX, Math.round(px.width))
  const h = Math.max(IMAGE_CROP_MIN_PX, Math.round(px.height))
  return {
    xPct: srcW > 0 ? (Math.round(px.x) / srcW) * 100 : 0,
    yPct: srcH > 0 ? (Math.round(px.y) / srcH) * 100 : 0,
    wPct: srcW > 0 ? (w / srcW) * 100 : 100,
    hPct: srcH > 0 ? (h / srcH) * 100 : 100,
  }
}

/**
 * 解析选区的完整裁剪几何（合成与预览的唯一口径）。
 *
 * 规则：
 * - 输出画布尺寸 = 选区像素尺寸（四舍五入取整，至少 1px）；
 * - 源图可绘制区域 = 选区与原图矩形的交集（完全落在原图外时为 0 尺寸，画布只剩背景色）；
 * - 绘制偏移 = 选区左上角相对输出画布的位置（负数表示源图被裁掉左上部分）。
 *
 * @param rect 归一化选区
 * @param srcW 原图宽度（像素，> 0）
 * @param srcH 原图高度（像素，> 0）
 * @returns 解析后的几何
 */
export function resolveCropGeometry(rect: ImageCropRect, srcW: number, srcH: number): ImageCropGeometry {
  const px = cropRectToPixels(rect, srcW, srcH)
  const sx = Math.max(0, px.x)
  const sy = Math.max(0, px.y)
  const right = Math.min(srcW, px.x + px.width)
  const bottom = Math.min(srcH, px.y + px.height)
  const sw = Math.max(0, right - sx)
  const sh = Math.max(0, bottom - sy)
  // 完全越界（选区与原图无交集）时把偏移钳制为 0：画布整体铺背景色，避免"画在画布外"的无效调用
  const hasOverlap = sw > 0 && sh > 0
  return {
    sx,
    sy,
    sw,
    sh,
    outW: px.width,
    outH: px.height,
    padX: hasOverlap ? Math.max(0, -px.x) : 0,
    padY: hasOverlap ? Math.max(0, -px.y) : 0,
    extended: px.x < 0 || px.y < 0 || px.x + px.width > srcW || px.y + px.height > srcH,
  }
}

/**
 * 校验输出画布是否在浏览器能力范围内。
 *
 * 超限时浏览器 `drawImage` **不抛异常而是画出空白/半张图**，因此必须在合成前拦截。
 *
 * @param outW 输出宽度（像素）
 * @param outH 输出高度（像素）
 * @returns 合法返回 null；非法返回中文错误说明
 */
export function validateOutputSize(outW: number, outH: number): string | null {
  if (!Number.isFinite(outW) || !Number.isFinite(outH) || outW < IMAGE_CROP_MIN_PX || outH < IMAGE_CROP_MIN_PX) {
    return '输出尺寸无效（宽高至少 1 像素）'
  }
  if (outW > IMAGE_CROP_MAX_SIDE || outH > IMAGE_CROP_MAX_SIDE) {
    return `输出尺寸超出浏览器画布上限（单边最大 ${IMAGE_CROP_MAX_SIDE} 像素），请缩小选区`
  }
  if (outW * outH > IMAGE_CROP_MAX_PIXELS) {
    return `输出画布像素过多（${outW} × ${outH}），请缩小选区后再应用`
  }
  return null
}

/** 框选器手柄：四个角 + 四条边 + 整体位移 */
export type ImageCropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move'

/**
 * 选区整体平移（像素，可为负/越界；宽高不变）。
 *
 * @param px 当前像素矩形
 * @param dx 水平位移（像素）
 * @param dy 垂直位移（像素）
 * @returns 平移后的像素矩形
 */
export function moveCropRect(px: ImageCropPixels, dx: number, dy: number): ImageCropPixels {
  return {
    x: Math.round(px.x + (Number.isFinite(dx) ? dx : 0)),
    y: Math.round(px.y + (Number.isFinite(dy) ? dy : 0)),
    width: px.width,
    height: px.height,
  }
}

/**
 * 按手柄缩放选区（像素）。对边固定不动，宽高至少 1px。
 *
 * 四个角与四条边共八个手柄；`'move'` 不做缩放（原样返回，调用方应改用 moveCropRect）。
 *
 * **等比模式（`altKey` 为真，界面上为按住 Shift）**：仅对**四个角**生效，按拖拽起始时的
 * 选区宽高比（`altKey` 传入该比例，即 `width / height`）等比缩放——对角落固定不动，
 * 缩放系数取**位移占优轴**的比例（横向位移更大看宽度、纵向更大看高度），再回算另一边。
 * 四条边手柄在等比模式下与普通模式一致（单边伸缩会破坏比例，故不参与）。
 *
 * @param px 当前像素矩形
 * @param handle 被拖拽的手柄
 * @param dx 水平位移（像素）
 * @param dy 垂直位移（像素）
 * @param altKey 是否等比缩放（拖拽起始选区宽高比；`undefined` = 非等比模式）
 * @returns 缩放后的像素矩形
 */
export function resizeCropRect(
  px: ImageCropPixels,
  handle: ImageCropHandle,
  dx: number,
  dy: number,
  altKey?: number,
): ImageCropPixels {
  if (handle === 'move') return { ...px }
  const ddx = Number.isFinite(dx) ? Math.round(dx) : 0
  const ddy = Number.isFinite(dy) ? Math.round(dy) : 0
  const left0 = px.x
  const top0 = px.y
  const right0 = px.x + px.width
  const bottom0 = px.y + px.height
  const isCorner = handle.length === 2
  const ratio = typeof altKey === 'number' && Number.isFinite(altKey) && altKey > 0 ? altKey : 0

  if (isCorner && ratio > 0) {
    // 等比缩放：以对角落为锚点，缩放系数取**位移占优的那一轴**的比例
    // （不用两轴最大值：dy=0 时最大值会把"缩小"钳回 1，导致拖不动）
    const rawW = handle.includes('w') ? px.width - ddx : px.width + ddx
    const rawH = handle.includes('n') ? px.height - ddy : px.height + ddy
    const scale = Math.abs(ddx) >= Math.abs(ddy) ? rawW / px.width : rawH / px.height
    const minScale = Math.max(IMAGE_CROP_MIN_PX / px.width, IMAGE_CROP_MIN_PX / px.height)
    const s = Math.max(minScale, scale)
    const width = Math.max(IMAGE_CROP_MIN_PX, Math.round(px.width * s))
    const height = Math.max(IMAGE_CROP_MIN_PX, Math.round(width / ratio))
    return {
      x: Math.round(handle.includes('w') ? right0 - width : left0),
      y: Math.round(handle.includes('n') ? bottom0 - height : top0),
      width,
      height,
    }
  }

  let left = left0
  let top = top0
  let right = right0
  let bottom = bottom0
  if (handle.includes('w')) left = left0 + ddx
  if (handle.includes('e')) right = right0 + ddx
  if (handle.includes('n')) top = top0 + ddy
  if (handle.includes('s')) bottom = bottom0 + ddy
  if (right - left < IMAGE_CROP_MIN_PX) {
    // 保证最小宽度：拖过对边时把移动边钳回，另一侧保持不动
    if (handle.includes('w')) left = right - IMAGE_CROP_MIN_PX
    else right = left + IMAGE_CROP_MIN_PX
  }
  if (bottom - top < IMAGE_CROP_MIN_PX) {
    if (handle.includes('n')) top = bottom - IMAGE_CROP_MIN_PX
    else bottom = top + IMAGE_CROP_MIN_PX
  }
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(IMAGE_CROP_MIN_PX, Math.round(right - left)),
    height: Math.max(IMAGE_CROP_MIN_PX, Math.round(bottom - top)),
  }
}

/**
 * 按滚轮/按钮方向计算下一档显示缩放（结果钳制到 `[IMAGE_CROP_ZOOM_MIN, IMAGE_CROP_ZOOM_MAX]`）。
 *
 * @param current 当前缩放倍率（非法/越界值先按上下限钳制）
 * @param direction 缩放方向：`> 0` 放大一档（滚轮上滚），`< 0` 缩小一档，`0` 保持不变
 * @returns 下一档缩放倍率（已钳制；无法再缩放时返回钳制后的当前值）
 */
export function nextCropZoom(current: number, direction: number): number {
  const from = clampZoom(current)
  if (!Number.isFinite(direction) || direction === 0) return from
  return clampZoom(direction > 0 ? from * IMAGE_CROP_ZOOM_STEP : from / IMAGE_CROP_ZOOM_STEP)
}

/**
 * 把缩放倍率钳制到 `[IMAGE_CROP_ZOOM_MIN, IMAGE_CROP_ZOOM_MAX]`（非法值按 MIN 处理）。
 *
 * @param zoom 缩放倍率
 * @returns 钳制后的缩放倍率
 */
function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return IMAGE_CROP_ZOOM_MIN
  return Math.min(IMAGE_CROP_ZOOM_MAX, Math.max(IMAGE_CROP_ZOOM_MIN, zoom))
}

/**
 * 把滚轮事件的 `deltaY` 归一化为像素单位（`deltaMode`：0 = 像素、1 = 行、2 = 页）。
 *
 * 三种模式必须区分：Firefox 默认按「行」上报（一格 `deltaY = 3`），若按像素处理，
 * 触控板/滚轮都得滚几十下才动一档。
 *
 * @param deltaY 滚轮位移（原始值）
 * @param deltaMode 位移单位（缺省 0 = 像素）
 * @returns 归一化后的像素位移（非有限值返回 0）
 */
export function normalizeWheelDelta(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 0
  if (deltaMode === 1) return deltaY * WHEEL_LINE_PX
  if (deltaMode === 2) return deltaY * WHEEL_PAGE_PX
  return deltaY
}

/**
 * 按滚轮位移计算缩放倍率：**指数映射**（位移越大缩放越多，方向由正负决定）。
 *
 * 用「每事件固定一档」在触控板上会失控——一次两指滑动会连发几十个 `deltaY = ±3` 的事件，
 * 每次都乘 1.15 会瞬间冲到上限。指数映射让缩放量正比于实际滚动距离：
 * 鼠标滚轮一格（100px 归一化）仍恰好一档，触控板的连续小位移则平滑累积。
 *
 * @param current 当前缩放倍率（非法/越界值先按上下限钳制）
 * @param deltaY 归一化后的滚轮位移（像素，上滚为负 = 放大）
 * @returns 缩放后的倍率（已钳制）
 */
export function zoomByWheelDelta(current: number, deltaY: number): number {
  const from = clampZoom(current)
  if (!Number.isFinite(deltaY) || deltaY === 0) return from
  return clampZoom(from * Math.pow(IMAGE_CROP_ZOOM_STEP, -deltaY / IMAGE_CROP_ZOOM_WHEEL_UNIT))
}

/** 光标锚定缩放所需的滚动状态（`resizeCropRect` 式的纯几何，便于单测） */
export interface ImageCropZoomAnchor {
  /** 缩放前滚动容器的水平滚动量（像素） */
  scrollLeft: number
  /** 缩放前滚动容器的垂直滚动量（像素） */
  scrollTop: number
  /** 指针相对滚动容器**可视区左上角**的水平偏移（像素，= clientX − rect.left） */
  offsetX: number
  /** 指针相对滚动容器可视区左上角的垂直偏移（像素） */
  offsetY: number
  /** 缩放比例（新缩放 ÷ 旧缩放，> 0） */
  ratio: number
}

/**
 * 计算「光标锚定缩放」后的滚动位置：缩放前后**指针下的那一点内容保持不动**。
 *
 * 做法：把指针在可视区内的偏移换算成内容坐标（`scroll + offset`），按 `ratio` 缩放后
 * 再反算回滚动量。面板里的框选器是滚动容器（放大后出现滚动条），若不修正滚动位置，
 * 放大时内容会朝左上角漂移，用户正在看的选区瞬间跑出视野。
 *
 * @param anchor 缩放前滚动状态与指针位置
 * @returns 修正后的滚动位置（负值钳制为 0；非有限值回退原滚动量）
 */
export function anchoredZoomScroll(anchor: ImageCropZoomAnchor): { scrollLeft: number; scrollTop: number } {
  const { scrollLeft, scrollTop, offsetX, offsetY, ratio } = anchor
  if (!Number.isFinite(ratio) || ratio <= 0) return { scrollLeft, scrollTop }
  const next = (scroll: number, offset: number): number => {
    const value = (scroll + offset) * ratio - offset
    return Number.isFinite(value) ? Math.max(0, value) : scroll
  }
  return { scrollLeft: next(scrollLeft, offsetX), scrollTop: next(scrollTop, offsetY) }
}
