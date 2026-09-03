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
    <!-- 保存为（hover 展开子菜单：按节点输出类型提供目标——图片=角色/场景/道具图片/自定义；视频=道具视频；音频=道具音频） -->
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
          v-for="t in saveTargets"
          :key="t"
          class="canvas-context-menu__item"
          @click="emit('save-as', t)"
        >
          {{ saveTargetLabel(t) }}
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

  <!-- 群组右键菜单（复制/删除整组） -->
  <div
    v-if="groupMenu.show"
    class="canvas-context-menu"
    :style="{ left: `${groupMenu.x}px`, top: `${groupMenu.y}px` }"
  >
    <div class="canvas-context-menu__title">
      已选 {{ groupMenu.count }} 个节点
    </div>
    <div
      class="canvas-context-menu__item"
      @click="emit('group-copy')"
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
      @click="emit('group-delete')"
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
</template>

<script setup lang="ts">
import type { SaveAsType } from './composables/types'

/**
 * 画布右键菜单：节点菜单与连线菜单的纯展示组件。
 * 节点菜单含「保存为」hover 子菜单（按节点输出类型提供目标：图片=角色/场景/道具图片/自定义资产；
 * 视频=道具视频；音频=道具音频），仅节点有当前产物时显示。
 * 菜单状态与动作逻辑由 useCanvasMenus / useCanvasFlow 组合式持有，动作通过事件上抛。
 */
defineProps<{
  /** 节点右键菜单状态（x/y 相对画布容器） */
  nodeMenu: { show: boolean; x: number; y: number }
  /** 节点是否可重新生成（原型能力标志） */
  canGenerate: boolean
  /** 节点是否有版本历史（原型能力标志） */
  hasHistory: boolean
  /** 节点是否显示「保存为」菜单（有当前产物即可） */
  canSave: boolean
  /** 节点可用的保存目标类型列表（按节点输出类型推导） */
  saveTargets: SaveAsType[]
  /** 节点是否关联了连线（「断开连接」显隐） */
  hasConnections: boolean
  /** 连线右键菜单状态（x/y 相对画布容器） */
  edgeMenu: { show: boolean; x: number; y: number }
  /** 群组右键菜单状态（x/y 相对画布容器；count 为选中节点数） */
  groupMenu: { show: boolean; x: number; y: number; count: number }
}>()

const emit = defineEmits<{
  /** 重新生成 */
  (e: 'generate'): void
  /** 查看历史 */
  (e: 'history'): void
  /** 保存为：按目标类型分派（角色设计/场景图/道具图片/道具视频/道具音频/自定义资产等） */
  (e: 'save-as', type: SaveAsType): void
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
  /** 复制整组 */
  (e: 'group-copy'): void
  /** 删除整组 */
  (e: 'group-delete'): void
}>()

/**
 * 保存目标类型 → 菜单显示名。
 *
 * @param type 保存目标类型
 * @returns 显示名
 */
function saveTargetLabel(type: SaveAsType): string {
  switch (type) {
    case 'character': return '角色设计'
    case 'character-variant': return '角色设计-衍生变体'
    case 'stage': return '场景图'
    case 'stage-variant': return '场景图-衍生变体'
    case 'prop-image': return '道具图片'
    case 'prop-video': return '道具视频'
    case 'prop-audio': return '道具音频'
    case 'custom': return '自定义资产'
    default: return '保存为'
  }
}
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

/* 群组菜单标题：加粗 + 底部细分隔线 */
.canvas-context-menu__title {
  padding: 4px 14px 6px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.6);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  margin-bottom: 2px;
  user-select: none;
}
</style>
