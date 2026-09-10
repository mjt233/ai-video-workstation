<template>
  <!-- 群组虚线框（多选 ≥2 个节点时由合成节点 __group-frame 渲染）：
       纯展示组件（不可交互）；尺寸由合成节点 position/width/height 决定。
       指针事件（关键，见 docs/canvas/interactions.md）：**整框穿透**（`pointer-events: none`），
       否则该框会盖住框内全部可交互元素——最典型的是持久分组标题条：
       单击分组标题条选中「分组单元」后虚线框随即出现并盖住标题条，
       双击改名 / 再次单击等后续交互全部被框体吞掉（实测复现：框内元素命中不到）。
       因此虚线框只负责「画出多选范围」，命中判定一律交给框内真实元素与 Vue Flow pane。 -->
  <div
    class="canvas-group-frame"
    title="多选范围（拖动选中节点可整体移动）"
  />
</template>

<script setup lang="ts">
/**
 * 群组虚线框：多选状态下的成组框（**纯展示**，不参与任何指针交互）。
 *
 * - 整体移动选中节点：拖动**任一选中节点**（Vue Flow 原生拖动会携带全部选中节点，
 *   `node-drag-stop` 批量回写 store），或拖动持久分组标题条；
 * - 框体本身 `pointer-events: none`：框内节点、持久分组标题条/边框、连线、
 *   「Ctrl+拖拽框选」等一切既有交互都不受遮挡（详见 docs/canvas/interactions.md 的实现约束表）；
 * - 因此原先挂在框体上的右键组菜单（`openGroupMenu`）与「拖动框体整组移动」不再可用：
 *   前者改由节点右键菜单承担，后者由拖动选中节点 / 分组标题条承担。
 */
</script>

<style scoped>
.canvas-group-frame {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 2px dashed rgba(25, 118, 210, 0.75);
  border-radius: 8px;
  background: rgba(25, 118, 210, 0.04);
  /* 关键：整框不拦截指针——虚线框只是「范围提示」，绝不能成为框内元素的遮罩 */
  pointer-events: none;
}
</style>
