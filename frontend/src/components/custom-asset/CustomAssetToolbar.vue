<template>
  <div
    class="d-flex align-center pa-2 border-b ga-2"
    style="flex-shrink: 0;"
  >
    <!-- 面包屑导航 -->
    <div
      class="d-flex align-center flex-grow-1"
      style="min-width: 0; overflow-x: auto;"
    >
      <template
        v-for="(crumb, i) in breadcrumbItems"
        :key="i"
      >
        <v-btn
          v-if="i > 0"
          icon="mdi-chevron-right"
          size="x-small"
          variant="text"
          density="compact"
          class="breadcrumb-sep"
          disabled
        />
        <v-btn
          variant="text"
          size="small"
          density="compact"
          class="breadcrumb-btn text-none"
          :class="{ 'text-primary font-weight-medium': !crumb.disabled }"
          :disabled="crumb.disabled"
          @click="emit('navigate', crumb.path)"
        >
          {{ crumb.title }}
        </v-btn>
      </template>
    </div>

    <v-spacer />

    <!-- 视图切换 -->
    <v-btn-toggle
      :model-value="viewMode"
      mandatory
      density="compact"
      color="primary"
      variant="outlined"
      divided
      class="view-mode-toggle"
      @update:model-value="onViewModeChange"
    >
      <v-btn
        value="list"
        size="small"
        icon="mdi-view-list"
        title="列表视图"
      />
      <v-btn
        value="grid"
        size="small"
        icon="mdi-view-grid"
        title="网格视图"
      />
    </v-btn-toggle>

    <v-btn
      size="small"
      color="primary"
      variant="tonal"
      prepend-icon="mdi-folder-plus"
      @click="emit('create-dir')"
    >
      新建目录
    </v-btn>
    <v-btn
      size="small"
      color="primary"
      variant="tonal"
      prepend-icon="mdi-upload"
      :loading="uploading"
      @click="emit('upload')"
    >
      上传
    </v-btn>
    <v-btn
      size="small"
      color="primary"
      variant="tonal"
      prepend-icon="mdi-refresh"
      :disabled="loading"
      @click="emit('refresh')"
    >
      刷新
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import type { BreadcrumbItem, ViewMode } from '../../utils/customAssetFile'

/**
 * 自定义资产工具栏：面包屑、视图切换与操作按钮。
 */
defineProps<{
  /** 面包屑项 */
  breadcrumbItems: BreadcrumbItem[]
  /** 当前视图模式 */
  viewMode: ViewMode
  /** 是否正在上传 */
  uploading: boolean
  /** 是否正在加载目录 */
  loading: boolean
}>()

const emit = defineEmits<{
  /** 导航到指定目录 */
  navigate: [path: string]
  /** 视图模式变更 */
  'update:viewMode': [mode: ViewMode]
  /** 点击新建目录 */
  'create-dir': []
  /** 点击上传 */
  upload: []
  /** 点击刷新 */
  refresh: []
}>()

/**
 * 处理视图模式切换。
 * @param value 新视图模式
 */
function onViewModeChange(value: unknown) {
  if (value === 'list' || value === 'grid') {
    emit('update:viewMode', value)
  }
}
</script>

<style scoped>
.view-mode-toggle {
  flex-shrink: 0;
}
</style>
