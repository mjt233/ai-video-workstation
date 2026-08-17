<template>
  <v-app>
    <v-app-bar
      color="primary"
      elevation="2"
    >
      <v-btn
        v-if="$route.path !== '/'"
        icon="mdi-arrow-left"
        variant="text"
        color="white"
        @click="$router.push('/')"
      />
      <v-toolbar-title class="text-white">
        视频项目管理器
      </v-toolbar-title>
      <v-spacer />
      <v-btn
        v-if="isProjectPage"
        prepend-icon="mdi-export"
        variant="text"
        color="white"
        class="mr-2"
        :title="exportTitle"
        @click="onExportProject"
      >
        导出项目
      </v-btn>
      <v-btn
        icon="mdi-cog"
        variant="text"
        color="white"
        aria-label="服务商配置"
        @click="showProviderSettings = true"
      />
    </v-app-bar>
    <v-main>
      <router-view />
    </v-main>
    <ProviderSettingsDialog v-model="showProviderSettings" />
  </v-app>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { downloadProjectExport } from './api/client'
import ProviderSettingsDialog from './components/ProviderSettingsDialog.vue'

const route = useRoute()
const showProviderSettings = ref(false)

/**
 * 是否处于项目详情页（存在 project 查询参数）：
 * 仅在该页面显示「导出项目」按钮。
 */
const isProjectPage = computed(() => route.path === '/project' && !!route.query.project)

/** 导出按钮悬浮提示（含项目名，便于区分当前导出对象） */
const exportTitle = computed(() => {
  const project = route.query.project
  return project ? `导出整个项目「${String(project)}」为 zip` : ''
})

/**
 * 导出当前项目：以浏览器原生下载方式获取整个项目的 zip 压缩包。
 */
function onExportProject() {
  const project = route.query.project
  if (!project) return
  downloadProjectExport(String(project))
}
</script>
