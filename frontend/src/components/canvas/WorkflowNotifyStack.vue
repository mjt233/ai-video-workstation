<template>
  <!--
    右下角工作流完成通知气泡栈：每个完成的工作流任务一张独立卡片（不聚合），
    30 秒后自动关闭、`×` 手动关闭、最多 3 张（超出淘汰最旧，见 canvas/notify.ts）。
    抽屉（任务管理器）打开时整栈隐藏：右下角正是抽屉本体所在区域，且「历史」页签
    提供了同样的产物预览与放大能力。
  -->
  <TransitionGroup
    tag="div"
    class="workflow-notify"
    name="notify"
  >
    <v-card
      v-for="item in visibleItems"
      :key="item.taskId"
      class="workflow-notify__card"
      elevation="6"
    >
      <div class="workflow-notify__head">
        <v-icon
          :icon="item.status === 'success' ? 'mdi-check-circle' : 'mdi-alert-circle'"
          :color="item.status === 'success' ? 'success' : 'error'"
          size="16"
          class="mr-2"
        />
        <span
          class="workflow-notify__title"
          :title="item.title"
        >{{ item.title }}</span>
        <v-spacer />
        <v-btn
          icon="mdi-close"
          size="x-small"
          variant="text"
          aria-label="关闭通知"
          @click="dismissWorkflowNotify(item.taskId)"
        />
      </div>

      <div
        v-if="item.subtitle"
        class="workflow-notify__subtitle"
      >
        {{ item.subtitle }}
      </div>

      <!-- 成功：产物预览（图片/视频点击放大预览，音频内联试听） -->
      <div
        v-if="item.status === 'success'"
        class="workflow-notify__media"
      >
        <button
          v-if="item.mediaKind === 'image' && !broken[item.taskId]"
          type="button"
          class="workflow-notify__thumb"
          title="点击放大预览"
          @click="openPreview(item)"
        >
          <img
            :src="item.mediaUrl"
            alt="产物预览"
            @error="broken[item.taskId] = true"
          >
        </button>
        <button
          v-else-if="item.mediaKind === 'video' && !broken[item.taskId]"
          type="button"
          class="workflow-notify__thumb"
          title="点击放大预览"
          @click="openPreview(item)"
        >
          <video
            :src="`${item.mediaUrl}#t=0.1`"
            muted
            preload="metadata"
            @error="broken[item.taskId] = true"
          />
        </button>
        <audio
          v-else-if="item.mediaKind === 'audio'"
          class="workflow-notify__audio"
          :src="item.mediaUrl"
          controls
        />
        <!-- 文本生成产物（无文件）：文本在画布节点与任务详情中可见，此处只给指引文案 -->
        <div
          v-else-if="item.textTask"
          class="workflow-notify__text"
        >
          文本产物已完成，可在画布节点或「任务管理器 → 历史 → 任务详情」查看
        </div>
        <div
          v-else
          class="workflow-notify__fallback"
        >
          {{ fallbackTextOf(item) }}
        </div>
      </div>

      <!-- 失败：原因 + 任务管理器「历史」入口（不做任务级定位） -->
      <div
        v-else
        class="workflow-notify__error"
      >
        <span class="workflow-notify__error-text">{{ item.errorMsg }}</span>
        <v-btn
          size="x-small"
          variant="text"
          color="primary"
          @click="emit('open-manager')"
        >
          查看日志
        </v-btn>
      </div>
    </v-card>
  </TransitionGroup>

  <!-- 放大预览对话框（与任务管理器历史行共用；不参与气泡列表过渡） -->
  <CanvasMediaPreviewDialog
    v-model="preview.show"
    :url="preview.url"
    :kind="preview.kind"
    :title="preview.title"
    :file-name="preview.fileName"
  />
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import CanvasMediaPreviewDialog from './CanvasMediaPreviewDialog.vue'
import {
  dismissWorkflowNotify,
  workflowNotifications,
  type WorkflowNotifyItem,
} from '../../canvas/notify'

/**
 * 右下角完成通知气泡栈。
 *
 * 数据全部来自 `canvas/notify.ts` 的模块级 store（由 App.vue 安装的统一任务
 * 广播监听推送），本组件只负责渲染与交互，不做任何请求。
 *
 * 列表由 `TransitionGroup` 驱动：新卡片淡入上移，`×` / 30s 超时 / 抽屉打开隐藏
 * 三种移除路径共用同一套离场动画（收起占位高度，剩余卡片平滑上移）。
 */
const props = defineProps<{
  /** 是否隐藏整栈（任务管理器抽屉打开时为 true；计时不暂停，关闭抽屉后未超时的卡片继续显示） */
  hidden?: boolean
}>()

const emit = defineEmits<{
  /** 请求打开任务管理器（失败气泡「查看日志」） */
  (e: 'open-manager'): void
}>()

/** 当前气泡列表（store 直接消费，无需本地副本） */
const items = workflowNotifications

/** 实际渲染的气泡：抽屉打开时整栈置空（移除同样走离场动画，卡片保留各自剩余计时） */
const visibleItems = computed(() => (props.hidden ? [] : items.value))

/** taskId → 产物加载失败标记（图片/视频元素 error 时显示占位文案） */
const broken = reactive<Record<string, boolean>>({})

/** 放大预览对话框状态 */
const preview = reactive({
  show: false,
  url: '',
  kind: 'image' as 'image' | 'video',
  title: '',
  fileName: '',
})

/**
 * 产物文件名（放大预览标题与下载文件名）。
 *
 * @param item 气泡条目
 * @returns 路径最后一段；无产物时返回「产物」
 */
function fileNameOf(item: WorkflowNotifyItem): string {
  return item.outputPath.split('/').pop() || '产物'
}

/**
 * 无媒体元素可渲染时的占位文案。
 *
 * 文本生成产物已在模板中单独渲染（{@link textSummary}），不会走到这里。
 *
 * @param item 气泡条目
 * @returns 占位文案
 */
function fallbackTextOf(item: WorkflowNotifyItem): string {
  if (!item.outputPath) return '已完成（产物路径未知）'
  if (item.mediaKind === 'none') return `产物：${fileNameOf(item)}`
  return '产物加载失败'
}

/**
 * 打开产物放大预览（仅图片/视频）。
 *
 * @param item 气泡条目
 */
function openPreview(item: WorkflowNotifyItem): void {
  if (item.mediaKind !== 'image' && item.mediaKind !== 'video') return
  preview.url = item.mediaUrl
  preview.kind = item.mediaKind
  preview.title = `${item.title} · ${fileNameOf(item)}`
  preview.fileName = fileNameOf(item)
  preview.show = true
}
</script>

<style scoped>
.workflow-notify {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 300px;
  pointer-events: none;
}

/* ── 进出场过渡（TransitionGroup）────────────────────────────────────────────
   入场：自右下淡入并轻微上移；离场：淡出右移，同时收起自身占位高度
   （max-height + padding + 抵消 flex gap 的负 margin），使剩余卡片平滑上移。 */
.notify-enter-active {
  transition: opacity 0.22s ease-out, transform 0.22s ease-out;
}

.notify-leave-active {
  transition:
    opacity 0.18s ease-in,
    transform 0.18s ease-in,
    max-height 0.24s ease-in,
    margin 0.24s ease-in,
    padding 0.24s ease-in;
  max-height: 420px;
  overflow: hidden;
}

.notify-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
}

.notify-leave-to {
  opacity: 0;
  transform: translateX(16px);
  max-height: 0;
  margin-bottom: -8px;
  padding-top: 0;
  padding-bottom: 0;
}

.workflow-notify__card {
  pointer-events: auto;
  padding: 8px 10px 10px;
}

.workflow-notify__head {
  display: flex;
  align-items: center;
  min-width: 0;
}

.workflow-notify__title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-notify__subtitle {
  margin-top: 2px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-notify__media {
  margin-top: 6px;
}

.workflow-notify__thumb {
  display: block;
  width: 100%;
  height: 132px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  overflow: hidden;
  background: #111;
  cursor: zoom-in;
}

.workflow-notify__thumb img,
.workflow-notify__thumb video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.workflow-notify__audio {
  width: 100%;
  height: 32px;
}

.workflow-notify__fallback {
  padding: 10px;
  border: 1px dashed rgba(0, 0, 0, 0.18);
  border-radius: 4px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.55);
  word-break: break-all;
}

/* 文本生成产物（无文件）：浅底说明条（指引用户到画布节点/任务详情看全文） */
.workflow-notify__text {
  padding: 10px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(0, 0, 0, 0.7);
  background: rgba(var(--v-theme-primary), 0.06);
  border: 1px solid rgba(var(--v-theme-primary), 0.24);
}

.workflow-notify__error {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin-top: 4px;
}

.workflow-notify__error-text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: #c62828;
  word-break: break-all;
}
</style>
