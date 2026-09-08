<template>
  <!-- AI 文本生成节点自定义状态遮罩（非阻塞轻量形态）：
       仅接入标准状态机（statusByNode），遮罩容器 pointer-events: none 不拦截
       流式输出与节点内「停止」按钮；仅「中断」按钮自身可点击。 -->
  <div
    class="ai-status-overlay"
    :class="{ 'ai-status-overlay--error': status?.status === 'error' }"
  >
    <template v-if="status?.status === 'running'">
      <div class="ai-status-overlay__row">
        <v-progress-circular
          :size="14"
          :width="2"
          indeterminate
          color="primary"
        />
        <span class="ai-status-overlay__log">{{ status.lastLog || '正在生成…' }}</span>
      </div>
      <v-btn
        size="x-small"
        variant="tonal"
        color="primary"
        class="ai-status-overlay__btn"
        @click.stop="emit('interrupt', node.id)"
      >
        中断
      </v-btn>
    </template>
    <template v-else-if="status?.status === 'error'">
      <div class="ai-status-overlay__error">
        <v-icon
          icon="mdi-alert-circle-outline"
          color="error"
          size="16"
        />
        <span class="ai-status-overlay__errtext">
          {{ status.errorMsg || '生成失败' }}（可点击节点内「生成」重试）
        </span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { CanvasNodeData } from '../../../canvas/types'
import type { GenerateStatus } from '../../../canvas/useCanvasGeneration'

/**
 * AI 文本生成节点自定义状态遮罩（NodePrototype.statusOverlay 注册）。
 *
 * 节点原型声明后由 CanvasNodeCard 在 running/error 态渲染本组件（替代默认
 * 整体遮罩）：running 显示 spinner + 阶段日志 + 「中断」按钮；error 显示非阻塞
 * 红字提示（遮罩不拦截指针，用户可直接点击节点内「生成」重试）。
 */

const props = defineProps<{
  /** 生成状态（标准状态机注入） */
  status?: GenerateStatus
  /** 节点数据（中断 emits 携带节点 id） */
  node: CanvasNodeData
  /** 项目名（预留：与默认遮罩一致的 props 契约） */
  project: string
}>()

const emit = defineEmits<{
  /** 「中断」按钮（与默认遮罩一致的统一中断入口） */
  (e: 'interrupt', nodeId: string): void
  /** 「重试」按钮（本遮罩不渲染；保留 emits 契约与默认遮罩一致） */
  (e: 'retry', nodeId: string): void
}>()
</script>

<style scoped>
/* 非阻塞轻量遮罩：容器不拦截指针（仅 .ai-status-overlay__btn 可点击） */
.ai-status-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 8px;
  pointer-events: none;
  background: transparent;
}

.ai-status-overlay__row {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 90%;
}

.ai-status-overlay__log {
  font-size: 11px;
  color: rgb(25, 118, 210);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 仅「中断」按钮自身可点击（与默认遮罩一致 emit interrupt(nodeId)） */
.ai-status-overlay__btn {
  pointer-events: auto;
}

.ai-status-overlay__error {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  max-width: 92%;
}

.ai-status-overlay__errtext {
  font-size: 11px;
  line-height: 1.4;
  color: rgb(211, 47, 47);
}
</style>
