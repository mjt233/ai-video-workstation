<template>
  <div class="video-generate-params">
    <!-- 参数行：紧凑横排，空间不足时换行（工作流下拉优先占满剩余宽度） -->
    <div class="generation-params-row">
      <!-- 生成模式（所选实现声明多种模式时显示；位于工作流之前，与其它生成节点一致） -->
      <v-select
        v-if="modes.length > 1"
        :model-value="mode"
        :items="modeItems"
        item-title="label"
        item-value="value"
        label="生成模式"
        density="compact"
        variant="outlined"
        hide-details
        class="generation-params-row__mode"
        @update:model-value="(v) => emit('update:mode', v as VideoGenerateMode)"
      />

      <v-select
        :model-value="workflowImpl"
        :items="workflowItems"
        item-title="label"
        item-value="value"
        label="工作流"
        placeholder="请选择工作流实现"
        density="compact"
        variant="outlined"
        hide-details
        :disabled="workflowsLoaded && workflowItems.length === 0"
        :error="!!implError"
        class="generation-params-row__workflow"
        @update:model-value="(v) => emit('update:workflow', v)"
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

      <!-- 时长：点击弹出菜单（1~15 秒快捷选择 + 手动输入） -->
      <DurationPicker
        :model-value="duration"
        @update:model-value="(v) => emit('update:duration', v)"
      />

      <!-- 输出尺寸：点击弹出菜单配置 -->
      <WorkflowSizePicker
        :size-capabilities="sizeCapabilities"
        :model-value="sizeConfig"
        @update:model-value="(v) => emit('update:size', v)"
      />

      <!-- 工作流参数：点击弹出菜单配置 -->
      <WorkflowParamsTrigger
        :model-value="workflowParams"
        :declarations="declarations"
        :provider="provider"
        :provider-type="providerType"
        :project="project"
        @update:model-value="(v) => emit('update:workflowParams', v)"
      />

      <!-- 全屏切换（全屏时变为退出） -->
      <v-btn
        class="generation-params-row__fullscreen"
        :icon="isFullscreen ? 'mdi-fullscreen-exit' : 'mdi-fullscreen'"
        size="small"
        variant="text"
        :title="isFullscreen ? '退出全屏' : '全屏显示'"
        @click="emit('toggle-fullscreen')"
      />
    </div>

    <!-- 工作流实现校验错误（下拉用 hide-details 保持行高恒定，错误文案统一在行下展示） -->
    <div
      v-if="implError"
      class="text-error text-body-small mt-1"
    >
      {{ implError }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type {
  WorkflowSizeConfig,
  WorkflowUserParamDeclaration,
  WorkflowUserParamValue,
} from '../../../api/workflow'
import type { VideoGenerateMode } from '../../../canvas/videoTypes'
import DurationPicker from '../../DurationPicker.vue'
import WorkflowParamsTrigger from '../../WorkflowParamsTrigger.vue'
import WorkflowSizePicker from '../../WorkflowSizePicker.vue'

/**
 * 【生成视频】节点统一参数行。
 *
 * 由 `VideoGenerateEditor` 的导演台分支与首尾帧/参考分支共用，保证两种布局下
 * 「生成模式 + 工作流 + 时长 + 输出尺寸 + 工作流参数 + 全屏」的位置、样式与
 * 交互完全一致（避免两处模板各自演化）。
 *
 * 组件自身不持有状态：时长/尺寸/参数值均由父级从节点 config 读取后传入，
 * 交互结果通过事件上抛（父级负责按唯一权威字段写回 config）。
 */
const props = defineProps<{
  /** 当前生成模式（config.mode） */
  mode: VideoGenerateMode
  /** 当前实现支持的生成模式列表（长度 > 1 时才渲染模式下拉） */
  modes: VideoGenerateMode[]
  /** 当前选择的工作流实现标识（config.workflowImpl；未选择时为空串） */
  workflowImpl: string
  /** 工作流下拉选项（图生视频类型下的所有实现，含 providerName 用于选项 chip） */
  workflowItems: Array<{ value: string; label: string; providerName?: string; provider?: string }>
  /** 工作流列表是否已加载完成（用于「加载中」与「无可用实现」的禁用区分） */
  workflowsLoaded: boolean
  /** 工作流实现校验错误（非空时下拉标红并在行下展示文案） */
  implError: string
  /** 所选实现声明的输出尺寸能力（透传 WorkflowSizePicker） */
  sizeCapabilities?: { ratio?: string[]; size?: string[]; supportCustomSize?: boolean }
  /** 当前输出时长（秒；由父级统一读取） */
  duration: number
  /** 当前统一尺寸配置（config.sizeConfig；缺省时由父级按已存宽高反推） */
  sizeConfig: WorkflowSizeConfig | null
  /** 工作流自定义参数声明（尺寸类 key 已由父级剔除） */
  declarations: WorkflowUserParamDeclaration[]
  /** 工作流参数值（config.workflowParams） */
  workflowParams: Record<string, WorkflowUserParamValue>
  /** 服务商实例 ID（透传 WorkflowParamsTrigger/Form） */
  provider?: string
  /** 服务商类型 ID（透传 WorkflowParamsTrigger/Form） */
  providerType?: string
  /** 项目名（透传 WorkflowParamsTrigger/Form） */
  project: string
  /** 是否处于全屏显示（决定全屏按钮图标与提示） */
  isFullscreen: boolean
}>()

/**
 * 组件事件：参数行内各控件的变更上抛，由父级写入节点 config。
 * - update:mode：切换生成模式
 * - update:workflow：切换工作流实现
 * - update:duration：变更输出时长
 * - update:size：变更输出尺寸（统一尺寸配置）
 * - update:workflowParams：变更工作流自定义参数
 * - toggle-fullscreen：切换全屏显示
 */
const emit = defineEmits<{
  (e: 'update:mode', v: VideoGenerateMode): void
  (e: 'update:workflow', v: string): void
  (e: 'update:duration', v: number): void
  (e: 'update:size', v: WorkflowSizeConfig): void
  (e: 'update:workflowParams', v: Record<string, WorkflowUserParamValue>): void
  (e: 'toggle-fullscreen'): void
}>()

/** 生成模式下拉选项（按当前实现支持的模式生成中文标签） */
const modeItems = computed(() =>
  props.modes.map((m) => ({
    value: m,
    label: m === 'director' ? '导演台' : m === 'first-last-frame' ? '首尾帧' : '参考',
  })),
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
</script>

<style scoped>
/* 参数行：紧凑横排，空间不足时换行（工作流下拉优先占满剩余宽度） */
.generation-params-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.generation-params-row__mode {
  flex: 0 0 auto;
  width: 100px;
}

.generation-params-row__workflow {
  flex: 1 1 180px;
  min-width: 180px;
  max-width: 260px;
}

.generation-params-row__fullscreen {
  align-self: center;
  flex: 0 0 auto;
}
</style>
