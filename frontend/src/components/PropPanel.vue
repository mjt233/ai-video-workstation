<template>
  <div
    v-if="props.category && props.name"
    style="flex: 1; min-height: 0; overflow-y: auto;"
  >
    <v-tabs v-model="tab">
      <v-tab value="image">
        图片
      </v-tab>
      <v-tab value="video">
        视频
      </v-tab>
      <v-tab value="audio">
        音频
      </v-tab>
    </v-tabs>

    <v-tabs-window v-model="tab">
      <!-- ── 图片页签 ─────────────────────────────────────────── -->
      <v-tabs-window-item value="image">
        <v-row
          no-gutters
          class="ma-0"
        >
          <!-- 左列：描述文案 -->
          <v-col
            cols="5"
            class="pa-2"
          >
            <div class="text-body-medium font-weight-medium mb-1">
              描述文案
            </div>
            <v-textarea
              v-model="imageMd"
              rows="8"
              variant="outlined"
              label="图片描述（用于文生图；有关联图片时作为图片编辑提示词）"
              :disabled="savingMd"
              @update:model-value="imageMdDirty = true"
            />
            <v-btn
              size="small"
              color="primary"
              variant="tonal"
              :disabled="!imageMdDirty || savingMd"
              :loading="savingMd"
              @click="saveImageMd"
            >
              保存描述
            </v-btn>
          </v-col>

          <!-- 右列：关联资产 -->
          <v-col
            cols="7"
            class="pa-2"
          >
            <div class="d-flex align-center mb-1">
              <div class="text-body-medium font-weight-medium">
                关联资产
              </div>
              <v-spacer />
              <v-btn
                size="small"
                color="primary"
                variant="tonal"
                prepend-icon="mdi-folder-search"
                @click="openPicker('image')"
              >
                选择资产
              </v-btn>
            </div>
            <div
              v-if="!refs.image.length"
              class="text-grey text-body-small mb-2"
            >
              未选择关联资产：生成时使用「文生图」工作流；选择图片后自动切换为「图片编辑」。
            </div>
            <v-list
              v-else
              density="compact"
              class="pa-0"
            >
              <v-list-item
                v-for="(p, i) in refs.image"
                :key="p"
                class="pa-0"
              >
                <template #prepend>
                  <v-img
                    :src="thumbUrl(props.project, p)"
                    width="48"
                    height="48"
                    cover
                    rounded
                    class="mr-2"
                  />
                </template>
                <v-list-item-title class="text-body-small text-truncate">
                  {{ getPathLabel(p) }}
                </v-list-item-title>
                <template #append>
                  <v-btn
                    icon="mdi-arrow-up"
                    size="x-small"
                    variant="text"
                    :disabled="i === 0"
                    title="上移"
                    @click="moveRef('image', i, -1)"
                  />
                  <v-btn
                    icon="mdi-arrow-down"
                    size="x-small"
                    variant="text"
                    :disabled="i === refs.image.length - 1"
                    title="下移"
                    @click="moveRef('image', i, 1)"
                  />
                  <v-btn
                    icon="mdi-close"
                    size="x-small"
                    variant="text"
                    color="error"
                    title="移除"
                    @click="removeRef('image', i)"
                  />
                </template>
              </v-list-item>
            </v-list>
          </v-col>
        </v-row>

        <v-divider class="my-2" />

        <!-- 生成参数行：工作流类型 + 工作流实现（动态获取）+ 输出尺寸 + 工作流参数 + 生成 -->
        <div class="d-flex align-center ga-2 flex-wrap pa-2">
          <v-select
            v-model="imgWorkflowType"
            :items="imgWorkflowTypeOptions"
            label="工作流类型"
            variant="outlined"
            density="compact"
            style="max-width: 180px;"
            hide-details
          />
          <v-select
            v-model="imgImpl"
            :items="imgImplOptions"
            item-title="name"
            item-value="impl"
            label="工作流实现（须选择）"
            variant="outlined"
            density="compact"
            style="max-width: 280px;"
            hide-details
            :disabled="!imgWorkflowAvailable"
            @update:model-value="onImageImplChange"
          >
            <!-- 下拉选项最右侧显示提供商 chip（与画布生成节点一致） -->
            <template #item="{ item, props: itemProps }">
              <v-list-item v-bind="itemProps">
                <template #append>
                  <v-chip
                    v-if="providerLabelOf(item)"
                    size="x-small"
                    label
                    variant="tonal"
                    color="secondary"
                    class="ml-1"
                  >
                    {{ providerLabelOf(item) }}
                  </v-chip>
                </template>
              </v-list-item>
            </template>
          </v-select>
          <!-- 输出尺寸：点击弹出菜单配置（与画布生成图片节点一致） -->
          <WorkflowSizePicker
            :size-capabilities="imageCurrentImpl?.capabilities?.size"
            :model-value="imageSizeConfig"
            @update:model-value="onImageSizeConfigChange"
          />
          <!-- 工作流参数：点击弹出菜单配置（与画布生成图片节点一致） -->
          <WorkflowParamsTrigger
            v-model="imageWorkflowParams"
            :declarations="imageCurrentDeclarations"
            :provider="imageCurrentImpl?.providerInstanceId"
            :provider-type="imageCurrentImpl?.provider"
            :project="props.project"
          />
          <v-btn
            color="primary"
            prepend-icon="mdi-auto-fix"
            :loading="imgSubmitting"
            :disabled="imgTaskStatus === 'running'"
            @click="generateImage"
          >
            生成图片
          </v-btn>
        </div>

        <!-- 生成日志 / 结果 -->
        <div
          v-if="imgTaskStatus !== 'idle'"
          class="pa-2"
        >
          <v-alert
            v-if="imgTaskStatus === 'completed'"
            type="success"
            variant="tonal"
            density="compact"
            class="mb-1"
          >
            图片生成完成
          </v-alert>
          <v-alert
            v-else-if="imgTaskStatus === 'failed'"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-1"
          >
            {{ imgTaskError || '生成失败' }}
          </v-alert>
          <v-progress-linear
            v-if="imgTaskStatus === 'running'"
            indeterminate
            class="mb-1"
          />
          <div
            v-if="imgTaskLogs.length"
            class="bg-grey-lighten-3 rounded pa-2"
            style="max-height: 120px; overflow-y: auto; font-size: 12px; font-family: monospace;"
          >
            <div
              v-for="(log, i) in imgTaskLogs"
              :key="i"
              class="text-body-small"
              :class="log.level === 'error' ? 'text-error' : log.level === 'warn' ? 'text-warning' : 'text-grey-darken-1'"
            >
              {{ log.message }}
            </div>
          </div>
        </div>

        <!-- 产物区 -->
        <v-divider class="my-2" />
        <div class="pa-2">
          <div class="d-flex align-center mb-2">
            <div class="text-body-medium font-weight-medium">
              图片产物
            </div>
            <v-spacer />
            <AssetImageUploadButton
              :project="props.project"
              :asset-path="imageOutputPath"
              @uploaded="load"
            />
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-history"
              class="ml-2"
              :disabled="!hasImage"
              @click="openHistory(imageOutputPath)"
            >
              历史版本
            </v-btn>
          </div>
          <v-img
            v-if="hasImage"
            :src="imageUrl"
            contain
            max-height="360"
          />
          <div
            v-else
            class="text-grey"
          >
            暂无图片，点击「生成图片」或上传图片
          </div>
        </div>
      </v-tabs-window-item>

      <!-- ── 视频页签 ─────────────────────────────────────────── -->
      <v-tabs-window-item value="video">
        <v-row
          no-gutters
          class="ma-0"
        >
          <!-- 左列：描述文案 -->
          <v-col
            cols="5"
            class="pa-2"
          >
            <div class="text-body-medium font-weight-medium mb-1">
              描述文案
            </div>
            <v-textarea
              v-model="videoMd"
              rows="8"
              variant="outlined"
              label="视频描述（用于图生视频提示词）"
              :disabled="savingMd"
              @update:model-value="videoMdDirty = true"
            />
            <v-btn
              size="small"
              color="primary"
              variant="tonal"
              :disabled="!videoMdDirty || savingMd"
              :loading="savingMd"
              @click="saveVideoMd"
            >
              保存描述
            </v-btn>
          </v-col>

          <!-- 右列：关联资产（1~2 张图片：首帧/首尾帧） -->
          <v-col
            cols="7"
            class="pa-2"
          >
            <div class="d-flex align-center mb-1">
              <div class="text-body-medium font-weight-medium">
                关联资产
              </div>
              <v-spacer />
              <v-btn
                size="small"
                color="primary"
                variant="tonal"
                prepend-icon="mdi-folder-search"
                @click="openPicker('video')"
              >
                选择图片
              </v-btn>
            </div>
            <div
              v-if="!refs.video.length"
              class="text-grey text-body-small mb-2"
            >
              未选择关联图片：当前为文生视频模式，但系统暂不支持纯文生视频，请选择 1~2 张图片（可先在「图片」页签生成道具图片）。
            </div>
            <v-list
              v-else
              density="compact"
              class="pa-0"
            >
              <v-list-item
                v-for="(p, i) in refs.video"
                :key="p"
                class="pa-0"
              >
                <template #prepend>
                  <v-img
                    :src="thumbUrl(props.project, p)"
                    width="48"
                    height="48"
                    cover
                    rounded
                    class="mr-2"
                  />
                </template>
                <v-list-item-title class="text-body-small text-truncate">
                  {{ getPathLabel(p) }}{{ refs.video.length === 2 ? (i === 0 ? '（首帧）' : '（尾帧）') : '（首帧）' }}
                </v-list-item-title>
                <template #append>
                  <v-btn
                    icon="mdi-arrow-up"
                    size="x-small"
                    variant="text"
                    :disabled="i === 0"
                    title="上移"
                    @click="moveRef('video', i, -1)"
                  />
                  <v-btn
                    icon="mdi-arrow-down"
                    size="x-small"
                    variant="text"
                    :disabled="i === refs.video.length - 1"
                    title="下移"
                    @click="moveRef('video', i, 1)"
                  />
                  <v-btn
                    icon="mdi-close"
                    size="x-small"
                    variant="text"
                    color="error"
                    title="移除"
                    @click="removeRef('video', i)"
                  />
                </template>
              </v-list-item>
            </v-list>
          </v-col>
        </v-row>

        <v-divider class="my-2" />

        <!-- 生成参数行：工作流实现（动态获取）+ 时长 + 输出尺寸 + 工作流参数 + 生成 -->
        <div class="d-flex align-center ga-2 flex-wrap pa-2">
          <v-select
            v-model="videoImpl"
            :items="videoImplOptions"
            item-title="name"
            item-value="impl"
            label="工作流实现（须选择）"
            variant="outlined"
            density="compact"
            style="max-width: 280px;"
            hide-details
            :disabled="!videoWorkflowAvailable"
            @update:model-value="onVideoImplChange"
          >
            <!-- 下拉选项最右侧显示提供商 chip（与画布生成视频节点一致） -->
            <template #item="{ item, props: itemProps }">
              <v-list-item v-bind="itemProps">
                <template #append>
                  <v-chip
                    v-if="providerLabelOf(item)"
                    size="x-small"
                    label
                    variant="tonal"
                    color="secondary"
                    class="ml-1"
                  >
                    {{ providerLabelOf(item) }}
                  </v-chip>
                </template>
              </v-list-item>
            </template>
          </v-select>
          <div class="d-flex align-center">
            <span class="text-body-small mr-1">时长</span>
            <DurationPicker
              :model-value="videoDuration"
              @update:model-value="onVideoDurationChange"
            />
          </div>
          <!-- 输出尺寸：点击弹出菜单配置（与画布生成视频节点一致） -->
          <WorkflowSizePicker
            :size-capabilities="videoCurrentImpl?.capabilities?.size"
            :model-value="videoSizeConfig"
            @update:model-value="onVideoSizeConfigChange"
          />
          <!-- 工作流参数：点击弹出菜单配置（与画布生成视频节点一致） -->
          <WorkflowParamsTrigger
            v-model="videoWorkflowParams"
            :declarations="videoCurrentDeclarations"
            :provider="videoCurrentImpl?.providerInstanceId"
            :provider-type="videoCurrentImpl?.provider"
            :project="props.project"
          />
          <v-btn
            color="primary"
            prepend-icon="mdi-auto-fix"
            :loading="videoSubmitting"
            :disabled="videoTaskStatus === 'running'"
            @click="generateVideo"
          >
            生成视频
          </v-btn>
        </div>

        <!-- 生成日志 / 结果 -->
        <div
          v-if="videoTaskStatus !== 'idle'"
          class="pa-2"
        >
          <v-alert
            v-if="videoTaskStatus === 'completed'"
            type="success"
            variant="tonal"
            density="compact"
            class="mb-1"
          >
            视频生成完成
          </v-alert>
          <v-alert
            v-else-if="videoTaskStatus === 'failed'"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-1"
          >
            {{ videoTaskError || '生成失败' }}
          </v-alert>
          <v-progress-linear
            v-if="videoTaskStatus === 'running'"
            indeterminate
            class="mb-1"
          />
          <div
            v-if="videoTaskLogs.length"
            class="bg-grey-lighten-3 rounded pa-2"
            style="max-height: 120px; overflow-y: auto; font-size: 12px; font-family: monospace;"
          >
            <div
              v-for="(log, i) in videoTaskLogs"
              :key="i"
              class="text-body-small"
              :class="log.level === 'error' ? 'text-error' : log.level === 'warn' ? 'text-warning' : 'text-grey-darken-1'"
            >
              {{ log.message }}
            </div>
          </div>
        </div>

        <!-- 产物区 -->
        <v-divider class="my-2" />
        <div class="pa-2">
          <div class="d-flex align-center mb-2">
            <div class="text-body-medium font-weight-medium">
              视频产物
            </div>
            <v-spacer />
            <v-btn
              size="small"
              variant="tonal"
              prepend-icon="mdi-upload"
              @click="videoInputRef?.click()"
            >
              上传视频
            </v-btn>
            <input
              ref="videoInputRef"
              type="file"
              class="d-none"
              accept="video/*"
              @change="onUploadVideo"
            >
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-history"
              class="ml-2"
              :disabled="!hasVideo"
              @click="openHistory(videoOutputPath)"
            >
              历史版本
            </v-btn>
          </div>
          <video
            v-if="hasVideo"
            :src="videoUrl"
            controls
            style="max-width: 100%; max-height: 360px;"
          />
          <div
            v-else
            class="text-grey"
          >
            暂无视频，点击「生成视频」或上传视频
          </div>

          <!-- 上传的视频文件列表（保留原文件名） -->
          <div
            v-if="uploadedMediaFiles.length"
            class="mt-3"
          >
            <div class="text-body-medium font-weight-medium mb-1">
              已上传视频文件
            </div>
            <MediaFileList
              :project="props.project"
              :files="uploadedMediaFiles"
              @refresh="load"
            />
          </div>
        </div>
      </v-tabs-window-item>

      <!-- ── 音频页签 ─────────────────────────────────────────── -->
      <v-tabs-window-item value="audio">
        <div class="pa-2">
          <div class="d-flex align-center mb-2">
            <div class="text-body-medium font-weight-medium">
              音频资产
            </div>
            <v-spacer />
            <v-btn
              size="small"
              variant="tonal"
              prepend-icon="mdi-upload"
              @click="audioInputRef?.click()"
            >
              上传音频
            </v-btn>
            <input
              ref="audioInputRef"
              type="file"
              class="d-none"
              accept="audio/*"
              @change="onUploadAudio"
            >
          </div>
          <div class="text-body-small text-medium-emphasis mb-2">
            道具音频仅支持上传与展示（不参与生成）。文件存储于 <code>assert/prop/{{ props.category }}/{{ props.name }}/</code> 下，重名上传会先归档历史版本。
          </div>
          <MediaFileList
            :project="props.project"
            :files="audioFiles"
            :is-audio="true"
            @refresh="load"
          />
        </div>
      </v-tabs-window-item>
    </v-tabs-window>

    <!-- 生成提交失败 / 提示 -->
    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      :timeout="4000"
      location="bottom"
    >
      {{ snackbar.text }}
    </v-snackbar>

    <!-- 资产选择器（关联资产选择：图片/视频页签均为图片） -->
    <AssetPickerDialog
      v-model="picker.show"
      :project="props.project"
      :tabs="['stage', 'character', 'prop', 'custom', 'scene-stage']"
      media-kind="image"
      :multiple="true"
      :max="picker.kind === 'video' ? 2 : -1"
      :selected="picker.selected"
      @update:selected="onPickerSelect"
    />

    <!-- 历史版本对话框 -->
    <AssetHistoryDialog
      v-model="historyDialog.show"
      :project="props.project"
      :asset-path="historyDialog.path"
      @activated="load"
    />
  </div>
  <div
    v-else
    class="d-flex align-center justify-center text-grey"
    style="min-height: 200px;"
  >
    请从左侧资产浏览器选择道具
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { readFs, writeFs, existsFs, uploadFs, deleteFs } from '../api/client'
import { archiveAssetHistory, getPropRefs, savePropRefs, type PropRefs } from '../api/assets'
import {
  runWorkflow,
  getWorkflows,
  type WorkflowImplementation,
  type WorkflowInfo,
  type WorkflowSizeConfig,
  type WorkflowUserParamDeclaration,
  type WorkflowUserParamValue,
} from '../api/workflow'
import { useWorkflowTask } from '../composables/useWorkflowTask'
import { confirm } from '../utils/confirm'
import { findSizeParamKeys } from '../utils/workflowSize'
import { isAudioFile, isVideoFile, getPathLabel, thumbUrl } from './asset-picker/utils'
import AssetPickerDialog from './asset-picker/AssetPickerDialog.vue'
import AssetHistoryDialog from './AssetHistoryDialog.vue'
import AssetImageUploadButton from './AssetImageUploadButton.vue'
import DurationPicker from './DurationPicker.vue'
import WorkflowSizePicker from './WorkflowSizePicker.vue'
import WorkflowParamsTrigger from './WorkflowParamsTrigger.vue'
import MediaFileList from './prop/MediaFileList.vue'

/**
 * 道具详情面板：图片 / 视频 / 音频三个页签。
 *
 * - 图片页签：描述文案（prompt/prop/{分类}/{道具}/image.md）+ 关联资产（图片多选，
 *   refs.json.image）+ 生成（无关联=文生图 text-to-image；有关联=图片编辑 image-edit，
 *   工作流实现列表经 getWorkflows 动态获取，须显式选择）+ 上传/历史版本；
 * - 视频页签：描述文案（video.md）+ 关联资产（图片 1~2 张，refs.json.video，首帧/首尾帧）
 *   + 生成（image-to-video，首尾帧模式；无关联时提示先选图，因系统无纯文生视频工作流）
 *   + 上传/历史版本；
 * - 音频页签：仅上传 + 展示（不生成），文件保留原文件名，重名覆盖先归档历史。
 *
 * 产物固定路径：assert/prop/{分类}/{道具}/image.jpg 与 video.mp4；
 * 重复生成由服务端引擎自动归档历史。
 */
const props = defineProps<{
  project: string
  category?: string
  name?: string
}>()

const tab = ref<string | null>('image')

// ── 描述文案与关联资产 ─────────────────────────────────────────────

const imageMd = ref('')
const videoMd = ref('')
const imageMdDirty = ref(false)
const videoMdDirty = ref(false)
const savingMd = ref(false)
const refs = ref<PropRefs>({ image: [], video: [] })

/** 图片产物固定路径 */
const imageOutputPath = computed(() =>
  props.category && props.name ? `assert/prop/${props.category}/${props.name}/image.jpg` : '')
/** 视频产物固定路径 */
const videoOutputPath = computed(() =>
  props.category && props.name ? `assert/prop/${props.category}/${props.name}/video.mp4` : '')

// ── 产物展示 ───────────────────────────────────────────────────────

const hasImage = ref(false)
const imageUrl = ref('')
const hasVideo = ref(false)
const videoUrl = ref('')
/** 目录下上传的音频文件列表 */
const audioFiles = ref<Array<{ name: string; path: string }>>([])
/** 目录下上传的视频文件列表（不含固定产物 video.mp4） */
const uploadedMediaFiles = ref<Array<{ name: string; path: string }>>([])

/** 项目分辨率（project.json；缺失时回退 1280x720） */
const projectResolution = ref({ width: 1280, height: 720 })

// ── 工作流实现（动态获取，参照画布生成节点）────────────────────────

/** 全部工作流信息（getWorkflows 动态获取，含自定义注册实现） */
const workflows = ref<WorkflowInfo[]>([])

/** 图片工作流类型下拉（文生图/图片编辑） */
const imgWorkflowType = ref<'text-to-image' | 'image-edit'>('text-to-image')
const imgWorkflowTypeOptions = computed(() => [
  { title: '文生图', value: 'text-to-image' as const },
  { title: '图片编辑', value: 'image-edit' as const },
])

/** 当前工作流类型下可用的实现列表（动态获取） */
const imgImplOptions = computed<WorkflowImplementation[]>(() => {
  const wf = workflows.value.find((w) => w.type === imgWorkflowType.value)
  return wf?.implementations ?? []
})
const imgWorkflowAvailable = computed(() => imgImplOptions.value.length > 0)
const imgImpl = ref('')

/** 图片当前选择的工作流实现（找不到时为 undefined） */
const imageCurrentImpl = computed(() =>
  imgImplOptions.value.find((i) => i.impl === imgImpl.value),
)

/** 视频工作流实现列表（image-to-video 类型，动态获取） */
const videoImplOptions = computed<WorkflowImplementation[]>(() => {
  const wf = workflows.value.find((w) => w.type === 'image-to-video')
  return wf?.implementations ?? []
})
const videoWorkflowAvailable = computed(() => videoImplOptions.value.length > 0)
const videoImpl = ref('')

/** 视频当前选择的工作流实现（找不到时为 undefined） */
const videoCurrentImpl = computed(() =>
  videoImplOptions.value.find((i) => i.impl === videoImpl.value),
)

/** 视频时长（秒），默认 5（持久化于 gen.json） */
const videoDuration = ref(5)

// ── 生成参数（工作流用户参数 + 输出尺寸；与画布生成节点一致，持久化于 gen.json）────

/** 图片工作流用户参数（key → 值；与 WorkflowParamsTrigger 双向同步） */
const imageWorkflowParams = ref<Record<string, WorkflowUserParamValue>>({})
/** 视频工作流用户参数（key → 值） */
const videoWorkflowParams = ref<Record<string, WorkflowUserParamValue>>({})
/** 图片输出尺寸配置（WorkflowSizePicker 回显/输出） */
const imageSizeConfig = ref<WorkflowSizeConfig | null>(null)
/** 视频输出尺寸配置 */
const videoSizeConfig = ref<WorkflowSizeConfig | null>(null)

/**
 * 当前实现的自定义参数声明（剔除尺寸相关 key：输出尺寸由参数行内
 * 专用 WorkflowSizePicker 处理，避免与 WorkflowParamsForm 内置尺寸组件重复展示）。
 */
const imageCurrentDeclarations = computed<WorkflowUserParamDeclaration[]>(() => {
  const params = imageCurrentImpl.value?.params ?? []
  const sizeKeys = findSizeParamKeys(params)
  if (!sizeKeys) return params
  const excluded = new Set([sizeKeys.widthKey, sizeKeys.heightKey])
  if (sizeKeys.enableKey) excluded.add(sizeKeys.enableKey)
  return params.filter((d) => !excluded.has(d.key))
})

/** 视频当前实现的自定义参数声明（同样剔除尺寸 key） */
const videoCurrentDeclarations = computed<WorkflowUserParamDeclaration[]>(() => {
  const params = videoCurrentImpl.value?.params ?? []
  const sizeKeys = findSizeParamKeys(params)
  if (!sizeKeys) return params
  const excluded = new Set([sizeKeys.widthKey, sizeKeys.heightKey])
  if (sizeKeys.enableKey) excluded.add(sizeKeys.enableKey)
  return params.filter((d) => !excluded.has(d.key))
})

/**
 * 生成参数配置文件（prompt/prop/{分类}/{道具}/gen.json，纯前端数据，与 canvas.json 同机制）：
 * 图片/视频页签的工作流实现、workflowParams、sizeConfig 与视频时长，切换道具/刷新后回显
 * （与画布生成节点一致：实现选择也持久化，刷新后参数菜单可正确回显）。
 */
interface PropGenConfig {
  image: {
    impl?: string
    workflowParams?: Record<string, WorkflowUserParamValue>
    sizeConfig?: WorkflowSizeConfig | null
  }
  video: {
    impl?: string
    workflowParams?: Record<string, WorkflowUserParamValue>
    sizeConfig?: WorkflowSizeConfig | null
    duration?: number
  }
}

/** gen.json 相对路径 */
function genJsonRel(category?: string, name?: string): string {
  return `prompt/prop/${category ?? props.category}/${name ?? props.name}/gen.json`
}

/** 生成参数保存防抖 timer */
let genSaveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 防抖保存生成参数（gen.json）：连续调整参数时合并为一次写入（与画布保存防抖一致）。
 * 调度时捕获目标道具路径——防抖窗口内切换道具也不会写错文件（切换时由 watch 先行落盘旧道具）。
 */
function schedulePersistGen(): void {
  if (!props.category || !props.name) return
  if (genSaveTimer) return
  const category = props.category
  const name = props.name
  genSaveTimer = setTimeout(() => {
    genSaveTimer = null
    void persistGen(category, name)
  }, 800)
}

/**
 * 立即保存生成参数（gen.json）。切换道具/组件卸载时调用，避免防抖窗口内丢失；
 * 可显式传入目标道具路径（切换道具时用旧值落盘）。
 *
 * @param category 目标分类（缺省用当前 props）
 * @param name 目标道具名（缺省用当前 props）
 */
async function persistGen(category?: string, name?: string): Promise<void> {
  const cat = category ?? props.category
  const nm = name ?? props.name
  if (!cat || !nm) return
  const content: PropGenConfig = {
    image: {
      impl: imgImpl.value,
      workflowParams: imageWorkflowParams.value,
      sizeConfig: imageSizeConfig.value,
    },
    video: {
      impl: videoImpl.value,
      workflowParams: videoWorkflowParams.value,
      sizeConfig: videoSizeConfig.value,
      duration: videoDuration.value,
    },
  }
  try {
    await writeFs(props.project, genJsonRel(cat, nm), `${JSON.stringify(content, null, 2)}\n`)
  } catch (e) {
    // 保存失败不阻断使用：参数仅影响下次生成，提示一次即可（有意忽略，避免重复弹窗）
    console.error('[prop-panel] 保存生成参数失败', e)
  }
}

/**
 * 读取生成参数（gen.json）回显：工作流实现、工作流参数、输出尺寸与视频时长。
 * 文件缺失/非法时保持默认值；实现有效性由 loadWorkflows 完成后再校验（实现列表为动态获取）。
 */
async function loadGen(): Promise<void> {
  if (!props.category || !props.name) return
  try {
    const data = await readFs(props.project, genJsonRel()) as Partial<PropGenConfig>
    if (data && typeof data === 'object') {
      const img = data.image ?? {}
      const vid = data.video ?? {}
      if (typeof img.impl === 'string' && img.impl) {
        imgImpl.value = img.impl
      }
      if (img.workflowParams && typeof img.workflowParams === 'object') {
        imageWorkflowParams.value = { ...img.workflowParams }
      }
      if (img.sizeConfig && typeof img.sizeConfig === 'object') {
        imageSizeConfig.value = img.sizeConfig as WorkflowSizeConfig
      }
      if (typeof vid.impl === 'string' && vid.impl) {
        videoImpl.value = vid.impl
      }
      if (vid.workflowParams && typeof vid.workflowParams === 'object') {
        videoWorkflowParams.value = { ...vid.workflowParams }
      }
      if (vid.sizeConfig && typeof vid.sizeConfig === 'object') {
        videoSizeConfig.value = vid.sizeConfig as WorkflowSizeConfig
      }
      if (typeof vid.duration === 'number' && vid.duration > 0) {
        videoDuration.value = vid.duration
      }
    }
  } catch {
    // gen.json 缺失时使用默认参数（首次进入无自定义配置，属预期情况）
  }
}

/**
 * 图片输出尺寸变化（WorkflowSizePicker 输出）→ 更新本地状态并持久化。
 *
 * @param v 用户选择的尺寸配置
 */
function onImageSizeConfigChange(v: WorkflowSizeConfig): void {
  imageSizeConfig.value = v
  schedulePersistGen()
}

/**
 * 视频输出尺寸变化 → 更新本地状态并持久化。
 *
 * @param v 用户选择的尺寸配置
 */
function onVideoSizeConfigChange(v: WorkflowSizeConfig): void {
  videoSizeConfig.value = v
  schedulePersistGen()
}

/**
 * 视频时长变化 → 更新本地状态并持久化。
 *
 * @param v 时长（秒）
 */
function onVideoDurationChange(v: number): void {
  videoDuration.value = v
  schedulePersistGen()
}

/**
 * 图片切换工作流实现：重置参数为默认（与画布生成节点 onImplChange 一致，避免跨实现参数串用）。
 */
function onImageImplChange(): void {
  imageWorkflowParams.value = {}
  imageSizeConfig.value = null
  schedulePersistGen()
}

/**
 * 视频切换工作流实现：重置参数为默认。
 */
function onVideoImplChange(): void {
  videoWorkflowParams.value = {}
  videoSizeConfig.value = null
  schedulePersistGen()
}

/**
 * 解析工作流实现条目的服务商显示名（下拉选项 chip；与画布生成节点一致）。
 *
 * @param raw 下拉原始条目
 * @returns 服务商显示名；未声明时为空串
 */
function providerLabelOf(raw: { providerName?: string; provider?: string }): string {
  return raw?.providerName ?? raw?.provider ?? ''
}

// ── 生成任务轮询 ───────────────────────────────────────────────────

const imgTaskId = ref<string | null>(null)
const videoTaskId = ref<string | null>(null)
const imgPolling = useWorkflowTask(imgTaskId)
const videoPolling = useWorkflowTask(videoTaskId)
const imgSubmitting = ref(false)
const videoSubmitting = ref(false)

/** 图片生成状态/日志/错误（透传轮询状态） */
const imgTaskStatus = computed(() => imgPolling.status.value)
const imgTaskError = computed(() => imgPolling.error.value)
const imgTaskLogs = computed(() => imgPolling.logs.value)
const videoTaskStatus = computed(() => videoPolling.status.value)
const videoTaskError = computed(() => videoPolling.error.value)
const videoTaskLogs = computed(() => videoPolling.logs.value)

// ── 资产选择器与历史对话框 ─────────────────────────────────────────

/** 资产选择器状态（kind 区分图片/视频页签的关联资产） */
const picker = reactive({
  show: false,
  kind: 'image' as 'image' | 'video',
  selected: [] as string[],
})

/** 历史版本对话框状态 */
const historyDialog = reactive({ show: false, path: '' })

/** 操作反馈 */
const snackbar = reactive({ show: false, text: '', color: 'primary' as 'primary' | 'error' | 'warning' | 'success' })

/** 音频/视频文件上传 input 引用 */
const audioInputRef = ref<HTMLInputElement | null>(null)
const videoInputRef = ref<HTMLInputElement | null>(null)

/**
 * 展示操作反馈提示。
 *
 * @param text 提示文案
 * @param color 提示颜色
 */
function showSnackbar(text: string, color: 'primary' | 'error' | 'warning' | 'success' = 'primary'): void {
  snackbar.text = text
  snackbar.color = color
  snackbar.show = true
}

/**
 * 加载道具详情：描述文案、关联资产、产物存在性与目录文件列表、项目分辨率。
 * 切换道具（project/category/name 变化）时调用。
 */
async function load(): Promise<void> {
  if (!props.category || !props.name) return
  try {
    const [imageMdRaw, videoMdRaw, refsRes, hasImageRes, hasVideoRes] = await Promise.all([
      readFs(props.project, `prompt/prop/${props.category}/${props.name}/image.md`) as Promise<string>,
      readFs(props.project, `prompt/prop/${props.category}/${props.name}/video.md`) as Promise<string>,
      getPropRefs(props.project, props.category, props.name),
      existsFs(props.project, imageOutputPath.value),
      existsFs(props.project, videoOutputPath.value),
    ])
    imageMd.value = imageMdRaw
    videoMd.value = videoMdRaw
    imageMdDirty.value = false
    videoMdDirty.value = false
    refs.value = refsRes.refs
    hasImage.value = hasImageRes
    hasVideo.value = hasVideoRes
    imageUrl.value = hasImageRes ? `/api/fs/${props.project}/${imageOutputPath.value}?t=${Date.now()}` : ''
    videoUrl.value = hasVideoRes ? `/api/fs/${props.project}/${videoOutputPath.value}?t=${Date.now()}` : ''
    await loadDirFiles()
    await loadProjectResolution()
    await loadGen()
  } catch (e) {
    showSnackbar(e instanceof Error ? `道具加载失败：${e.message}` : '道具加载失败', 'error')
  }
}

/**
 * 加载道具 assert 目录下的音频/视频文件列表（目录不存在时为空）。
 */
async function loadDirFiles(): Promise<void> {
  audioFiles.value = []
  uploadedMediaFiles.value = []
  if (!props.category || !props.name) return
  const dir = `assert/prop/${props.category}/${props.name}`
  try {
    const res = await readFs(props.project, dir) as { entries?: Array<{ name: string; type: 'file' | 'dir' }> }
    const files = (res.entries ?? []).filter((e) => e.type === 'file')
    audioFiles.value = files
      .filter((f) => isAudioFile(f.name))
      .map((f) => ({ name: f.name, path: `${dir}/${f.name}` }))
    uploadedMediaFiles.value = files
      .filter((f) => f.name !== 'video.mp4' && isVideoFile(f.name))
      .map((f) => ({ name: f.name, path: `${dir}/${f.name}` }))
  } catch {
    // 目录不存在时视为无文件（首次进入尚未生成产物）
  }
}

/**
 * 读取项目分辨率（project.json 的 width/height），缺失时保持默认 1280x720。
 */
async function loadProjectResolution(): Promise<void> {
  try {
    const data = await readFs(props.project, 'project.json') as { width?: number; height?: number }
    if (typeof data?.width === 'number' && data.width > 0 && typeof data?.height === 'number' && data.height > 0) {
      projectResolution.value = { width: data.width, height: data.height }
    }
  } catch {
    // project.json 缺失时使用默认分辨率（1280x720）
  }
}

// ── 描述文案保存 ───────────────────────────────────────────────────

/**
 * 保存图片描述文案到 prompt/prop/{分类}/{道具}/image.md。
 */
async function saveImageMd(): Promise<void> {
  if (!props.category || !props.name) return
  savingMd.value = true
  try {
    await writeFs(props.project, `prompt/prop/${props.category}/${props.name}/image.md`, imageMd.value)
    imageMdDirty.value = false
    showSnackbar('描述已保存', 'success')
  } catch (e) {
    showSnackbar(e instanceof Error ? e.message : '保存失败', 'error')
  } finally {
    savingMd.value = false
  }
}

/**
 * 保存视频描述文案到 prompt/prop/{分类}/{道具}/video.md。
 */
async function saveVideoMd(): Promise<void> {
  if (!props.category || !props.name) return
  savingMd.value = true
  try {
    await writeFs(props.project, `prompt/prop/${props.category}/${props.name}/video.md`, videoMd.value)
    videoMdDirty.value = false
    showSnackbar('描述已保存', 'success')
  } catch (e) {
    showSnackbar(e instanceof Error ? e.message : '保存失败', 'error')
  } finally {
    savingMd.value = false
  }
}

// ── 关联资产：选择 / 移除 / 排序 ───────────────────────────────────

/**
 * 打开资产选择器（关联资产均为图片：图片编辑输入图 / 图生视频首尾帧）。
 *
 * @param kind 关联资产目标页签（image=图片页签、video=视频页签）
 */
function openPicker(kind: 'image' | 'video'): void {
  picker.kind = kind
  picker.selected = [...refs.value[kind]]
  picker.show = true
}

/**
 * 资产选择器确认：更新对应页签的关联资产并持久化到 refs.json。
 *
 * @param paths 选中的资产路径列表
 */
function onPickerSelect(paths: string[]): void {
  const kind = picker.kind
  const next: PropRefs = {
    image: kind === 'image' ? paths : refs.value.image,
    video: kind === 'video' ? paths : refs.value.video,
  }
  refs.value = next
  void persistRefs(next)
  // 图片页签：关联资产变化时自动切换默认工作流类型（文生图 ↔ 图片编辑）
  if (kind === 'image') {
    imgWorkflowType.value = paths.length > 0 ? 'image-edit' : 'text-to-image'
  }
}

/**
 * 移除指定下标的关联资产并持久化。
 *
 * @param kind 关联资产类型
 * @param index 下标
 */
async function removeRef(kind: 'image' | 'video', index: number): Promise<void> {
  const list = [...refs.value[kind]]
  list.splice(index, 1)
  const next: PropRefs = { image: kind === 'image' ? list : refs.value.image, video: kind === 'video' ? list : refs.value.video }
  refs.value = next
  await persistRefs(next)
  if (kind === 'image') {
    imgWorkflowType.value = next.image.length > 0 ? 'image-edit' : 'text-to-image'
  }
}

/**
 * 上移/下移关联资产（首尾帧顺序 = 图片编辑输入顺序）并持久化。
 *
 * @param kind 关联资产类型
 * @param index 当前下标
 * @param dir 移动方向（-1 上移 / 1 下移）
 */
async function moveRef(kind: 'image' | 'video', index: number, dir: -1 | 1): Promise<void> {
  const list = [...refs.value[kind]]
  const target = index + dir
  if (target < 0 || target >= list.length) return
  const [moved] = list.splice(index, 1)
  list.splice(target, 0, moved)
  const next: PropRefs = { image: kind === 'image' ? list : refs.value.image, video: kind === 'video' ? list : refs.value.video }
  refs.value = next
  await persistRefs(next)
}

/**
 * 持久化关联资产到 refs.json（服务端规范化并去重）。
 *
 * @param next 待保存的配置
 */
async function persistRefs(next: PropRefs): Promise<void> {
  if (!props.category || !props.name) return
  try {
    const res = await savePropRefs(props.project, props.category, props.name, next)
    refs.value = res.refs
  } catch (e) {
    showSnackbar(e instanceof Error ? e.message : '保存关联资产失败', 'error')
  }
}

// ── 生成 ───────────────────────────────────────────────────────────

/**
 * 生成图片：无关联资产 → 文生图（text-to-image，先写入 image.md 再以 promptPath 提交）；
 * 有关联资产 → 图片编辑（image-edit，关联图片按序作为输入图）。
 * 产物固定 assert/prop/{分类}/{道具}/image.jpg，重复生成由服务端引擎归档历史。
 */
async function generateImage(): Promise<void> {
  if (!props.category || !props.name) return
  if (imgTaskStatus.value === 'running') return
  if (!imgImpl.value) {
    showSnackbar('请先选择工作流实现', 'warning')
    return
  }
  if (imgWorkflowType.value === 'image-edit' && refs.value.image.length === 0) {
    showSnackbar('图片编辑需要至少 1 张关联图片，请先选择关联资产', 'warning')
    return
  }
  imgSubmitting.value = true
  try {
    let vars: Record<string, string>
    if (imgWorkflowType.value === 'image-edit') {
      vars = {
        prompt: imageMd.value,
        imagePaths: JSON.stringify(refs.value.image),
        purpose: 'prop-image',
      }
    } else {
      // 文生图：先把当前描述文案写入 image.md，再以 promptPath 提交（与画布 text-to-image 一致）
      await writeFs(props.project, `prompt/prop/${props.category}/${props.name}/image.md`, imageMd.value)
      vars = { promptPath: `prompt/prop/${props.category}/${props.name}/image.md`, purpose: 'prop-image' }
    }
    const { taskId } = await runWorkflow({
      project: props.project,
      workflowId: imgWorkflowType.value,
      impl: imgImpl.value,
      params: {
        vars,
        outputPath: imageOutputPath.value,
        userParams: imageWorkflowParams.value,
        ...(imageSizeConfig.value ? { sizeConfig: imageSizeConfig.value } : {}),
      },
    })
    imgTaskId.value = taskId
  } catch (e) {
    showSnackbar(e instanceof Error ? e.message : '提交失败', 'error')
  } finally {
    imgSubmitting.value = false
  }
}

/**
 * 生成视频：图生视频（image-to-video，首尾帧模式）。
 * 无关联图片时提示先选择（系统无纯文生视频工作流）；1 张=首帧、2 张=首尾帧。
 * 产物固定 assert/prop/{分类}/{道具}/video.mp4。
 */
async function generateVideo(): Promise<void> {
  if (!props.category || !props.name) return
  if (videoTaskStatus.value === 'running') return
  if (!videoImpl.value) {
    showSnackbar('请先选择工作流实现', 'warning')
    return
  }
  const refsVideo = refs.value.video
  if (refsVideo.length === 0) {
    showSnackbar('当前为文生视频模式，但系统暂不支持纯文生视频。请先选择至少 1 张关联图片（可先在「图片」页签生成道具图片）', 'warning')
    return
  }
  if (refsVideo.length > 2) {
    showSnackbar('图生视频最多支持 2 张关联图片（首帧 + 尾帧）', 'warning')
    return
  }
  videoSubmitting.value = true
  try {
    // 先把当前描述文案写入 video.md（供后续参考与批量任务读取）
    await writeFs(props.project, `prompt/prop/${props.category}/${props.name}/video.md`, videoMd.value)
    const { taskId } = await runWorkflow({
      project: props.project,
      workflowId: 'image-to-video',
      impl: videoImpl.value,
      params: {
        vars: {},
        outputPath: videoOutputPath.value,
        userParams: videoWorkflowParams.value,
        video: {
          mode: 'first-last-frame',
          resolution: projectResolution.value,
          duration: videoDuration.value,
          prompt: videoMd.value,
          director: {
            frames: refsVideo.map((p, i) => ({
              path: p,
              cursor: refsVideo.length <= 1 ? 0 : i / (refsVideo.length - 1),
            })),
          },
          ...(videoSizeConfig.value ? { sizeConfig: videoSizeConfig.value } : {}),
          extraParams: {},
        },
      },
    })
    videoTaskId.value = taskId
  } catch (e) {
    showSnackbar(e instanceof Error ? e.message : '提交失败', 'error')
  } finally {
    videoSubmitting.value = false
  }
}

// ── 上传（图片走 AssetImageUploadButton；视频/音频保留原文件名）──────

/**
 * 上传音频文件到道具目录（保留原文件名；重名先归档历史）。
 *
 * @param event 文件选择事件
 */
async function onUploadAudio(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await uploadMediaFile(file, '音频')
}

/**
 * 上传视频文件到道具目录（保留原文件名；重名先归档历史）。
 *
 * @param event 文件选择事件
 */
async function onUploadVideo(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await uploadMediaFile(file, '视频')
}

/**
 * 上传媒体文件（音频/视频）到 assert/prop/{分类}/{道具}/ 下，保留原文件名。
 * 目标已存在时先归档为历史版本，再写入新文件。
 *
 * @param file 待上传文件
 * @param label 类型文案（用于提示）
 */
async function uploadMediaFile(file: File, label: string): Promise<void> {
  if (!props.category || !props.name) return
  const dest = `assert/prop/${props.category}/${props.name}/${file.name}`
  try {
    // 目标已存在时先归档历史（copy 保留旧文件），归档失败视为文件不存在，忽略
    try {
      await archiveAssetHistory(props.project, dest)
    } catch {
      // 目标文件不存在时归档接口返回错误，属预期情况，忽略
    }
    await uploadFs(props.project, dest, file)
    showSnackbar(`${label}上传成功`, 'success')
    await load()
  } catch (e) {
    showSnackbar(e instanceof Error ? e.message : `${label}上传失败`, 'error')
  }
}

/**
 * 打开历史版本对话框（图片/视频固定产物与上传文件共用）。
 *
 * @param path 资产相对路径
 */
function openHistory(path: string): void {
  historyDialog.path = path
  historyDialog.show = true
}

// ── 工作流加载（动态获取实现列表）─────────────────────────────────

/**
 * 加载全部工作流实现（含动态注册的自定义实现），并回显已保存的实现选择。
 */
async function loadWorkflows(): Promise<void> {
  try {
    workflows.value = await getWorkflows()
    const imgImpls = imgImplOptions.value
    if (imgImpls.length && !imgImpls.some((i) => i.impl === imgImpl.value)) {
      imgImpl.value = ''
    }
    const videoImpls = videoImplOptions.value
    if (videoImpls.length && !videoImpls.some((i) => i.impl === videoImpl.value)) {
      videoImpl.value = ''
    }
  } catch (e) {
    // 工作流列表获取失败不阻断页面：生成时校验会提示无可用实现
    console.error('[prop-panel] 工作流列表加载失败', e)
  }
}

/** 切换道具时：先落盘旧道具的生成参数（防抖窗口内未保存的，用旧路径），再重置状态并加载新道具 */
watch(
  () => [props.project, props.category, props.name] as const,
  (newVal, oldVal) => {
    // 防抖窗口内未保存的旧道具参数先落盘（用旧道具路径，避免写到新道具；跨项目切换丢弃）
    if (genSaveTimer) {
      clearTimeout(genSaveTimer)
      genSaveTimer = null
      const [oldProject, oldCategory, oldName] = oldVal as [string, string, string]
      if (oldProject && oldCategory && oldName && oldProject === newVal[0]) {
        void persistGen(oldCategory, oldName)
      }
    }
    imgTaskId.value = null
    videoTaskId.value = null
    imgImpl.value = ''
    videoImpl.value = ''
    imageWorkflowParams.value = {}
    imageSizeConfig.value = null
    videoWorkflowParams.value = {}
    videoSizeConfig.value = null
    void load()
    void loadWorkflows()
  },
  { immediate: true },
)

/** 图片任务完成/失败后刷新产物展示 */
watch(imgTaskStatus, (s) => {
  if (s === 'completed' || s === 'failed') void load()
})

/** 视频任务完成/失败后刷新产物展示 */
watch(videoTaskStatus, (s) => {
  if (s === 'completed' || s === 'failed') void load()
})

/** 工作流类型切换时清空实现选择与生成参数（不同类型实现不通用） */
watch(imgWorkflowType, () => {
  imgImpl.value = ''
  imageWorkflowParams.value = {}
  imageSizeConfig.value = null
})

/** 图片工作流用户参数变化 → 持久化（deep：菜单内单项修改也触发） */
watch(
  imageWorkflowParams,
  () => {
    schedulePersistGen()
  },
  { deep: true },
)

/** 视频工作流用户参数变化 → 持久化 */
watch(
  videoWorkflowParams,
  () => {
    schedulePersistGen()
  },
  { deep: true },
)

/** 组件卸载时落盘防抖窗口内未保存的生成参数 */
onUnmounted(() => {
  if (genSaveTimer) {
    clearTimeout(genSaveTimer)
    genSaveTimer = null
    void persistGen()
  }
})
</script>
