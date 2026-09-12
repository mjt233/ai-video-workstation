<template>
  <div
    ref="rootRef"
    class="image-crop-stage"
    :style="{ ...stageStyle, aspectRatio: String(aspect) }"
  >
    <!-- 源图：按「扩展可视区」缩放居中；选区外的区域露出舞台底色（= 扩展后的背景色） -->
    <img
      v-if="imageUrl"
      :src="imageUrl"
      alt=""
      class="image-crop-stage__img"
      :style="{ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }"
      @load="onImageLoad"
    >
    <div
      v-else
      class="image-crop-stage__empty text-body-small"
    >
      未连接图片输入
    </div>

    <!-- 选区框（纯展示）：超出原图的部分即为扩展区域，背景色即舞台底色 -->
    <div
      v-if="imageUrl"
      class="image-crop-stage__box"
      :style="boxStyle"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 「图片修剪与扩展」节点的选区合成视图（**纯展示**，编辑器与只读场景共用）。
 *
 * 语义：**选区即画布** —— 舞台底色 = 扩展区域的背景色，选区框内就是最终输出画布：
 *  - 选区小于原图 → 框外部分被裁掉（不会出现在产物里）；
 *  - 选区超出原图 → 框内原图之外的地方填舞台底色（即扩展的空白内容）。
 *
 * 布局：以「扩展可视区」为舞台（源图居中、四周留出可向外拖拽的空间）。**舞台自身的实测尺寸
 * 是唯一尺寸来源**（ResizeObserver 测量 + `rect` 事件上报）：源图、选区框与编辑器叠加的
 * 手柄/位移层全部由同一份 `stageRect` 推导，避免「按 CSS 宽高比推算出的一份尺寸」与
 * 「容器实测的另一份尺寸」不一致（曾出现：某次渲染读到未稳定的高度，导致选区框与源图错位）。
 *
 * **源图显示宽取「舞台宽 × k」（k = 1 / IMAGE_CROP_STAGE_MARGIN_FACTOR），显示高 = 显示宽 ÷ 源图宽高比**
 * —— 源图不会被拉伸。舞台是源图的**两轴等比放大**（舞台 = 源图显示尺寸 × 系数），因此使用方
 * 必须把容器宽高比设为**源图宽高比本身**（`aspect = srcAspect`，不要乘系数）：横向与纵向留白
 * 就都等于「源图显示尺寸 × IMAGE_CROP_STAGE_MARGIN_RATIO」（留白即向外扩展的操作空间）。
 *
 * 组件自身不处理任何指针事件（无手柄、无拖拽），手柄与拖拽由配置组件按 `rect` 事件叠加实现。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { IMAGE_CROP_STAGE_MARGIN_FACTOR } from '../../canvas/imageCrop'

/** 舞台内源图区域的像素矩形（编辑器据此叠加手柄，与源图渲染完全同源） */
export interface ImageCropStageRect {
  /** 舞台宽度（像素） */
  stageWidth: number
  /** 舞台高度（像素） */
  stageHeight: number
  /** 源图左边界（像素，相对舞台） */
  left: number
  /** 源图上边界（像素，相对舞台） */
  top: number
  /** 源图宽度（像素） */
  width: number
  /** 源图高度（像素） */
  height: number
}

const props = defineProps<{
  /** 源图预览 URL（同源预览地址；为空时显示占位） */
  imageUrl: string
  /** 源图自然宽度（像素；未知时传 0，仅影响提示不影响布局） */
  imageWidth: number
  /** 源图自然高度（像素；未知时传 0） */
  imageHeight: number
  /** 选区（归一化到原图的百分比；可越界表示向外扩展） */
  crop: { xPct: number; yPct: number; wPct: number; hPct: number }
  /** 扩展区域背景色（`#RRGGBB` / `#RRGGBBAA`；alpha=0 即透明） */
  background: string
  /** 舞台宽高比（宽 ÷ 高；使用方须传**源图宽高比本身**——舞台是源图的两轴等比放大，
   *  乘留白系数会让舞台与源图不同比、纵向留白被吃成 0；缺省 4/3 仅用于源图尺寸未知的首帧） */
  aspect?: number
  /** 源图宽高比（宽 ÷ 高；0/未传时回落到按舞台比例均分，仅用于首帧占位） */
  srcAspect?: number
  /** 是否显示三分构图辅助线（编辑器开启、节点主体关闭） */
  guides?: boolean
}>()

const emit = defineEmits<{
  /** 源图加载完成（使用方据此取得 naturalWidth/naturalHeight 计算输出像素尺寸） */
  (e: 'image-load', size: { width: number; height: number }): void
  /** 舞台与源图区域尺寸变化（含首次挂载/容器缩放；编辑器据此同步手柄层） */
  (e: 'rect', rect: ImageCropStageRect): void
}>()

/** 源图显示尺寸相对舞台尺寸的比例（舞台 = 源图 × `IMAGE_CROP_STAGE_MARGIN_FACTOR`） */
const k = 1 / IMAGE_CROP_STAGE_MARGIN_FACTOR

/** 舞台根元素（尺寸测量基准） */
const rootRef = ref<HTMLElement | null>(null)

/** 舞台实测尺寸（0 = 尚未测量；ResizeObserver 保证稳定后必定回填） */
const stageSize = ref({ width: 0, height: 0 })

/** 舞台宽高比（未传入或非法时按 4:3）——仅用于设置 CSS `aspect-ratio`，几何以实测尺寸为准 */
const aspect = computed(() => (props.aspect && props.aspect > 0 ? props.aspect : 4 / 3))

/**
 * 源图在舞台中的基准尺寸（比例值）。
 *
 * **源图显示比例恒等于原图比例**：宽度取「舞台宽 × k」，高度由宽度推导（显示宽 ÷ 源图宽高比）
 * 而**不是**「舞台高 × k」——后者只有在「舞台宽高比 = 源图宽高比」时才等价，一旦使用方传错
 * `aspect` 就会把图拉伸（曾因此把 3:2 的图渲染成 2.85:1）。按宽度推导等于把「不拉伸」写成
 * 硬保证：使用方传对 `aspect`（= 源图宽高比）时两式完全一致（舞台与源图同比 ⇒ 两轴留白相等），
 * 传错时也只是上下留白不等，图仍不变形。
 */
const base = computed(() => {
  const src = props.srcAspect && props.srcAspect > 0 ? props.srcAspect : aspect.value
  const { width: sw, height: sh } = stageSize.value
  const wPx = k * sw
  const hPx = wPx / src
  return {
    h: sh > 0 ? hPx / sh : k / src,
    w: k,
  }
})

/** 源图区域矩形（舞台实测尺寸 × 基准比例；测量前为 0） */
const rect = computed<ImageCropStageRect>(() => {
  const { width: sw, height: sh } = stageSize.value
  const b = base.value
  return {
    stageWidth: sw,
    stageHeight: sh,
    left: ((1 - b.w) / 2) * sw,
    top: ((1 - b.h) / 2) * sh,
    width: b.w * sw,
    height: b.h * sh,
  }
})

/** 选区框样式（像素定位，与手柄层同一套坐标） */
const boxStyle = computed(() => {
  const r = rect.value
  const c = props.crop
  return {
    left: `${r.left + (c.xPct / 100) * r.width}px`,
    top: `${r.top + (c.yPct / 100) * r.height}px`,
    width: `${(c.wPct / 100) * r.width}px`,
    height: `${(c.hPct / 100) * r.height}px`,
    // 三分构图辅助线（编辑器显示）
    backgroundImage: props.guides
      ? 'linear-gradient(to right, rgba(255,255,255,0.45) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.45) 1px, transparent 1px)'
      : 'none',
    backgroundSize: props.guides ? '33.333% 33.333%' : 'auto',
  }
})

/** 舞台底色：扩展区域即背景色；半透明时叠棋盘格以体现透明度 */
const stageStyle = computed(() => {
  const bg = props.background || '#FFFFFFFF'
  return {
    background: `linear-gradient(${bg}, ${bg}), repeating-conic-gradient(#d8d8d8 0% 25%, #f4f4f4 0% 50%) 50% / 12px 12px`,
  }
})

/** 已上报过的矩形签名（避免每次观测都触发父级事件，保持渲染稳定） */
let lastEmitted = ''

/** 尺寸观察器（舞台尺寸随面板宽度/贴靠方向变化） */
let observer: ResizeObserver | null = null

/**
 * 读取舞台实测尺寸并上报（尺寸未变化时不重复上报）。
 */
function measure() {
  const el = rootRef.value
  if (!el) return
  const width = el.clientWidth
  const height = el.clientHeight
  stageSize.value = { width, height }
  const r = rect.value
  const signature = [r.stageWidth, r.stageHeight, r.left, r.top, r.width, r.height].map((n) => n.toFixed(2)).join(',')
  if (signature === lastEmitted) return
  lastEmitted = signature
  emit('rect', { ...r })
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && rootRef.value) {
    observer = new ResizeObserver(() => measure())
    observer.observe(rootRef.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

// 源图/比例变化会改变合成（比例影响基准尺寸），重新测量并上报
watch([() => props.aspect, () => props.imageUrl], () => measure())

/**
 * 源图加载完成：把自然尺寸上报给使用方（用于像素尺寸读数与合成）。
 *
 * @param e 图片 load 事件
 */
function onImageLoad(e: Event) {
  const el = e.target as HTMLImageElement
  if (!el.naturalWidth || !el.naturalHeight) return
  emit('image-load', { width: el.naturalWidth, height: el.naturalHeight })
}
</script>

<style scoped>
.image-crop-stage {
  position: relative;
  width: 100%;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.12);
  box-sizing: border-box;
}

.image-crop-stage__img {
  position: absolute;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

.image-crop-stage__empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.6);
}

.image-crop-stage__box {
  position: absolute;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.9), 0 0 0 2px rgba(0, 0, 0, 0.65);
  pointer-events: none;
}
</style>
