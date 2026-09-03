<template>
  <!-- 群组输出连接点（多选时由合成节点 __group-dot 渲染，位于虚线框右边缘垂直居中）：
       mousedown 后由 useCanvasGroup.startGroupConnect 承接成组连接拖拽
       （node 本身 draggable=false，内容带 nodrag 类防止触发任何原生拖动）。 -->
  <div
    class="canvas-group-dot nodrag"
    title="拖拽连接其他节点；松开超过一定距离可新建生成节点"
    @mousedown.stop.prevent="emit('mousedown', $event)"
  />
</template>

<script setup lang="ts">
/**
 * 群组输出连接点（纯展示 + mousedown 上抛）。
 * 拖拽行为（预览线/命中检测/释放判定）由 useCanvasGroup 组合式承接。
 */
const emit = defineEmits<{
  /** 左键按下（启动成组连接拖拽） */
  (e: 'mousedown', event: MouseEvent): void
}>()
</script>

<style scoped>
.canvas-group-dot {
  width: 16px;
  height: 16px;
  box-sizing: border-box;
  border-radius: 50%;
  background: #1976d2;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  cursor: crosshair;
}
</style>
