import { describe, expect, it } from 'vitest'
import {
  anchoredZoomScroll,
  colorAlpha,
  colorWithAlpha,
  cropFormatOf,
  cropOutputExt,
  cropRectOf,
  cropRectToPixels,
  effectiveBackgroundColor,
  IMAGE_CROP_MAX_SIDE,
  IMAGE_CROP_RECT_DEFAULT,
  IMAGE_CROP_STAGE_MARGIN_FACTOR,
  IMAGE_CROP_STAGE_MARGIN_RATIO,
  IMAGE_CROP_ZOOM_MAX,
  IMAGE_CROP_ZOOM_MIN,
  IMAGE_CROP_ZOOM_STEP,
  IMAGE_CROP_ZOOM_WHEEL_UNIT,
  isImageCropFormat,
  isOpaqueColor,
  moveCropRect,
  nextCropZoom,
  normalizeHexColor,
  normalizeWheelDelta,
  parseHexColor,
  pixelsToCropRect,
  resizeCropRect,
  resolveCropGeometry,
  validateOutputSize,
  zoomByWheelDelta,
  type ImageCropPixels,
} from './imageCrop'

/** 基准源图尺寸：1920 × 1080 */
const SRC_W = 1920
const SRC_H = 1080

describe('cropRectOf（选区读取与净化）', () => {
  it('缺省/非法一律回退原图整幅', () => {
    expect(cropRectOf()).toEqual(IMAGE_CROP_RECT_DEFAULT)
    expect(cropRectOf({})).toEqual(IMAGE_CROP_RECT_DEFAULT)
    expect(cropRectOf({ crop: null })).toEqual(IMAGE_CROP_RECT_DEFAULT)
    expect(cropRectOf({ crop: 'bad' })).toEqual(IMAGE_CROP_RECT_DEFAULT)
    expect(cropRectOf({ crop: { xPct: 10, yPct: 10, wPct: 0, hPct: 50 } })).toEqual(IMAGE_CROP_RECT_DEFAULT)
    expect(cropRectOf({ crop: { xPct: 10, yPct: 10, wPct: 50, hPct: -5 } })).toEqual(IMAGE_CROP_RECT_DEFAULT)
  })

  it('合法选区原样读取（允许负值与超过 100）', () => {
    const rect = { xPct: -10, yPct: -5, wPct: 120, hPct: 140 }
    expect(cropRectOf({ crop: rect })).toEqual(rect)
  })

  it('部分字段缺失时逐字段回落缺省', () => {
    expect(cropRectOf({ crop: { wPct: 50 } })).toEqual({ xPct: 0, yPct: 0, wPct: 50, hPct: 100 })
    expect(cropRectOf({ crop: { xPct: 25, yPct: 25, wPct: 50, hPct: 50 } })).toEqual({
      xPct: 25,
      yPct: 25,
      wPct: 50,
      hPct: 50,
    })
  })

  it('NaN / Infinity 等非有限值回落缺省', () => {
    expect(cropRectOf({ crop: { xPct: NaN, yPct: Infinity, wPct: 50, hPct: 50 } })).toEqual({
      xPct: 0,
      yPct: 0,
      wPct: 50,
      hPct: 50,
    })
  })
})

describe('输出格式读取与产物扩展名', () => {
  it('缺省 png，合法值原样返回', () => {
    expect(cropFormatOf()).toBe('png')
    expect(cropFormatOf({})).toBe('png')
    expect(cropFormatOf({ format: 'png' })).toBe('png')
    expect(cropFormatOf({ format: 'jpg' })).toBe('jpg')
  })

  it('非法值回退 png', () => {
    expect(cropFormatOf({ format: 'webp' })).toBe('png')
    expect(cropFormatOf({ format: 1 })).toBe('png')
    expect(isImageCropFormat('gif')).toBe(false)
  })

  it('产物扩展名与格式一致', () => {
    expect(cropOutputExt({ format: 'jpg' })).toBe('jpg')
    expect(cropOutputExt({ format: 'png' })).toBe('png')
    expect(cropOutputExt({})).toBe('png')
  })
})

describe('颜色解析与规范化', () => {
  it('parseHexColor 支持 3/4/6/8 位与无 # 前缀', () => {
    expect(parseHexColor('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseHexColor('000000')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(parseHexColor('#F00')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseHexColor('#0000FF80')).toEqual({ r: 0, g: 0, b: 255, a: 128 / 255 })
    expect(parseHexColor('not-a-color')).toBeNull()
    expect(parseHexColor('')).toBeNull()
    expect(parseHexColor(123)).toBeNull()
    expect(parseHexColor('#12345')).toBeNull()
  })

  it('normalizeHexColor 统一输出 #RRGGBBAA 大写形式', () => {
    expect(normalizeHexColor('#fff')).toBe('#FFFFFFFF')
    expect(normalizeHexColor('ff0000')).toBe('#FF0000FF')
    expect(normalizeHexColor('#0000ff80')).toBe('#0000FF80')
    // 3 位十六进制是合法颜色（'bad' → #bbaadd），真正非法的输入才回退
    expect(normalizeHexColor('xyz')).toBe('#FFFFFFFF')
    expect(normalizeHexColor('#12345')).toBe('#FFFFFFFF')
    expect(normalizeHexColor('xyz', '#00000000')).toBe('#00000000')
  })

  it('colorWithAlpha 组装基色与透明度（越界钳制）', () => {
    expect(colorWithAlpha('#FF0000', 1)).toBe('#FF0000FF')
    expect(colorWithAlpha('#FF0000', 0)).toBe('#FF000000')
    expect(colorWithAlpha('#00FF00', 0.5)).toBe('#00FF0080')
    expect(colorWithAlpha('#00FF00', 2)).toBe('#00FF00FF')
    expect(colorWithAlpha('#00FF00', -1)).toBe('#00FF0000')
    expect(colorWithAlpha('xyz', 1)).toBe('#FFFFFFFF')
    expect(colorWithAlpha('xyz', 0)).toBe('#FFFFFF00')
  })

  it('colorAlpha / isOpaqueColor 判定透明度', () => {
    expect(colorAlpha('#FFFFFF')).toBe(1)
    expect(colorAlpha('#FFFFFF00')).toBe(0)
    expect(isOpaqueColor('#FFFFFF')).toBe(true)
    expect(isOpaqueColor('#FFFFFF00')).toBe(false)
    expect(isOpaqueColor('#00000080')).toBe(false)
    expect(isOpaqueColor('xyz')).toBe(true)
  })

  it('effectiveBackgroundColor：JPG 下透明回落不透明白，PNG 下保留透明', () => {
    expect(effectiveBackgroundColor({ background: '#00000000', format: 'jpg' })).toBe('#000000FF')
    expect(effectiveBackgroundColor({ background: '#00000000', format: 'png' })).toBe('#00000000')
    expect(effectiveBackgroundColor({ background: '#12345680', format: 'jpg' })).toBe('#123456FF')
    expect(effectiveBackgroundColor({ background: '#12345680', format: 'png' })).toBe('#12345680')
    expect(effectiveBackgroundColor({})).toBe('#FFFFFFFF')
  })
})

describe('百分比 ↔ 像素换算', () => {
  it('原图整幅 = 源图尺寸', () => {
    expect(cropRectToPixels(IMAGE_CROP_RECT_DEFAULT, SRC_W, SRC_H)).toEqual({
      x: 0,
      y: 0,
      width: SRC_W,
      height: SRC_H,
    })
  })

  it('比例换算四舍五入取整', () => {
    const px = cropRectToPixels({ xPct: 10, yPct: 20, wPct: 50, hPct: 25 }, SRC_W, SRC_H)
    expect(px).toEqual({ x: 192, y: 216, width: 960, height: 270 })
  })

  it('极小选区也至少 1 像素', () => {
    const px = cropRectToPixels({ xPct: 0, yPct: 0, wPct: 0.001, hPct: 0.001 }, SRC_W, SRC_H)
    expect(px.width).toBe(1)
    expect(px.height).toBe(1)
  })

  it('负数/超过 100 的百分比原样换算（向外扩展）', () => {
    const px = cropRectToPixels({ xPct: -10, yPct: -10, wPct: 120, hPct: 120 }, SRC_W, SRC_H)
    expect(px).toEqual({ x: -192, y: -108, width: 2304, height: 1296 })
  })

  it('pixelsToCropRect ↔ cropRectToPixels 往返后像素不变（编辑器输入回显口径）', () => {
    const px: ImageCropPixels = { x: -100, y: 40, width: 1200, height: 800 }
    const rect = pixelsToCropRect(px, SRC_W, SRC_H)
    expect(cropRectToPixels(rect, SRC_W, SRC_H)).toEqual(px)
  })

  it('源图尺寸未知时给出安全的兜底百分比', () => {
    expect(pixelsToCropRect({ x: 0, y: 0, width: 100, height: 100 }, 0, 0)).toEqual({
      xPct: 0,
      yPct: 0,
      wPct: 100,
      hPct: 100,
    })
  })
})

describe('resolveCropGeometry（合成与预览的统一几何口径）', () => {
  it('整幅选区：源图铺满画布、无偏移', () => {
    const g = resolveCropGeometry(IMAGE_CROP_RECT_DEFAULT, SRC_W, SRC_H)
    expect(g).toEqual({
      sx: 0,
      sy: 0,
      sw: SRC_W,
      sh: SRC_H,
      outW: SRC_W,
      outH: SRC_H,
      padX: 0,
      padY: 0,
      extended: false,
    })
  })

  it('向内裁剪：画布等于选区，源图偏移为 0', () => {
    const g = resolveCropGeometry({ xPct: 25, yPct: 25, wPct: 50, hPct: 50 }, SRC_W, SRC_H)
    expect(g.outW).toBe(960)
    expect(g.outH).toBe(540)
    expect(g.sx).toBe(480)
    expect(g.sy).toBe(270)
    expect(g.sw).toBe(960)
    expect(g.sh).toBe(540)
    expect(g.padX).toBe(0)
    expect(g.padY).toBe(0)
    expect(g.extended).toBe(false)
  })

  it('向外扩展：画布变大，源图按负偏移绘制（偏移取绝对值）', () => {
    const g = resolveCropGeometry({ xPct: -10, yPct: -10, wPct: 120, hPct: 120 }, SRC_W, SRC_H)
    expect(g.outW).toBe(2304)
    expect(g.outH).toBe(1296)
    expect(g.sw).toBe(SRC_W)
    expect(g.sh).toBe(SRC_H)
    expect(g.padX).toBe(192)
    expect(g.padY).toBe(108)
    expect(g.sx).toBe(0)
    expect(g.sy).toBe(0)
    expect(g.extended).toBe(true)
  })

  it('单边扩展：仅该方向有填充', () => {
    // 左边界保持 0、右边界扩到 120% → 右侧多出 20% 空白
    const g = resolveCropGeometry({ xPct: 0, yPct: 0, wPct: 120, hPct: 100 }, SRC_W, SRC_H)
    expect(g.outW).toBe(2304)
    expect(g.padX).toBe(0)
    expect(g.sw).toBe(SRC_W)
    expect(g.padY).toBe(0)
    expect(g.extended).toBe(true)
  })

  it('部分越界的裁剪：源图区域被钳制到图片内', () => {
    // 选区左边界在原图内 -5%、右边界超出 10%
    const g = resolveCropGeometry({ xPct: -5, yPct: 0, wPct: 115, hPct: 100 }, SRC_W, SRC_H)
    expect(g.outW).toBe(2208)
    expect(g.sx).toBe(0)
    expect(g.sw).toBe(SRC_W)
    expect(g.padX).toBe(96)
    expect(g.padY).toBe(0)
    expect(g.extended).toBe(true)
  })

  it('完全落在原图外：该方向可绘制区域为 0（合成时整体只铺背景色）', () => {
    const g = resolveCropGeometry({ xPct: -300, yPct: 0, wPct: 50, hPct: 50 }, SRC_W, SRC_H)
    // 水平方向与原图无交集 → sw=0；垂直方向仍有交集（sh 保留，但合成以 sw>0 && sh>0 为绘制条件）
    expect(g.sw).toBe(0)
    expect(g.sh).toBe(540)
    expect(g.padX).toBe(0)
    expect(g.padY).toBe(0)
    expect(g.outW).toBe(960)
    expect(g.outH).toBe(540)
    expect(g.extended).toBe(true)
  })
})

describe('validateOutputSize（浏览器画布上限拦截）', () => {
  it('合法尺寸返回 null', () => {
    expect(validateOutputSize(1920, 1080)).toBeNull()
    expect(validateOutputSize(1, 1)).toBeNull()
    expect(validateOutputSize(IMAGE_CROP_MAX_SIDE, 1)).toBeNull()
  })

  it('单边超限给出可执行提示', () => {
    const msg = validateOutputSize(IMAGE_CROP_MAX_SIDE + 1, 100)
    expect(msg).toContain('单边最大')
  })

  it('总像素超限给出可执行提示', () => {
    const msg = validateOutputSize(20000, 20000)
    expect(msg).toContain('像素过多')
  })

  it('非法尺寸（0 / 负数 / 非数字）报错', () => {
    expect(validateOutputSize(0, 100)).toContain('无效')
    expect(validateOutputSize(100, -1)).toContain('无效')
    expect(validateOutputSize(NaN, 100)).toContain('无效')
  })
})

describe('moveCropRect / resizeCropRect（八向拖拽几何）', () => {
  /** 基准选区：x=100 y=100 w=400 h=300 */
  const base: ImageCropPixels = { x: 100, y: 100, width: 400, height: 300 }

  it('整体位移：宽高不变、可越界（扩展）', () => {
    expect(moveCropRect(base, 50, -30)).toEqual({ x: 150, y: 70, width: 400, height: 300 })
    expect(moveCropRect(base, -500, 0)).toEqual({ x: -400, y: 100, width: 400, height: 300 })
  })

  it('四角缩放：对角落固定', () => {
    expect(resizeCropRect(base, 'nw', -20, -10)).toEqual({ x: 80, y: 90, width: 420, height: 310 })
    expect(resizeCropRect(base, 'se', 20, 10)).toEqual({ x: 100, y: 100, width: 420, height: 310 })
    expect(resizeCropRect(base, 'ne', 20, -10)).toEqual({ x: 100, y: 90, width: 420, height: 310 })
    expect(resizeCropRect(base, 'sw', -20, 10)).toEqual({ x: 80, y: 100, width: 420, height: 310 })
  })

  it('四边缩放：仅移动被拖的边', () => {
    expect(resizeCropRect(base, 'n', 0, -10)).toEqual({ x: 100, y: 90, width: 400, height: 310 })
    expect(resizeCropRect(base, 's', 0, 10)).toEqual({ x: 100, y: 100, width: 400, height: 310 })
    expect(resizeCropRect(base, 'w', -20, 0)).toEqual({ x: 80, y: 100, width: 420, height: 300 })
    expect(resizeCropRect(base, 'e', 20, 0)).toEqual({ x: 100, y: 100, width: 420, height: 300 })
  })

  it('最小尺寸 1px：拖过对边时钳回，不出现负尺寸', () => {
    const e = resizeCropRect(base, 'e', -1000, 0)
    expect(e.width).toBe(1)
    expect(e.x).toBe(100)
    const w = resizeCropRect(base, 'w', 1000, 0)
    expect(w.width).toBe(1)
    expect(w.x).toBe(499)
    const se = resizeCropRect(base, 'se', -1000, -1000)
    expect(se.width).toBe(1)
    expect(se.height).toBe(1)
  })

  it("'move' 手柄不做缩放（原样返回副本）", () => {
    const r = resizeCropRect(base, 'move', 50, 50)
    expect(r).toEqual(base)
    expect(r).not.toBe(base)
  })

  it('非有限位移按 0 处理', () => {
    expect(resizeCropRect(base, 'e', NaN, 0)).toEqual(base)
    expect(moveCropRect(base, Infinity, 0)).toEqual(base)
  })
})

describe('resizeCropRect 等比模式（按住 Shift 拖拽四角）', () => {
  /** 基准选区：400×300（比例 4:3） */
  const base: ImageCropPixels = { x: 100, y: 100, width: 400, height: 300 }
  const RATIO = 400 / 300

  it('右下角：按起始比例等比放大，左上角固定', () => {
    const r = resizeCropRect(base, 'se', 200, 0, RATIO)
    expect(r.x).toBe(100)
    expect(r.y).toBe(100)
    expect(r.width).toBe(600)
    expect(r.height).toBe(450)
    expect(r.width / r.height).toBeCloseTo(RATIO, 2)
  })

  it('左上角：右下角固定，按比例缩放', () => {
    const r = resizeCropRect(base, 'nw', -100, 0, RATIO)
    expect(r.x + r.width).toBe(500)
    expect(r.y + r.height).toBe(400)
    expect(r.width).toBe(500)
    expect(r.height).toBe(375)
  })

  it('右上角与左下角：对角落固定', () => {
    const ne = resizeCropRect(base, 'ne', 100, -100, RATIO)
    expect(ne.x).toBe(100)
    expect(ne.y + ne.height).toBe(400)
    expect(ne.width / ne.height).toBeCloseTo(RATIO, 2)

    const sw = resizeCropRect(base, 'sw', -100, 100, RATIO)
    expect(sw.x + sw.width).toBe(500)
    expect(sw.y).toBe(100)
    expect(sw.width / sw.height).toBeCloseTo(RATIO, 2)
  })

  it('取位移占优轴的比例（横向占优看宽、纵向占优看高；两轴相等时看宽）', () => {
    // 横向占优：宽 +200 → 600（若误用纵向则仍为 400）
    const wDominant = resizeCropRect(base, 'se', 200, 0, RATIO)
    expect(wDominant.width).toBe(600)
    // 纵向占优：高 +150 → 300 → 宽 600
    const hDominant = resizeCropRect(base, 'se', 0, 150, RATIO)
    expect(hDominant.height).toBe(450)
    // 缩小方向同样可动（历史缺陷：max 规则在 dy=0 时把缩小钳回 1:1）
    const shrink = resizeCropRect(base, 'se', -200, 0, RATIO)
    expect(shrink.width).toBe(200)
    expect(shrink.height).toBe(150)
  })

  it('支持非原图比例（如 16:9 选区）', () => {
    const wide: ImageCropPixels = { x: 0, y: 0, width: 1600, height: 900 }
    const r = resizeCropRect(wide, 'se', -800, 0, 1600 / 900)
    expect(r.width).toBe(800)
    expect(r.height).toBe(450)
  })

  it('缩到极小时仍保持 ≥ 1px 且不翻转', () => {
    const r = resizeCropRect(base, 'se', -1000, -1000, RATIO)
    expect(r.width).toBeGreaterThanOrEqual(1)
    expect(r.height).toBeGreaterThanOrEqual(1)
    expect(r.x).toBe(100)
    expect(r.y).toBe(100)
  })

  it('四边手柄不受等比模式影响（单边伸缩，行为与普通模式一致）', () => {
    expect(resizeCropRect(base, 'e', 20, 0, RATIO)).toEqual(resizeCropRect(base, 'e', 20, 0))
    expect(resizeCropRect(base, 's', 0, 20, RATIO)).toEqual(resizeCropRect(base, 's', 0, 20))
  })

  it('比例为非法值（0 / 负数 / NaN）时退化为普通模式', () => {
    expect(resizeCropRect(base, 'se', 20, 10, 0)).toEqual(resizeCropRect(base, 'se', 20, 10))
    expect(resizeCropRect(base, 'se', 20, 10, -1)).toEqual(resizeCropRect(base, 'se', 20, 10))
    expect(resizeCropRect(base, 'se', 20, 10, NaN)).toEqual(resizeCropRect(base, 'se', 20, 10))
  })

  it("'move' 手柄在等比模式下同样不缩放", () => {
    expect(resizeCropRect(base, 'move', 50, 50, RATIO)).toEqual(base)
  })
})

describe('舞台留白与显示缩放（nextCropZoom / anchoredZoomScroll）', () => {
  it('留白系数与留白比例成对（舞台宽高比 = 源图宽高比 × 系数）', () => {
    expect(IMAGE_CROP_STAGE_MARGIN_RATIO).toBe(1)
    expect(IMAGE_CROP_STAGE_MARGIN_FACTOR).toBe(1 + 2 * IMAGE_CROP_STAGE_MARGIN_RATIO)
    // 每边留出与源图等大的空白 ⇒ 最多可把输出撑到源图的 3 倍边长
    expect(IMAGE_CROP_STAGE_MARGIN_FACTOR).toBe(3)
  })

  it('nextCropZoom：上滚放大一档、下滚缩小一档（倍率为常量）', () => {
    expect(nextCropZoom(1, 1)).toBeCloseTo(IMAGE_CROP_ZOOM_STEP, 10)
    expect(nextCropZoom(IMAGE_CROP_ZOOM_STEP, -1)).toBeCloseTo(1, 10)
    expect(nextCropZoom(2, 1)).toBeCloseTo(2 * IMAGE_CROP_ZOOM_STEP, 10)
  })

  it('nextCropZoom：钳制在 [MIN, MAX]，到边界后不再变化', () => {
    expect(nextCropZoom(IMAGE_CROP_ZOOM_MAX, 1)).toBe(IMAGE_CROP_ZOOM_MAX)
    expect(nextCropZoom(IMAGE_CROP_ZOOM_MIN, -1)).toBe(IMAGE_CROP_ZOOM_MIN)
    expect(nextCropZoom(1000, 1)).toBe(IMAGE_CROP_ZOOM_MAX)
    expect(nextCropZoom(0, -1)).toBe(IMAGE_CROP_ZOOM_MIN)
  })

  it('nextCropZoom：方向为 0 / 非法值时保持当前档（非法当前值按 MIN 处理）', () => {
    expect(nextCropZoom(2, 0)).toBe(2)
    expect(nextCropZoom(2, NaN)).toBe(2)
    expect(nextCropZoom(NaN, 0)).toBe(IMAGE_CROP_ZOOM_MIN)
  })

  it('normalizeWheelDelta：像素/行/页三种 deltaMode 归一到像素', () => {
    expect(normalizeWheelDelta(100)).toBe(100)
    expect(normalizeWheelDelta(100, 0)).toBe(100)
    // 行模式（Firefox 默认，一格 deltaY = 3）折合 16px/行
    expect(normalizeWheelDelta(3, 1)).toBe(48)
    // 页模式折合 400px/页
    expect(normalizeWheelDelta(1, 2)).toBe(400)
    expect(normalizeWheelDelta(NaN, 1)).toBe(0)
  })

  it('zoomByWheelDelta：一格滚轮（100px）恰好一档，方向由位移正负决定', () => {
    expect(zoomByWheelDelta(1, -IMAGE_CROP_ZOOM_WHEEL_UNIT)).toBeCloseTo(IMAGE_CROP_ZOOM_STEP, 10)
    expect(zoomByWheelDelta(IMAGE_CROP_ZOOM_STEP, IMAGE_CROP_ZOOM_WHEEL_UNIT)).toBeCloseTo(1, 10)
    // 位移翻倍 → 缩放量按指数累积（两格 = 一档的平方）
    expect(zoomByWheelDelta(1, -2 * IMAGE_CROP_ZOOM_WHEEL_UNIT)).toBeCloseTo(IMAGE_CROP_ZOOM_STEP ** 2, 10)
  })

  it('zoomByWheelDelta：触控板式连续小位移不会一帧冲到头', () => {
    // 单个 deltaY = -3 的事件只放大 1.15^0.03 ≈ 1.0042
    const one = zoomByWheelDelta(1, -3)
    expect(one).toBeGreaterThan(1)
    expect(one).toBeLessThan(1.01)
    // 20 个连续小位移仍远小于上限（旧实现「每事件一档」会到 1.15^20 ≈ 16 倍）
    let z = 1
    for (let i = 0; i < 20; i += 1) z = zoomByWheelDelta(z, -3)
    expect(z).toBeCloseTo(IMAGE_CROP_ZOOM_STEP ** 0.6, 6)
    expect(z).toBeLessThan(1.1)
  })

  it('zoomByWheelDelta：钳制在 [MIN, MAX]，位移为 0 / 非法时保持当前档', () => {
    expect(zoomByWheelDelta(1, 1000)).toBe(IMAGE_CROP_ZOOM_MIN)
    expect(zoomByWheelDelta(IMAGE_CROP_ZOOM_MAX, -1000)).toBe(IMAGE_CROP_ZOOM_MAX)
    expect(zoomByWheelDelta(2, 0)).toBe(2)
    expect(zoomByWheelDelta(2, NaN)).toBe(2)
    expect(zoomByWheelDelta(NaN, -100)).toBeGreaterThanOrEqual(IMAGE_CROP_ZOOM_MIN)
  })

  it('anchoredZoomScroll：指针下的内容点在缩放前后保持不动', () => {
    // 指针在可视区 (100, 50)，滚动量 (200, 100)，放大 2 倍：
    // 内容坐标 x = 300 → 缩放后 600 → 新滚动量 = 600 − 100 = 500（y 同理 = 300 − 50 = 250）
    expect(anchoredZoomScroll({ scrollLeft: 200, scrollTop: 100, offsetX: 100, offsetY: 50, ratio: 2 }))
      .toEqual({ scrollLeft: 500, scrollTop: 250 })
  })

  it('anchoredZoomScroll：缩小（ratio < 1）时滚动量随之减小，负值钳制为 0', () => {
    // 内容坐标 x = 140 → 缩小一半 70 → 70 − 100 = −30 → 钳制 0
    expect(anchoredZoomScroll({ scrollLeft: 40, offsetX: 100, scrollTop: 0, offsetY: 0, ratio: 0.5 }))
      .toEqual({ scrollLeft: 0, scrollTop: 0 })
  })

  it('anchoredZoomScroll：ratio = 1 或非法时滚动量不变（回退原值）', () => {
    const base = { scrollLeft: 120, scrollTop: 60, offsetX: 30, offsetY: 30 }
    expect(anchoredZoomScroll({ ...base, ratio: 1 })).toEqual({ scrollLeft: 120, scrollTop: 60 })
    expect(anchoredZoomScroll({ ...base, ratio: 0 })).toEqual({ scrollLeft: 120, scrollTop: 60 })
    expect(anchoredZoomScroll({ ...base, ratio: NaN })).toEqual({ scrollLeft: 120, scrollTop: 60 })
  })
})
