<template>
  <v-dialog
    :model-value="modelValue"
    max-width="900"
    @update:model-value="onDialogUpdate"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          class="mr-2"
          size="small"
        >
          mdi-history
        </v-icon>
        <span>文本历史版本</span>
        <span
          v-if="node"
          class="text-body-small text-grey ml-2"
        >
          {{ node.name }}
        </span>
      </v-card-title>
      <v-card-text>
        <div
          v-if="rows.length === 0"
          class="text-grey text-body-medium"
        >
          暂无历史版本。每次 AI 响应正常结束后会自动保存一个版本（含当时的输入与输出）；最多保留
          {{ MAX_TEXT_HISTORY_VERSIONS }} 条，超出自动丢弃最旧。
        </div>
        <div
          v-else
          class="ai-text-history"
        >
          <!-- 左侧：选中版本的详情（时间/模型等元信息 + 当时的输入/输出） -->
          <div class="ai-text-history__detail">
            <div
              v-if="selected"
              class="ai-text-history__detail-inner"
            >
              <div class="text-body-small text-medium-emphasis mb-1">
                {{ formatDate(selected.createdAt) }}
              </div>
              <div
                v-if="metaChips.length > 0"
                class="mb-2"
              >
                <v-chip
                  v-for="chip in metaChips"
                  :key="chip.label"
                  size="x-small"
                  variant="tonal"
                  class="mr-1"
                  :title="chip.tooltip"
                >
                  {{ chip.label }}
                </v-chip>
              </div>
              <div class="ai-text-history__field-title">
                当时的输入
              </div>
              <div
                class="ai-text-history__text"
                :class="{ 'ai-text-history__text--empty': !selected.input }"
              >
                {{ selected.input || '（空）' }}
              </div>
              <div class="ai-text-history__field-title mt-2">
                当时的输出
              </div>
              <div
                class="ai-text-history__text ai-text-history__text--output"
                :class="{ 'ai-text-history__text--empty': !selected.output }"
              >
                {{ selected.output || '（空）' }}
              </div>
            </div>
          </div>
          <!-- 右侧：版本列表（最新在前） -->
          <v-list
            class="ai-text-history__list"
            density="compact"
          >
            <v-list-item
              v-for="h in rows"
              :key="h.id"
              :active="selectedId === h.id"
              @click="selectedId = h.id"
            >
              <template #prepend>
                <v-icon
                  icon="mdi-text-box-outline"
                  size="small"
                  class="ai-text-history__row-icon"
                />
              </template>
              <v-list-item-title class="text-body-medium">
                {{ formatDate(h.createdAt) }}
              </v-list-item-title>
              <v-list-item-subtitle class="ai-text-history__row-excerpt">
                {{ outputExcerpt(h) }}
              </v-list-item-subtitle>
              <template #append>
                <div class="ai-text-history__row-actions">
                  <v-btn
                    size="x-small"
                    variant="tonal"
                    color="primary"
                    title="把该版本的输出设为当前 AI 响应"
                    @click.stop="setAsCurrent(h)"
                  >
                    设为当前
                  </v-btn>
                  <v-btn
                    size="x-small"
                    variant="text"
                    color="error"
                    icon="mdi-delete-outline"
                    title="删除该版本"
                    @click.stop="deleteEntry(h)"
                  />
                </div>
              </template>
            </v-list-item>
          </v-list>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="closeDialog"
        >
          关闭
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../canvas/types'
import {
  MAX_TEXT_HISTORY_VERSIONS,
  readTextHistory,
  removeTextHistory,
  type AiTextHistoryEntry,
} from '../../canvas/aiTextHistory'
import { confirm } from '../../utils/confirm'

/** 组件 props：显隐、项目名（兼容画布层调用约定）、目标节点（null 时空态） */
const props = defineProps<{
  modelValue: boolean
  project: string
  node: CanvasNodeData | null
}>()

/** 组件 emits：显隐同步；config 写回（设为当前走正常可撤销更新，删除走静默更新）；操作反馈 */
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'update:config-quiet', patch: Record<string, unknown>): void
  (e: 'notify', text: string, color: 'success' | 'error' | 'primary'): void
}>()

/** 当前选中的版本 id（打开时默认最新一条） */
const selectedId = ref<string | null>(null)

/** 历史版本原始数组（config.outputHistory，末尾为最新；数据即 config，无需服务端请求） */
const rawEntries = computed<AiTextHistoryEntry[]>(() => readTextHistory(props.node?.config ?? {}))

/** 展示用版本列表（最新在前） */
const rows = computed(() => [...rawEntries.value].reverse())

/** 当前选中版本 */
const selected = computed(() => rows.value.find((h) => h.id === selectedId.value) ?? null)

/** 选中版本的元信息 chips（模型 / 预设 / 媒体输入数量） */
const metaChips = computed<{ label: string; tooltip: string }[]>(() => {
  const s = selected.value
  if (!s) return []
  const chips: { label: string; tooltip: string }[] = []
  if (s.modelName) chips.push({ label: `模型：${s.modelName}`, tooltip: s.modelName })
  if (s.presetName) chips.push({ label: `预设：${s.presetName}`, tooltip: `当时使用了预设提示词「${s.presetName}」` })
  if (s.mediaLabels && s.mediaLabels.length > 0) {
    chips.push({
      label: `媒体输入 ×${s.mediaLabels.length}`,
      tooltip: `当时的媒体输入：${s.mediaLabels.join('、')}`,
    })
  }
  return chips
})

/** 列表行输出节选（去换行的首行，超长省略） */
function outputExcerpt(h: AiTextHistoryEntry): string {
  const first = h.output.split('\n')[0] ?? ''
  return first.length > 40 ? `${first.slice(0, 40)}…` : first || '（空）'
}

/** 打开对话框时选中最新版本；关闭时清空选中（immediate：挂载即打开（modelValue 初始为 true）时也要初始化选中） */
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      selectedId.value = rows.value[0]?.id ?? null
    } else {
      selectedId.value = null
    }
  },
  { immediate: true },
)

/**
 * 「设为当前」：仅把该版本的输出写回为当前 AI 响应（config.output）。
 * 走正常可撤销更新；节点主体监听 config 变化后同步刷新展示，下游引用文本随之更新。
 *
 * @param h 目标历史版本
 */
function setAsCurrent(h: AiTextHistoryEntry): void {
  emit('update:config', { output: h.output })
  emit('notify', '已设为当前版本', 'success')
}

/**
 * 「删除」：确认后静默移除该版本（不入撤销栈，删除不可撤销）。
 * 成功后对话框保持打开并刷新列表。
 *
 * @param h 目标历史版本
 */
async function deleteEntry(h: AiTextHistoryEntry): Promise<void> {
  const ok = await confirm({
    title: '删除历史版本',
    content: `确定删除 ${formatDate(h.createdAt)} 的历史版本吗？此操作不可撤销。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  emit('update:config-quiet', { outputHistory: removeTextHistory(rawEntries.value, h.id) })
  if (selectedId.value === h.id) {
    selectedId.value = rows.value[0]?.id ?? null
  }
  emit('notify', '已删除历史版本', 'success')
}

/** 内部 v-dialog 显隐变化 → 透传父组件 */
function onDialogUpdate(v: unknown): void {
  emit('update:modelValue', Boolean(v))
}

/** 关闭对话框 */
function closeDialog(): void {
  emit('update:modelValue', false)
}

/** 格式化 ISO 时间为本地可读文本 */
function formatDate(iso: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('zh-CN')
  } catch {
    return iso
  }
}
</script>

<style scoped>
/* 主体：左详情 + 右列表双栏 */
.ai-text-history {
  display: flex;
  gap: 16px;
  align-items: stretch;
}

/* 左栏：选中版本详情（固定宽度，输入/输出文本区纵向排布） */
.ai-text-history__detail {
  flex: none;
  width: 380px;
  max-width: 55%;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.02);
  overflow: hidden;
  max-height: 420px;
}

.ai-text-history__detail-inner {
  padding: 10px;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.ai-text-history__field-title {
  flex: 0 0 auto;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.55);
  padding-bottom: 2px;
}

/* 输入/输出只读文本区 */
.ai-text-history__text {
  flex: 1 1 auto;
  min-height: 80px;
  max-height: 170px;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.6;
  padding: 6px 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 4px;
  background: #fff;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}

.ai-text-history__text--output {
  background: rgba(25, 118, 210, 0.03);
}

.ai-text-history__text--empty {
  color: rgba(0, 0, 0, 0.38);
  background: rgba(0, 0, 0, 0.02);
}

/* 右栏：版本列表 */
.ai-text-history__list {
  flex: 1;
  min-width: 0;
  max-height: 420px;
  overflow-y: auto;
}

.ai-text-history__row-icon {
  color: rgba(0, 0, 0, 0.38);
}

.ai-text-history__row-excerpt {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: inherit;
}

.ai-text-history__row-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
</style>
