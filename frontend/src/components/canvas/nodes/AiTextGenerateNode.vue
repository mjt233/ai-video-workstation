<template>
  <div class="ai-text-node">
    <!-- 生成中状态条（节点顶部） -->
    <div
      v-if="generating"
      class="ai-text-node__thinking"
    >
      <v-progress-circular
        :size="12"
        :width="2"
        indeterminate
        color="primary"
      />
      <span class="ml-1">Thinking...</span>
    </div>

    <!-- 首行：模型下拉（v-select，按服务商分组）+ 思考强度 -->
    <div class="ai-text-node__top">
      <!-- 模型下拉：普通 v-select，按服务商分组；选项 subtitle 显示输入模态图标 + 上下文大小 -->
      <v-select
        :model-value="selectedModelKey"
        :items="modelItems"
        item-title="title"
        item-value="value"
        placeholder="选择模型"
        density="compact"
        variant="outlined"
        hide-details
        prepend-inner-icon="mdi-robot-outline"
        class="ai-text-node__model-select"
        :disabled="generating"
        @update:model-value="onModelSelect"
      >
        <template #item="{ item, props: itemProps }">
          <v-list-item v-bind="itemProps">
            <template
              v-if="(item.modalities?.length ?? 0) > 0 || !!item.ctxText"
              #subtitle
            >
              <span class="ai-text-node__model-subtitle">
                <v-icon
                  v-for="mod in (item.modalities ?? [])"
                  :key="mod"
                  :icon="MODALITY_ICONS[mod] ?? 'mdi-help-circle-outline'"
                  size="x-small"
                  class="ai-text-node__model-subtitle-icon"
                  :title="MODALITY_LABELS[mod] ?? mod"
                />
                <span
                  v-if="item.ctxText"
                  class="ai-text-node__model-subtitle-ctx"
                >
                  {{ item.ctxText }}
                </span>
              </span>
            </template>
          </v-list-item>
        </template>
      </v-select>

      <!-- 思考强度（v-menu，选项 = 所选模型的思考强度挡位） -->
      <v-menu
        v-model="effortMenuOpen"
        :close-on-content-click="true"
        location="bottom start"
      >
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            size="small"
            variant="outlined"
            class="ai-text-node__pick"
            :disabled="generating || effortOptions.length === 0"
            :title="effortBtnTitle"
          >
            <v-icon
              icon="mdi-brain"
              size="x-small"
              class="mr-1"
            />
            <span>{{ effortLabel }}</span>
          </v-btn>
        </template>
        <v-list
          density="compact"
          class="ai-text-node__menu"
        >
          <v-list-item
            :title="'不设置'"
            :active="!selectedEffort"
            @click="selectEffort('')"
          />
          <v-list-item
            v-for="lv in effortOptions"
            :key="lv"
            :title="lv"
            :active="selectedEffort === lv"
            @click="selectEffort(lv)"
          />
        </v-list>
      </v-menu>
    </div>

    <!-- 预设提示词行：模型行下方整行下拉（系统配置 → 预设提示词） -->
    <div class="ai-text-node__preset">
      <v-select
        :model-value="selectedPresetKey"
        :items="presetItems"
        item-title="title"
        item-value="value"
        placeholder="不使用预设提示词"
        density="compact"
        variant="outlined"
        hide-details
        prepend-inner-icon="mdi-text-box-multiple-outline"
        :disabled="generating"
        @update:model-value="onPresetSelect"
      >
        <template #item="{ item, props: itemProps }">
          <v-list-item v-bind="itemProps">
            <template #title>
              <span>{{ item.title }}</span>
            </template>
          </v-list-item>
        </template>
      </v-select>
    </div>

    <!-- 媒体输入预览（复用生成图片/视频节点的统一输入预览组件） -->
    <div
      v-if="mediaCount > 0"
      class="ai-text-node__media-preview nodrag nowheel"
    >
      <CanvasInputPreview
        :project="project"
        :images-inputs="mediaByType.images"
        :videos-inputs="mediaByType.videos"
        :audios-inputs="mediaByType.audios"
        drag-hint="拖拽调整顺序"
        @reorder="onMediaReorder"
        @remove="(input) => emit('disconnect-input', input.nodeId)"
      />
    </div>

    <!-- 中部：用户输入 | AI 响应（1:1 自适应） -->
    <div class="ai-text-node__main">
      <div class="ai-text-node__pane">
        <div class="ai-text-node__pane-title">
          用户输入
          <span
            v-if="activePreset"
            class="ai-text-node__preset-tip"
          >
            生成时将替换到预设提示词 {user_prompt}
          </span>
          <span
            v-if="textInputCount > 1"
            class="ai-text-node__warn"
          >
            存在多个文本连线输入（{{ textInputCount }} 个），生成已禁用，请仅保留一个
          </span>
        </div>
        <textarea
          :value="userInputDisplay"
          class="ai-text-node__area nodrag nowheel"
          :class="{ 'ai-text-node__area--disabled': userInputDisabled }"
          :disabled="userInputDisabled"
          :placeholder="userInputPlaceholder"
          spellcheck="false"
          @input="onInputText"
        />
      </div>
      <div class="ai-text-node__pane">
        <div class="ai-text-node__pane-title ai-text-node__pane-title--actions">
          <span class="ai-text-node__pane-title-text">
            AI 响应
            <span
              v-if="warnings.length > 0"
              class="ai-text-node__warn"
            >
              {{ warnings.join('；') }}
            </span>
          </span>
          <v-btn
            icon="mdi-history"
            size="x-small"
            variant="text"
            class="ai-text-node__history-btn"
            title="历史版本（每次 AI 响应结束后自动保存，可查看当时的输入与输出）"
            @click.stop="emit('open-history')"
          />
        </div>
        <textarea
          ref="outputEl"
          class="ai-text-node__area ai-text-node__area--output nodrag nowheel"
          :class="{ 'ai-text-node__area--error': !!errorMsg }"
          :value="outputText || (errorMsg ?? '')"
          :readonly="outputAreaReadonly"
          placeholder="生成结果将流式显示在此；响应结束后可直接手动编辑"
          spellcheck="false"
          @input="onOutputEdit"
          @scroll="onOutputScroll"
        />
      </div>
    </div>

    <!-- 底行：生成 / 停止 -->
    <div class="ai-text-node__bottom">
      <span
        v-if="hint"
        class="ai-text-node__hint"
      >
        {{ hint }}
      </span>
      <v-spacer />
      <v-btn
        icon="mdi-play"
        size="small"
        variant="tonal"
        color="primary"
        :disabled="generating || !canGenerate"
        title="生成"
        @click="onGenerate"
      />
      <v-btn
        icon="mdi-stop"
        size="small"
        variant="tonal"
        color="error"
        :disabled="!generating"
        title="停止"
        class="ml-1"
        @click="onStop"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import { mergeInputOrder as mergeGlobalInputOrder } from '../../../canvas/generate'
import { chatLlmStream } from '../../../api/llm'
import { useLlmProviders } from '../../../composables/useLlmProviders'
import { usePresetPrompts } from '../../../composables/usePresetPrompts'
import { formatContextWindow } from '../../../utils/llmContextWindow'
import { MODALITY_ICONS, MODALITY_LABELS } from '../../../utils/llmModality'
import { composePresetPrompt } from '../../../utils/presetPrompt'
import { appendTextHistory, createTextHistoryEntry, readTextHistory } from '../../../canvas/aiTextHistory'
import type { LlmMediaInputItem } from '../composables/useCanvasNodeOps'
import CanvasInputPreview from '../editors/CanvasInputPreview.vue'

const props = defineProps<{
  project: string
  node: CanvasNodeData
  /** 媒体输入（来源节点输出类型为图片/音频/视频；单一输入口按来源类型归类） */
  inputs?: LlmMediaInputItem[]
  /** 文本输入内容（来源为「文本」节点，取其 config.text） */
  textInputs?: string[]
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'update:config-quiet', patch: Record<string, unknown>): void
  (e: 'disconnect-input', sourceNodeId: string): void
  /** 打开该节点的文本历史版本对话框（父级经 CanvasNodeCard 转发到画布层） */
  (e: 'open-history'): void
}>()

/** 大语言模型服务商选项（共享缓存） */
const providerOptions = useLlmProviders()

/** 预设提示词列表（共享缓存；系统配置 → 预设提示词） */
const presetPrompts = usePresetPrompts()

/** 流式输出节流间隔（毫秒；流式期间写入 config 的限流） */
const STREAM_COMMIT_THROTTLE_MS = 500

/** 生成中（禁用用户控件） */
const generating = ref(false)
/** 生成错误信息（响应区红字） */
const errorMsg = ref('')
/** 生成提示信息（底部 hint，如媒体输入被忽略） */
const hint = ref('')
/** 收集到的警告（媒体输入被忽略等） */
const warnings = ref<string[]>([])
/** 思考强度菜单打开状态 */
const effortMenuOpen = ref(false)
/** 用户输入文本 */
const inputText = ref('')
/** AI 响应文本（流式累积；节流落盘） */
const outputText = ref('')
/** AI 响应 textarea DOM（自动滚动） */
const outputEl = ref<HTMLTextAreaElement | null>(null)
/** 是否贴近底部（用户上滚后暂停自动滚动） */
const stickToBottom = ref(true)

/** 当前中止控制器（停止按钮） */
let controller: AbortController | null = null
/** 流式落盘节流定时器 */
let commitTimer: ReturnType<typeof setTimeout> | null = null
/** 上次节流提交时间 */
let lastCommitAt = 0

/** 配置快捷读取 */
const config = computed(() => props.node.config as Record<string, unknown>)
/** 服务商实例 id */
const providerInstanceId = computed(() => (typeof config.value.providerInstanceId === 'string' ? config.value.providerInstanceId : ''))
/** 模型 id */
const modelId = computed(() => (typeof config.value.modelId === 'string' ? config.value.modelId : ''))
/** 思考挡位（空 = 不设置） */
const selectedEffort = computed(() => (typeof config.value.reasoningLevel === 'string' ? config.value.reasoningLevel : ''))
/** 预设提示词 id（空 = 不使用预设） */
const promptPresetId = computed(() => (typeof config.value.promptPresetId === 'string' ? config.value.promptPresetId : ''))

/** 当前生效的预设提示词（按 id 匹配缓存；已删除的预设回退为不使用） */
const activePreset = computed(() =>
  promptPresetId.value ? presetPrompts.value.find((p) => p.id === promptPresetId.value) ?? null : null,
)

/** 下拉回显键：配置的预设仍存在时展示其 id，否则回退为「不使用」（占位） */
const selectedPresetKey = computed(() => activePreset.value?.id ?? null)

/** 预设提示词下拉条目（前置「不使用」空选项；无任何预设时显示占位提示） */
const presetItems = computed<{ title: string; value: string; props?: { disabled: boolean } }[]>(() => {
  if (presetPrompts.value.length === 0) {
    return [
      {
        title: '尚未配置预设提示词（系统配置 → 预设提示词）',
        value: '__empty__',
        props: { disabled: true },
      },
    ]
  }
  return [
    { title: '不使用预设提示词', value: '' },
    ...presetPrompts.value.map((p) => ({ title: p.name, value: p.id })),
  ]
})

/** 拼接模型选择键 */
function keyOf(instId: string, mId: string): string {
  return `${instId}::${mId}`
}

/** 当前模型选择键 */
const modelKey = computed(() => (providerInstanceId.value && modelId.value ? keyOf(providerInstanceId.value, modelId.value) : ''))

/** 当前选择的模型条目（按实例+模型组合查找） */
const selectedModel = computed(() => {
  for (const opt of providerOptions.value) {
    if (opt.instanceId !== providerInstanceId.value) continue
    const m = opt.models.find((x) => x.modelId === modelId.value)
    if (m) return { ...m, provider: opt }
  }
  return null
})

/**
 * 模型下拉条目（普通 v-select 条目 + 自定义元信息）。
 *
 * 分组头条目 `type: 'subheader'`（Vuetify 原生 subheader 类型，不可选中），
 * 模型条目携带 `modalities`（输入模态图标 key，用于 subtitle）与
 * `ctxText`（上下文窗口展示文本，如 1M / 131.1K）。
 */
interface LlmModelSelectItem {
  /** 条目类型（subheader = 服务商分组头；省略 = 普通模型项） */
  type?: 'subheader'
  /** 标题（分组头显示服务商名；模型项显示名称或 id） */
  title: string
  /** 选择值（服务商实例 id + 模型 id 拼接键；分组头/占位条目不可选） */
  value: string
  /** 附加到下拉项的 props（如占位条目禁用态） */
  props?: Record<string, unknown>
  /** 支持的输入模态图标 key（已过滤：仅保留有图标的模态） */
  modalities: string[]
  /** 上下文窗口展示文本（空 = 未知） */
  ctxText: string
}

/** 模型下拉条目（按服务商分组；无任何服务商时显示占位提示） */
const modelItems = computed<LlmModelSelectItem[]>(() => {
  if (providerOptions.value.length === 0) {
    return [
      {
        title: '尚未配置大语言模型服务商（服务商配置 → 大语言模型）',
        value: '__empty__',
        props: { disabled: true },
        modalities: [],
        ctxText: '',
      },
    ]
  }
  const out: LlmModelSelectItem[] = []
  for (const opt of providerOptions.value) {
    if (opt.models.length === 0) continue
    out.push({ type: 'subheader', title: opt.instanceName, value: `__group__${opt.instanceId}`, modalities: [], ctxText: '' })
    for (const m of opt.models) {
      out.push({
        title: m.name || m.modelId,
        value: keyOf(opt.instanceId, m.modelId),
        modalities: (Array.isArray(m.meta?.inputModalities) ? m.meta.inputModalities : []).filter((x) => MODALITY_ICONS[x]),
        ctxText: formatContextWindow(m.meta?.contextWindow ?? ''),
      })
    }
  }
  return out
})

/** 下拉回显键：仅当配置的模型仍存在于当前列表时才展示（否则显示占位） */
const selectedModelKey = computed(() =>
  modelItems.value.some((i) => i.type !== 'subheader' && i.value === modelKey.value) ? modelKey.value : null,
)

/** 思考挡位选项（所选模型的 meta.reasoningLevels 逗号分割） */
const effortOptions = computed(() => {
  const raw = selectedModel.value?.meta?.reasoningLevels
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
})

/** 思考强度按钮显示 */
const effortLabel = computed(() => {
  if (effortOptions.value.length === 0) return '思考'
  return selectedEffort.value || '思考'
})

const effortBtnTitle = computed(() =>
  effortOptions.value.length === 0 ? '该模型不支持思考强度，已禁用' : `思考强度：${selectedEffort.value || '不设置'}`,
)

/** 媒体输入总数（> 0 时显示输入预览组件） */
const mediaCount = computed(() => props.inputs?.length ?? 0)

/** 媒体输入按类型分组（供 CanvasInputPreview 使用；携带 version 作预览缓存键） */
const mediaByType = computed<{ images: CanvasInputInfo[]; videos: CanvasInputInfo[]; audios: CanvasInputInfo[] }>(() => {
  const images: CanvasInputInfo[] = []
  const videos: CanvasInputInfo[] = []
  const audios: CanvasInputInfo[] = []
  for (const it of props.inputs ?? []) {
    const info: CanvasInputInfo = { nodeId: it.nodeId, path: it.path, label: it.label, version: it.version }
    if (it.type === 'image') images.push(info)
    else if (it.type === 'video') videos.push(info)
    else audios.push(info)
  }
  return { images, videos, audios }
})

/** 文本输入数量（来源为「文本」节点的非空内容） */
const textInputCount = computed(() => props.textInputs?.length ?? 0)

/** 是否禁用用户输入（生成中 / 已连接文本输入时禁用，输入内容来自外部连线） */
const userInputDisabled = computed(() => generating.value || textInputCount.value > 0)

/**
 * 输出区是否只读：
 * - 生成流式期间只读（防止手动输入与流式增量互相覆盖）；
 * - 出错且无输出时只读（响应区展示的是红字错误文案，不允许误存为输出）；
 * 其余时刻（响应结束后/加载历史输出）允许手动编辑 AI 响应。
 */
const outputAreaReadonly = computed(
  () => generating.value || (outputText.value.trim().length === 0 && !!errorMsg.value),
)

/** 用户输入占位提示（按文本输入连接情况区分） */
const userInputPlaceholder = computed(() => {
  if (textInputCount.value > 1) return '存在多个文本连线输入，无法执行生成，请仅保留一个'
  if (textInputCount.value === 1) return '（来自外部输入）输入的内容'
  if (activePreset.value) return '输入内容…（生成时将替换到预设提示词 {user_prompt}）'
  return '输入内容…（可连接文本/图片/音频/视频输入）'
})

/** 用户输入框显示值（连接文本输入时清空显示，内容来自外部连线，改由占位提示说明） */
const userInputDisplay = computed(() => (textInputCount.value > 0 ? '' : inputText.value))

/** 是否满足生成条件（模型已选 + 输入非空；选择预设时必须提供用户输入；多个文本输入禁止生成） */
const canGenerate = computed(() => {
  if (!providerInstanceId.value || !modelId.value) return false
  if (textInputCount.value > 1) return false
  // 连接文本输入时以外部文本为准（用户输入框中残留的手动输入不再参与判定）
  const text = (textInputCount.value > 0 ? (props.textInputs?.[0] ?? '') : inputText.value).trim()
  // 选择预设提示词：必须提供用户输入（替换/追加到预设提示词中），与未选预设时的媒体兜底不同
  if (activePreset.value) return text.length > 0
  return text.length > 0 || (props.inputs?.length ?? 0) > 0
})

/** 初始化同步配置（外部回写时跟随） */
watch(
  () => props.node.config,
  (c) => {
    const cfg = (c ?? {}) as Record<string, unknown>
    inputText.value = typeof cfg.input === 'string' ? cfg.input : ''
    // 生成中不覆盖本地流式输出（结束前由节流/最终提交回写）
    if (!generating.value) {
      outputText.value = typeof cfg.output === 'string' ? cfg.output : ''
    }
  },
  { immediate: true },
)

/**
 * 模型下拉选择：解析出服务商实例 + 模型 id 并提交配置（清除思考挡位）。
 * 分组头/占位条目（无匹配模型）静默忽略。
 *
 * @param key 下拉选择值（服务商实例 id + 模型 id 拼接键）
 */
function onModelSelect(key: string | null): void {
  if (!key) return
  for (const opt of providerOptions.value) {
    const m = opt.models.find((x) => keyOf(opt.instanceId, x.modelId) === key)
    if (!m) continue
    emit('update:config', { providerInstanceId: opt.instanceId, modelId: m.modelId, reasoningLevel: '' })
    return
  }
}

/**
 * 媒体输入组内拖拽排序：合并回全局 config.inputOrder
 * （与生成图片/视频编辑器一致：mergeInputOrder 只影响本组相对顺序）。
 *
 * @param orderedIds 本组重排后的 nodeId 顺序
 */
function onMediaReorder(orderedIds: string[]): void {
  const cur = Array.isArray(config.value.inputOrder) ? (config.value.inputOrder as string[]) : []
  emit('update:config', { inputOrder: mergeGlobalInputOrder(cur, orderedIds) })
}

/** 选择思考挡位 */
function selectEffort(level: string): void {
  effortMenuOpen.value = false
  emit('update:config', { reasoningLevel: level })
}

/** 预设提示词选择（'' = 不使用；占位条目静默忽略） */
function onPresetSelect(key: string | null): void {
  if (key === null || key === '__empty__') return
  emit('update:config', { promptPresetId: key })
}

/** 用户输入变化：更新本地值并提交配置 */
function onInputText(e: Event): void {
  const v = (e.target as HTMLTextAreaElement).value
  inputText.value = v
  emit('update:config', { input: v })
}

/**
 * AI 响应手动编辑：更新本地值并提交配置（可撤销，与用户输入区编辑一致）。
 * 出错时响应区展示的是错误文案（见 outputAreaReadonly），能进入本处理即表示
 * 编辑的是真实输出内容；编辑同时清掉残留的错误红字状态。
 */
function onOutputEdit(e: Event): void {
  const v = (e.target as HTMLTextAreaElement).value
  if (v === outputText.value) return
  outputText.value = v
  if (errorMsg.value) errorMsg.value = ''
  emit('update:config', { output: v })
}

/**
 * 生成正常结束且输出非空时，追加一条文本历史版本（记录「当时的输入与输出」快照）。
 *
 * 走静默更新（update:config-quiet，不入撤销栈），且须在最终输出正常提交之前调用：
 * 最终提交的撤销快照此时已包含本条历史，撤销生成不会连带丢失已存档的版本。
 * 输入快照取本次实际发送的用户侧文本（外部文本连线取连线内容，否则取输入框文本；
 * 不含预设提示词替换后的完整发送内容），另附模型名/预设名/媒体输入名称供历史对话框对照。
 *
 * @param sentText 本次生成实际发送的用户侧文本（已 trim）
 */
function saveOutputHistoryVersion(sentText: string): void {
  const entry = createTextHistoryEntry(sentText, outputText.value, {
    modelName: selectedModel.value?.name || selectedModel.value?.modelId || modelId.value || undefined,
    presetName: activePreset.value?.name ?? undefined,
    mediaLabels: (props.inputs ?? []).map((i) => i.label).filter((s) => s.length > 0),
  })
  emit('update:config-quiet', { outputHistory: appendTextHistory(readTextHistory(config.value), entry) })
}

/** 生成 */
async function onGenerate(): Promise<void> {
  if (generating.value) return
  if (textInputCount.value > 1) {
    hint.value = '存在多个文本连线输入，无法执行生成，请仅保留一个'
    return
  }
  const instId = providerInstanceId.value
  const mId = modelId.value
  if (!instId || !mId) {
    errorMsg.value = '请先在节点顶部选择服务商与模型'
    return
  }
  // 连接文本输入时发送外部文本内容（用户输入框已禁用）；否则使用用户手动输入
  const text = (textInputCount.value > 0 ? (props.textInputs?.[0] ?? '').trim() : inputText.value.trim()).trim()
  // 预设提示词生效时：必须提供用户输入（用于替换 {user_prompt} 占位符或追加到末尾）
  const preset = activePreset.value
  if (!text && preset) {
    errorMsg.value = '请先输入内容（生成时将替换到预设提示词 {user_prompt} 中）'
    return
  }
  if (!text) {
    errorMsg.value = '请输入内容，或连接「文本」节点提供输入'
    return
  }
  // 预设不存在（已删除）时回退为不使用预设，并给出提示
  let presetNotice = ''
  if (promptPresetId.value && !preset) {
    presetNotice = '所选预设提示词已被删除，本次按不使用预设生成'
  }
  // 组装最终发送文本：有预设时替换 {user_prompt} 占位符或追加用户输入到末尾
  const finalInput = preset ? composePresetPrompt(preset.content, text) : text
  errorMsg.value = ''
  warnings.value = []
  hint.value = presetNotice
  outputText.value = ''
  controller = new AbortController()
  generating.value = true
  stickToBottom.value = true
  // 本次生成是否「正常结束」（未被停止、无错误）：为真且输出非空时流结束后自动存档历史版本
  let finishedOk = false
  // 生成前先提交一次输入快照
  emit('update:config', { input: inputText.value })
  try {
    for await (const ev of chatLlmStream(
      {
        project: props.project,
        providerInstanceId: instId,
        modelId: mId,
        reasoningEffort: selectedEffort.value || undefined,
        input: finalInput,
        media: (props.inputs ?? []).map((i) => ({ path: i.path, type: i.type })),
      },
      controller.signal,
    )) {
      if (ev.type === 'text' && typeof ev.delta === 'string') {
        outputText.value += ev.delta
        void scheduleCommit()
        void scrollToBottom()
      } else if (ev.type === 'warning' && ev.message) {
        warnings.value.push(ev.message)
      } else if (ev.type === 'error' && ev.message) {
        errorMsg.value = ev.message
        break
      }
    }
    await flushCommit()
    // 正常结束判定：未收到错误事件且未被「停止」中止（controller 在 finally 置空前仍可用）
    finishedOk = !errorMsg.value && !controller.signal.aborted
  } catch (e) {
    if (!controller.signal.aborted) {
      errorMsg.value = e instanceof Error ? e.message : String(e)
      console.error('[llm] 对话流异常:', e)
    }
  } finally {
    generating.value = false
    controller = null
    // 空响应且无错误时给占位提示
    if (!outputText.value && !errorMsg.value) {
      hint.value = '模型未返回内容（响应为空）'
    }
    // 正常结束且输出非空 → 先静默追加历史版本（在最终提交前，撤销生成不会丢失存档）
    if (finishedOk && outputText.value.trim().length > 0) {
      saveOutputHistoryVersion(text)
    }
    // 流结束后提交最终输出（走可撤销的正常更新路径）
    emit('update:config', { output: outputText.value })
  }
}

/** 停止生成（中止上游请求） */
function onStop(): void {
  controller?.abort()
}

/** 节流提交流式输出（不入撤销栈的静默更新） */
async function scheduleCommit(): Promise<void> {
  const now = Date.now()
  if (now - lastCommitAt >= STREAM_COMMIT_THROTTLE_MS) {
    lastCommitAt = now
    emit('update:config-quiet', { output: outputText.value })
    return
  }
  if (commitTimer) return
  commitTimer = setTimeout(() => {
    commitTimer = null
    lastCommitAt = Date.now()
    emit('update:config-quiet', { output: outputText.value })
  }, STREAM_COMMIT_THROTTLE_MS - (now - lastCommitAt))
}

/** 停止节流并立即提交当前文本（最后一段，先走静默再走最终提交） */
async function flushCommit(): Promise<void> {
  if (commitTimer) {
    clearTimeout(commitTimer)
    commitTimer = null
  }
  if (outputText.value) {
    emit('update:config-quiet', { output: outputText.value })
  }
}

/** AI 响应自动滚动到底部（用户上滚后暂停跟随） */
function onOutputScroll(): void {
  const el = outputEl.value
  if (!el) return
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

async function scrollToBottom(): Promise<void> {
  if (!stickToBottom.value) return
  await nextTick()
  const el = outputEl.value
  if (el && stickToBottom.value) el.scrollTop = el.scrollHeight
}

onBeforeUnmount(() => {
  // 卸載时中止进行中的流
  controller?.abort()
  if (commitTimer) clearTimeout(commitTimer)
})
</script>

<style scoped>
/* 节点整体：纵向排布，占满节点区域 */
.ai-text-node {
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 100%;
  padding: 6px;
  box-sizing: border-box;
  overflow: hidden;
}

/* 生成中状态条（Thinking...） */
.ai-text-node__thinking {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 4px;
  font-size: 11px;
  color: rgb(25, 118, 210);
  background: rgba(25, 118, 210, 0.08);
  border-radius: 3px;
}

/* 首行：模型下拉 + 思考强度 */
.ai-text-node__top {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.ai-text-node__model-select {
  flex: 1 1 auto;
  min-width: 0;
}

.ai-text-node__model-select :deep(.v-field__input) {
  font-size: 12px;
}

.ai-text-node__model-subtitle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.55);
}

.ai-text-node__model-subtitle-ctx {
  padding-left: 3px;
}

.ai-text-node__pick {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  text-transform: none;
  font-size: 12px;
}

/* 预设提示词行（模型行下方整行下拉） */
.ai-text-node__preset {
  flex: 0 0 auto;
}

.ai-text-node__preset :deep(.v-field__input) {
  font-size: 12px;
}

/* 用户输入标题栏：预设提示词提示 */
.ai-text-node__preset-tip {
  color: rgba(0, 0, 0, 0.5);
  padding-left: 6px;
}

/* 媒体输入预览（复用 CanvasInputPreview；nodrag 防止拖动预览区时移动节点） */
.ai-text-node__media-preview {
  flex: 0 1 auto;
  max-height: 132px;
  overflow-y: auto;
}

/* 中部：1:1 左右分割 */
.ai-text-node__main {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  gap: 6px;
}

.ai-text-node__pane {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 4px;
  overflow: hidden;
}

.ai-text-node__pane-title {
  flex: 0 0 auto;
  padding: 2px 6px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.6);
  background: rgba(0, 0, 0, 0.04);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 带操作按钮的标题行（AI 响应面板：标题文本省略 + 右侧历史按钮） */
.ai-text-node__pane-title--actions {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow: visible;
}

.ai-text-node__pane-title-text {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-text-node__history-btn {
  flex: 0 0 auto;
  color: rgba(0, 0, 0, 0.45);
}

.ai-text-node__history-btn:hover {
  color: rgb(25, 118, 210);
}

.ai-text-node__warn {
  color: rgb(251, 140, 0);
  padding-left: 6px;
}

.ai-text-node__area {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 4px 6px;
  font-size: 12px;
  line-height: 1.5;
  background: transparent;
  font-family: inherit;
  box-sizing: border-box;
  overflow-y: auto;
  word-break: break-word;
  white-space: pre-wrap;
}

.ai-text-node__area::placeholder {
  color: rgba(0, 0, 0, 0.35);
}

.ai-text-node__area--disabled {
  opacity: 0.65;
  background: rgba(0, 0, 0, 0.03);
}

.ai-text-node__area--output {
  background: rgba(0, 0, 0, 0.02);
}

.ai-text-node__area--error {
  color: rgb(211, 47, 47);
}

/* 底行：生成/停止 */
.ai-text-node__bottom {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.ai-text-node__hint {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
