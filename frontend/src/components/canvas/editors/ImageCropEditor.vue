<template>
  <div class="image-crop-editor">
    <!-- 无图片输入：占位提示 -->
    <div
      v-if="!input"
      class="image-crop-editor__empty"
    >
      <v-icon
        icon="mdi-image-off-outline"
        size="small"
        class="mr-1"
      />
      <span class="text-body-small text-medium-emphasis">请连接图片输入</span>
    </div>

    <template v-else>
      <!-- ── 框选器：四角 + 四边可拖拽缩放，框内可整体拖动；选区即最终输出画布 ──
           外层只负责「相对可视区固定」的缩放工具条；滚动容器是**固定高度的编辑区视口**
           （高度在 1 倍时贴合整块舞台后冻结），滚轮缩放只改视口内的内容尺寸，
           编辑区与整个配置面板的尺寸都不随之变化 -->
      <div class="image-crop-editor__stagewrap">
        <div
          ref="viewportRef"
          class="image-crop-editor__viewport nodrag nowheel"
          :style="viewportStyle"
          @wheel.prevent="onWheel"
        >
          <div
            class="image-crop-editor__stage"
            :style="stageStyle"
            title="双击恢复整幅选区"
            @dblclick="onResetRect"
          >
            <ImageCropStage
              :image-url="imageUrl"
              :image-width="srcW"
              :image-height="srcH"
              :crop="previewRect"
              :background="background"
              :aspect="stageAspect"
              :src-aspect="srcAspect"
              guides
              @image-load="onImageLoad"
              @rect="onStageRect"
            />

            <!-- 选区手柄层（覆盖在舞台上，按可视区百分比定位，与 ImageCropStage 同一套几何） -->
            <div
              v-if="srcW > 0 && srcH > 0"
              class="image-crop-editor__overlay"
            >
              <div
                v-for="h in HANDLES"
                :key="h.id"
                class="image-crop-editor__handle"
                :class="[`image-crop-editor__handle--${h.id}`, { 'image-crop-editor__handle--active': draggingHandle === h.id }]"
                :style="handleStyle(h.id)"
                :title="h.id.length === 2 ? '按住 Shift 拖拽可锁定当前比例等比缩放' : undefined"
                @pointerdown.stop="onHandlePointerDown(h.id, $event)"
              />
              <div
                class="image-crop-editor__move"
                :style="boxStyle"
                title="拖拽移动选区；向内裁剪、向外扩展（扩展区域填背景色）"
                @pointerdown.stop="onHandlePointerDown('move', $event)"
              />
              <!-- 实时输出像素尺寸浮标（拖拽时跟随选区右下角） -->
              <div
                class="image-crop-editor__badge"
                :style="badgeStyle"
              >
                {{ outW }} × {{ outH }}
              </div>
            </div>
          </div>
        </div>

        <!-- 显示缩放工具条（悬浮在舞台右上角；滚轮缩放的等价入口与当前比例读数） -->
        <div class="image-crop-editor__zoombar">
          <v-btn
            icon="mdi-magnify-minus-outline"
            size="x-small"
            variant="text"
            class="image-crop-editor__zoombtn"
            title="缩小显示比例"
            :disabled="zoom <= IMAGE_CROP_ZOOM_MIN"
            @click="zoomBy(-1)"
          />
          <span
            class="image-crop-editor__zoomval"
            title="显示缩放（只影响面板内的显示，不影响输出像素）；鼠标在框选区内滚轮即可缩放"
          >
            {{ zoomPercent }}%
          </span>
          <v-btn
            icon="mdi-magnify-plus-outline"
            size="x-small"
            variant="text"
            class="image-crop-editor__zoombtn"
            title="放大显示比例"
            :disabled="zoom >= IMAGE_CROP_ZOOM_MAX"
            @click="zoomBy(1)"
          />
          <v-btn
            icon="mdi-restore"
            size="x-small"
            variant="text"
            class="image-crop-editor__zoombtn"
            title="恢复默认缩放（整块框选区适配面板宽度）"
            :disabled="zoom <= IMAGE_CROP_ZOOM_MIN"
            @click="resetZoom"
          />
        </div>
      </div>

      <!-- ── 实时像素尺寸读数（拖拽中每帧更新） ── -->
      <div class="image-crop-editor__readout text-body-small">
        <span>源图 {{ srcW || '—' }} × {{ srcH || '—' }} px</span>
        <span class="image-crop-editor__arrow">→</span>
        <span class="image-crop-editor__out">输出 {{ outW }} × {{ outH }} px</span>
        <span
          v-if="extendHint"
          class="image-crop-editor__extend"
        >
          {{ extendHint }}
        </span>
      </div>

      <!-- ── 输出设置 + 执行 ── -->
      <div class="image-crop-editor__row image-crop-editor__row--params">
        <!-- 背景色：只有一个色块，点击打开调色盘（含 alpha 滑杆，即透明度）。
             调色盘用 `activator` **选择器** 绑到色块上，而不是用 `#activator` 插槽：
             插槽内容由 VMenu 渲染，父组件重渲染时因插槽标记为 stable 不会重新执行，
             色块的 style/title 会停在旧值（实测：改背景色后调色盘已生效、色块仍是旧色）。
             作为选择器挂在自家模板里的普通元素则由本组件正常打补丁。 -->
        <button
          :id="swatchId"
          type="button"
          class="image-crop-editor__swatch"
          :style="swatchStyle"
          :title="`背景色 ${background}（点击打开调色盘）`"
        />
        <v-menu
          :activator="`#${swatchId}`"
          :close-on-content-click="false"
          location="bottom start"
        >
          <div class="image-crop-editor__picker">
            <v-color-picker
              :model-value="background"
              mode="rgba"
              hide-inputs
              @update:model-value="onPickerColor"
            />
            <div class="image-crop-editor__picker-row">
              <button
                v-for="c in IMAGE_CROP_BACKGROUND_PRESETS"
                :key="c"
                type="button"
                class="image-crop-editor__preset"
                :style="{ background: c }"
                :title="c"
                @click="setBaseColor(c)"
              />
            </div>
          </div>
        </v-menu>
        <span class="image-crop-editor__field-label text-body-small">背景色</span>

        <v-btn-toggle
          :model-value="format"
          density="comfortable"
          variant="outlined"
          divided
          mandatory
          class="image-crop-editor__format"
          @update:model-value="onFormatChange"
        >
          <v-btn
            v-for="opt in IMAGE_CROP_FORMAT_OPTIONS"
            :key="opt.value"
            :value="opt.value"
            size="small"
          >
            {{ opt.label }}
          </v-btn>
        </v-btn-toggle>

        <v-btn
          size="small"
          variant="text"
          :disabled="busy || uploading"
          @click="onResetRect"
        >
          重置选区
        </v-btn>
        <v-btn
          v-if="!isBlueprint"
          color="primary"
          size="small"
          :loading="busy || uploading"
          :disabled="!canApply"
          @click="onApply"
        >
          {{ hasOutput ? '重新应用' : '应用' }}
        </v-btn>
      </div>

      <!-- 提示 / 错误 -->
      <div
        v-if="jpegTransparentHint"
        class="text-body-small text-error mt-1"
      >
        {{ jpegTransparentHint }}
      </div>
      <div
        v-if="sizeError"
        class="text-body-small text-error mt-1"
      >
        {{ sizeError }}
      </div>
      <div
        v-if="encodeError"
        class="text-body-small text-error mt-1"
      >
        {{ encodeError }}
      </div>
      <div
        v-else-if="!sizeError"
        class="text-body-small text-disabled mt-1"
      >
        拖拽四角/四边缩放选区，向内拖 = 裁剪，向外拖 = 扩展（扩展区域填背景色）；
        按住 <b>Shift</b> 拖拽四角 = 锁定当前比例等比缩放；框选区内<b>滚轮</b>缩放显示比例；
        双击选区恢复整幅
      </div>

      <!-- ── 当前结果 ── -->
      <div
        v-if="currentUrl"
        class="mt-3"
      >
        <div class="text-body-small text-medium-emphasis mb-1">
          当前结果
        </div>
        <img
          :src="currentUrl"
          alt=""
          class="image-crop-editor__result"
        >
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 「图片修剪与扩展」节点配置组件。
 *
 * **图像局部框选器**：可拖拽四角、四边缩放选区，也可拖动选区整体位移；
 * 选区即最终输出画布 —— 向内拖裁掉外围，向外拖把画布撑大并用背景色填充空白。
 *
 * 交互与执行要点：
 * - 拖动期间只更新本地预览（每帧实时刷新像素尺寸读数），**松手才写一次 config**
 *   （单次撤销，不污染撤销栈）；
 * - **输出尺寸只由选区决定**：面板不提供宽高输入框，尺寸以「源图 → 输出」读数与选区
 *   右下角浮标实时展示（少一组可双向同步的输入框即少一处口径分叉）；
 * - **背景色只有一个色块**：点击打开 `v-color-picker`（`mode="rgba"` ⇒ 饱和度面板 +
 *   色相滑杆 + **alpha 滑杆**，透明度也在这里调），不再单列十六进制/透明度输入框；
 * - 舞台四周按 `IMAGE_CROP_STAGE_MARGIN_RATIO`（= 1，每边留出与源图等大的空白）尽可能
 *   预留扩展空间，因此默认缩放下源图偏小 —— 用**滚轮缩放显示比例**补偿（`nextCropZoom`
 *   + `anchoredZoomScroll`，缩放以指针为锚点；缩放只影响显示，不写入 config）；
 * - 「应用」在主线程 Canvas 上合成（`canvas/imageCompose.ts`）并编码为 Blob，
 *   再走父级统一上传（`useCanvasUpload`：进度遮罩 / 失败重试 / 中止全部复用），
 *   落盘到节点固定产物路径 `output.{png|jpg}`（纯前端生成，不产生异步任务）；
 * - 尺寸读数、选区框、节点主体预览共用 `canvas/imageCrop.ts` 的同一份几何口径，
 *   保证「面板里看到的数字」与「实际产出像素」永远一致。
 */
import { computed, nextTick, ref, watch } from 'vue'
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import type { CanvasUploadFilePayload } from '../composables/useCanvasUpload'
import { buildPreviewUrl } from '../../../canvas/preview'
import { useCanvasMode } from '../../../canvas/canvasMode'
import ImageCropStage from '../ImageCropStage.vue'
import {
  anchoredZoomScroll,
  colorAlpha,
  colorWithAlpha,
  cropFormatOf,
  cropRectOf,
  cropRectToPixels,
  effectiveBackgroundColor,
  IMAGE_CROP_BACKGROUND_PRESETS,
  IMAGE_CROP_FORMAT_OPTIONS,
  IMAGE_CROP_RECT_DEFAULT,
  IMAGE_CROP_ZOOM_MAX,
  IMAGE_CROP_ZOOM_MIN,
  isImageCropFormat,
  nextCropZoom,
  normalizeHexColor,
  normalizeWheelDelta,
  parseHexColor,
  pixelsToCropRect,
  resolveCropGeometry,
  resizeCropRect,
  moveCropRect,
  validateOutputSize,
  zoomByWheelDelta,
  type ImageCropFormat,
  type ImageCropHandle,
  type ImageCropPixels,
  type ImageCropRect,
} from '../../../canvas/imageCrop'
import { composeCropToBlob, composeResultToFile, loadImageElement } from '../../../canvas/imageCompose'

const props = defineProps<{
  /** 项目名（资产预览 URL 与上传用） */
  project: string
  /** 当前节点数据（config 为持久化配置） */
  node: CanvasNodeData
  /** 全部输入（构建源图预览 URL 用） */
  inputs: CanvasInputInfo[]
  /** 节点是否正在执行（本节点走上传状态，此 prop 保留给统一接口） */
  isRunning: boolean
  /** 画布类型（父级统一传入，本组件暂不使用） */
  kind: CanvasKind
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发） */
  output?: { path: string; token?: number } | null
  /** 节点固定产物路径（即使文件不存在也有值；上传目标） */
  outputPath?: string
  /** 是否正在上传产物（父级按 upload-state 下发：按钮 loading + 禁用） */
  uploading?: boolean
}>()

const emit = defineEmits<{
  /** 配置补丁（选区 / 背景色 / 输出格式） */
  (e: 'update:config', patch: Record<string, unknown>): void
  /** 上传合成后的产物文件（父级经 useCanvasUpload 落盘到节点固定产物路径，成功后刷新节点产物展示） */
  (e: 'upload-file', payload: CanvasUploadFilePayload): void
  /** 统一接口占位（本节点无中断语义，父级统一监听） */
  (e: 'generate', nodeId: string): void
  (e: 'open-history', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'set-as-scene', nodeId: string): void
  (e: 'open-picker', nodeId: string): void
  (e: 'extract', nodeId: string): void
  (e: 'set-as-video', nodeId: string): void
}>()

/** 棋盘格底图（透明底色可视化；与背景色叠成两层 `background-image`） */
const CHECKERBOARD_IMAGE = 'repeating-conic-gradient(#d8d8d8 0% 25%, #f4f4f4 0% 50%)'
/** 棋盘格单元尺寸（`background-size` 的第二层） */
const CHECKERBOARD_SIZE = '8px 8px'
/** 背景色块元素 id（调色盘以选择器方式绑到它上面；按节点 id 派生保证唯一且稳定） */
const swatchId = computed(() => `image-crop-swatch-${props.node.id}`)

/** 画布模式（蓝图模式下隐藏执行入口：蓝图不产生产物） */
const canvasMode = useCanvasMode()
/** 是否蓝图模式 */
const isBlueprint = computed(() => canvasMode.mode === 'blueprint')

/** 八个缩放手柄（四角 + 四边） */
const HANDLES: ReadonlyArray<{ id: Exclude<ImageCropHandle, 'move'> }> = [
  { id: 'nw' },
  { id: 'n' },
  { id: 'ne' },
  { id: 'e' },
  { id: 'se' },
  { id: 's' },
  { id: 'sw' },
  { id: 'w' },
]

/** 输入图片（本节点为单一 image 输入口，取第一个有资产的输入） */
const input = computed<CanvasInputInfo | null>(() => props.inputs[0] ?? null)

/** 源图预览 URL（按 path + mtime 缓存：改配置触发的重渲染不会重载图片） */
const imageUrl = computed(() =>
  input.value ? buildPreviewUrl(props.project, input.value.path, input.value.version) : '',
)

/** 源图自然宽度（像素；0 = 未知） */
const srcW = ref(0)
/** 源图自然高度（像素；0 = 未知） */
const srcH = ref(0)

/** 显示缩放（1 = 整块「源图 + 留白」适配面板宽度） */
const zoom = ref(IMAGE_CROP_ZOOM_MIN)

/** 缩放百分比（整数展示） */
const zoomPercent = computed(() => Math.round(zoom.value * 100))

/** 切换输入源图时重置尺寸与显示缩放（等待新图 load 事件回填尺寸） */
watch(
  () => input.value?.path ?? '',
  () => {
    srcW.value = 0
    srcH.value = 0
    resetZoom()
  },
)

/** 选区（已持久化配置；净化读取） */
const crop = computed<ImageCropRect>(() => cropRectOf(props.node.config))

/** 拖动中的临时选区（像素）；非拖动时为 null */
const dragPixels = ref<ImageCropPixels | null>(null)

/** 框选器展示用的选区（拖动中优先用临时值） */
const previewRect = computed<ImageCropRect>(() => {
  const px = dragPixels.value
  if (!px) return crop.value
  if (!(srcW.value > 0) || !(srcH.value > 0)) return crop.value
  return pixelsToCropRect(px, srcW.value, srcH.value)
})

/** 当前几何（合并选区 + 源图尺寸；源图尺寸未知时按 0 处理） */
const geometry = computed(() =>
  resolveCropGeometry(previewRect.value, srcW.value > 0 ? srcW.value : 0, srcH.value > 0 ? srcH.value : 0),
)

/** 输出宽度（像素；源图未加载时为 0，界面显示 —） */
const outW = computed(() => (srcW.value > 0 && srcH.value > 0 ? geometry.value.outW : 0))
/** 输出高度（像素） */
const outH = computed(() => (srcW.value > 0 && srcH.value > 0 ? geometry.value.outH : 0))

/** 尺寸是否可用于换算（源图尺寸未知时禁用拖拽与合成，避免在错误基础上换算） */
const sizeEditable = computed(() => srcW.value > 0 && srcH.value > 0)

/** 扩展提示（选区超出原图时说明扩展了多少边距） */
const extendHint = computed(() => {
  if (!sizeEditable.value) return ''
  const px = cropRectToPixels(previewRect.value, srcW.value, srcH.value)
  const parts: string[] = []
  if (px.x < 0) parts.push(`左 ${-px.x}`)
  if (px.y < 0) parts.push(`上 ${-px.y}`)
  const right = px.x + px.width - srcW.value
  const bottom = px.y + px.height - srcH.value
  if (right > 0) parts.push(`右 ${right}`)
  if (bottom > 0) parts.push(`下 ${bottom}`)
  return parts.length > 0 ? `（扩展 ${parts.join(' / ')} px）` : ''
})

/** 背景色（规范化后的 #RRGGBBAA） */
const background = computed(() => normalizeHexColor(props.node.config.background))

/** 透明度（0~100 整数百分比；仅用于 JPG 提示，调整入口在调色盘 alpha 滑杆） */
const alphaPercent = computed(() => Math.round(colorAlpha(background.value) * 100))

/**
 * 色块样式（半透明时叠棋盘格，直观体现「透明背景」）。
 *
 * **必须分开写 `backgroundImage` 与 `backgroundSize`**：`50% / 8px 8px` 这种
 * 「位置 / 尺寸」语法只在 `background` 简写里合法，塞进 `background-image` 会让整条声明
 * 失效（浏览器静默丢弃 → 色块永远是空白，曾因此看不出当前背景色）。
 */
const swatchStyle = computed(() => ({
  backgroundImage: `linear-gradient(${background.value}, ${background.value}), ${CHECKERBOARD_IMAGE}`,
  backgroundSize: `auto, ${CHECKERBOARD_SIZE}`,
}))

/** 输出格式 */
const format = computed<ImageCropFormat>(() => cropFormatOf(props.node.config))

/** JPG + 透明背景提示（JPEG 无 alpha 通道，透明会被强制不透明） */
const jpegTransparentHint = computed(() => {
  if (format.value !== 'jpg') return ''
  return alphaPercent.value < 100 ? 'JPG 不支持透明，透明区域将变为不透明（保留所选颜色的 RGB）' : ''
})

/** 输出尺寸超限提示（浏览器画布上限；超限时禁止应用） */
const sizeError = computed(() => {
  if (!sizeEditable.value) return ''
  return validateOutputSize(outW.value, outH.value)
})

/** 合成/编码阶段的本地忙碌标记 */
const busy = ref(false)
/** 合成/编码失败原因（上传失败由父级遮罩提示） */
const encodeError = ref('')
/** 是否已有产物（按钮文案） */
const hasOutput = computed(() => !!(props.output || props.node.config.current))

/** 是否可应用：有输入、尺寸合法、未在忙碌/上传中 */
const canApply = computed(
  () => !!input.value && sizeEditable.value && !sizeError.value && !busy.value && !props.uploading,
)

/** 当前结果预览 URL（固定产物路径 + token 防缓存；优先父级下发的 output） */
const currentUrl = ref('')

/** 已缓存的产物 path / token（同时监听两者，避免新产物命中旧缓存） */
let cachedOutPath = ''
let cachedOutToken: number | undefined

watch(
  [() => props.output?.path ?? '', () => props.output?.token],
  ([p, token]) => {
    if (!p) {
      cachedOutPath = ''
      cachedOutToken = undefined
      currentUrl.value = ''
      return
    }
    if (p === cachedOutPath && token === cachedOutToken) return
    cachedOutPath = p
    cachedOutToken = token ?? undefined
    currentUrl.value = buildPreviewUrl(props.project, p, token ?? undefined)
  },
  { immediate: true },
)

/** 源图宽高比（宽 ÷ 高；源图尺寸未知时回落 4:3，仅用于首帧占位）。
 *  **不得按面板版式钳制**：显示比例必须恒等于原图比例，钳制会把极窄/极宽的源图压扁或拉长。 */
const srcAspect = computed(() => (srcW.value > 0 && srcH.value > 0 ? srcW.value / srcH.value : 4 / 3))

/**
 * 舞台宽高比 = **源图宽高比本身**（不加留白系数）。
 *
 * 留白是「源图显示尺寸 × IMAGE_CROP_STAGE_MARGIN_RATIO」的**两轴等比放大**：
 * 舞台 = 源图 × `IMAGE_CROP_STAGE_MARGIN_FACTOR`，因此舞台与源图**同宽高比**。
 * 曾把舞台宽高比写成「源图宽高比 × 系数」，那样舞台比源图更扁/更高：源图显示高按
 * 「显示宽 ÷ 源图宽高比」推导后恰好等于舞台高，纵向留白被吃成 0（横向有留白、纵向一点没有，
 * 向上/向下根本拖不出去）。等比放大后横向纵向留白都等于源图显示尺寸。
 */
const stageAspect = computed(() => srcAspect.value)

/** 舞台可用宽度下限（面板被智能贴靠收窄时不至于变成一条窄缝） */
const STAGE_MIN_WIDTH = 300

/** 舞台容器样式：缩放倍率 → 相对滚动容器宽度的百分比宽度（高度由宽高比推导，整体等比缩放） */
const stageStyle = computed(() => ({
  width: `${zoom.value * 100}%`,
  minWidth: `${STAGE_MIN_WIDTH}px`,
  aspectRatio: String(stageAspect.value),
}))

/** 滚动容器（滚轮缩放后的滚动位置修正基准） */
const viewportRef = ref<HTMLElement | null>(null)

/**
 * 编辑区视口的固定高度来源：**与舞台同源的宽高比**（内联 `aspect-ratio` = 源图宽高比）。
 *
 * - 视口宽 = 面板内容宽（CSS `width: 100%`），高 = 宽 ÷ 源图宽高比 ⇒ **恰好容纳 1 倍下的整块舞台**
 *   （舞台在 1 倍时宽 = 视口内容宽、显示高 = 显示宽 ÷ 源图宽高比，两条口径完全同源）；
 * - 高度只依赖源图宽高比与视口宽度，**与缩放倍率无关**，所以滚轮缩放只改变视口内的内容尺寸，
 *   编辑区与整个配置面板的尺寸纹丝不动（此前让滚动容器跟着内容长高，缩放会把整个面板一起撑高，
 *   看起来像「整个配置面板在缩放」，下方读数/背景色/应用按钮全被推着跑）；
 * - 用 CSS 宽高比而不是「测量舞台宽度再回写高度」：后者会因小数取整差 1px 而多出一条纵向滚动条，
 *   滚动条又吃掉 15px 内容宽 → 舞台变窄 → 高度更小，卡在一个带滚动条的自洽状态里。
 */
const viewportStyle = computed<Record<string, string>>(() => ({ aspectRatio: String(srcAspect.value) }))

/** 舞台内源图区域的实测矩形（由 ImageCropStage 的 rect 事件下发，与源图渲染同源） */
const stageRect = ref<{ stageWidth: number; stageHeight: number; left: number; top: number; width: number; height: number }>({
  stageWidth: 0,
  stageHeight: 0,
  left: 0,
  top: 0,
  width: 0,
  height: 0,
})

/**
 * 舞台尺寸变化（含挂载与容器缩放）：记录实测矩形（手柄层与拖拽换算的唯一几何来源）。
 *
 * @param rect 舞台与源图区域矩形
 */
function onStageRect(rect: typeof stageRect.value): void {
  stageRect.value = rect
}

/**
 * 按钮缩放：以可视区左上角为锚点（按钮缩放没有「指针位置」语义，保持滚动量不变最直观）。
 *
 * @param direction 方向：> 0 放大一档，< 0 缩小一档
 */
function zoomBy(direction: number): void {
  zoom.value = nextCropZoom(zoom.value, direction)
}

/** 恢复默认缩放（1 倍 = 整块框选区适配面板宽度）并回到左上角 */
function resetZoom(): void {
  zoom.value = IMAGE_CROP_ZOOM_MIN
  const vp = viewportRef.value
  if (!vp) return
  vp.scrollLeft = 0
  vp.scrollTop = 0
}

/**
 * 滚轮缩放显示比例：**以指针为锚点**（缩放前后指针下的那一点内容保持不动）。
 *
 * 缩放量按滚轮位移取指数映射（`zoomByWheelDelta`，并把 `deltaMode` 归一化为像素）：
 * 触控板一次滑动会连发几十个小位移事件，按「每事件一档」会瞬间冲到底。
 * 滚动位置修正必须等 DOM 尺寸更新后再写入（`nextTick`）：缩放是通过改舞台宽度实现的，
 * 同一帧内读取 `scrollWidth` 拿到的还是旧尺寸，直接写 `scrollLeft` 会被浏览器按旧范围钳制。
 *
 * @param e 滚轮事件（模板上用 `@wheel.prevent` 阻止面板滚动与画布缩放）
 */
async function onWheel(e: WheelEvent): Promise<void> {
  const previous = zoom.value
  const next = zoomByWheelDelta(previous, normalizeWheelDelta(e.deltaY, e.deltaMode))
  if (next === previous) return
  const vp = viewportRef.value
  if (!vp) {
    zoom.value = next
    return
  }
  const rect = vp.getBoundingClientRect()
  const scroll = anchoredZoomScroll({
    scrollLeft: vp.scrollLeft,
    scrollTop: vp.scrollTop,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    ratio: next / previous,
  })
  zoom.value = next
  await nextTick()
  vp.scrollLeft = scroll.scrollLeft
  vp.scrollTop = scroll.scrollTop
}

/** 选区框在舞台上的内联样式（像素定位；与手柄层、ImageCropStage 的选区框同源） */
const boxStyle = computed(() => {
  const img = stageRect.value
  const px = cropRectToPixels(previewRect.value, srcW.value || 1, srcH.value || 1)
  return {
    left: `${img.left + (px.x / (srcW.value || 1)) * img.width}px`,
    top: `${img.top + (px.y / (srcH.value || 1)) * img.height}px`,
    width: `${(px.width / (srcW.value || 1)) * img.width}px`,
    height: `${(px.height / (srcH.value || 1)) * img.height}px`,
  }
})

/**
 * 手柄位置样式（像素定位在选区框的四角/四边）。
 *
 * @param id 手柄标识（nw/n/ne/e/se/s/sw/w）
 * @returns 内联样式
 */
function handleStyle(id: Exclude<ImageCropHandle, 'move'>) {
  const base = boxStyle.value
  const left = parseFloat(base.left)
  const top = parseFloat(base.top)
  const width = parseFloat(base.width)
  const height = parseFloat(base.height)
  const cx = left + width / 2
  const cy = top + height / 2
  const pos: Record<string, { x: number; y: number }> = {
    nw: { x: left, y: top },
    n: { x: cx, y: top },
    ne: { x: left + width, y: top },
    e: { x: left + width, y: cy },
    se: { x: left + width, y: top + height },
    s: { x: cx, y: top + height },
    sw: { x: left, y: top + height },
    w: { x: left, y: cy },
  }
  const p = pos[id]
  return { left: `${p.x}px`, top: `${p.y}px` }
}

/** 像素尺寸浮标位置（选区右下角内部，跟随拖拽） */
const badgeStyle = computed(() => {
  const base = boxStyle.value
  return {
    left: `${parseFloat(base.left) + parseFloat(base.width)}px`,
    top: `${parseFloat(base.top) + parseFloat(base.height)}px`,
  }
})

/** 当前拖拽状态（手柄 / 起点 / 起始选区） */
const drag = ref<{ handle: ImageCropHandle; startX: number; startY: number; start: ImageCropPixels } | null>(null)

/** 正在拖拽的手柄（手柄高亮反馈；null = 未拖拽） */
const draggingHandle = computed<ImageCropHandle | null>(() => drag.value?.handle ?? null)

/**
 * 开始拖拽（手柄或整体位移）。
 *
 * 等比缩放（按住 Shift 拖拽四角）以**拖拽起始时**的选区宽高比为基准，因此拖拽过程中
 * 比例不会随缩放漂移；Shift 按下/松开即时生效（在 move 中实时读取 `shiftKey`）。
 *
 * @param handle 手柄标识
 * @param e 指针按下事件
 */
function onHandlePointerDown(handle: ImageCropHandle, e: PointerEvent) {
  if (!sizeEditable.value || busy.value) return
  const px = cropRectToPixels(crop.value, srcW.value, srcH.value)
  drag.value = { handle, startX: e.clientX, startY: e.clientY, start: px }
  dragPixels.value = px
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
}

/**
 * 指针移动：按屏幕位移换算为原图像素位移并更新临时选区（不写 config）。
 *
 * 换算基准是**实测的源图显示矩形**（`stageRect`），因此显示缩放（滚轮）后依然精确：
 * 屏幕位移 ÷ 显示宽 × 源图像素宽 = 原图位移。
 *
 * @param e 指针移动事件
 */
function onPointerMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  const rect = stageRect.value
  if (!(rect.width > 0) || !(rect.height > 0)) return
  const dx = ((e.clientX - d.startX) / rect.width) * srcW.value
  const dy = ((e.clientY - d.startY) / rect.height) * srcH.value
  dragPixels.value =
    d.handle === 'move'
      ? moveCropRect(d.start, dx, dy)
      : resizeCropRect(d.start, d.handle, dx, dy, e.shiftKey ? d.start.width / d.start.height : undefined)
}

/**
 * 指针抬起：把最终选区一次性写回 config（单次撤销）并清理拖拽状态。
 */
function onPointerUp() {
  const px = dragPixels.value
  drag.value = null
  dragPixels.value = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  if (!px || !sizeEditable.value) return
  emit('update:config', { crop: pixelsToCropRect(px, srcW.value, srcH.value) })
}

/** 重置选区为原图整幅 */
function onResetRect() {
  emit('update:config', { crop: { ...IMAGE_CROP_RECT_DEFAULT } })
}

/**
 * 源图加载完成：记录自然尺寸（用于像素换算与读数）。
 *
 * @param size 自然尺寸
 */
function onImageLoad(size: { width: number; height: number }) {
  srcW.value = size.width
  srcH.value = size.height
}

/**
 * 调色盘选色：**颜色与透明度都取自调色盘**（`mode="rgba"` 时 alpha 滑杆在面板内），
 * 非法值直接忽略（不写回配置，避免把背景色静默重置为默认白）。
 *
 * @param v v-color-picker 回传的颜色（`#RRGGBB` 或 `#RRGGBBAA`）
 */
function onPickerColor(v: unknown) {
  if (!parseHexColor(v)) return
  emit('update:config', { background: normalizeHexColor(v) })
}

/**
 * 设置基色（保留当前透明度；调色盘下方的预设色块用）。
 *
 * @param hex 基色（#RGB / #RRGGBB）
 */
function setBaseColor(hex: string) {
  emit('update:config', { background: colorWithAlpha(hex, colorAlpha(background.value)) })
}

/**
 * 切换输出格式（切到 JPG 且背景透明时仅提示，不强行改用户所选颜色）。
 *
 * @param v 新格式
 */
function onFormatChange(v: unknown) {
  if (!isImageCropFormat(v)) return
  emit('update:config', { format: v })
}

/**
 * 应用：Canvas 合成 → 编码 → 交给父级上传到节点固定产物路径。
 *
 * 失败（尺寸超限 / 上下文不可用 / 编码失败 / 源图加载失败）一律写入 encodeError 展示，
 * 并 console.error 记录（不静默）；上传失败由父级上传遮罩与 snackbar 提示。
 */
async function onApply() {
  const src = input.value
  const target = props.outputPath
  if (!src || !target || !canApply.value) return
  busy.value = true
  encodeError.value = ''
  try {
    const el = await loadImageElement(imageUrl.value)
    const result = await composeCropToBlob({
      image: el,
      crop: crop.value,
      background: effectiveBackgroundColor(props.node.config),
      format: format.value,
    })
    emit('upload-file', { nodeId: props.node.id, file: composeResultToFile(result), dest: target })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[image-crop] 合成失败（节点 ${props.node.id}）: ${msg}`)
    encodeError.value = msg
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.image-crop-editor__empty {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border: 1px dashed rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.image-crop-editor__stagewrap {
  position: relative;
}

/* 编辑区视口：**高度固定**的滚动容器 —— 高度 = 视口宽 ÷ 源图宽高比（内联 `aspect-ratio`），
   恰好容纳 1 倍下的整块舞台；因与缩放倍率无关，滚轮缩放不会把编辑区/整个面板撑高。
   flex + 子项 margin:auto 是「内容小于视口时居中、大于视口时可完整滚动」的标准组合
   （不能用 align-items:center —— 内容溢出时会把顶部裁掉且滚不到）。 */
.image-crop-editor__viewport {
  display: flex;
  align-items: flex-start;
  width: 100%;
  min-height: 200px;
  max-height: 60vh;
  overflow: auto;
  border-radius: 6px;
  overscroll-behavior: contain;
}

.image-crop-editor__stage {
  position: relative;
  /* 0 0 auto + 内联宽度 = 缩放倍率：不参与伸缩，否则会被 flex 压回容器宽度（缩放失效） */
  flex: 0 0 auto;
  margin: auto;
  overflow: hidden;
  border-radius: 6px;
  touch-action: none;
}

.image-crop-editor__overlay {
  position: absolute;
  inset: 0;
}

/* 缩放工具条（舞台右上角）：容器不吃指针事件，只有按钮本身可点，
   避免遮住下方选区手柄的拖拽命中区 */
.image-crop-editor__zoombar {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(0, 0, 0, 0.12);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  pointer-events: none;
  z-index: 4;
}

.image-crop-editor__zoombtn {
  pointer-events: auto;
}

.image-crop-editor__zoomval {
  min-width: 38px;
  font-size: 11px;
  line-height: 1;
  text-align: center;
  color: rgba(0, 0, 0, 0.7);
  font-variant-numeric: tabular-nums;
}

/* 选区主体：整体位移（半透明填充便于看清底图） */
.image-crop-editor__move {
  position: absolute;
  cursor: move;
  background: rgba(25, 118, 210, 0.08);
}

/* 八个缩放手柄 */
.image-crop-editor__handle {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border-radius: 2px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.6);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  z-index: 2;
}

.image-crop-editor__handle--nw,
.image-crop-editor__handle--se {
  cursor: nwse-resize;
}

.image-crop-editor__handle--ne,
.image-crop-editor__handle--sw {
  cursor: nesw-resize;
}

.image-crop-editor__handle--n,
.image-crop-editor__handle--s {
  cursor: ns-resize;
}

.image-crop-editor__handle--e,
.image-crop-editor__handle--w {
  cursor: ew-resize;
}

/* 拖拽中的手柄高亮（含 Shift 等比缩放时的反馈） */
.image-crop-editor__handle--active {
  background: rgb(25, 118, 210);
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.35);
}

/* 实时像素尺寸浮标 */
.image-crop-editor__badge {
  position: absolute;
  transform: translate(-100%, -100%);
  margin: -4px;
  padding: 1px 4px;
  font-size: 11px;
  line-height: 16px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 3px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 3;
}

.image-crop-editor__readout {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: rgba(0, 0, 0, 0.6);
  flex-wrap: wrap;
}

.image-crop-editor__out {
  font-weight: 600;
  color: rgba(0, 0, 0, 0.87);
}

.image-crop-editor__extend {
  color: rgb(25, 118, 210);
}

.image-crop-editor__row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
}

/* 输出设置行：色块 + 名称在左，格式与执行入口靠右 */
.image-crop-editor__format {
  margin-left: auto;
}

.image-crop-editor__field-label {
  color: rgba(0, 0, 0, 0.6);
}

.image-crop-editor__swatch {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.24);
  cursor: pointer;
}

.image-crop-editor__picker {
  width: 272px;
  padding: 8px;
  background: #fff;
}

.image-crop-editor__picker-row {
  display: flex;
  gap: 6px;
  padding: 6px 4px 2px;
}

.image-crop-editor__preset {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.24);
  cursor: pointer;
}

.image-crop-editor__result {
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.04);
}
</style>
