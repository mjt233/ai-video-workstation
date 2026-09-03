<template>
  <!-- 群组虚线框（多选 ≥2 个节点时由合成节点 __group-frame 渲染）：
       纯展示组件；拖动整组由 Vue Flow 原生节点拖动承接（节点 draggable），
       右键菜单经 context-menu 事件上抛。尺寸由合成节点 position/width/height 决定。 -->
  <div
    class="canvas-group-frame"
    title="拖动虚线框可整体移动选中节点"
    @contextmenu.prevent="emit('context-menu', $event)"
  />
</template>

<script setup lang="ts">
/**
 * 群组虚线框：多选状态下的成组框（纯展示 + 事件上抛）。
 * - 拖动整组：由 Vue Flow 对合成节点 __group-frame 的原生拖动承接（框架节点 draggable=true，
 *   拖动时全部选中节点一起移动，node-drag-stop 批量回写 store）；
 * - 右键菜单：context-menu 事件上抛，由 useCanvasMenus.openGroupMenu 打开组右键菜单；
 * - 点击框体（无拖动）：不改变选择（合成节点 selectable=false，AssetCanvas 忽略其 node-click）。
 */
const emit = defineEmits<{
  /** 右键事件（打开组右键菜单用） */
  (e: 'context-menu', event: MouseEvent): void
}>()
</script>

<style scoped>
.canvas-group-frame {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 2px dashed rgba(25, 118, 210, 0.75);
  border-radius: 8px;
  background: rgba(25, 118, 210, 0.04);
  cursor: move;
}
</style>
