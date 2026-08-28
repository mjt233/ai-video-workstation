<template>
  <div class="image-generate-editor">
    <!-- 输入预览（统一组件）：图片类型输入，无输入时显示占位提示 -->
    <CanvasInputPreview
      :project="props.project"
      :images-inputs="inputs"
      images-title="输入图"
      images-prefix="图像"
      drag-hint="拖拽调整顺序"
      empty-text="无输入图，默认使用文生图工作流"
      @reorder="(ids) => emit('update:config', { inputOrder: ids })"
      @remove="(input) => emit('disconnect-input', input.nodeId)"
    />

    <!-- 提示词 Prompt -->
    <v-textarea
      :model-value="prompt"
      label="提示词 Prompt"
      rows="5"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="(v) => emit('update:config', { prompt: v })"
    />

    <!-- 参数行：工作流类型/实现 + 输出尺寸 + 工作流参数（细节参数收纳进可开关菜单） -->
    <div class="generation-params-row">
      <v-select
        :model-value="workflowId"
        :items="workflowTypeItems"
        item-title="label"
        item-value="value"
        label="工作流类型"
        density="compact"
        variant="outlined"
        hide-details
        class="generation-params-row__type"
        @update:model-value="onTypeChange"
      />

      <v-select
        :model-value="currentImplId"
        :items="implItems"
        item-title="label"
        item-value="value"
        label="工作流实现"
        placeholder="请选择工作流实现"
        density="compact"
        variant="outlined"
        hide-details
        :disabled="workflowsLoaded && implItems.length === 0"
        :error="!!implError"
        :error-messages="implError ? [implError] : []"
        class="generation-params-row__impl"
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

      <!-- 输出尺寸：点击弹出菜单配置（仅生成图片/视频节点显示） -->
      <WorkflowSizePicker
        :size-capabilities="currentImpl?.capabilities?.size"
        :model-value="sizeConfig"
        @update:model-value="onSizeConfigChange"
      />

      <!-- 工作流参数：点击弹出菜单配置 -->
      <WorkflowParamsTrigger
        v-model="workflowParams"
        :declarations="currentDeclarations"
        :provider="currentImpl?.providerInstanceId"
        :provider-type="currentImpl?.provider"
        :project="props.project"
      />
    </div>

    <div class="d-flex align-center ga-2 mb-2">
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
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
      <v-btn
        v-if="kind === 'scene' && hasOutput && !isRunning"
        size="small"
        variant="tonal"
        color="primary"
        @click="emit('set-as-scene', node.id)"
      >
        设为分镜场景图
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  getWorkflows,
  type WorkflowInfo,
  type WorkflowSizeConfig,
  type WorkflowUserParamDeclaration,
  type WorkflowUserParamValue,
} from '../../../api/workflow'
import type { CanvasNodeData, CanvasKind } from '../../../canvas/types'
import type { CanvasInputInfo } from '../../../canvas/generate'
import WorkflowSizePicker from '../../WorkflowSizePicker.vue'
import WorkflowParamsTrigger from '../../WorkflowParamsTrigger.vue'
import { findSizeParamKeys } from '../../../utils/workflowSize'
import CanvasInputPreview from './CanvasInputPreview.vue'

const props = defineProps<{
  project: string
  node: CanvasNodeData
  inputs: CanvasInputInfo[]
  isRunning: boolean
  /** 画布类型：仅分镜画布（scene）显示「设为分镜场景图」 */
  kind: CanvasKind
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'open-history', nodeId: string): void
  (e: 'set-as-scene', nodeId: string): void
  (e: 'disconnect-input', sourceNodeId: string): void
}>()

const workflows = ref<WorkflowInfo[]>([])
/** 工作流列表是否已加载完成（区分「加载中」与「类型下没有可用实现」的校验提示） */
const workflowsLoaded = ref(false)
/** 工作流实现校验错误（未选择实现时点击生成显示，选择后清除） */
const implError = ref('')

/** 节点当前是否已有产物（生成按钮文案/历史/设为分镜场景图入口用；产物为固定路径文件，由服务端落盘） */
const hasOutput = computed(() => !!(props.output || props.node.config.current))

const prompt = computed(() => (typeof props.node.config.prompt === 'string' ? props.node.config.prompt : ''))
const workflowId = computed(() => {
  const explicit = props.node.config.workflowId
  if (typeof explicit === 'string' && explicit) return explicit
  return props.inputs.length > 0 ? 'image-edit' : 'text-to-image'
})
const workflowParams = ref<Record<string, WorkflowUserParamValue>>({})

const currentWorkflow = computed(() => workflows.value.find((w) => w.type === workflowId.value))

/** 工作流类型下拉（文生图 / 图片编辑） */
const workflowTypeItems = computed(() =>
  workflows.value
    .filter((w) => w.type === 'text-to-image' || w.type === 'image-edit')
    .map((w) => ({ value: w.type, label: w.type === 'text-to-image' ? '文生图' : '图片编辑' })),
)

/** 当前类型下的所有实现（如 ComfyUI default / Seedream pro / Seedream lite；providerName 用于选项 chip） */
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

/**
 * 切换工作流类型：显式写入 workflowId，重置实现与参数（实现置空，须用户重新选择）。
 * @param v 工作流类型（text-to-image / image-edit）
 */
function onTypeChange(v: string) {
  implError.value = ''
  emit('update:config', { workflowId: v, workflowImpl: undefined, workflowParams: {}, sizeConfig: undefined })
}

/**
 * 切换工作流实现（如 ComfyUI default / Seedream pro/lite），重置参数为默认。
 * @param v 实现标识（impl）
 */
function onImplChange(v: string) {
  implError.value = ''
  emit('update:config', { workflowImpl: v, workflowParams: {}, sizeConfig: undefined })
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

/** 当前选择的工作流实现（找不到时为 undefined） */
const currentImpl = computed(() =>
  (currentWorkflow.value?.implementations ?? []).find((i) => i.impl === currentImplId.value),
)

/**
 * 当前实现的自定义参数声明（剔除尺寸相关 key：本编辑器尺寸由参数行内
 * 专用 WorkflowSizePicker 处理，避免与 WorkflowParamsForm 内置尺寸组件重复展示）。
 */
const currentDeclarations = computed<WorkflowUserParamDeclaration[]>(() => {
  const params = currentImpl.value?.params ?? []
  const sizeKeys = findSizeParamKeys(params)
  if (!sizeKeys) return params
  const excluded = new Set([sizeKeys.widthKey, sizeKeys.heightKey])
  if (sizeKeys.enableKey) excluded.add(sizeKeys.enableKey)
  return params.filter((d) => !excluded.has(d.key))
})

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

/** 统一尺寸配置（config.sizeConfig 的本地副本；表单更新后持久化到节点配置）。 */
const sizeConfig = ref<WorkflowSizeConfig | null>(null)

// config.sizeConfig → 本地（配置面板重挂载后恢复已保存的尺寸配置）
watch(
  () => props.node.config.sizeConfig,
  (v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const rec = v as Record<string, unknown>
      if (typeof rec.ratio === 'string' && rec.ratio !== '' && typeof rec.size === 'string' && rec.size !== '') {
        sizeConfig.value = v as WorkflowSizeConfig
        return
      }
    }
    sizeConfig.value = null
  },
  { immediate: true, deep: true },
)

/**
 * 统一尺寸配置变化（WorkflowSizePicker 输出）回写节点持久化配置。
 * 相等性守卫避免「本地 → emit → config → 本地」循环；画布图片节点提交时
 * 由 useCanvasGeneration 读取 config.sizeConfig 并入 params.sizeConfig。
 *
 * @param v 用户选择的尺寸配置
 */
function onSizeConfigChange(v: WorkflowSizeConfig) {
  sizeConfig.value = v
  const cur = props.node.config.sizeConfig
  const same = cur != null && typeof cur === 'object' && JSON.stringify(cur) === JSON.stringify(v)
  if (!same) emit('update:config', { sizeConfig: v })
}

// 加载工作流列表（初始化一次）
getWorkflows()
  .then((list) => { workflows.value = list })
  .catch(() => { workflows.value = [] })
  .finally(() => { workflowsLoaded.value = true })
</script>

<style scoped>
/* 参数行：紧凑横排，空间不足时换行（工作流实现下拉优先占满剩余宽度） */
.generation-params-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.generation-params-row__type {
  flex: 0 0 auto;
  width: 110px;
}

.generation-params-row__impl {
  flex: 1 1 160px;
  min-width: 160px;
}
</style>