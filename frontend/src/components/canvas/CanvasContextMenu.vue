<template>
  <!-- 节点右键菜单（重新生成/历史/保存为（子菜单）/断开连接/重命名/复制/删除）与连线右键菜单（断开连接） -->
  <div
    v-if="nodeMenu.show"
    class="canvas-context-menu"
    :style="{ left: `${nodeMenu.x}px`, top: `${nodeMenu.y}px` }"
  >
    <div
      v-if="canGenerate"
      class="canvas-context-menu__item"
      @click="emit('generate')"
    >
      <v-icon
        size="small"
        class="mr-2"
      >
        mdi-refresh
      </v-icon>
      重新生成
    </div>
    <div
      v-if="hasHistory"
      class="canvas-context-menu__item"
      @click="emit('history')"
    >
      <v-icon
        size="small"
        class="mr-2"
      >
        mdi-history
      </v-icon>
      历史
    </div>
    <!-- 保存为（hover 展开子菜单：角色设计/角色设计-衍生变体/场景图/场景图-衍生变体/自定义资产） -->
    <div
      v-if="canSave"
      class="canvas-context-menu__item canvas-context-menu__item--submenu"
    >
      <v-icon
        size="small"
        class="mr-2"
      >
        mdi-content-save-outline
      </v-icon>
      <span>保存为</span>
      <v-icon
        size="small"
        class="ml-auto"
      >
        mdi-chevron-right
      </v-icon>
      <div class="canvas-context-menu__submenu">
        <div
          class="canvas-context-menu__item"
          @click="emit('save-as-character')"
        >
          角色设计
        </div>
        <div
          class="canvas-context-menu__item"
          @click="emit('save-as-character-variant')"
        >
          角色设计-衍生变体
        </div>
        <div
          class="canvas-context-menu__item"
          @click="emit('save-as-stage')"
        >
          场景图
        </div>
        <div
          class="canvas-context-menu__item"
          @click="emit('save-as-stage-variant')"
        >
          场景图-衍生变体
        </div>
        <div
          class="canvas-context-menu__item"
          @click="emit('save-as-custom')"
        >
          自定义资产
        </div>
      </div>
    </div>
    <div
      v-if="hasConnections"
      class="canvas-context-menu__item"
      @click="emit('disconnect')"
    >
      <v-icon
        size="small"
        class="mr-2"
      >
        mdi-link-off
      </v-icon>
      断开连接
    </div>
    <div
      class="canvas-context-menu__item"
      @click="emit('rename')"
    >
      <v-icon
        size="small"
        class="mr-2"
      >
        mdi-pencil-outline
      </v-icon>
      重命名
    </div>
    <div
      class="canvas-context-menu__item"
      @click="emit('copy')"
    >
      <v-icon
        size="small"
        class="mr-2"
      >
        mdi-content-copy
      </v-icon>
      复制
    </div>
    <div
      class="canvas-context-menu__item canvas-context-menu__item--danger"
      @click="emit('delete')"
    >
      <v-icon
        size="small"
        class="mr-2"
      >
        mdi-delete-outline
      </v-icon>
      删除
    </div>
  </div>

  <!-- 连线右键菜单（断开连接） -->
  <div
    v-if="edgeMenu.show"
    class="canvas-context-menu"
    :style="{ left: `${edgeMenu.x}px`, top: `${edgeMenu.y}px` }"
  >
    <div
      class="canvas-context-menu__item canvas-context-menu__item--danger"
      @click="emit('disconnect-edge')"
    >
      <v-icon
        size="small"
        class="mr-2"
      >
        mdi-link-off
      </v-icon>
      断开连接
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 画布右键菜单：节点菜单与连线菜单的纯展示组件。
 * 节点菜单含「保存为」hover 子菜单（5 个保存目标类型），仅输出类型为图片且有产物的节点显示。
 * 菜单状态与动作逻辑由 useCanvasMenus / useCanvasFlow 组合式持有，动作通过事件上抛。
 */
defineProps<{
  /** 节点右键菜单状态（x/y 相对画布容器） */
  nodeMenu: { show: boolean; x: number; y: number }
  /** 节点是否可重新生成（原型能力标志） */
  canGenerate: boolean
  /** 节点是否有版本历史（原型能力标志） */
  hasHistory: boolean
  /** 节点是否显示「保存为」菜单（输出类型为图片且有当前产物） */
  canSave: boolean
  /** 节点是否关联了连线（「断开连接」显隐） */
  hasConnections: boolean
  /** 连线右键菜单状态（x/y 相对画布容器） */
  edgeMenu: { show: boolean; x: number; y: number }
}>()

const emit = defineEmits<{
  /** 重新生成 */
  (e: 'generate'): void
  /** 查看历史 */
  (e: 'history'): void
  /** 保存为：角色设计（覆盖 assert/character/{角色}/appearance.jpg） */
  (e: 'save-as-character'): void
  /** 保存为：角色设计-衍生变体（assert/character/{角色}/variants/{变体id}.jpg） */
  (e: 'save-as-character-variant'): void
  /** 保存为：场景图（assert/stage/{场景}/{子场景}.jpg） */
  (e: 'save-as-stage'): void
  /** 保存为：场景图-衍生变体（assert/stage/{场景}/variants/{子场景}/{变体id}.jpg） */
  (e: 'save-as-stage-variant'): void
  /** 保存为：自定义资产（assert/custom/...，SaveAssetDialog） */
  (e: 'save-as-custom'): void
  /** 断开节点全部连接 */
  (e: 'disconnect'): void
  /** 重命名 */
  (e: 'rename'): void
  /** 复制 */
  (e: 'copy'): void
  /** 删除 */
  (e: 'delete'): void
  /** 断开选中连线 */
  (e: 'disconnect-edge'): void
}>()
</script>

<style scoped>
.canvas-context-menu {
  position: absolute;
  z-index: 20;
  min-width: 140px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
}

.canvas-context-menu__item {
  display: flex;
  align-items: center;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  user-select: none;
}

.canvas-context-menu__item:hover {
  background: rgba(0, 0, 0, 0.05);
}

/* 「保存为」父级项：相对定位，子菜单悬浮展开在右侧 */
.canvas-context-menu__item--submenu {
  position: relative;
}

.canvas-context-menu__submenu {
  display: none;
  position: absolute;
  left: 100%;
  top: -5px;
  min-width: 168px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  z-index: 21;
}

.canvas-context-menu__item--submenu:hover .canvas-context-menu__submenu {
  display: block;
}

.canvas-context-menu__item--danger {
  color: rgb(176, 0, 32);
}

.canvas-context-menu__item--danger:hover {
  background: rgba(176, 0, 32, 0.08);
}
</style>
