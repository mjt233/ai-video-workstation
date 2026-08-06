<template>
  <div
    v-if="tabLoading"
    class="d-flex align-center justify-center py-8"
  >
    <v-progress-circular
      indeterminate
      size="28"
    />
  </div>
  <template v-else>
    <v-row
      v-if="tabItems.length"
      density="compact"
    >
      <v-col
        v-for="item in tabItems"
        :key="item.path"
        cols="4"
        sm="3"
        md="2"
      >
        <v-card
          variant="outlined"
          :class="{ 'asset-card--selected': isSelected(item.path) }"
          class="asset-card"
          ripple
          @click="$emit('select', item)"
        >
          <div class="asset-thumb-wrap">
            <AssetThumb :src="item.thumbnail" />
            <v-icon
              v-if="isSelected(item.path)"
              class="asset-check-icon"
              color="primary"
              size="28"
            >
              mdi-check-circle
            </v-icon>
          </div>
          <div
            class="pa-1 text-body-small text-truncate text-center"
            :title="item.label"
          >
            {{ item.label }}
          </div>
        </v-card>
      </v-col>
    </v-row>
    <div
      v-else
      class="text-grey text-body-medium text-center py-8"
    >
      暂无可用资产
    </div>
  </template>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { listImageFilesRecursive, thumbUrl } from './utils'
import AssetThumb from './AssetThumb.vue'
import type { AssetItem } from './types'

/**
 * 自定义资产页签：平铺网格。
 *
 * 递归列举 assert/custom/ 下的全部图片并以网格展示，
 * 点击资产条目 emit select 事件交由父组件处理选中。
 */
const props = defineProps<{
  /** 项目名 */
  project: string
  /** 需要排除的资产路径（不展示） */
  exclude: string[]
  /** 当前已选中的资产路径列表（用于高亮） */
  selectedPaths: string[]
  /** 弹窗是否打开（仅在打开时加载） */
  active: boolean
  /** 弹窗打开时递增的重新加载信号 */
  reloadKey: number
}>()

defineEmits<{
  /** 点击资产条目，携带该条目 */
  select: [item: AssetItem]
}>()

/** 加载中标记 */
const tabLoading = ref(false)
/** 平铺网格条目列表 */
const tabItems = ref<AssetItem[]>([])

/**
 * 判断路径是否已被选中。
 *
 * @param path 资产相对路径
 * @returns true 表示已选中
 */
function isSelected(path: string): boolean {
  return props.selectedPaths.includes(path)
}

/** 加载「自定义资产」标签数据（平铺网格） */
async function loadCustomTab() {
  tabLoading.value = true
  tabItems.value = []
  try {
    const project = props.project
    const imagePaths = await listImageFilesRecursive(project, 'assert/custom/')
    for (const p of imagePaths) {
      if (props.exclude.includes(p)) continue
      const relPath = p.replace(/^assert\/custom\//, '')
      tabItems.value.push({
        path: p,
        label: relPath,
        thumbnail: thumbUrl(project, p),
        depth: 0,
      })
    }
  } finally {
    tabLoading.value = false
  }
}

/** 弹窗打开或 reloadKey 变化时重新加载 */
watch(
  () => [props.active, props.reloadKey] as const,
  () => {
    if (props.active) void loadCustomTab()
  },
  { immediate: true },
)
</script>

<style scoped>
.asset-card {
  cursor: pointer;
  transition: box-shadow 0.15s ease;
  position: relative;
}

.asset-card:hover {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-primary));
}

.asset-card--selected {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}

.asset-thumb-wrap {
  position: relative;
}

.asset-check-icon {
  position: absolute;
  top: 4px;
  right: 4px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}
</style>
