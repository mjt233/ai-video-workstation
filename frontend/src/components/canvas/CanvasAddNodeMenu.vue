<template>
  <!-- 添加节点菜单：0×0 隐藏锚点在鼠标处弹出，选择原型后在锚点对应流坐标添加节点 -->
  <div
    ref="anchorEl"
    class="add-menu-anchor"
    :style="{ left: `${x}px`, top: `${y}px` }"
  />
  <v-menu
    :model-value="modelValue"
    :activator="activator"
    location="bottom start"
    :open-on-click="false"
    min-width="180"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-list
      density="compact"
      nav
    >
      <v-list-subheader class="add-menu__title">
        添加节点
      </v-list-subheader>
      <v-list-item
        v-for="p in NODE_PROTOTYPES"
        :key="p.id"
        :title="p.name"
        :prepend-icon="p.icon"
        @click="emit('select', p.id)"
      />
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NODE_PROTOTYPES } from '../../canvas/registry'

/**
 * 添加节点菜单：双击空白处/工具栏「＋」在鼠标处弹出，选择节点原型后由父级在
 * 对应流坐标添加节点。菜单状态（show/锚点坐标）由 useCanvasMenus 组合式持有，
 * 本组件为纯展示组件。
 */
defineProps<{
  /** 菜单显隐（v-model，父级 addMenu.show） */
  modelValue: boolean
  /** 菜单锚点 x（相对画布容器） */
  x: number
  /** 菜单锚点 y（相对画布容器） */
  y: number
}>()

const emit = defineEmits<{
  /** 菜单显隐变化 */
  (e: 'update:modelValue', value: boolean): void
  /** 选中节点原型（按原型 id 添加节点） */
  (e: 'select', prototypeId: string): void
}>()

/** 菜单锚点元素（0×0 隐藏定位点，VMenu 依此在鼠标处弹出） */
const anchorEl = ref<HTMLElement | null>(null)

/** VMenu 的定位锚点：去掉 null（activator 类型不接受 null，undefined 可接受），元素挂载后即可用 */
const activator = computed(() => anchorEl.value ?? undefined)
</script>

<style scoped>
/* 添加节点菜单锚点：0×0 隐藏定位点，供 VMenu 在鼠标处弹出（不拦截画布交互） */
.add-menu-anchor {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
  visibility: hidden;
}

/* 添加节点菜单标题：加粗 + 底部细分隔线，与选项列表区分 */
.add-menu__title {
  font-weight: 500;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  margin-bottom: 2px;
  padding-bottom: 6px;
}
</style>
