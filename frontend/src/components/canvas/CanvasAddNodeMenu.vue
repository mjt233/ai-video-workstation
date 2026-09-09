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
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- 总标题 + 三列分类（加载/生成/工具），列内为该分类下的节点原型列表 -->
    <div class="add-menu">
      <div class="add-menu__title">
        添加节点
      </div>
      <div class="add-menu__columns">
        <div
          v-for="group in categoryGroups"
          :key="group.id"
          class="add-menu__column"
        >
          <div class="add-menu__category">
            <v-icon
              :icon="group.icon"
              size="14"
              class="mr-1"
            />
            {{ group.label }}
          </div>
          <v-list
            density="compact"
            nav
            class="add-menu__list"
          >
            <v-list-item
              v-for="p in group.items"
              :key="p.id"
              :title="p.name"
              :prepend-icon="p.icon"
              @click="emit('select', p.id)"
            />
          </v-list>
        </div>
      </div>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { NODE_CATEGORIES, NODE_PROTOTYPES } from '../../canvas/registry'
import type { NodeCategory, NodeCategoryMeta, NodePrototype } from '../../canvas/registry'

/**
 * 添加节点菜单分类分组项：分类元数据 + 该分类下的节点原型列表（按注册表顺序）。
 */
interface CategoryGroup extends NodeCategoryMeta {
  /** 该分类下的节点原型列表 */
  items: NodePrototype[]
}

/**
 * 添加节点菜单：双击空白处/空白处右键/工具栏「＋」在鼠标处弹出，选择节点原型后由父级在
 * 对应流坐标添加节点。菜单按注册表 category 分为「加载/生成/工具」三列展示。
 * 菜单状态（show/锚点坐标）由 useCanvasMenus 组合式持有，本组件为纯展示组件。
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

/**
 * 按 NODE_CATEGORIES 顺序把节点原型分组成三列数据。
 * 分类数组顺序即菜单列顺序；未匹配到任何分类的原型不会出现在菜单中。
 *
 * @returns 三列分类分组（加载/生成/工具），组内原型保持注册表声明顺序
 */
const categoryGroups = computed<CategoryGroup[]>(() =>
  NODE_CATEGORIES.map((c) => ({
    ...c,
    items: NODE_PROTOTYPES.filter((p): p is NodePrototype & { category: NodeCategory } => p.category === c.id),
  })),
)
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

/* 菜单容器：白底卡片，总标题 + 三列分类 */
.add-menu {
  background: rgb(var(--v-theme-surface));
  border-radius: 4px;
  box-shadow: 0 5px 5px -3px rgba(0, 0, 0, 0.2), 0 8px 10px 1px rgba(0, 0, 0, 0.14),
    0 3px 14px 2px rgba(0, 0, 0, 0.12);
}

/* 总标题「添加节点」：加粗 + 底部细分隔线 */
.add-menu__title {
  font-weight: 500;
  padding: 10px 14px 6px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

/* 三列分类横向排布 */
.add-menu__columns {
  display: flex;
  align-items: flex-start;
}

/* 单个分类列：固定宽度，列间细分隔线 */
.add-menu__column {
  width: 168px;
  padding: 4px 0 6px;
}

.add-menu__column + .add-menu__column {
  border-left: 1px solid rgba(0, 0, 0, 0.08);
}

/* 分类小标题：图标 + 文案，弱化字号 */
.add-menu__category {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.6);
  padding: 4px 14px;
}

/* 分类内原型列表：去掉 v-list 默认纵向内边距，紧凑排布 */
.add-menu__list {
  padding: 0;
}
</style>
