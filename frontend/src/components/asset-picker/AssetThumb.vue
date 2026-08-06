<template>
  <v-img
    v-if="!imgError"
    :src="src"
    :height="height"
    :width="width"
    cover
    class="flex-shrink-0"
    :class="{ rounded }"
    @error="imgError = true"
  >
    <template #placeholder>
      <div class="d-flex align-center justify-center fill-height text-body-small text-grey">
        {{ placeholder }}
      </div>
    </template>
  </v-img>
  <div
    v-else
    class="d-flex align-center justify-center bg-grey-lighten-3 rounded flex-shrink-0"
    :style="fallbackStyle"
  >
    <v-icon
      color="grey"
      size="40"
    >
      mdi-image-off-outline
    </v-icon>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * 资产缩略图组件。
 *
 * 统一处理图片加载失败降级：加载失败时自动切换为占位图标，
 * 避免各页签子组件重复实现 imgError 逻辑。
 * 用于角色/场景树、自定义资产网格、分镜场景图等处的缩略图展示。
 */
const props = withDefaults(defineProps<{
  /** 图片直链 */
  src?: string
  /** 高度（px 数字或 CSS 字符串），默认 120 */
  height?: number | string
  /** 宽度（px 数字或 CSS 字符串）；未指定时自适应 */
  width?: number | string
  /** 加载中的占位文案 */
  placeholder?: string
  /** 是否圆角 */
  rounded?: boolean
}>(), {
  src: undefined,
  height: 120,
  width: undefined,
  placeholder: '加载中',
  rounded: false,
})

/** 图片是否加载失败（失败时展示占位图标） */
const imgError = ref(false)

/** src 变化时重置错误状态，避免复用旧图 */
watch(
  () => props.src,
  () => {
    imgError.value = false
  },
)

/** 降级占位块的尺寸样式（与图片尺寸保持一致） */
const fallbackStyle = computed(() => {
  const style: Record<string, string> = {}
  if (props.height !== undefined) style.height = px(props.height)
  if (props.width !== undefined) style.width = px(props.width)
  return style
})

/** 将数字或 CSS 字符串尺寸统一为 CSS 长度 */
function px(v: number | string): string {
  return typeof v === 'number' ? `${v}px` : v
}
</script>
