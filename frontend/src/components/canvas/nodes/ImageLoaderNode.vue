<template>
  <div class="image-loader-node">
    <template v-if="imageUrl">
      <v-img
        :src="imageUrl"
        contain
        width="100%"
        height="100%"
        @error="imageUrl = ''"
      />
      <!-- 悬浮操作：放大查看 / 下载图片 -->
      <ImageNodeActions
        :image-url="imageUrl"
        :asset-path="assetPath"
      />
    </template>
    <template v-else>
      <div class="image-loader-node__empty">
        <v-icon
          icon="mdi-image-outline"
          size="large"
        />
        <div class="text-body-small text-medium-emphasis">
          未选择图片
        </div>
        <div class="d-flex ga-1 mt-1">
          <v-btn
            size="x-small"
            variant="tonal"
            color="primary"
            @click.stop="openUpload"
          >
            上传图片
          </v-btn>
          <v-btn
            size="x-small"
            variant="tonal"
            @click.stop="openPicker"
          >
            选择资产
          </v-btn>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import { buildPreviewUrl } from '../../../canvas/preview'
import { uploadFs } from '../../../api/client'
import ImageNodeActions from './ImageNodeActions.vue'

/** 节点 body 组件统一 props：节点数据 + 项目名 */
const props = defineProps<{
  project: string
  node: CanvasNodeData
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'open-picker', nodeId: string): void
}>()

const imageUrl = ref('')

/** 当前资产路径（config.assetPath） */
const assetPath = computed(() => (typeof props.node.config.assetPath === 'string' ? props.node.config.assetPath : ''))

watch(
  assetPath,
  (p) => {
    imageUrl.value = p ? buildPreviewUrl(props.project, p) : ''
  },
  { immediate: true },
)

/** 打开系统文件选择并上传到自定义资产，然后写入 assetPath */
function openUpload() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const dest = `assert/custom/canvas/${Date.now()}-${file.name}`
    const res = await uploadFs(props.project, dest, file)
    if (res.success) {
      emit('update:config', { assetPath: res.path })
    }
  }
  input.click()
}

/** 打开资产选择器（Task 7 在 AssetCanvas 统一提供，此处先占位） */
function openPicker() {
  emit('open-picker', props.node.id)
}
</script>

<style scoped>
.image-loader-node {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
}

/* 鼠标悬浮节点时显示右上角操作按钮 */
.image-loader-node:hover .image-node-actions {
  opacity: 1;
  pointer-events: auto;
}

.image-loader-node__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px;
}
</style>
