<template>
  <div class="image-crop-node">
    <!-- 当前产物（已应用的修剪/扩展结果）：固定路径产物，按 mtime 作缓存键刷新 -->
    <v-img
      v-if="previewUrl"
      :src="previewUrl"
      contain
      width="100%"
      height="100%"
      @error="onPreviewError"
    />
    <!-- 无产物 / 未连接：纯提示，不提供任何交互控件（交互全在配置面板内） -->
    <div
      v-else
      class="image-crop-node__empty"
    >
      <v-icon
        icon="mdi-crop"
        size="large"
      />
      <div class="text-body-small text-medium-emphasis">
        {{ emptyHint }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 「图片修剪与扩展」节点卡片主体。
 *
 * **与「加载图片」节点同样的呈现约定**：节点主体只负责显示当前产物（一张图），
 * **不承载任何可交互 UI**（无按钮、无输入框、不响应主体内拖拽），整体只保留两种交互：
 * 1. 点击节点 → 打开配置面板（由 `useCanvasSelection.onNodeClick` 统一驱动，节点内无需处理）；
 * 2. 按住节点拖动 → 移动节点位置（**根元素不得带 `nodrag`**，否则节点拖不动）。
 *
 * 选区拖拽、背景色、输出格式全部在配置面板（`editors/ImageCropEditor.vue`）中完成——
 * 这是有意设计：节点卡片内直接拖拽会与 Vue Flow 的节点拖动/缩放/框选手势冲突。
 *
 * 产物为固定路径（output.png / output.jpg），浏览器缓存由产物 mtime（token）区分，
 * 因此必须同时监听 path 与 token，否则重新应用后预览会命中旧缓存。
 */
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'

const props = defineProps<{
  /** 项目名（构建预览 URL 用） */
  project: string
  /** 节点数据（仅用于取节点 id 与产物配置） */
  node: CanvasNodeData
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 按 node-info 下发，无产物时 null） */
  output?: { path: string; token?: number } | null
  /** 本节点的连线输入（仅用于判断是否已连接，决定占位文案；由 AssetCanvas 下发） */
  inputs?: unknown[]
}>()

/** 是否已连接图片输入（决定占位文案） */
const connected = computed(() => (props.inputs?.length ?? 0) > 0)

/** 占位文案（已连接但尚未应用 / 未连接输入） */
const emptyHint = computed(() =>
  connected.value ? '尚未应用，点击节点打开配置面板' : '请连接图片输入',
)

/** 产物预览 URL（按 path + token 缓存，产物重新生成后 token 变化即刷新） */
const previewUrl = ref('')

/** 已缓存 URL 对应的产物 path（与 token 一起参与变更判定） */
let cachedPath = ''
/** 已缓存 URL 对应的产物 token（mtime） */
let cachedToken: number | undefined

watch(
  [() => props.output?.path ?? '', () => props.output?.token],
  ([p, token]) => {
    if (!p) {
      cachedPath = ''
      cachedToken = undefined
      previewUrl.value = ''
      return
    }
    if (p === cachedPath && token === cachedToken) return
    cachedPath = p
    cachedToken = token ?? undefined
    previewUrl.value = buildPreviewUrl(props.project, p, token ?? undefined)
  },
  { immediate: true },
)

/**
 * 预览加载失败（产物文件已被删除/路径失效）：清空 URL 回落到占位提示。
 *
 * 同时清掉缓存键，使产物下次刷新（token 变化）时能重新尝试加载。
 */
function onPreviewError() {
  console.warn(`[image-crop] 产物预览加载失败（节点 ${props.node.id}）：${cachedPath}`)
  cachedPath = ''
  cachedToken = undefined
  previewUrl.value = ''
}
</script>

<style scoped>
/* 与「加载图片」节点同款：铺满节点主体、内容居中；**不带 nodrag/nowheel**，
   保证在图片上按下拖拽即移动节点、滚轮即缩放画布 */
.image-crop-node {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
}

/* 图片本身不接收指针事件：拖拽直接落到节点根元素上（避免原生图片拖动干扰节点拖动） */
.image-crop-node :deep(img) {
  pointer-events: none;
  -webkit-user-drag: none;
  user-select: none;
}

.image-crop-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px;
  text-align: center;
}
</style>
