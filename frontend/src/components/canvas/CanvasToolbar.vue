<template>
  <!-- 工具栏：视图缩放/撤销重做/自动搭画布/添加节点 + 保存状态指示 -->
  <div class="canvas-toolbar">
    <v-btn
      size="small"
      variant="text"
      icon="mdi-fit-to-screen-outline"
      title="适应视图"
      @click="emit('fit')"
    />
    <v-btn
      size="small"
      variant="text"
      icon="mdi-plus"
      title="放大"
      @click="emit('zoom-in')"
    />
    <v-btn
      size="small"
      variant="text"
      icon="mdi-minus"
      title="缩小"
      @click="emit('zoom-out')"
    />
    <v-divider
      vertical
      class="mx-1"
    />
    <v-btn
      size="small"
      variant="text"
      icon="mdi-undo"
      title="撤销 (Ctrl+Z)"
      :disabled="!canUndo"
      @click="emit('undo')"
    />
    <v-btn
      size="small"
      variant="text"
      icon="mdi-redo"
      title="重做 (Ctrl+Shift+Z)"
      :disabled="!canRedo"
      @click="emit('redo')"
    />
    <v-divider
      vertical
      class="mx-1"
    />
    <v-btn
      size="small"
      prepend-icon="mdi-auto-fix"
      variant="tonal"
      :loading="autoBuilding"
      title="根据分镜/子场景自动搭建画布"
      @click="emit('auto-build')"
    >
      自动搭画布
    </v-btn>
    <v-btn
      size="small"
      variant="text"
      icon="mdi-plus-thick"
      title="添加节点（或双击空白处）"
      @click="emit('add', $event)"
    />
    <v-spacer />
    <v-progress-circular
      v-if="saving"
      size="18"
      indeterminate
      color="primary"
    />
    <span
      v-else-if="dirty"
      class="text-body-small text-medium-emphasis"
    >未保存</span>
    <span
      v-else
      class="text-body-small text-disabled"
    >已保存</span>
  </div>
</template>

<script setup lang="ts">
/**
 * 资产画布工具栏：视图缩放、撤销/重做、自动搭画布、添加节点入口与保存状态指示。
 * 纯展示组件，全部动作通过事件上抛由 AssetCanvas 接线。
 */
defineProps<{
  /** 是否可撤销 */
  canUndo: boolean
  /** 是否可重做 */
  canRedo: boolean
  /** 自动搭画布进行中（按钮 loading） */
  autoBuilding: boolean
  /** 画布保存中（进度圈指示） */
  saving: boolean
  /** 画布有未保存修改（「未保存」文案） */
  dirty: boolean
}>()

const emit = defineEmits<{
  /** 适应视图 */
  (e: 'fit'): void
  /** 放大 */
  (e: 'zoom-in'): void
  /** 缩小 */
  (e: 'zoom-out'): void
  /** 撤销 */
  (e: 'undo'): void
  /** 重做 */
  (e: 'redo'): void
  /** 自动搭画布 */
  (e: 'auto-build'): void
  /** 添加节点（携带触发鼠标事件，供菜单定位） */
  (e: 'add', event: MouseEvent): void
}>()
</script>

<style scoped>
.canvas-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}
</style>
