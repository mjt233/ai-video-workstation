<template>
  <!-- 群组连接目标选择菜单：输出点拖拽超过阈值释放后在鼠标处弹出，
       列出全部有输入端口的节点原型，按群组输出类型兼容性过滤（不兼容项禁用并注明原因）。 -->
  <div
    ref="anchorEl"
    class="group-connect-menu-anchor"
    :style="{ left: `${x}px`, top: `${y}px` }"
  />
  <v-menu
    :model-value="modelValue"
    :activator="activator"
    location="bottom start"
    :open-on-click="false"
    min-width="200"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-list
      density="compact"
      nav
    >
      <v-list-subheader class="group-connect-menu__title">
        选择目标节点
      </v-list-subheader>
      <v-list-item
        v-for="item in items"
        :key="item.prototypeId"
        :title="item.name"
        :prepend-icon="item.icon"
        :disabled="!item.compatible"
        :subtitle="item.compatible ? undefined : item.reason"
        @click="item.compatible && emit('select', item.prototypeId)"
      />
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { GroupConnectOption } from '../../canvas/groupSelection'

/**
 * 群组连接目标选择菜单：输出点拖拽超阈值释放时弹出，选择目标原型后由父级
 * 在释放点创建节点并连接全部兼容源。菜单状态由 useCanvasGroup 组合式持有，
 * 本组件为纯展示组件（与 CanvasAddNodeMenu 同一套 0×0 锚点 + VMenu 定位方案）。
 */
defineProps<{
  /** 菜单显隐（v-model，父级 connectMenu.show） */
  modelValue: boolean
  /** 菜单锚点 x（相对画布容器） */
  x: number
  /** 菜单锚点 y（相对画布容器） */
  y: number
  /** 菜单候选（GroupConnectOption[]，含兼容性标记与原因） */
  items: GroupConnectOption[]
}>()

const emit = defineEmits<{
  /** 菜单显隐变化 */
  (e: 'update:modelValue', value: boolean): void
  /** 选中目标原型（按原型 id 创建并连接） */
  (e: 'select', prototypeId: string): void
}>()

/** 菜单锚点元素（0×0 隐藏定位点，VMenu 依此在鼠标处弹出） */
const anchorEl = ref<HTMLElement | null>(null)

/** VMenu 的定位锚点：去掉 null（activator 类型不接受 null，undefined 可接受），元素挂载后即可用 */
const activator = computed(() => anchorEl.value ?? undefined)
</script>

<style scoped>
/* 菜单锚点：0×0 隐藏定位点，供 VMenu 在鼠标处弹出（不拦截画布交互） */
.group-connect-menu-anchor {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
  visibility: hidden;
}

/* 菜单标题：加粗 + 底部细分隔线，与选项列表区分 */
.group-connect-menu__title {
  font-weight: 500;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  margin-bottom: 2px;
  padding-bottom: 6px;
}
</style>
