<template>
  <div class="variant-tree-node-wrapper">
    <div
      class="variant-node-card"
      :style="{ marginLeft: depth * 12 + 'px' }"
    >
      <v-card
        variant="outlined"
        class="variant-card"
      >
        <div class="variant-media">
          <v-img
            v-if="imageUrls[node.id]"
            :src="imageUrls[node.id]"
            :aspect-ratio="props.aspectRatio ?? 1"
            contain
            class="variant-image variant-image--clickable"
            title="点击放大查看"
            @click="$emit('preview', node)"
          />
          <div
            v-else
            class="variant-placeholder text-grey text-body-small"
            :style="{ aspectRatio: props.aspectRatio ?? 1 }"
          >
            暂无图片
          </div>

          <div class="variant-actions">
            <v-btn
              size="x-small"
              variant="flat"
              icon="mdi-magnify"
              title="放大查看"
              :disabled="!imageUrls[node.id]"
              @click.stop="$emit('preview', node)"
            />
            <v-btn
              size="x-small"
              color="primary"
              variant="flat"
              icon="mdi-auto-fix"
              title="生成图片"
              @click.stop="$emit('generate', node)"
            />
            <slot
              name="upload-btn"
              :node="node"
            />
            <v-btn
              size="x-small"
              variant="flat"
              icon="mdi-history"
              title="历史版本"
              :disabled="!node.hasImage"
              @click.stop="$emit('history', node)"
            />
            <v-btn
              size="x-small"
              variant="flat"
              icon="mdi-pencil"
              title="编辑描述"
              @click.stop="$emit('edit', node)"
            />
            <v-btn
              size="x-small"
              variant="flat"
              icon="mdi-plus-circle-outline"
              color="primary"
              title="创建下级变体"
              @click.stop="$emit('createChild', node)"
            />
            <v-btn
              size="x-small"
              variant="flat"
              color="error"
              icon="mdi-delete"
              title="删除"
              @click.stop="$emit('delete', node)"
            />
          </div>
        </div>

        <div class="pa-2">
          <div class="d-flex align-center ga-1 mb-1">
            <div
              class="text-body-medium font-weight-medium text-truncate"
              :title="node.id"
            >
              {{ node.id }}
            </div>
            <v-chip
              size="x-small"
              :color="node.hasImage ? 'success' : 'grey'"
              variant="tonal"
              class="flex-shrink-0"
            >
              {{ node.hasImage ? '已有图' : '未生成' }}
            </v-chip>
          </div>
          <div
            class="text-body-small text-medium-emphasis variant-desc"
            :title="node.desc"
          >
            {{ node.desc }}
          </div>
        </div>
      </v-card>
    </div>

    <div
      v-if="node.children?.length"
      class="variant-tree-children"
    >
      <VariantTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :image-urls="imageUrls"
        :aspect-ratio="props.aspectRatio ?? 1"
        @preview="$emit('preview', $event)"
        @generate="$emit('generate', $event)"
        @history="$emit('history', $event)"
        @edit="$emit('edit', $event)"
        @delete="$emit('delete', $event)"
        @create-child="$emit('createChild', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { VariantTreeNode as TreeNode } from '../composables/useVariantTree'

defineOptions({ name: 'VariantTreeNode' })

const props = defineProps<{
  node: TreeNode
  depth: number
  imageUrls: Record<string, string>
  aspectRatio?: number
}>()

defineEmits<{
  preview: [node: TreeNode]
  generate: [node: TreeNode]
  history: [node: TreeNode]
  edit: [node: TreeNode]
  delete: [node: TreeNode]
  createChild: [node: TreeNode]
}>()
</script>

<style scoped>
.variant-tree-node-wrapper {
  display: flex;
  flex-direction: column;
}
.variant-node-card {
  width: 200px;
  flex-shrink: 0;
}
.variant-card {
  overflow: hidden;
}
.variant-media {
  position: relative;
  background: rgba(var(--v-theme-on-surface), 0.04);
  min-height: 100px;
}
.variant-image--clickable {
  cursor: zoom-in;
}
.variant-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100px;
}
.variant-actions {
  position: absolute;
  inset: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 4px;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
}
.variant-card:hover .variant-actions,
.variant-card:focus-within .variant-actions {
  opacity: 1;
  pointer-events: auto;
}
.variant-desc {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  word-break: break-word;
  min-height: 2.4em;
}
.variant-tree-children {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 8px;
  margin-top: 8px;
  padding-left: 12px;
}
</style>
