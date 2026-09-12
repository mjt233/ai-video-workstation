/**
 * 「图片修剪与扩展」节点核心：把源图按选区裁剪/扩展合成为新图像并编码为 Blob。
 *
 * **纯前端实现**（不依赖外部图像库）：主线程 Canvas 2D —— 先铺背景色，
 * 再用 `drawImage` 把源图的可见部分画到（可能为负的）偏移位置：
 * ```
 * ctx.fillStyle = 背景色            // '#RRGGBBAA'，Canvas 原生支持
 * ctx.fillRect(0, 0, outW, outH)
 * ctx.drawImage(img, sx, sy, sw, sh, padX, padY, sw, sh)   // sx/sy/padX/padY 均可为负
 * canvas.toBlob(cb, 'image/png' | 'image/jpeg', 质量)
 * ```
 * 优点：零依赖、负坐标裁剪天然支持、透明度原生支持；
 * 代价：同步阻塞主线程，且超限时浏览器会**静默画出空白**——故合成前统一经
 * `validateOutputSize` 拦截（见 canvas/imageCrop.ts）。
 */

import {
  effectiveBackgroundColor,
  IMAGE_CROP_FORMAT_DEFAULT,
  isImageCropFormat,
  resolveCropGeometry,
  validateOutputSize,
  type ImageCropRect,
} from './imageCrop'

/** JPG 编码质量（0~1；PNG 忽略该参数） */
export const IMAGE_CROP_JPEG_QUALITY = 0.92

/** 合成参数 */
export interface ComposeCropOptions {
  /** 已加载完成的源图（`naturalWidth/naturalHeight` 必须可用） */
  image: HTMLImageElement
  /** 归一化选区（百分比；可越界表示向外扩展） */
  crop: ImageCropRect
  /** 背景色（`#RRGGBB` / `#RRGGBBAA`；缺省不透明白） */
  background?: string
  /** 输出格式（png / jpg；缺省 png） */
  format?: string
}

/** 合成结果（Blob + 实际输出尺寸，供上传与界面回显） */
export interface ComposeCropResult {
  /** 编码后的图像数据 */
  blob: Blob
  /** 实际输出宽度（像素） */
  width: number
  /** 实际输出高度（像素） */
  height: number
  /** 实际使用的 MIME（image/png / image/jpeg） */
  mime: string
}

/**
 * 创建并加载图像元素（合成前置步骤；需要在 DOM 中挂载即可解码的浏览器亦可正常工作）。
 *
 * 统一走同源预览 URL（`/fs/...`），因此画布不会被跨域污染；
 * 仍显式设置 `crossOrigin='anonymous'` 以规避反向代理等场景下的 taint 风险。
 *
 * @param url 图像 URL（同源预览地址）
 * @returns 加载完成的图像元素
 * @throws Error 加载失败（网络错误 / 404 / 解码失败）
 */
export function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('无法加载源图（可能文件缺失或预览不可用）'))
    img.src = url
  })
}

/**
 * 按选区把源图合成为新图像并编码为 Blob。
 *
 * 关键点：
 * - 输出尺寸 = 选区尺寸（像素取整），扩展区域铺背景色；
 * - JPG 输出时透明背景自动回落不透明白（JPEG 无 alpha 通道）；
 * - 超限尺寸、Canvas 上下文不可用、编码失败一律**抛错**（不静默产出坏图）。
 *
 * @param options 合成参数（源图元素 / 选区 / 背景色 / 输出格式）
 * @returns 编码结果（Blob + 输出尺寸 + MIME）
 * @throws Error 尺寸超限、Canvas 上下文不可用或编码失败
 */
export function composeCropToBlob(options: ComposeCropOptions): Promise<ComposeCropResult> {
  const { image } = options
  const srcW = image.naturalWidth || image.width
  const srcH = image.naturalHeight || image.height
  if (!(srcW > 0) || !(srcH > 0)) {
    return Promise.reject(new Error('无法读取源图尺寸'))
  }
  const geometry = resolveCropGeometry(options.crop, srcW, srcH)
  const sizeError = validateOutputSize(geometry.outW, geometry.outH)
  if (sizeError) return Promise.reject(new Error(sizeError))

  const format = isImageCropFormat(options.format) ? options.format : IMAGE_CROP_FORMAT_DEFAULT
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png'
  const backgroundColor = effectiveBackgroundColor({ background: options.background, format })

  const canvas = document.createElement('canvas')
  canvas.width = geometry.outW
  canvas.height = geometry.outH
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    const msg = `无法创建画布上下文（输出 ${geometry.outW} × ${geometry.outH}），请缩小选区后重试`
    console.error(`[image-crop] ${msg}`)
    return Promise.reject(new Error(msg))
  }
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, geometry.outW, geometry.outH)
  if (geometry.sw > 0 && geometry.sh > 0) {
    ctx.drawImage(image, geometry.sx, geometry.sy, geometry.sw, geometry.sh, geometry.padX, geometry.padY, geometry.sw, geometry.sh)
  }

  return new Promise<ComposeCropResult>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // 及时释放画布占用（大图下内存回收更积极）
        canvas.width = 0
        canvas.height = 0
        if (!blob) {
          const msg = '图像编码失败，请重试或改用其它输出格式'
          console.error(`[image-crop] ${msg}（${mime} ${geometry.outW}×${geometry.outH}）`)
          reject(new Error(msg))
          return
        }
        resolve({ blob, width: geometry.outW, height: geometry.outH, mime })
      },
      mime,
      format === 'jpg' ? IMAGE_CROP_JPEG_QUALITY : undefined,
    )
  })
}

/**
 * 把编码结果包装为上传用的 File（文件名含节点产物扩展名，便于服务端按扩展名/ MIME 校验）。
 *
 * @param result 合成结果
 * @returns 待上传文件
 */
export function composeResultToFile(result: ComposeCropResult): File {
  const ext = result.mime === 'image/jpeg' ? 'jpg' : 'png'
  return new File([result.blob], `output.${ext}`, { type: result.mime })
}
