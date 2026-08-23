<template>
  <div class="tts-generate-editor">
    <v-radio-group
      :model-value="mode"
      inline
      density="compact"
      hide-details
      class="mb-1"
      @update:model-value="onModeChange"
    >
      <v-radio
        label="音色克隆"
        value="clone"
      />
      <v-radio
        label="音色设计"
        value="design"
      />
    </v-radio-group>

    <div class="text-body-small text-medium-emphasis mb-2">
      <template v-if="mode === 'clone'">
        参考音频（{{ inputs.length }}）：
        <span v-if="inputs.length">已连接，将作为克隆音色参考</span>
        <span
          v-else
          class="text-error"
        >需先连接「加载音频」节点</span>
      </template>
      <template v-else>
        音色设计无需参考音频
      </template>
    </div>

    <template v-if="mode === 'clone'">
      <v-textarea
        :model-value="text"
        label="朗读文本 Text"
        rows="3"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => emit('update:config', { text: v })"
      />
      <v-textarea
        :model-value="refText"
        label="参考音频文字内容 RefText"
        rows="2"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => emit('update:config', { refText: v })"
      />
    </template>
    <template v-else>
      <v-textarea
        :model-value="prompt"
        label="声线描述 Prompt"
        rows="2"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => emit('update:config', { prompt: v })"
      />
      <v-textarea
        :model-value="text"
        label="朗读文本 Text"
        rows="3"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-2"
        @update:model-value="(v) => emit('update:config', { text: v })"
      />
    </template>

    <v-select
      :model-value="currentImplId"
      :items="implItems"
      item-title="label"
      item-value="value"
      :label="mode === 'clone' ? '克隆工作流实现' : '设计工作流实现'"
      placeholder="请选择工作流实现"
      density="compact"
      variant="outlined"
      :disabled="workflowsLoaded && implItems.length === 0"
      :error="!!implError"
      :error-messages="implError ? [implError] : []"
      class="mb-2"
      @update:model-value="onImplChange"
    >
      <!-- 下拉选项最右侧显示提供商 chip（v-bind="itemProps" 保留 title 与选中态） -->
      <template #item="{ item, props: itemProps }">
        <v-list-item v-bind="itemProps">
          <template #append>
            <v-chip
              v-if="providerLabel(item)"
              size="x-small"
              label
              variant="tonal"
              color="secondary"
              class="ml-1"
            >
              {{ providerLabel(item) }}
            </v-chip>
          </template>
        </v-list-item>
      </template>
    </v-select>

    <WorkflowParamsForm
      v-model="workflowParams"
      :declarations="currentDeclarations"
      :provider="currentImpl?.providerInstanceId"
      :provider-type="currentImpl?.provider"
      :project="props.project"
    />

    <div class="d-flex align-center ga-2">
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
        :disabled="!canGenerate"
        @click="requestGenerate"
      >
        {{ hasOutput ? '重新生成' : '生成' }}
      </v-btn>
      <v-btn
        v-if="isRunning"
        size="small"
        variant="tonal"
        @click="emit('interrupt', node.id)"
      >
        中断
      </v-btn>
      <v-spacer />
      <v-btn
        v-if="hasOutput"
        size="small"
        variant="text"
        @click="emit('open-history', node.id)"
      >
        历史
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getWorkflows, type WorkflowInfo, type WorkflowUserParamValue } from '../../../api/workflow'
import type { CanvasNodeData } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import WorkflowParamsForm from '../../WorkflowParamsForm.vue'

const props = defineProps<{
  project: string
  node: CanvasNodeData
  inputs: CanvasInputInfo[]
  isRunning: boolean
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'open-history', nodeId: string): void
}>()

const workflows = ref<WorkflowInfo[]>([])
/** 工作流列表是否已加载完成（区分「加载中」与「类型下没有可用实现」的校验提示） */
const workflowsLoaded = ref(false)
/** 工作流实现校验错误（未选择实现时点击生成显示，选择后清除） */
const implError = ref('')

/** 节点当前是否已有产物（生成按钮文案/历史入口用；产物为固定路径文件，由服务端落盘） */
const hasOutput = computed(() => !!(props.output || props.node.config.current))

const mode = computed(() => (props.node.config.mode === 'clone' ? 'clone' : 'design'))
const text = computed(() => (typeof props.node.config.text === 'string' ? props.node.config.text : ''))
const refText = computed(() => (typeof props.node.config.refText === 'string' ? props.node.config.refText : ''))
const prompt = computed(() => (typeof props.node.config.prompt === 'string' ? props.node.config.prompt : ''))
const workflowParams = ref<Record<string, WorkflowUserParamValue>>({})

const workflowId = computed(() => (mode.value === 'clone' ? 'tts-voice-clone' : 'tts-voice-design'))

const currentWorkflow = computed(() => workflows.value.find((w) => w.type === workflowId.value))

const implItems = computed(() =>
  (currentWorkflow.value?.implementations ?? []).map((i) => ({ value: i.impl, label: i.name, providerName: i.providerName, provider: i.provider })),
)

/**
 * 解析工作流实现条目的服务商显示名。
 *
 * 优先展示服务商实例名（providerName，来自 /api/workflows）；未提供时回退显示
 * provider 类型 ID；均缺失返回空串（下拉选项不渲染 chip）。
 *
 * @param raw 下拉原始条目（含可选 providerName / provider 字段）
 * @returns 服务商显示名；未声明时为空串
 */
function providerLabel(raw: { providerName?: string; provider?: string }): string {
  return raw?.providerName ?? raw?.provider ?? ''
}

/** 当前选择的工作流实现标识（仅回显 config.workflowImpl；缺失/非法时为空，不展示虚假默认值） */
const currentImplId = computed(() => {
  const impl = props.node.config.workflowImpl
  if (typeof impl === 'string' && implItems.value.some((i) => i.value === impl)) return impl
  return ''
})

/** 克隆模式未连接音频输入时禁用生成 */
const canGenerate = computed(() => !(mode.value === 'clone' && props.inputs.length < 1))

/** 当前选择的工作流实现（找不到时为 undefined） */
const currentImpl = computed(() =>
  (currentWorkflow.value?.implementations ?? []).find((i) => i.impl === currentImplId.value),
)

const currentDeclarations = computed(() => currentImpl.value?.params ?? [])

/**
 * 切换生成模式（音色克隆 / 音色设计）：重置工作流实现与参数。
 * @param v 目标模式（clone / design，VRadioGroup 可能抛出 null）
 */
function onModeChange(v: string | null) {
  if (v !== 'clone' && v !== 'design') return
  implError.value = ''
  emit('update:config', { mode: v, workflowImpl: undefined, workflowParams: {} })
}

/**
 * 切换工作流实现（如不同 TTS 提供方），重置参数为默认。
 * @param v 实现标识（impl）
 */
function onImplChange(v: string) {
  implError.value = ''
  emit('update:config', { workflowImpl: v, workflowParams: {} })
}

/**
 * 点击「生成」：未选择工作流实现时展示校验错误且不触发生成，
 * 保证实际提交的实现与界面显示一致。
 */
function requestGenerate() {
  if (!currentImplId.value) {
    implError.value = !workflowsLoaded.value
      ? '工作流列表加载中，请稍候再试'
      : implItems.value.length === 0
        ? '当前工作流类型没有可用实现，请先在服务商设置中配置实例'
        : '请先选择工作流实现'
    return
  }
  implError.value = ''
  emit('generate', props.node.id)
}

watch(
  () => props.node.config.workflowParams,
  (v) => {
    if (v && typeof v === 'object') workflowParams.value = { ...(v as Record<string, WorkflowUserParamValue>) }
  },
  { immediate: true, deep: true },
)

watch(
  workflowParams,
  (v) => {
    // 相等性守卫：config.workflowParams 与本地值一致时不再回写，
    // 避免「config → 本地 → emit → config」无限循环。
    const cur = props.node.config.workflowParams
    const same = cur != null && typeof cur === 'object' && JSON.stringify(cur) === JSON.stringify(v)
    if (!same) emit('update:config', { workflowParams: v })
  },
)

// 加载工作流列表（初始化一次）
getWorkflows()
  .then((list) => { workflows.value = list })
  .catch(() => { workflows.value = [] })
  .finally(() => { workflowsLoaded.value = true })
</script>
