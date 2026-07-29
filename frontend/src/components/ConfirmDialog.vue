<template>
  <v-dialog
    :model-value="state.open"
    :max-width="state.maxWidth"
    persistent
    @update:model-value="onModelUpdate"
  >
    <v-card>
      <v-card-title>
        {{ state.title }}
      </v-card-title>
      <v-card-text class="text-body-2">
        {{ state.content }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="resolveConfirm(false)"
        >
          {{ state.cancelText }}
        </v-btn>
        <v-btn
          :color="state.confirmColor"
          @click="resolveConfirm(true)"
        >
          {{ state.confirmText }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * 全局确认对话框宿主：配合 utils/confirm 的 Promise API 使用。
 * 应在 App 根节点挂载一次。
 */
import { getConfirmState, resolveConfirm } from '../utils/confirm'

const state = getConfirmState()

/**
 * 处理对话框关闭（如 Esc）；视为取消。
 * @param open 是否打开
 */
function onModelUpdate(open: boolean) {
  if (!open) resolveConfirm(false)
}
</script>
