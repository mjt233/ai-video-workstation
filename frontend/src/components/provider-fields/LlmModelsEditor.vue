<template>
  <div class="llm-models-editor">
    <!-- 头部：标题 + 一键获取模型列表 -->
    <div class="d-flex align-center">
      <div class="text-body-medium font-weight-medium">
        {{ label }}
      </div>
      <v-spacer />
      <v-btn
        color="primary"
        variant="tonal"
        size="small"
        :loading="fetching"
        :disabled="!canFetch"
        :title="canFetch ? '获取服务商模型列表并自动匹配元信息' : '需先填写协议类型、BaseURL 与 API Key'"
        @click="openFetchDialog"
      >
        <v-icon
          icon="mdi-download"
          size="small"
          class="mr-1"
        />
        一键获取模型列表
      </v-btn>
    </div>
    <div
      v-if="description"
      class="text-caption text-medium-emphasis mt-1"
    >
      {{ description }}
    </div>
    <div
      v-else-if="!canFetch"
      class="text-caption text-medium-emphasis mt-1"
    >
      填写协议类型、BaseURL 与 API Key 后可「一键获取模型列表」（编辑模式自动沿用已保存的 API Key）。
    </div>
    <!-- 一键获取添加结果提示 -->
    <v-alert
      v-if="applyNotice"
      type="success"
      density="compact"
      class="mt-2 mb-0"
      :text="applyNotice"
      closable
      @click:close="applyNotice = ''"
    />

    <!-- 已配置模型列表 -->
    <div
      v-if="models.length === 0"
      class="text-caption text-medium-emphasis py-2"
    >
      尚未配置模型：可手动点击「添加模型」，或先「一键获取模型列表」后勾选添加。
    </div>
    <v-card
      v-for="(m, idx) in models"
      :key="idx"
      variant="outlined"
      density="compact"
      class="mt-2"
    >
      <v-card-text class="py-2">
        <!-- 行 1：模型 id / 显示名称 / 删除 -->
        <div class="d-flex align-center gap-2">
          <v-text-field
            v-model="m.modelId"
            label="模型 id"
            placeholder="如 glm-5.3-flash"
            variant="outlined"
            density="compact"
            hide-details
            class="flex-grow-1 llm-models-editor__field"
            @input="onChange"
          />
          <v-text-field
            v-model="m.name"
            label="显示名称"
            placeholder="如 GLM 5.3 Flash"
            variant="outlined"
            density="compact"
            hide-details
            class="flex-grow-1 llm-models-editor__field"
            @input="onChange"
          />
          <v-btn
            icon="mdi-delete"
            size="small"
            variant="text"
            color="error"
            title="删除模型"
            @click="onDeleteRow(idx)"
          />
        </div>
        <!-- 行 2：上下文窗口 + 思考强度 + tool call -->
        <div class="d-flex align-center flex-wrap gap-2 mt-1">
          <v-text-field
            v-model="m.meta.contextWindow"
            label="上下文窗口"
            placeholder="128K / 1M / 128000"
            variant="outlined"
            density="compact"
            hide-details
            class="llm-models-editor__field llm-models-editor__ctx"
            :error="!contextWindowValid(m.meta.contextWindow)"
            :error-messages="contextWindowValid(m.meta.contextWindow) ? undefined : '格式：纯数字或 K/M（如 128000、128K、1M）'"
            @input="onChange"
          />
          <v-text-field
            v-model="m.meta.reasoningLevels"
            label="思考强度挡位"
            placeholder="low,medium,high（留空=不支持）"
            variant="outlined"
            density="compact"
            hide-details
            class="llm-models-editor__field llm-models-editor__levels"
            @input="onChange"
          />
          <v-switch
            v-model="m.meta.toolCall"
            label="tool call"
            color="primary"
            density="compact"
            hide-details
            class="mt-0"
            @update:model-value="onChange"
          />
        </div>
        <!-- 行 3：输入模态（图标+文字，v-checkbox） -->
        <div class="d-flex align-center flex-wrap mt-1">
          <span class="text-caption text-medium-emphasis mr-2">输入模态：</span>
          <v-checkbox
            v-for="mod in MODALITIES"
            :key="mod.key"
            :model-value="m.meta.inputModalities.includes(mod.key)"
            density="compact"
            hide-details
            class="mt-0 mr-2"
            @update:model-value="(v: boolean | null) => toggleModality(m, mod.key, !!v)"
          >
            <template #label>
              <v-icon
                :icon="mod.icon"
                size="x-small"
                class="mr-1"
              />
              {{ mod.label }}
            </template>
          </v-checkbox>
        </div>
      </v-card-text>
    </v-card>
    <v-btn
      variant="text"
      size="small"
      prepend-icon="mdi-plus"
      class="mt-2"
      @click="addRow"
    >
      添加模型
    </v-btn>

    <!-- 一键获取模型列表对话框 -->
    <v-dialog
      v-model="fetchDialogOpen"
      max-width="760"
      persistent
    >
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon
            icon="mdi-download"
            class="mr-2"
          />
          获取模型列表
          <v-spacer />
          <v-btn
            icon="mdi-close"
            size="small"
            variant="text"
            @click="fetchDialogOpen = false"
          />
        </v-card-title>
        <v-card-text>
          <!-- 加载中 -->
          <div
            v-if="fetching"
            class="d-flex flex-column align-center justify-center pa-8"
          >
            <v-progress-circular indeterminate />
            <div class="text-body-2 text-medium-emphasis mt-3">
              正在获取模型列表与元数据…
            </div>
          </div>
          <!-- 错误 -->
          <v-alert
            v-else-if="fetchError"
            type="error"
            class="mb-3"
            :text="fetchError"
            closable
            @click:close="fetchError = ''"
          />
          <!-- 列表 -->
          <template v-else>
            <div class="d-flex align-center mb-1">
              <span class="text-caption text-medium-emphasis">
                共 {{ fetched.length }} 个模型，勾选后点击「确定」添加到配置列表（已存在同 id 模型将跳过）。
              </span>
            </div>
            <div
              v-if="fetched.length === 0"
              class="text-body-2 text-medium-emphasis text-center pa-6"
            >
              未获取到模型；请检查协议类型、BaseURL 与 API Key。
            </div>
            <div class="llm-models-editor__fetch-list">
              <div
                v-for="m in fetched"
                :key="m.modelId"
                class="llm-models-editor__fetch-item"
                :class="{ 'llm-models-editor__fetch-item--checked': selectedIds.includes(m.modelId) }"
              >
                <v-checkbox
                  :model-value="selectedIds.includes(m.modelId)"
                  density="compact"
                  hide-details
                  class="mt-0"
                  @update:model-value="(v: boolean | null) => toggleSelect(m.modelId, !!v)"
                />
                <div class="flex-grow-1 min-width-0">
                  <div class="text-body-2 font-weight-medium">
                    {{ m.name || m.modelId }}
                    <span class="text-caption text-medium-emphasis">{{ m.modelId }}</span>
                  </div>
                  <div class="d-flex align-center flex-wrap">
                    <span
                      v-for="mod in metaModalities(m)"
                      :key="mod"
                      class="llm-models-editor__meta-chip"
                      :title="mod"
                    >
                      <v-icon
                        :icon="MODALITY_ICONS[mod] ?? 'mdi-help-circle-outline'"
                        size="x-small"
                        class="mr-1"
                      />
                      {{ MODALITY_LABELS[mod] ?? mod }}
                    </span>
                    <span
                      v-if="m.meta?.contextWindow"
                      class="llm-models-editor__meta-chip"
                      title="上下文窗口"
                    >
                      <v-icon
                        icon="mdi-gauge"
                        size="x-small"
                        class="mr-1"
                      />
                      {{ formatContextWindow(m.meta.contextWindow) }}
                    </span>
                    <span
                      class="llm-models-editor__meta-chip"
                      :class="m.meta?.toolCall ? '' : 'llm-models-editor__meta-chip--off'"
                      :title="m.meta?.toolCall ? '支持 tool call' : '不支持 tool call'"
                    >
                      <v-icon
                        :icon="m.meta?.toolCall ? 'mdi-check-decagram-outline' : 'mdi-close-circle-outline'"
                        size="x-small"
                        class="mr-1"
                      />
                      tool call
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="fetchDialogOpen = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :disabled="fetching || selectedIds.length === 0"
            @click="applySelected"
          >
            确定（{{ selectedIds.length }}）
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fetchLlmModels, type LlmCatalogModel, type LlmConfiguredModel } from '../../api/llm'
import { confirm } from '../../utils/confirm'
import { formatContextWindow, isValidContextWindow } from '../../utils/llmContextWindow'
import { MODALITY_ICONS, MODALITY_LABELS } from '../../utils/llmModality'

const props = defineProps<{
  /** 模型列表值（ProviderConfigValue：对象数组） */
  modelValue: unknown
  /** 字段中文标签 */
  label?: string
  /** 字段说明 */
  description?: string
  /** schema 字段名 */
  name?: string
  /** 同表单配置（协议/BaseURL/API Key 前提校验） */
  formConfig?: Record<string, unknown>
  /** 编辑模式实例 id（apiKey 为空时服务端回填） */
  instanceId?: string
}>()

const emit = defineEmits<{
  (e: 'update:model-value', value: unknown): void
}>()

/** 输入模态定义（图标+文字） */
const MODALITIES: { key: string; label: string; icon: string }[] = [
  { key: 'text', label: MODALITY_LABELS.text ?? '文本', icon: MODALITY_ICONS.text ?? 'mdi-format-text' },
  { key: 'image', label: MODALITY_LABELS.image ?? '图片', icon: MODALITY_ICONS.image ?? 'mdi-image-outline' },
  { key: 'audio', label: MODALITY_LABELS.audio ?? '音频', icon: MODALITY_ICONS.audio ?? 'mdi-music-note' },
  { key: 'video', label: MODALITY_LABELS.video ?? '视频', icon: MODALITY_ICONS.video ?? 'mdi-video-outline' },
]

/** 可编辑模型条目（meta 恒存在，避免模板空值判断） */
interface EditableModel {
  modelId: string
  name: string
  meta: { contextWindow: string; inputModalities: string[]; reasoningLevels: string; toolCall: boolean }
}

/** 本地模型列表（深拷贝 prop，meta 规范化） */
const models = ref<EditableModel[]>([])

/** 获取对话框状态 */
const fetchDialogOpen = ref(false)
const fetching = ref(false)
const fetchError = ref('')
const fetched = ref<LlmCatalogModel[]>([])
/** 勾选中的模型 id */
const selectedIds = ref<string[]>([])
/** 添加结果提示 */
const applyNotice = ref('')

watch(
  () => props.modelValue,
  (v) => {
    if (Array.isArray(v)) {
      models.value = (v as LlmConfiguredModel[]).map((m) => ({
        modelId: typeof m.modelId === 'string' ? m.modelId : '',
        name: typeof m.name === 'string' ? m.name : '',
        meta: {
          // 上下文字段按 K/M 展示（纯数字会转为 128K/1M 等；两种形式均可再编辑）
          contextWindow: m.meta?.contextWindow ? formatContextWindow(m.meta.contextWindow) : '',
          inputModalities: Array.isArray(m.meta?.inputModalities) ? [...m.meta.inputModalities] : ['text'],
          reasoningLevels: m.meta?.reasoningLevels ?? '',
          toolCall: !!m.meta?.toolCall,
        },
      }))
    } else {
      models.value = []
    }
  },
  { immediate: true },
)

/** 上下文窗口输入是否合法 */
function contextWindowValid(raw: string): boolean {
  return isValidContextWindow(raw)
}

/** 一键获取前提：协议/BaseURL/API Key 已填（编辑模式 apiKey 空时用已保存值） */
const canFetch = computed(() => {
  const cfg = props.formConfig ?? {}
  const protocol = typeof cfg.protocol === 'string' ? cfg.protocol.trim() : ''
  const baseUrl = typeof cfg.baseUrl === 'string' ? cfg.baseUrl.trim() : ''
  const apiKey = typeof cfg.apiKey === 'string' ? cfg.apiKey.trim() : ''
  return !!protocol && !!baseUrl && (!!apiKey || !!props.instanceId)
})

/** 上抛变更（整体替换数组） */
function onChange(): void {
  emit('update:model-value', JSON.parse(JSON.stringify(models.value)))
}

/** 添加空模型行 */
function addRow(): void {
  models.value.push({
    modelId: '',
    name: '',
    meta: { contextWindow: '', inputModalities: ['text'], reasoningLevels: '', toolCall: false },
  })
  onChange()
}

/** 删除模型行（弹窗确认） */
async function onDeleteRow(idx: number): Promise<void> {
  const m = models.value[idx]
  if (!m) return
  const label = m.modelId || m.name || `第 ${idx + 1} 项`
  const ok = await confirm({
    title: '删除模型',
    content: `确定从模型列表删除「${label}」？`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  models.value.splice(idx, 1)
  onChange()
}

/** 切换输入模态 */
function toggleModality(m: LlmConfiguredModel, key: string, on: boolean): void {
  const set = new Set(m.meta?.inputModalities ?? [])
  if (on) set.add(key)
  else set.delete(key)
  if (m.meta) m.meta.inputModalities = [...set]
  onChange()
}

/** 打开获取对话框并请求 */
async function openFetchDialog(): Promise<void> {
  fetchDialogOpen.value = true
  fetching.value = true
  fetchError.value = ''
  fetched.value = []
  selectedIds.value = []
  try {
    const cfg = props.formConfig ?? {}
    fetched.value = await fetchLlmModels({
      protocol: String(cfg.protocol ?? ''),
      baseUrl: String(cfg.baseUrl ?? ''),
      apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey : '',
      instanceId: props.instanceId,
    })
  } catch (e) {
    fetchError.value = e instanceof Error ? e.message : String(e)
  } finally {
    fetching.value = false
  }
}

/** 勾选模型 */
function toggleSelect(modelId: string, on: boolean): void {
  if (on) {
    if (!selectedIds.value.includes(modelId)) selectedIds.value.push(modelId)
  } else {
    selectedIds.value = selectedIds.value.filter((id) => id !== modelId)
  }
}

/** 获取列表条目元信息展示：输入模态（未知时默认文本） */
function metaModalities(m: LlmCatalogModel): string[] {
  const mods = m.meta?.inputModalities?.filter((x) => MODALITY_ICONS[x]) ?? []
  return mods.length > 0 ? mods : ['text']
}

/** 确定：把勾选模型追加到配置列表（跳过重复） */
function applySelected(): void {
  let skipped = 0
  let added = 0
  for (const item of fetched.value) {
    if (!selectedIds.value.includes(item.modelId)) continue
    if (models.value.some((m) => m.modelId === item.modelId)) {
      skipped += 1
      continue
    }
    models.value.push({
      modelId: item.modelId,
      name: item.name || item.modelId,
      meta: {
        // 元信息回填：上下文按 K/M 展示（如 1048576 → 1M）
        contextWindow: item.meta?.contextWindow ? formatContextWindow(item.meta.contextWindow) : '',
        // 未获取到元信息时保留空（用户可手动补充），默认文本模态
        inputModalities: item.meta?.inputModalities ?? [],
        reasoningLevels: item.meta?.reasoningLevels ?? '',
        toolCall: !!item.meta?.toolCall,
      },
    })
    added += 1
  }
  onChange()
  fetchDialogOpen.value = false
  applyNotice.value = added > 0
    ? `已添加 ${added} 个模型${skipped > 0 ? `，跳过 ${skipped} 个重复模型` : ''}`
    : (skipped > 0 ? `全部 ${skipped} 个模型已存在，未添加` : '')
}
</script>

<style scoped>
.gap-2 {
  gap: 8px;
}

.min-width-0 {
  min-width: 0;
}

.llm-models-editor__field {
  max-width: 260px;
}

.llm-models-editor__ctx {
  max-width: 190px;
}

.llm-models-editor__levels {
  max-width: 230px;
}

/* 获取列表：滚动容器 */
.llm-models-editor__fetch-list {
  max-height: 55vh;
  overflow-y: auto;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
}

.llm-models-editor__fetch-item {
  display: flex;
  align-items: flex-start;
  padding: 2px 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.llm-models-editor__fetch-item--checked {
  background: rgba(25, 118, 210, 0.06);
}

.llm-models-editor__meta-chip {
  display: inline-flex;
  align-items: center;
  margin-right: 8px;
  padding: 0 6px;
  font-size: 11px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 8px;
  color: rgba(0, 0, 0, 0.75);
}

.llm-models-editor__meta-chip--off {
  opacity: 0.55;
}
</style>
