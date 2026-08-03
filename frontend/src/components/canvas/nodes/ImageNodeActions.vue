<template>
  <div
    class="image-node-actions"
    @mousedown.stop
  >
    <!-- 放大查看 -->
    <v-btn
      size="x-small"
      variant="flat"
      color="grey-darken-4"
      icon="mdi-magnify-plus-outline"
      title="放大查看"
      @click.stop="preview.show = true"
    />
    <!-- 下载图片 -->
    <v-btn
      size="x-small"
      variant="flat"
      color="grey-darken-4"
      icon="mdi-download"
      title="下载图片"
      @click.stop="download"
    />

    <!-- 放大查看对话框 -->
    <v-dialog
      v-model="preview.show"
      max-width="90vw"
    >
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon
            class="mr-2"
            size="small"
            color="primary"
          >
            mdi-image-outline
          </v-icon>
          <span class="text-truncate">{{ fileName }}</span>
          <v-spacer />
          <v-btn
            icon="mdi-download"
            size="small"
            variant="text"
            title="下载"
            @click="download"
          />
          <v-btn
            icon="mdi-close"
            size="small"
            variant="text"
            @click="preview.show = false"
          />
        </v-card-title>
        <v-divider />
        <v-card-text class="image-node-actions__preview">
          <img
            :src="imageUrl"
            :alt="fileName"
            class="image-node-actions__img"
          >
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'

/**
 * 图片节点悬浮操作按钮（放大查看 / 下载图片）。
 *
 * 供「加载图片」「生成图片」等图片类节点复用：放置于节点内部，默认隐藏，
 * 由父节点 hover 样式控制显示（父节点需 `position: relative` 并添加类似
 * `.父节点:hover .image-node-actions { opacity: 1; pointer-events: auto; }` 的规则）。
 *
 * @example
 * ```vue
 * <template v-if="imageUrl">
 *   <v-img :src="imageUrl" />
 *   <ImageNodeActions :image-url="imageUrl" :asset-path="assetPath" />
 * </template>
 * ```
 */
const props = defineProps<{
  /** 图片预览 URL（/api/fs/... 带缓存键） */
  imageUrl: string
  /** 资产相对路径（用于派生下载文件名） */
  assetPath: string
}>()

/** 放大查看对话框状态 */
const preview = reactive({
  show: false,
})

/** 从资产路径派生下载/标题文件名（取最后一段，无路径时回退为 image） */
const fileName = computed(() => {
  const path = props.assetPath
  if (!path) return 'image'
  return path.split('/').pop() || 'image'
})

/**
 * 下载图片：同源地址可直接通过 `<a download>` 指定下载文件名。
 */
function download() {
  const a = document.createElement('a')
  a.href = props.imageUrl
  a.download = fileName.value
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
</script>

<style scoped>
.image-node-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 5;
  display: flex;
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}
.image-node-actions .v-btn {
  opacity: .5;
  transition: all .2s;
}
.image-node-actions .v-btn:hover {
  opacity: 1;
}

.image-node-actions__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #111;
  min-height: 240px;
}

.image-node-actions__img {
  max-width: 100%;
  max-height: 80vh;
  object-fit: contain;
  display: block;
}
</style>
