<template>
  <div class="text-generate-editor">
    <!-- 输入预览（统一组件）：媒体输入按类型分组；无输入时提示可连接文本/图片/音频/视频 -->
    <CanvasInputPreview
      :project="props.project"
      :images-inputs="imagesInputs"
      :videos-inputs="videosInputs"
      :audios-inputs="audiosInputs"
      images-title="输入图片"
      videos-title="输入视频"
      audios-title="输入音频"
      empty-text="可连接图片/音频/视频作为素材，或连接「文本」节点作为外部提示词"
      drag-hint="拖拽调整顺序"
      @reorder="onMediaReorder"
      @remove="(input) => emit('disconnect-input', input.nodeId)"
    />

    <!-- 多个文本连线输入：报错并禁止生成（与生成图片/视频节点同一规则，仅保留一个） -->
    <div
      v-if="textInputCount > 1"
      class="text-error text-body-small mb-2"
    >
      存在多个文本连线输入（{{ textInputCount }} 个），生成已禁用，请仅保留一个
    </div>

    <!-- 提示词（连线文本输入时禁用并显示「（已连接外部输入）」，与生成图片/视频节点一致） -->
    <v-textarea
      :model-value="promptFieldValue"
      :label="textInputCount > 0 ? '提示词（已连接外部输入）' : '提示词 Prompt'"
      :disabled="textInputCount > 0"
      rows="3"
      density="compact"
      variant="outlined"
      hide-details
      class="mb-2"
      @update:model-value="(v) => emit('update:config', { prompt: v })"
    />

    <!-- 参数行：工作流实现 + 工作流参数（文本生成无输出尺寸） -->
    <div class="generation-params-row">
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

      <!-- 工作流参数：点击弹出菜单配置 -->
      <WorkflowParamsTrigger
        v-model="workflowParams"
        :declarations="currentDeclarations"
        :provider="currentImpl?.providerInstanceId"
        :provider-type="currentImpl?.provider"
        :project="props.project"
      />
    </div>

    <!-- 工作流实现校验错误（下拉用 hide-details 保持行高恒定，错误文案统一在行下展示） -->
    <div
      v-if="implError"
      class="text-error text-body-small mb-2"
    >
      {{ implError }}
    </div>

    <!-- 错误提示（运行失败时；本节点无默认状态遮罩，故在面板内显式展示原因） -->
    <div
      v-if="errorMsg"
      class="text-error text-body-small mb-2"
    >
      {{ errorMsg }}
    </div>

    <!-- 执行类操作（生成 / 中断 / 历史）：蓝图模式全部隐藏 -->
    <div
      v-if="!isBlueprint"
      class="d-flex align-center ga-2"
    >
      <v-btn
        color="primary"
        size="small"
        :loading="isRunning"
        :disabled="isRunning"
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
import { mergeInputOrder as mergeGlobalInputOrder } from '../../../canvas/generate'
import { hasTextGenerationImpl } from '../../../canvas/textGenerate'
import WorkflowParamsTrigger from '../../WorkflowParamsTrigger.vue'
import CanvasInputPreview from './CanvasInputPreview.vue'
import { useCanvasMode } from '../../../canvas/canvasMode'

/**
 * 【文本生成】节点配置面板。
 *
 * 与生成图片/视频节点的差异：
 * - 工作流类型固定 `text-generation`（无需类型下拉），因此**不渲染输出尺寸组件**；
 * - 提示词 + 媒体输入即全部输入（图片进 `vars.imagePaths`，视频/音频进 `vars.mediaPaths`）；
 * - 连线文本输入（「文本」/「AI文本生成」等节点）优先作为提示词（与生成图片/视频同一规则）。
 */
const props = defineProps<{
  project: string
  node: CanvasNodeData
  /** 本节点输入资产（父级 inputsOf：已按 config.inputOrder 排序，供生成入口拆分路径） */
  inputs?: CanvasInputInfo[]
  /** 图片类型输入（父级按来源节点输出类型分组下发；供统一输入预览组件展示） */
  imagesInputs?: CanvasInputInfo[]
  /** 视频类型输入 */
  videosInputs?: CanvasInputInfo[]
  /** 音频类型输入 */
  audiosInputs?: CanvasInputInfo[]
  /** 文本连线输入内容（来源为文本类节点的非空内容） */
  textInputs?: string[]
  isRunning: boolean
  /** 运行失败原因（父级按节点状态下发；有值时在面板内以红字展示） */
  errorMsg?: string
}>()

const emit = defineEmits<{
  (e: 'update:config', patch: Record<string, unknown>): void
  (e: 'generate', nodeId: string): void
  (e: 'interrupt', nodeId: string): void
  (e: 'open-history', nodeId: string): void
  (e: 'disconnect-input', sourceNodeId: string): void
}>()

/** 工作流类型（固定值：文本生成） */
const WORKFLOW_TYPE = 'text-generation'

/** 工作流列表（/api/workflows） */
const workflows = ref<WorkflowInfo[]>([])
/** 工作流列表是否已加载完成（区分「加载中」与「类型下没有可用实现」的校验提示） */
const workflowsLoaded = ref(false)
/** 工作流实现校验错误（未选择实现时点击生成显示，选择后清除） */
const implError = ref('')

/** 画布模式上下文：蓝图模式下隐藏生成/中断/历史等执行类入口 */
const canvasMode = useCanvasMode()
/** 是否蓝图模式 */
const isBlueprint = computed(() => canvasMode.mode === 'blueprint')

/** 节点配置 */
const config = computed(() => props.node.config as Record<string, unknown>)

/** 配置的提示词 */
const prompt = computed(() => (typeof config.value.prompt === 'string' ? config.value.prompt : ''))

/** 文本连线输入数量 */
const textInputCount = computed(() => props.textInputs?.length ?? 0)

/**
 * 提示词输入框的显示值：已连接文本输入时字段禁用并**作为字段值**展示提示
 * （禁用态 textarea 的 placeholder 在浏览器中不渲染，故不能用 placeholder 实现，
 * 与生成视频节点的处理一致）；未连接时显示配置的提示词。
 */
const promptFieldValue = computed(() => (textInputCount.value > 0 ? '（已连接外部输入）' : prompt.value))

/** 当前选择的工作流实现标识（仅回显 config.workflowImpl；缺失/非法时为空，不展示虚假默认值） */
const currentImplId = computed(() => {
  const impl = props.node.config.workflowImpl
  if (typeof impl === 'string' && implItems.value.some((i) => i.value === impl)) return impl
  return ''
})

/** 当前工作流类型下的全部实现（含服务商名） */
const implItems = computed(() =>
  (workflows.value.find((w) => w.type === WORKFLOW_TYPE)?.implementations ?? []).map((i) => ({
    value: i.impl,
    label: i.name,
    providerName: i.providerName,
    provider: i.provider,
  })),
)

/** 当前选择的工作流实现（找不到时为 undefined） */
const currentImpl = computed(() =>
  (workflows.value.find((w) => w.type === WORKFLOW_TYPE)?.implementations ?? []).find(
    (i) => i.impl === currentImplId.value,
  ),
)

/** 工作流用户参数声明（工作流参数弹窗据此渲染表单） */
const currentDeclarations = computed(() => currentImpl.value?.params ?? [])

/** 是否已有生成结果（按钮文案 / 历史入口） */
const hasOutput = computed(() => typeof config.value.output === 'string' && config.value.output.trim() !== '')

/** 运行错误信息（父级按节点状态下发；本节点无默认状态遮罩，需在面板内展示失败原因） */
const errorMsg = computed(() => props.errorMsg ?? '')

/**
 * 解析工作流实现条目的服务商显示名。
 *
 * @param raw 下拉原始条目（含可选 providerName / provider 字段）
 * @returns 服务商显示名；未声明时为空串（不渲染 chip）
 */
function providerLabel(raw: { providerName?: string; provider?: string }): string {
  return raw?.providerName ?? raw?.provider ?? ''
}

/** 图片/视频/音频输入（父级已按来源节点输出类型分组；未传时为空数组） */
const imagesInputs = computed(() => props.imagesInputs ?? [])
const videosInputs = computed(() => props.videosInputs ?? [])
const audiosInputs = computed(() => props.audiosInputs ?? [])

/** 工作流用户参数（与 config.workflowParams 双向同步） */
const workflowParams = ref<Record<string, WorkflowUserParamValue>>({})

/**
 * 媒体输入组内拖拽排序：合并回全局 config.inputOrder
 * （与生成图片/视频节点一致：只影响本组相对顺序）。
 *
 * @param orderedIds 本组重排后的 nodeId 顺序
 */
function onMediaReorder(orderedIds: string[]): void {
  const cur = Array.isArray(config.value.inputOrder) ? (config.value.inputOrder as string[]) : []
  emit('update:config', { inputOrder: mergeGlobalInputOrder(cur, orderedIds) })
}

/**
 * 切换工作流实现：重置用户参数（不同实现的参数声明不同，避免残留无效键）。
 *
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
  if (!hasTextGenerationImpl(props.node.config.workflowImpl)) {
    implError.value = !workflowsLoaded.value
      ? '工作流列表加载中，请稍候再试'
      : implItems.value.length === 0
        ? '当前工作流类型没有可用实现，请先在服务商设置中配置「文本生成」类型的工作流'
        : '请先选择工作流实现'
    return
  }
  implError.value = ''
  emit('generate', props.node.id)
}

/** 供父级读取提交输入的说明：生成入口在 useCanvasNodeOps.generateNode，
 *  该处按 llmMediaInputsOf（来源类型 + 路径）拆分 imagePaths / mediaPaths 后提交。 */

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

// 加载工作流列表（初始化一次；失败按空列表处理，由校验提示引导用户去服务商设置）
getWorkflows()
  .then((list) => { workflows.value = list })
  .catch(() => { workflows.value = [] })
  .finally(() => { workflowsLoaded.value = true })
</script>

<style scoped>
/* 参数行：紧凑横排（工作流实现下拉优先占满剩余宽度） */
.generation-params-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.generation-params-row__impl {
  flex: 1 1 180px;
  min-width: 180px;
}
</style>
