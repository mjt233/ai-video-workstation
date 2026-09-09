<template>
  <v-dialog
    :model-value="modelValue"
    fullscreen
    persistent
    @update:model-value="onModelValue"
  >
    <v-card class="blueprint-editor">
      <v-card-title class="d-flex align-center">
        <v-icon
          icon="mdi-vector-square"
          class="mr-2"
        />
        编辑蓝图：{{ meta.name }}
        <v-chip
          size="x-small"
          variant="tonal"
          class="ml-2"
        >
          {{ scopeLabel }}
        </v-chip>
        <v-chip
          v-if="dirty"
          size="x-small"
          color="warning"
          variant="tonal"
          class="ml-2"
        >
          未保存
        </v-chip>
        <span
          v-if="meta.description"
          class="text-body-small text-medium-emphasis ml-3"
        >{{ meta.description }}</span>
        <v-spacer />
        <span class="text-body-small text-disabled mr-2">Ctrl+S 保存</span>
        <v-btn
          variant="tonal"
          color="primary"
          prepend-icon="mdi-content-save"
          class="mr-2"
          :loading="saving"
          :disabled="!dirty"
          title="保存蓝图内容与资产项目（Ctrl+S）"
          @click="onSave"
        >
          保存
        </v-btn>
        <v-btn
          variant="text"
          prepend-icon="mdi-close"
          title="关闭编辑器（有未保存修改时会询问）"
          @click="close"
        >
          关闭
        </v-btn>
      </v-card-title>

      <v-card-text class="blueprint-editor__body">
        <!-- 画布编辑器（蓝图模式）：节点/连线/分组编辑 + 配置面板 + 资产上传/选择 -->
        <AssetCanvas
          v-if="blueprint"
          ref="canvasRef"
          :key="blueprint.id"
          mode="blueprint"
          kind="stage"
          :project="assetProject"
          :asset-project-ready="assetProjectReady"
          :blueprint="{ scope, project, id: blueprint.id }"
          :blueprint-meta="{ name: meta.name, description: meta.description, assetProject: meta.assetProject }"
          @blueprint-meta-updated="onMetaUpdated"
        />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AssetCanvas from '../canvas/AssetCanvas.vue'
import type { BlueprintScope } from '../../api/blueprints'
import type { CanvasBlueprint } from '../../canvas/blueprint'
import { confirm } from '../../utils/confirm'

/**
 * 蓝图编辑器对话框（完整画布式编辑器宿主）。
 *
 * 主体复用 `AssetCanvas` 的蓝图模式（`mode='blueprint'`）：节点/连线/分组编辑、
 * 配置面板、撤销重做、复制粘贴、持久分组全套交互，以及加载节点的上传/选择资产；
 * 生成、上传产物、历史、设为场景图、自动搭画布等执行类入口在蓝图模式下关闭。
 *
 * **手动保存**：编辑器内关闭了自动保存（`autoSave: false`），节点/连线/分组与「资产项目」
 * 的改动只保留在内存，点头部「保存」或 `Ctrl+S` 才以单次 CAS 请求落盘；
 * 点「关闭」时若仍有未保存改动，会先询问「不保存退出」还是「继续编辑」。
 *
 * 元信息（名称/描述）在管理列表编辑；资产项目在画布信息条中选择（见 AssetCanvas）。
 */
const props = defineProps<{
  /** 对话框显隐（v-model） */
  modelValue: boolean
  /** 待编辑的蓝图（含 nodes/connections/groups/rev/assetProject） */
  blueprint: CanvasBlueprint | null
  /** 作用域（blueprint.scope 缺省时使用） */
  scope: BlueprintScope
  /** 项目名（作用域为项目级时） */
  project: string
}>()

const emit = defineEmits<{
  /** 显隐变化 */
  (e: 'update:modelValue', value: boolean): void
  /** 资产项目变更（宿主同步自身蓝图对象） */
  (e: 'meta-updated', patch: { assetProject: string | null }): void
}>()

/** 本地元信息镜像（打开蓝图时初始化；资产项目变更后同步） */
const meta = ref<{ name: string; description: string; assetProject: string | null }>({
  name: '蓝图',
  description: '',
  assetProject: null,
})

/** 画布编辑器实例（读取保存状态、触发手动保存） */
const canvasRef = ref<InstanceType<typeof AssetCanvas> | null>(null)

/** 资产项目（作为 AssetCanvas 的 project 上下文：预览/上传/选择资产） */
const assetProject = computed(() => meta.value.assetProject ?? '')

/** 资产上下文是否就绪（项目级蓝图恒为所属项目，全局蓝图需显式设置） */
const assetProjectReady = computed(() => !!assetProject.value)

/** 作用域展示文案 */
const scopeLabel = computed(() => (props.scope === 'global' ? '全局' : `项目 ${props.project}`))

/** 是否存在未保存的修改（画布内容 + 资产项目；由 AssetCanvas 暴露的保存状态驱动） */
const dirty = computed(() => canvasRef.value?.blueprintState.dirty === true)

/** 保存中（头部「保存」按钮 loading） */
const saving = computed(() => canvasRef.value?.blueprintState.saving === true)

// 打开时同步蓝图元信息
watch(
  () => [props.modelValue, props.blueprint] as const,
  ([open, bp]) => {
    if (!open || !bp) return
    meta.value = {
      name: bp.name,
      description: bp.description,
      assetProject: bp.assetProject ?? null,
    }
  },
  { immediate: true },
)

/**
 * 资产项目变更（来自画布信息条，仅内存）：同步本地镜像并上抛宿主。
 *
 * 是否落盘由 AssetCanvas 的保存流程决定（手动保存：点「保存」/Ctrl+S 时与内容一并写入）。
 *
 * @param patch 变更补丁
 */
function onMetaUpdated(patch: { assetProject: string | null }): void {
  meta.value = { ...meta.value, assetProject: patch.assetProject }
  emit('meta-updated', patch)
}

/**
 * 对话框显隐变化：仅允许向上打开；关闭一律走 `close()`（未保存时先确认），
 * 避免 `closeOnBack` 等路径绕过确认直接丢弃修改。
 *
 * @param value 新的显隐值
 */
function onModelValue(value: boolean): void {
  if (value) {
    emit('update:modelValue', true)
    return
  }
  void close()
}

/** 手动保存蓝图（画布内容 + 资产项目；失败/冲突由 AssetCanvas 提示） */
async function onSave(): Promise<void> {
  await canvasRef.value?.saveBlueprint()
}

/**
 * 关闭编辑器：存在未保存修改时先确认「不保存退出」（确认后丢弃内存改动）。
 */
async function close(): Promise<void> {
  if (dirty.value) {
    const ok = await confirm({
      title: '放弃未保存的修改',
      content: '当前蓝图有未保存的修改（节点/连线/分组/资产项目）。不保存直接退出将丢失这些修改，确定继续？',
      confirmText: '不保存退出',
      confirmColor: 'error',
      cancelText: '继续编辑',
    })
    if (!ok) return
  }
  emit('update:modelValue', false)
}
</script>

<style scoped>
.blueprint-editor {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.blueprint-editor__body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

/* 画布占满对话框主体 */
.blueprint-editor__body > * {
  height: 100%;
}
</style>
