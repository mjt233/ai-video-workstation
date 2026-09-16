<template>
  <!--
    全局「任务管理器」抽屉（Header 右上角图标从右侧滑出；展示系统当前全部异步任务）。
    用 temporary 浮层而非挤压主内容：画布（Vue Flow）尺寸/滚轮交互不因抽屉开合重排。
  -->
  <v-navigation-drawer
    :model-value="modelValue"
    location="right"
    temporary
    :width="DRAWER_WIDTH"
    class="task-manager-drawer"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="task-manager-drawer__inner">
      <div class="task-manager-drawer__head">
        <v-icon
          icon="mdi-progress-clock"
          size="20"
          class="mr-2"
          color="primary"
        />
        <span class="text-subtitle-1 font-weight-medium">任务管理器</span>
        <span
          v-if="activeTasks.length > 0"
          class="text-body-small text-medium-emphasis ml-2"
        >
          （{{ activeTasks.length }} 个进行中）
        </span>
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          aria-label="关闭"
          @click="emit('update:modelValue', false)"
        />
      </div>

      <!-- 「进行中」= 统一任务注册表（内存运行态）；「历史」= SQLite 持久化任务（含日志与产物） -->
      <v-tabs
        v-model="tab"
        density="comfortable"
        color="primary"
        class="px-4"
      >
        <v-tab value="active">
          进行中
        </v-tab>
        <v-tab value="history">
          历史
        </v-tab>
      </v-tabs>

      <v-window
        v-model="tab"
        class="task-manager-drawer__window"
      >
        <v-window-item value="active">
          <div class="task-manager-drawer__body">
            <template v-if="activeTasks.length > 0">
              <div
                v-for="t in activeTasks"
                :key="t.id"
                class="task-manager-drawer__row"
              >
                <div class="task-manager-drawer__info">
                  <div class="task-manager-drawer__title">
                    <v-progress-circular
                      v-if="t.status === 'running'"
                      :size="14"
                      :width="2"
                      indeterminate
                      color="primary"
                      class="mr-2"
                    />
                    <v-icon
                      v-else
                      icon="mdi-clock-outline"
                      size="14"
                      color="warning"
                      class="mr-2"
                    />
                    <v-chip
                      :color="typeColor(t.type)"
                      size="x-small"
                      variant="tonal"
                      class="mr-2"
                    >
                      {{ typeLabel(t.type) }}
                    </v-chip>
                    <span class="task-manager-drawer__name">{{ t.label }}</span>
                  </div>
                  <div class="task-manager-drawer__meta">
                    <span>{{ statusText(t) }}</span>
                    <span class="mx-1">·</span>
                    <span>已运行 {{ formatElapsed(t.startedAt) }}</span>
                    <template v-if="locationText(t)">
                      <span class="mx-1">·</span>
                      <span>{{ locationText(t) }}</span>
                    </template>
                  </div>
                  <!-- 进度条：有真实进度（ffmpeg / 上报中间进度的工作流服务商）显示确定百分比，其余不确定 -->
                  <v-progress-linear
                    v-if="t.status === 'running'"
                    :model-value="t.progress"
                    :indeterminate="typeof t.progress !== 'number'"
                    height="4"
                    rounded
                    color="primary"
                    class="mt-1"
                  />
                </div>
                <v-tooltip
                  :text="t.cancelable ? '中断该任务' : (t.cancelBlockReason || '该任务不支持中断')"
                  location="left"
                >
                  <template #activator="{ props: tipProps }">
                    <span v-bind="tipProps">
                      <v-btn
                        size="small"
                        variant="tonal"
                        color="error"
                        class="task-manager-drawer__interrupt"
                        :disabled="!t.cancelable"
                        @click="onInterrupt(t)"
                      >
                        中断
                      </v-btn>
                    </span>
                  </template>
                </v-tooltip>
              </div>
            </template>
            <div
              v-else
              class="task-manager-drawer__empty"
            >
              <v-icon
                icon="mdi-progress-clock"
                size="36"
                class="mb-2"
                color="grey"
              />
              <div class="text-body-medium text-medium-emphasis">
                暂无进行中的任务
              </div>
            </div>
            <div
              v-if="finishedNoticeCount > 0"
              class="task-manager-drawer__finished-note"
            >
              <span>本次打开期间已有 {{ finishedNoticeCount }} 个任务完成</span>
              <v-btn
                size="x-small"
                variant="text"
                color="primary"
                @click="showRecent()"
              >
                查看最近完成 →
              </v-btn>
            </div>
          </div>
        </v-window-item>

        <v-window-item value="history">
          <div class="task-manager-drawer__body task-manager-drawer__body--history">
            <TaskHistoryPanel
              :active="tab === 'history'"
              :reload-token="historyReloadToken"
            />
          </div>
        </v-window-item>
      </v-window>
    </div>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { taskSocket, type LlmCanvasTarget, type TaskInfo, type TaskType } from '../canvas/taskSocket'
import TaskHistoryPanel from './task/TaskHistoryPanel.vue'

/** 抽屉宽度（像素；窄屏由 CSS `max-width: 92vw` 兜底） */
const DRAWER_WIDTH = 460

/**
 * 全局「任务管理器」抽屉：
 * - 任务列表实时来自 `taskSocket.tasks`（服务端 begin/update/finish 广播，含 ffmpeg 真实进度）；
 * - 每行展示：类型标记 / 名称 / 状态 / 已运行时长（按 startedAt 客户端每秒刷新）/ 画布位置 / 进度条；
 * - 「中断」按钮统一走 `taskSocket.cancel`（ffmpeg kill 子进程、LLM abort 上游、工作流 Bridge 取消）；
 *   不可中断的任务按钮置灰并以 tooltip 显示原因（如「该工作流不支持中断」）；
 * - 「历史」页签 = SQLite 持久任务（跨刷新保留，含产物缩略图与日志），也是"看刚完成的任务"的入口
 *   （列表按 `created_at DESC`，第一条即最近完成的）。
 */
const props = defineProps<{
  /** 抽屉可见性（v-model） */
  modelValue: boolean
  /** 活跃任务列表（taskSocket.tasks 注入） */
  tasks: TaskInfo[]
  /** 外部请求打开的页签（配合 openToken；缺省保持当前页签） */
  openTab?: 'active' | 'history'
  /** 外部请求令牌：自增即按 openTab 切换页签并刷新历史列表 */
  openToken?: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  /** 操作反馈（snackbar） */
  (e: 'notify', text: string, color?: 'success' | 'error' | 'primary'): void
}>()

/** 活跃（pending/running）任务列表（按启动时间倒序） */
const activeTasks = computed(() =>
  props.tasks
    .filter((t) => t.status === 'running' || t.status === 'pending')
    .sort((a, b) => b.startedAt - a.startedAt),
)

/** 当前页签：active = 进行中（内存注册表）；history = 历史（SQLite 任务 + 产物 + 日志） */
const tab = ref<'active' | 'history'>('active')

/** 历史列表刷新令牌（自增即触发 TaskHistoryPanel 重新拉取第一页） */
const historyReloadToken = ref(0)

/** 已完成计数提示（本次抽屉打开期间收敛的任务数；打开时清零） */
const finishedNoticeCount = ref(0)
/** 上次任务快照（数量减少判定完成） */
let prevCount = activeTasks.value.length

/** 当前时间（秒级刷新；耗时展示用） */
const nowTick = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

/** 抽屉打开时启动秒级计时；关闭时停止并清零完成计数（同时复位页签） */
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      nowTick.value = Date.now()
      finishedNoticeCount.value = 0
      prevCount = activeTasks.value.length
      tickTimer ??= setInterval(() => {
        nowTick.value = Date.now()
      }, 1000)
    } else {
      tab.value = 'active'
      if (tickTimer) {
        clearInterval(tickTimer)
        tickTimer = null
      }
    }
  },
  { immediate: true },
)

/** 外部请求（如完成气泡的「查看日志」）打开指定页签并刷新历史 */
watch(
  () => props.openToken,
  () => {
    if (!props.openToken) return
    tab.value = props.openTab ?? 'active'
    if (tab.value === 'history') historyReloadToken.value += 1
  },
)

/**
 * 工作流任务收敛（成功 / 失败 / 用户中断）后的「历史」自动刷新**不在这里**：
 * 由 `TaskHistoryPanel` 自行监听 `workflowFinishedTick`（它需要判断用户是否正在滚动翻看旧任务，
 * 已滚动时不打断）。本令牌只服务"用户显式要求跳到最新"的两条路径：外部 `openToken` 与
 * 「查看最近完成 →」。
 */

/** 任务数量下降（终态移除）→ 完成计数 +1（抽屉打开期间） */
watch(
  () => activeTasks.value.length,
  (count) => {
    if (!props.modelValue) return
    if (count < prevCount) finishedNoticeCount.value += prevCount - count
    prevCount = count
  },
)

onBeforeUnmount(() => {
  if (tickTimer) clearInterval(tickTimer)
  window.removeEventListener('keydown', onKeydown)
})

/**
 * ESC 关闭抽屉：`v-navigation-drawer` 自带遮罩点击关闭但**不处理 ESC**，
 * 这里补上与全站对话框一致的行为。
 *
 * 上层仍有打开的对话框（如历史行的产物放大预览）时直接返回：让对话框先关闭，
 * 避免一次 ESC 连关两层。
 *
 * @param e 键盘事件
 */
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !props.modelValue) return
  if (document.querySelector('.v-dialog.v-overlay--active')) return
  emit('update:modelValue', false)
}

onMounted(() => window.addEventListener('keydown', onKeydown))

/** 从「进行中」跳转「历史」并刷新（列表第一条即最近完成的任务） */
function showRecent(): void {
  tab.value = 'history'
  historyReloadToken.value += 1
}

/**
 * 格式化任务耗时（毫秒时间差 → mm:ss 或 h:mm:ss）。
 *
 * @param startedAt 任务启动时间（毫秒时间戳）
 * @returns 已运行时长文本
 */
function formatElapsed(startedAt: number): string {
  const total = Math.max(0, Math.floor((nowTick.value - startedAt) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

/**
 * 任务类型中文标签。
 *
 * @param type 任务类型
 * @returns 中文标签
 */
function typeLabel(type: TaskType): string {
  if (type === 'workflow') return 'AI 生成'
  if (type === 'llm') return 'LLM 会话'
  return '视频处理'
}

/**
 * 任务类型标记颜色。
 *
 * @param type 任务类型
 * @returns Vuetify 颜色名
 */
function typeColor(type: TaskType): string {
  if (type === 'workflow') return 'primary'
  if (type === 'llm') return 'purple'
  return 'teal'
}

/**
 * 状态文案：pending 排队中；running 按类型显示阶段
 * （LLM Thinking/响应中；任何有真实进度的任务显示「处理中 N%」；其余 ffmpeg「处理中…」、工作流「运行中…」）。
 *
 * @param t 任务摘要
 * @returns 状态文本
 */
function statusText(t: TaskInfo): string {
  if (t.status === 'pending') return '排队中'
  if (t.status !== 'running') return t.status === 'completed' ? '已完成' : t.status === 'failed' ? '失败' : '已中断'
  if (t.type === 'llm') return t.phase === 'responding' ? '正在响应…' : 'Thinking…'
  // 有真实进度就显示百分比：ffmpeg 恒有（除取帧），工作流取决于服务商是否上报中间进度
  if (typeof t.progress === 'number') return `处理中 ${t.progress}%`
  if (t.type === 'ffmpeg') return '处理中…'
  return '运行中…'
}

/**
 * 任务位置展示（项目 + 画布中文标签）。
 *
 * @param t 任务摘要
 * @returns 位置文本（无定位信息时返回空串）
 */
function locationText(t: TaskInfo): string {
  const parts: string[] = []
  if (t.project) parts.push(t.project)
  const c: LlmCanvasTarget | undefined = t.canvas
  if (c) {
    if (c.kind === 'scene') parts.push(`分镜第${c.episode}集 ${c.shot}#`)
    else parts.push(`场景 ${c.stage ?? ''} / ${c.label ?? ''}`)
  }
  return parts.join(' · ')
}

/**
 * 中断任务（取消非删除，无需 confirm）：WS 优先 + HTTP 兜底；
 * 服务端收敛后广播任务列表更新（LLM 另有 finished 广播），列表实时移除。
 *
 * @param t 任务摘要
 */
function onInterrupt(t: TaskInfo): void {
  taskSocket.cancel(t.id)
  emit('notify', `已请求中断「${t.label}」`, 'primary')
}
</script>

<style scoped>
.task-manager-drawer {
  max-width: 92vw;
}

/* 抽屉内部满高纵向布局：头部 + 页签固定，内容区各自滚动 */
.task-manager-drawer__inner {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.task-manager-drawer :deep(.v-navigation-drawer__content) {
  overflow: hidden;
}

.task-manager-drawer__head {
  display: flex;
  align-items: center;
  padding: 12px 12px 8px 16px;
}

.task-manager-drawer__window {
  flex: 1 1 auto;
  min-height: 0;
}

.task-manager-drawer__window :deep(.v-window__container),
.task-manager-drawer__window :deep(.v-window-item) {
  height: 100%;
}

.task-manager-drawer__body {
  height: 100%;
  overflow-y: auto;
  padding: 4px 16px 16px;
}

/* 「历史」页签：满高与内部滚动交给 TaskHistoryPanel（body 自身不滚动，否则会出现双层滚动条与底部空白） */
.task-manager-drawer__body--history {
  padding: 0;
  overflow: hidden;
}

.task-manager-drawer__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.task-manager-drawer__row:last-child {
  border-bottom: none;
}

.task-manager-drawer__info {
  flex: 1 1 auto;
  min-width: 0;
}

.task-manager-drawer__title {
  display: flex;
  align-items: center;
  min-width: 0;
}

.task-manager-drawer__name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-manager-drawer__meta {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.5);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-manager-drawer__interrupt {
  flex: 0 0 auto;
}

.task-manager-drawer__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px 12px;
}

.task-manager-drawer__finished-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.5);
}
</style>
