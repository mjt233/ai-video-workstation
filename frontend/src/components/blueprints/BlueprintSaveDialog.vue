<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    persistent
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          icon="mdi-vector-square"
          class="mr-2"
        />
        创建画布蓝图
        <v-spacer />
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-card-text>
        <!-- 内容摘要 -->
        <div class="blueprint-save__summary">
          <v-chip
            size="small"
            variant="tonal"
            color="primary"
            class="mr-2"
          >
            {{ payload?.nodes.length ?? 0 }} 个节点
          </v-chip>
          <v-chip
            size="small"
            variant="tonal"
            class="mr-2"
          >
            {{ payload?.connections.length ?? 0 }} 条连线
          </v-chip>
          <v-chip
            size="small"
            variant="tonal"
          >
            {{ payload?.groups.length ?? 0 }} 个分组
          </v-chip>
        </div>
        <div class="text-body-small text-medium-emphasis mb-3">
          蓝图保存节点的全部配置、连线与分组（含相对位置）；不包含任何生成产物，
          插入到画布后生成类节点需要重新生成。
        </div>

        <v-text-field
          v-model="name"
          label="蓝图名称"
          variant="outlined"
          density="comfortable"
          :maxlength="BLUEPRINT_NAME_MAX"
          counter
          autofocus
          @update:model-value="nameEdited = true"
        />
        <v-textarea
          v-model="description"
          label="描述（可选）"
          variant="outlined"
          density="comfortable"
          rows="2"
          :maxlength="BLUEPRINT_DESC_MAX"
          auto-grow
        />

        <!-- 保存位置：全局 / 项目 -->
        <div class="text-body-small text-medium-emphasis mt-2 mb-1">
          保存位置
        </div>
        <v-btn-toggle
          v-model="scope"
          mandatory
          density="comfortable"
          variant="outlined"
          divided
          class="mb-2"
        >
          <v-btn
            value="global"
            prepend-icon="mdi-earth"
          >
            全局
          </v-btn>
          <v-btn
            value="project"
            prepend-icon="mdi-folder-outline"
          >
            项目
          </v-btn>
        </v-btn-toggle>
        <v-select
          v-if="scope === 'project'"
          v-model="project"
          :items="projects"
          label="目标项目"
          variant="outlined"
          density="comfortable"
          hide-details="auto"
        />
        <div class="text-body-small text-medium-emphasis mt-1">
          {{ scope === 'global'
            ? '全局蓝图对所有项目可见，资产上下文（预览/上传/选择资产）在编辑器中单独指定。'
            : '项目级蓝图保存在该项目下，仅该项目可见，资产上下文固定为该项目。' }}
        </div>

        <v-alert
          v-if="error"
          type="error"
          class="mt-3"
          :text="error"
          closable
          @click:close="error = ''"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="emit('update:modelValue', false)"
        >
          取消
        </v-btn>
        <v-btn
          color="primary"
          :loading="saving"
          :disabled="!payload || payload.nodes.length === 0 || !name.trim() || (scope === 'project' && !project)"
          prepend-icon="mdi-content-save-outline"
          @click="onSave"
        >
          保存蓝图
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { getProjects } from '../../api/client'
import {
  BlueprintExistsError,
  createBlueprint,
  listBlueprints,
  type BlueprintScope,
} from '../../api/blueprints'
import {
  BLUEPRINT_DESC_MAX,
  BLUEPRINT_NAME_MAX,
  defaultBlueprintName,
  type BlueprintPayload,
  type CanvasBlueprint,
} from '../../canvas/blueprint'
import { confirm } from '../../utils/confirm'

/**
 * 「创建画布蓝图」对话框：把画布中选中的节点/连线/分组保存为蓝图。
 *
 * 数据来源：父级（AssetCanvas）用 `captureBlueprintFromCanvas` 捕获选中集后经 `payload` 传入。
 * 本组件负责名称/描述/作用域选择、同名覆盖确认与保存请求。
 */
const props = defineProps<{
  /** 对话框显隐（v-model） */
  modelValue: boolean
  /** 捕获到的蓝图内容（无选中节点时为 null） */
  payload: BlueprintPayload | null
  /** 当前画布项目名（项目级蓝图的默认目标） */
  defaultProject: string
}>()

const emit = defineEmits<{
  /** 显隐变化 */
  (e: 'update:modelValue', value: boolean): void
  /** 保存成功（蓝图内容 + 作用域展示文案） */
  (e: 'saved', blueprint: CanvasBlueprint, scopeLabel: string): void
}>()

/** 蓝图名称（默认「蓝图 N」，随作用域变化自动刷新，用户编辑后不再覆盖） */
const name = ref('')
/** 用户是否手动编辑过名称 */
const nameEdited = ref(false)
/** 蓝图描述 */
const description = ref('')
/** 保存位置：全局 / 项目 */
const scope = ref<BlueprintScope>('project')
/** 项目级蓝图的目标项目 */
const project = ref(props.defaultProject)
/** 项目列表（项目级作用域下拉） */
const projects = ref<string[]>([])
/** 保存中 */
const saving = ref(false)
/** 错误提示 */
const error = ref('')

/**
 * 加载项目列表（失败时输出日志并保留当前项目，不阻断对话框）。
 */
async function loadProjects(): Promise<void> {
  try {
    const list = await getProjects()
    projects.value = list.map((p) => p.name)
    if (!project.value || !projects.value.includes(project.value)) {
      project.value = props.defaultProject || projects.value[0] || ''
    }
  } catch (e) {
    console.error('[blueprint] 加载项目列表失败', e)
  }
}

/**
 * 按当前作用域计算默认蓝图名称（「蓝图 N」，取最小未占用编号）。
 * 仅在用户未手动编辑名称时应用。
 */
async function refreshDefaultName(): Promise<void> {
  if (nameEdited.value) return
  try {
    const existing = await listBlueprints(
      scope.value === 'project' ? { scope: 'project', project: project.value } : { scope: 'global' },
    )
    name.value = defaultBlueprintName(existing)
  } catch (e) {
    // 列表加载失败时退回不带编号的默认名，不阻断保存
    console.error('[blueprint] 读取蓝图列表失败（回退默认名称）', e)
    name.value = '蓝图 1'
  }
}

// 打开时初始化：重置状态、加载项目列表与默认名称
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    error.value = ''
    nameEdited.value = false
    description.value = ''
    scope.value = 'project'
    project.value = props.defaultProject
    void loadProjects()
    void refreshDefaultName()
  },
)

// 作用域/项目变化时刷新默认名称（用户已编辑则保留）
watch([scope, project], () => {
  void refreshDefaultName()
})

/**
 * 保存蓝图：同名冲突时弹窗确认覆盖。
 */
async function onSave(): Promise<void> {
  if (!props.payload || props.payload.nodes.length === 0) return
  saving.value = true
  error.value = ''
  const ref = scope.value === 'project' ? { scope: 'project' as const, project: project.value } : { scope: 'global' as const }
  try {
    const blueprint = await createBlueprint(ref, {
      name: name.value,
      description: description.value,
      payload: props.payload,
    })
    emit('saved', blueprint, scopeLabelOf())
    emit('update:modelValue', false)
  } catch (e) {
    if (e instanceof BlueprintExistsError) {
      const ok = await confirm({
        title: '覆盖同名蓝图',
        content: `已存在名为「${name.value.trim()}」的蓝图，是否用当前内容覆盖它？原内容不可恢复。`,
        confirmText: '覆盖',
        confirmColor: 'warning',
      })
      if (ok) {
        try {
          const blueprint = await createBlueprint(ref, {
            name: name.value,
            description: description.value,
            payload: props.payload,
            overwrite: true,
          })
          emit('saved', blueprint, scopeLabelOf())
          emit('update:modelValue', false)
        } catch (err) {
          error.value = err instanceof Error ? err.message : String(err)
        }
      }
    } else {
      error.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    saving.value = false
  }
}

/**
 * 作用域展示文案（snackbar 用）。
 *
 * @returns 「全局」或「项目 xxx」
 */
function scopeLabelOf(): string {
  return scope.value === 'global' ? '全局' : `项目 ${project.value}`
}
</script>

<style scoped>
.blueprint-save__summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
</style>
