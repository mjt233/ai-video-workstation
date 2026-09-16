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
      <!-- 任务管理器（全局功能）：右上角独立图标 + 活跃任务数徽标 + 右侧抽屉 -->
      <v-btn
        icon
        variant="text"
        color="white"
        class="mr-1"
        aria-label="任务管理器"
        :title="activeTaskCount > 0 ? `任务管理器（${activeTaskCount} 个进行中）` : '任务管理器'"
        @click="toggleTaskManager"
      >
        <v-badge
          :content="String(activeTaskCount)"
          :model-value="activeTaskCount > 0"
          color="error"
        >
          <v-icon icon="mdi-progress-clock" />
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
    <SystemSettingsDialog
      v-model="showSystemSettings"
      :initial-section="targetSection"
    />
    <TaskManagerDrawer
      v-model="sessionsOpen"
      :tasks="taskSocket.tasks.value"
      :open-tab="managerTab"
      :open-token="managerToken"
      @notify="onSessionsNotify"
    />
    <!-- 工作流完成通知气泡（右下角；抽屉打开时隐藏，避免与抽屉互相遮挡） -->
    <WorkflowNotifyStack
      :hidden="sessionsOpen"
      @open-manager="openTaskManager('history')"
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
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { downloadProjectExport } from './api/client'
import { taskSocket } from './canvas/taskSocket'
import { installWorkflowNotifyListener } from './canvas/notify'
import SystemSettingsDialog from './components/SystemSettingsDialog.vue'
import TaskManagerDrawer from './components/TaskManagerDrawer.vue'
import WorkflowNotifyStack from './components/canvas/WorkflowNotifyStack.vue'
import { useSystemSettings } from './composables/useSystemSettings'

const route = useRoute()
// 系统设置对话框开关与定位状态提升到 composable，供任意页面（如存储清理页）打开并定位子类
const { dialogOpen: showSystemSettings, targetSection } = useSystemSettings()
/** 任务管理器抽屉开关（顶栏图标 / 完成气泡与「进行中」的跳转入口共用） */
const sessionsOpen = ref(false)
/** 请求抽屉打开的页签与令牌（令牌自增即触发切换 + 历史刷新） */
const managerTab = ref<'active' | 'history'>('active')
const managerToken = ref(0)

/**
 * 打开任务管理器抽屉并定位页签。
 *
 * @param tab 目标页签（默认「进行中」）
 */
function openTaskManager(tab: 'active' | 'history' = 'active'): void {
  managerTab.value = tab
  managerToken.value += 1
  sessionsOpen.value = true
}

/** 顶栏图标：切换抽屉显隐（重新打开时保持当前定位逻辑由抽屉自身负责） */
function toggleTaskManager(): void {
  sessionsOpen.value = !sessionsOpen.value
}

/** 全局操作反馈提示（LLM 会话面板中断等操作） */
const snackbar = reactive({ show: false, text: '', color: 'primary' })

/** 活跃任务数（Header 徽标：服务端 begin/finish 广播实时刷新） */
const activeTaskCount = computed(
  () => taskSocket.tasks.value.filter((t) => t.status === 'running' || t.status === 'pending').length,
)

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

// 全局 WS 连接（App 挂载即连；断线指数退避重连；任务列表 /llm-ws 广播驱动）
// 同时安装「工作流完成通知气泡」监听（消费同一广播的工作流终态）
let offWorkflowNotify: (() => void) | null = null
onMounted(() => {
  taskSocket.connect()
  offWorkflowNotify = installWorkflowNotifyListener()
})
onBeforeUnmount(() => {
  offWorkflowNotify?.()
  offWorkflowNotify = null
})
</script>
