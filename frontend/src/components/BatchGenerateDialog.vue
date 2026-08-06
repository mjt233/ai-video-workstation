<template>
  <v-dialog
    v-model="show"
    max-width="560"
  >
    <v-card>
      <!-- Config mode -->
      <template v-if="mode === 'config'">
        <v-card-title class="d-flex align-center">
          <v-icon
            class="mr-2"
            color="primary"
          >
            mdi-lightning-bolt
          </v-icon>
          一键生成资产
        </v-card-title>

        <v-card-text>
          <v-alert
            v-if="dependencyWarning"
            type="warning"
            variant="tonal"
            class="mb-3"
            density="compact"
          >
            {{ dependencyWarning }}
          </v-alert>

          <v-alert
            v-if="configWarning"
            type="warning"
            variant="tonal"
            class="mb-3"
            density="compact"
          >
            {{ configWarning }}
          </v-alert>

          <v-alert
            v-if="submitError"
            type="error"
            variant="tonal"
            class="mb-3"
            density="compact"
          >
            {{ submitError }}
          </v-alert>

          <div class="text-body-medium mb-2 font-weight-medium">
            选择要生成的资产类型与工作流实现
          </div>
          <v-row dense>
            <v-col
              v-for="at in assetTypes"
              :key="at.id"
              cols="6"
            >
              <v-checkbox
                v-model="selectedTypes"
                :label="at.label"
                :value="at.id"
                density="compact"
                hide-details
                color="primary"
              />
              <v-select
                v-if="selectedTypes.includes(at.id)"
                v-model="implSelections[at.id]"
                :items="implOptionsFor(at.id)"
                item-title="name"
                item-value="impl"
                :label="`${at.label}工作流`"
                density="compact"
                variant="outlined"
                hide-details
                class="mt-1"
              />
              <!-- 所选工作流的用户参数输入表单（按实现切换自动重置） -->
              <WorkflowParamsForm
                v-if="selectedTypes.includes(at.id)"
                :key="`params-${at.id}-${implSelections[at.id] ?? 'none'}`"
                :declarations="paramsDeclarationsMap[at.id]"
                :model-value="userParamsByAssetType[at.id] ?? {}"
                :project="props.project"
                class="mt-1"
                @update:model-value="(v) => setUserParams(at.id, v)"
              />
            </v-col>
          </v-row>

          <v-divider class="my-3" />

          <div class="text-body-medium mb-2 font-weight-medium">
            并发执行数
          </div>
          <v-slider
            v-model="concurrency"
            :min="1"
            :max="10"
            :step="1"
            thumb-label
            show-ticks
          />

          <v-divider class="my-3" />

          <v-checkbox
            v-model="overwrite"
            label="重复生成 — 已存在资产时也覆盖重新生成"
            density="compact"
            hide-details
            color="primary"
          />
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="close"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :disabled="selectedTypes.length === 0 || submitting"
            :loading="submitting"
            @click="startGenerate"
          >
            开始生成
          </v-btn>
        </v-card-actions>
      </template>

      <!-- Progress mode -->
      <template v-else>
        <v-card-title class="d-flex align-center">
          <v-icon
            class="mr-2"
            color="primary"
          >
            mdi-lightning-bolt
          </v-icon>
          一键生成资产
          <v-spacer />
          <span class="text-body-medium font-weight-regular text-grey">
            {{ summary.completed + summary.failed }} / {{ summary.total }}
          </span>
        </v-card-title>

        <v-card-text>
          <v-progress-linear
            :model-value="progressPercent"
            color="primary"
            height="8"
            rounded
            class="mb-3"
          />

          <v-list
            density="compact"
            style="max-height: 320px; overflow-y: auto;"
          >
            <v-list-item
              v-for="task in tasks"
              :key="task.taskId"
            >
              <template #prepend>
                <v-icon
                  :icon="getStatusIcon(task.status)"
                  :color="getStatusColor(task.status)"
                  class="mr-2"
                />
              </template>

              <v-list-item-title class="text-body-medium">
                {{ getTaskDisplayName(task) }}
              </v-list-item-title>

              <v-list-item-subtitle class="text-body-small">
                {{ getTaskStatusText(task.status) }}
                <span v-if="task.errorMsg"> — {{ task.errorMsg }}</span>
              </v-list-item-subtitle>

              <template #append>
                <v-btn
                  v-if="task.status === 'failed'"
                  variant="text"
                  icon="mdi-refresh"
                  size="small"
                  color="error"
                  @click="retryTask(task.taskId)"
                />
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="close"
          >
            {{ batchRunning ? '后台运行' : '关闭' }}
          </v-btn>
        </v-card-actions>
      </template>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  runBatch,
  retryTask as apiRetryTask,
  getWorkflows,
  type BatchSummary,
  type TaskResponse,
  type WorkflowInfo,
  type WorkflowUserParamDeclaration,
  type WorkflowUserParamValue,
} from '../api/workflow'
import WorkflowParamsForm from './WorkflowParamsForm.vue'

const props = defineProps<{
  modelValue: boolean
  project: string
  batchId: string | null
  summary: BatchSummary
  tasks: TaskResponse[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'update:batchId', v: string | null): void
  (e: 'refresh'): void
  (e: 'clear-batch'): void
}>()

const show = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const assetTypes = [
  { id: 'character-appearance', label: '🧑 角色外观' },
  { id: 'character-voice', label: '🎤 角色声音' },
  { id: 'stage-image', label: '🏙️ 场景图片' },
  { id: 'variant-edit', label: '✨ 衍生变体' },
  { id: 'scene-stage-image', label: '🎬 分镜场景图' },
  { id: 'scene-tts', label: '🔈 分镜语音' },
  { id: 'video-generate', label: '🎥 视频' },
]

/** 资产类型 → 工作流类型 ID（用于查询可选实现） */
const ASSET_TYPE_WORKFLOW: Record<string, string> = {
  'character-appearance': 'text-to-image',
  'character-voice': 'tts-voice-design',
  'stage-image': 'text-to-image',
  'variant-edit': 'image-edit',
  'scene-stage-image': 'image-edit',
  'scene-tts': 'tts-voice-design',
  'video-generate': 'image-to-video',
}

const mode = ref<'config' | 'progress'>('config')
const selectedTypes = ref<string[]>([])
const concurrency = ref(1)
const overwrite = ref(false)
const submitting = ref(false)
const submitError = ref<string | null>(null)
const configWarning = ref<string | null>(null)

/** 已加载的工作流定义列表（含各类型可用实现） */
const workflows = ref<WorkflowInfo[]>([])
const workflowMap = computed(() => {
  const m: Record<string, WorkflowInfo> = {}
  for (const w of workflows.value) m[w.type] = w
  return m
})

/** 资产类型 → 选定的工作流实现（默认第一个） */
const implSelections = ref<Record<string, string>>({})

/** 资产类型 → 用户手动传入的工作流参数值（key → 值） */
const userParamsByAssetType = ref<Record<string, Record<string, WorkflowUserParamValue>>>({})

/**
 * 资产类型 → 所选工作流实现声明的用户参数（供表单渲染）。
 *
 * 注意：必须返回稳定引用（computed 缓存），避免每次渲染生成新数组
 * 导致 WorkflowParamsForm 的内部 watch 反复触发重置。
 */
const paramsDeclarationsMap = computed<Record<string, WorkflowUserParamDeclaration[]>>(() => {
  const m: Record<string, WorkflowUserParamDeclaration[]> = {}
  for (const at of assetTypes) {
    const wid = ASSET_TYPE_WORKFLOW[at.id]
    const wf = wid ? workflowMap.value[wid] : undefined
    const impl = implSelections.value[at.id]
    const implDef = wf?.implementations.find((i) => i.impl === impl)
    m[at.id] = implDef?.params ?? []
  }
  return m
})

/**
 * 更新指定资产类型的用户参数值。
 *
 * @param assetTypeId 资产类型 ID
 * @param v 用户填写的参数值（key → 值）
 */
function setUserParams(assetTypeId: string, v: Record<string, WorkflowUserParamValue>) {
  userParamsByAssetType.value = { ...userParamsByAssetType.value, [assetTypeId]: v }
}

/**
 * 获取指定资产类型可用的工作流实现列表。
 * @param assetTypeId 资产类型 ID
 * @returns 实现列表；工作流未加载或类型未知时返回空数组
 */
function implOptionsFor(assetTypeId: string): { impl: string; name: string; description?: string }[] {
  const wid = ASSET_TYPE_WORKFLOW[assetTypeId]
  const wf = wid ? workflowMap.value[wid] : undefined
  return wf?.implementations ?? []
}

/**
 * 加载工作流定义，并为已勾选的资产类型补齐默认实现（取第一个）。
 */
async function loadWorkflows() {
  try {
    workflows.value = await getWorkflows()
  } catch {
    workflows.value = []
  }
  syncImplDefaults()
}

/**
 * 为已勾选的资产类型补齐默认实现（第一个），并清除未勾选类型的记录。
 */
function syncImplDefaults() {
  const next = { ...implSelections.value }
  for (const at of assetTypes) {
    const opts = implOptionsFor(at.id)
    if (selectedTypes.value.includes(at.id)) {
      if (!opts.some((o) => o.impl === next[at.id])) {
        if (opts.length > 0) next[at.id] = opts[0].impl
        else delete next[at.id]
      }
    } else {
      delete next[at.id]
    }
  }
  implSelections.value = next
}

watch(selectedTypes, () => syncImplDefaults())

const progressPercent = computed(() => {
  if (props.summary.total === 0) return 0
  return ((props.summary.completed + props.summary.failed) / props.summary.total) * 100
})

const batchRunning = computed(() => props.summary.running > 0 || props.summary.pending > 0)

const batchFinished = computed(() =>
  props.summary.total > 0
  && props.summary.completed + props.summary.failed === props.summary.total,
)

const sel = computed(() => new Set(selectedTypes.value))

const dependencyWarning = computed(() => {
  const warnings: string[] = []

  // scene-stage-image 需要角色外观和场景图片
  if (sel.value.has('scene-stage-image')) {
    if (!sel.value.has('character-appearance')) {
      warnings.push('分镜场景图需要「角色外观」已存在')
    }
    if (!sel.value.has('stage-image')) {
      warnings.push('分镜场景图需要「场景图片」已存在')
    }
  }

  // video-generate 需要分镜场景图和分镜语音
  if (sel.value.has('video-generate')) {
    if (!sel.value.has('scene-stage-image')) {
      warnings.push('视频需要「分镜场景图」已存在')
    }
    if (!sel.value.has('scene-tts')) {
      warnings.push('视频需要「分镜语音」已存在')
    }
  }

  // variant-edit 需要角色外观或场景图片
  if (sel.value.has('variant-edit')) {
    if (!sel.value.has('character-appearance') && !sel.value.has('stage-image')) {
      warnings.push('衍生变体需要「角色外观」或「场景图片」已存在')
    }
  }

  return warnings.length > 0 ? warnings.join('；') + '。请先勾选前置资产类型，否则对应任务会因找不到引用文件而失败。' : null
})

function getTaskStatusText(status: string): string {
  switch (status) {
    case 'completed': return '已完成'
    case 'running': return '生成中'
    case 'failed': return '失败'
    default: return '排队中'
  }
}

const statusIconMap: Record<string, string> = {
  completed: 'mdi-check-circle',
  running: 'mdi-loading mdi-spin',
  failed: 'mdi-alert-circle',
}

const statusColorMap: Record<string, string> = {
  completed: 'success',
  running: 'primary',
  failed: 'error',
}

const defaultIcon = 'mdi-clock-outline'
const defaultColor = 'grey-lighten-1'

function getStatusIcon(status: string): string {
  return statusIconMap[status] ?? defaultIcon
}

function getStatusColor(status: string): string {
  return statusColorMap[status] ?? defaultColor
}

function getTaskDisplayName(task: TaskResponse): string {
  const vars = task.params?.vars ?? {}
  const purpose = vars.purpose || ''
  const assetTypeId =
    purpose
    || (task.workflowId === 'image-to-video' ? 'video-generate' : task.workflowId)
  const typeLabel = assetTypes.find(a => a.id === assetTypeId)?.label
    ?? assetTypes.find(a => a.id === purpose)?.label
    ?? task.workflowId

  // 按资产用途 / 工作流类型展示
  if (purpose === 'character-appearance' || (task.workflowId === 'text-to-image' && vars.name && !vars.label && !vars.stageName)) {
    return vars.name ? `${typeLabel} — ${vars.name}` : typeLabel
  }
  if (purpose === 'character-voice' || (task.workflowId === 'tts-voice-design' && purpose !== 'scene-tts' && (vars.character || vars.name))) {
    const n = vars.character || vars.name
    return n ? `${typeLabel} — ${n}` : typeLabel
  }
  if (purpose === 'stage-image' || (task.workflowId === 'text-to-image' && (vars.stageName || vars.label))) {
    const stageName = vars.stageName || vars.name
    if (stageName && vars.label) return `${typeLabel} — ${stageName}/${vars.label}`
    if (stageName) return `${typeLabel} — ${stageName}`
    return typeLabel
  }
  if (purpose === 'variant-edit') {
    if (vars.variantKind === 'character' && vars.variantOwner && vars.variantId) {
      return `${typeLabel} — ${vars.variantOwner}@${vars.variantId}`
    }
    if (vars.variantKind === 'stage' && vars.variantOwner && vars.baseLabel && vars.variantId) {
      return `${typeLabel} — ${vars.variantOwner}/${vars.baseLabel}@${vars.variantId}`
    }
    return typeLabel
  }
  if (purpose === 'scene-stage-image' || (task.workflowId === 'image-edit' && vars.episode && vars.shot && vars.index != null)) {
    if (vars.episode && vars.shot && vars.index != null) {
      return `${typeLabel} — 第${vars.episode}集 镜头${vars.shot} · 场景${vars.index}`
    }
    if (vars.episode && vars.shot) return `${typeLabel} — 第${vars.episode}集 镜头${vars.shot}`
    return typeLabel
  }
  if (task.workflowId === 'image-to-video' || purpose === 'video-generate') {
    if (vars.episode && vars.shot) return `${typeLabel} — 第${vars.episode}集 镜头${vars.shot}`
    return typeLabel
  }
  if (purpose === 'scene-tts' || (task.workflowId === 'tts-voice-design' && vars.episode)) {
    if (vars.episode && vars.shot && vars.index != null && vars.character) {
      return `${typeLabel} — 第${vars.episode}集 镜头${vars.shot} · #${vars.index} ${vars.character}`
    }
    if (vars.episode && vars.shot && vars.index != null) {
      return `${typeLabel} — 第${vars.episode}集 镜头${vars.shot} · 台词${vars.index}`
    }
    if (vars.episode && vars.shot) return `${typeLabel} — 第${vars.episode}集 镜头${vars.shot}`
    return typeLabel
  }
  return typeLabel
}

function resetConfig() {
  selectedTypes.value = []
  concurrency.value = 1
  overwrite.value = false
  submitting.value = false
  submitError.value = null
  configWarning.value = null
  implSelections.value = {}
  userParamsByAssetType.value = {}
}

// When dialog opens: resume progress if batch is active, otherwise config
watch(show, (val) => {
  if (!val) return
  if (props.batchId) {
    mode.value = 'progress'
    submitError.value = null
    configWarning.value = null
  } else {
    mode.value = 'config'
    resetConfig()
    loadWorkflows()
  }
})

// If parent clears batch while dialog is open, return to config
watch(() => props.batchId, (id) => {
  if (!id && show.value && mode.value === 'progress' && !submitting.value) {
    mode.value = 'config'
    resetConfig()
  }
})

async function startGenerate() {
  submitting.value = true
  submitError.value = null
  configWarning.value = null
  try {
    // 组装每个资产类型选定的工作流实现（默认取第一个可用实现）
    const implByAssetType: Record<string, string> = {}
    for (const id of selectedTypes.value) {
      const impl = implSelections.value[id] ?? implOptionsFor(id)[0]?.impl
      if (impl) implByAssetType[id] = impl
    }
    // 组装每个资产类型用户手动传入的工作流参数（仅发送有值的类型）
    const userParamsPayload: Record<string, Record<string, WorkflowUserParamValue>> = {}
    for (const id of selectedTypes.value) {
      const vals = userParamsByAssetType.value[id]
      if (vals && Object.keys(vals).length > 0) userParamsPayload[id] = vals
    }
    const result = await runBatch({
      project: props.project,
      assetTypes: selectedTypes.value,
      concurrency: concurrency.value,
      overwrite: overwrite.value,
      implByAssetType,
      userParamsByAssetType: userParamsPayload,
    })

    if (!result.batchId || result.totalTasks === 0) {
      configWarning.value = '没有需要生成的资产。所选类型均已存在，可勾选「重复生成」后重试。'
      return
    }

    emit('update:batchId', result.batchId)
    mode.value = 'progress'
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string } }; message?: string }
    submitError.value = e?.response?.data?.error || e.message || '提交失败，请重试'
  } finally {
    submitting.value = false
  }
}

async function retryTask(taskId: string) {
  try {
    await apiRetryTask(taskId)
  } catch {
    // Ignore retry errors; next poll will refresh status
  }
}

function close() {
  // Background run: keep batchId so parent continues polling
  if (mode.value === 'progress' && batchFinished.value) {
    emit('refresh')
    emit('clear-batch')
  }
  show.value = false
}
</script>
