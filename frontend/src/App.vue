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
      <!-- LLM 活跃会话（全局功能）：右上角独立图标 + 活跃数徽标 + 面板 -->
      <v-btn
        icon
        variant="text"
        color="white"
        class="mr-1"
        aria-label="LLM 活跃会话"
        :title="activeLlmCount > 0 ? `LLM 活跃会话（${activeLlmCount}）` : 'LLM 活跃会话'"
        @click="sessionsOpen = !sessionsOpen"
      >
        <v-badge
          :content="String(activeLlmCount)"
          :model-value="activeLlmCount > 0"
          color="error"
        >
          <v-icon icon="mdi-broadcast" />
        </v-badge>
      </v-btn>
      <v-btn
        icon="mdi-cog"
        variant="text"
        color="white"
        aria-label="系统配置"
        @click="showSystemSettings = true"
      />
    </v-app-bar>
    <v-main>
      <router-view />
    </v-main>
    <SystemSettingsDialog v-model="showSystemSettings" />
    <LlmSessionsDialog
      v-model="sessionsOpen"
      :sessions="llmSocket.sessions.value"
      @notify="onSessionsNotify"
    />
    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      :timeout="3000"
      location="bottom"
    >
      {{ snackbar.text }}
    </v-snackbar>
  </v-app>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { downloadProjectExport } from './api/client'
import { llmSocket } from './canvas/llmSocket'
import SystemSettingsDialog from './components/SystemSettingsDialog.vue'
import LlmSessionsDialog from './components/LlmSessionsDialog.vue'

const route = useRoute()
const showSystemSettings = ref(false)
/** LLM 活跃会话面板开关 */
const sessionsOpen = ref(false)

/** 全局操作反馈提示（LLM 会话面板中断等操作） */
const snackbar = reactive({ show: false, text: '', color: 'primary' })

/** 活跃 LLM 会话数（Header 徽标：服务端 begin/finish 广播实时刷新） */
const activeLlmCount = computed(() => llmSocket.sessions.value.filter((s) => s.status === 'running').length)

/** 面板操作反馈 */
function onSessionsNotify(text: string, color: 'success' | 'error' | 'primary' = 'primary'): void {
  snackbar.text = text
  snackbar.color = color
  snackbar.show = true
}

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

// 全局 WS 连接（App 挂载即连；断线指数退避重连；会话列表 /llm-ws 广播驱动）
onMounted(() => llmSocket.connect())
</script>
