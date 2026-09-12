import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  composeCropToBlob,
  composeResultToFile,
  loadImageElement,
  IMAGE_CROP_JPEG_QUALITY,
} from './imageCompose'
import { IMAGE_CROP_RECT_DEFAULT, IMAGE_CROP_MAX_SIDE } from './imageCrop'

/**
 * 假 Canvas 记录器：capture getContext('2d') 上的 fillStyle/fillRect/drawImage
 * 与 toBlob 的编码参数，用于断言合成行为（jsdom 不实现 canvas 渲染）。
 */
interface FakeCanvas {
  /** 被创建的 canvas 元素（读取 width/height） */
  canvas: HTMLCanvasElement
  /** toBlob 编码时刻的 canvas 宽度（合成后会被清零以释放内存，故在编码时采样） */
  widthAtEncode?: number
  /** toBlob 编码时刻的 canvas 高度 */
  heightAtEncode?: number
  /** drawImage 调用参数列表 */
  drawImages: unknown[][]
  /** fillRect 调用参数列表 */
  fillRects: number[][]
  /** fillStyle 赋值序列 */
  fillStyles: string[]
  /** toBlob 调用参数（type / quality） */
  blobs: Array<{ type?: string; quality?: number }>
}

/** 源图尺寸（基准） */
const SRC_W = 800
const SRC_H = 600

/**
 * 构造假源图元素。
 *
 * @param w 自然宽度
 * @param h 自然高度
 * @returns 假 HTMLImageElement
 */
function fakeImage(w = SRC_W, h = SRC_H): HTMLImageElement {
  return { naturalWidth: w, naturalHeight: h, width: w, height: h } as unknown as HTMLImageElement
}

/**
 * 安装假 canvas 工厂（document.createElement('canvas')）。
 *
 * @param blob 传给 toBlob 回调的结果（null 模拟编码失败）
 * @returns 记录器
 */
function installFakeCanvas(blob: Blob | null = new Blob(['x'], { type: 'image/png' })): FakeCanvas {
  const recorder: FakeCanvas = { canvas: null as unknown as HTMLCanvasElement, drawImages: [], fillRects: [], fillStyles: [], blobs: [] }
  const ctx = {
    set fillStyle(v: string) {
      recorder.fillStyles.push(v)
    },
    get fillStyle() {
      return recorder.fillStyles[recorder.fillStyles.length - 1] ?? ''
    },
    fillRect: (...args: number[]) => recorder.fillRects.push(args),
    drawImage: (...args: unknown[]) => recorder.drawImages.push(args),
  }
  const original = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, opts?: ElementCreationOptions) => {
    if (tag !== 'canvas') return original(tag, opts)
    const el = original('canvas') as HTMLCanvasElement
    Object.defineProperty(el, 'getContext', { value: () => ctx, configurable: true })
    Object.defineProperty(el, 'toBlob', {
      value: (cb: (b: Blob | null) => void, type?: string, quality?: number) => {
        recorder.blobs.push({ type, quality })
        recorder.widthAtEncode = el.width
        recorder.heightAtEncode = el.height
        cb(blob)
      },
      configurable: true,
    })
    recorder.canvas = el
    return el
  })
  return recorder
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('composeCropToBlob（裁剪/扩展合成与编码）', () => {
  it('canvas 尺寸 = 选区尺寸，先铺背景色再绘制源图可见区域', async () => {
    const rec = installFakeCanvas()
    const res = await composeCropToBlob({
      image: fakeImage(),
      crop: { xPct: 25, yPct: 25, wPct: 50, hPct: 50 },
      background: '#FF0000',
      format: 'png',
    })
    expect(rec.widthAtEncode).toBe(400)
    expect(rec.heightAtEncode).toBe(300)
    expect(rec.fillStyles[0]).toBe('#FF0000FF')
    expect(rec.fillRects[0]).toEqual([0, 0, 400, 300])
    // 源图区域：(200,150) 起 400×300，画到 (0,0)
    expect(rec.drawImages[0]).toEqual([expect.anything(), 200, 150, 400, 300, 0, 0, 400, 300])
    expect(res).toMatchObject({ width: 400, height: 300, mime: 'image/png' })
    expect(res.blob).toBeInstanceOf(Blob)
  })

  it('向外扩展：画布变大，源图按正偏移绘制（负选区坐标取绝对值）', async () => {
    const rec = installFakeCanvas()
    const res = await composeCropToBlob({
      image: fakeImage(),
      crop: { xPct: -12.5, yPct: -25, wPct: 125, hPct: 150 },
      background: '#00FF00',
      format: 'png',
    })
    // -12.5% × 800 = -100 → outW = 1000；-25% × 600 = -150 → outH = 900
    expect(rec.widthAtEncode).toBe(1000)
    expect(rec.heightAtEncode).toBe(900)
    expect(rec.drawImages[0]).toEqual([expect.anything(), 0, 0, 800, 600, 100, 150, 800, 600])
    expect(res).toMatchObject({ width: 1000, height: 900 })
  })

  it('选区完全落在原图外：只铺背景色，不调用 drawImage', async () => {
    const rec = installFakeCanvas()
    const res = await composeCropToBlob({
      image: fakeImage(),
      crop: { xPct: 200, yPct: 0, wPct: 50, hPct: 50 },
      background: '#000000',
      format: 'png',
    })
    expect(rec.drawImages).toHaveLength(0)
    expect(rec.fillRects).toHaveLength(1)
    expect(res).toMatchObject({ width: 400, height: 300 })
  })

  it('PNG：透明背景原样保留，编码为 image/png 且不带质量参数', async () => {
    const rec = installFakeCanvas()
    await composeCropToBlob({
      image: fakeImage(),
      crop: IMAGE_CROP_RECT_DEFAULT,
      background: '#00000000',
      format: 'png',
    })
    expect(rec.fillStyles[0]).toBe('#00000000')
    expect(rec.blobs[0].type).toBe('image/png')
    expect(rec.blobs[0].quality).toBeUndefined()
  })

  it('JPG：透明背景回落不透明（保留 RGB，仅 alpha 强制 FF），编码为 image/jpeg 且带质量参数', async () => {
    const rec = installFakeCanvas(new Blob(['x'], { type: 'image/jpeg' }))
    const res = await composeCropToBlob({
      image: fakeImage(),
      crop: IMAGE_CROP_RECT_DEFAULT,
      background: '#00000000',
      format: 'jpg',
    })
    expect(rec.fillStyles[0]).toBe('#000000FF')
    expect(rec.blobs[0].type).toBe('image/jpeg')
    expect(rec.blobs[0].quality).toBe(IMAGE_CROP_JPEG_QUALITY)
    expect(res.mime).toBe('image/jpeg')
  })

  it('尺寸超浏览器画布上限时抛错且不创建画布', async () => {
    const rec = installFakeCanvas()
    await expect(
      composeCropToBlob({
        image: fakeImage(),
        // 80000% × 800 = 640000 像素宽 → 超过单边上限
        crop: { xPct: 0, yPct: 0, wPct: 80000, hPct: 100 },
        format: 'png',
      }),
    ).rejects.toThrow(/单边最大/)
    expect(rec.canvas).toBeNull()
  })

  it('无法读取源图尺寸时抛错', async () => {
    installFakeCanvas()
    await expect(
      composeCropToBlob({ image: fakeImage(0, 0), crop: IMAGE_CROP_RECT_DEFAULT, format: 'png' }),
    ).rejects.toThrow('无法读取源图尺寸')
  })

  it('toBlob 返回 null（编码失败）时抛错', async () => {
    installFakeCanvas(null)
    await expect(
      composeCropToBlob({ image: fakeImage(), crop: IMAGE_CROP_RECT_DEFAULT, format: 'png' }),
    ).rejects.toThrow(/编码失败/)
  })

  it('缺少 2d 上下文时抛错并打日志（不静默）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const original = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, opts?: ElementCreationOptions) => {
      if (tag !== 'canvas') return original(tag, opts)
      const el = original('canvas') as HTMLCanvasElement
      Object.defineProperty(el, 'getContext', { value: () => null, configurable: true })
      return el
    })
    await expect(
      composeCropToBlob({ image: fakeImage(), crop: IMAGE_CROP_RECT_DEFAULT, format: 'png' }),
    ).rejects.toThrow(/无法创建画布上下文/)
    expect(spy).toHaveBeenCalled()
  })

  it('应用后释放画布尺寸（大图内存回收）', async () => {
    const rec = installFakeCanvas()
    await composeCropToBlob({ image: fakeImage(), crop: IMAGE_CROP_RECT_DEFAULT, format: 'png' })
    expect(rec.canvas.width).toBe(0)
    expect(rec.canvas.height).toBe(0)
  })

  it('单边上限内的极端比例仍可合成（边界值不误报）', async () => {
    const rec = installFakeCanvas()
    const img = fakeImage(IMAGE_CROP_MAX_SIDE, 1)
    await composeCropToBlob({ image: img, crop: IMAGE_CROP_RECT_DEFAULT, format: 'png' })
    expect(rec.widthAtEncode).toBe(IMAGE_CROP_MAX_SIDE)
  })
})

describe('composeResultToFile（产物文件名与 MIME）', () => {
  it('PNG 结果 → output.png', () => {
    const file = composeResultToFile({ blob: new Blob(['x'], { type: 'image/png' }), width: 10, height: 10, mime: 'image/png' })
    expect(file.name).toBe('output.png')
    expect(file.type).toBe('image/png')
  })

  it('JPG 结果 → output.jpg', () => {
    const file = composeResultToFile({
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      width: 10,
      height: 10,
      mime: 'image/jpeg',
    })
    expect(file.name).toBe('output.jpg')
    expect(file.type).toBe('image/jpeg')
  })
})

describe('loadImageElement（源图加载）', () => {
  it('加载成功返回图像元素', async () => {
    class FakeImage {
      /** 同源标记（生产代码会显式设置） */
      crossOrigin = ''
      /** 加载成功回调 */
      onload: (() => void) | null = null
      /** 加载失败回调 */
      onerror: (() => void) | null = null
      /** 设置 src 时立即触发 onload（模拟已缓存图片） */
      set src(_v: string) {
        this.onload?.()
      }
    }
    vi.stubGlobal('Image', FakeImage)
    const img = await loadImageElement('/api/fs/demo/assert/a.png')
    expect(img).toBeInstanceOf(FakeImage)
  })

  it('加载失败抛中文错误', async () => {
    class FakeImage {
      /** 同源标记 */
      crossOrigin = ''
      /** 加载成功回调 */
      onload: (() => void) | null = null
      /** 加载失败回调 */
      onerror: (() => void) | null = null
      /** 设置 src 时立即触发 onerror */
      set src(_v: string) {
        this.onerror?.()
      }
    }
    vi.stubGlobal('Image', FakeImage)
    await expect(loadImageElement('/bad.png')).rejects.toThrow(/无法加载源图/)
  })
})
