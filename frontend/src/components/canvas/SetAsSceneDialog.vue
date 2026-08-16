<template>
  <!-- 设为分镜场景图对话框：列出分镜全部场景帧，选中后确认覆盖；或新增场景图 -->
  <v-dialog
    :model-value="modelValue"
    max-width="620"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          class="mr-2"
          size="small"
        >
          mdi-image-multiple
        </v-icon>
        <span>设为分镜场景图</span>
      </v-card-title>
      <v-card-text>
        <div
          v-if="loading"
          class="text-grey text-body-medium"
        >
          加载中…
        </div>
        <template v-else>
          <div class="text-body-small text-medium-emphasis mb-2">
            点击场景帧进入选中状态，再点击「确认」设为场景图（共 {{ frames.length }} 帧）：
          </div>
          <div
            v-if="frames.length"
            class="d-flex flex-wrap ga-2 mb-2"
          >
            <div
              v-for="f in frames"
              :key="f.index"
              class="scene-frame-option"
              :class="{ 'scene-frame-option--selected': selectedIndex === f.index }"
              @click="selectedIndex = selectedIndex === f.index ? null : f.index"
            >
              <div class="scene-frame-option__img-wrap">
                <v-icon
                  v-if="selectedIndex === f.index"
                  class="scene-frame-option__check"
                  icon="mdi-check-circle"
                  size="small"
                />
                <img
                  v-if="!f.broken"
                  :src="f.imageUrl"
                  class="scene-frame-option__img"
                  @error="f.broken = true"
                >
                <div
                  v-else
                  class="scene-frame-option__img scene-frame-option__img--empty"
                >
                  <v-icon icon="mdi-image-off-outline" />
                </div>
              </div>
              <div
                class="scene-frame-option__label"
                :title="f.label"
              >
                场景{{ f.index + 1 }}：{{ f.label }}
              </div>
            </div>
          </div>
          <div
            v-else
            class="text-grey text-body-medium mb-2"
          >
            当前分镜还没有场景图定义（stage.json 为空）
          </div>
          <div class="d-flex align-center ga-2">
            <v-btn
              size="small"
              color="primary"
              variant="tonal"
              prepend-icon="mdi-plus"
              :disabled="!canAdd"
              @click="addNewFrame"
            >
              新增场景图
            </v-btn>
            <span
              v-if="!canAdd"
              class="text-body-small text-grey"
            >
              无可用的基础场景引用，可先在「场景图片」页签添加场景帧
            </span>
          </div>
        </template>
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
          variant="tonal"
          prepend-icon="mdi-check"
          :disabled="selectedIndex === null"
          @click="confirmSetAsScene"
        >
          确认
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { readFs, copyFs } from '../../api/client'
import { createSceneStageFrame } from '../../api/assets'
import { buildSceneFrameOptions, deriveStageFrameBody, type SceneFrameOption } from '../../canvas/sceneFrame'
import type { CanvasInputInfo } from '../../canvas/generate'
import type { CanvasNodeData } from '../../canvas/types'

/**
 * 「设为分镜场景图」对话框：打开时读取 stage.json 列出全部场景帧，
 * 点击进入选中状态后确认覆盖该帧；「新增场景图」按节点输入推导新帧定义并追加。
 * 覆盖/新增均把节点当前产物复制到 assert/scene/{集数}/{分镜}/stage/{i}.jpg。
 */
const props = defineProps<{
  /** 对话框显隐（v-model） */
  modelValue: boolean
  /** 项目名 */
  project: string
  /** 生成节点（产物来源；为空时不执行） */
  node: CanvasNodeData | null
  /** 当前产物（固定路径 + 防缓存 token；由 AssetCanvas 下发，优先于 config.current 旧数据） */
  output?: { path: string; token?: number } | null
  /** 生成节点输入资产（推导新帧定义） */
  inputs: CanvasInputInfo[]
  /** 分镜集数 */
  episode?: string
  /** 分镜号 */
  shot?: string
}>()

const emit = defineEmits<{
  /** 对话框显隐变化 */
  (e: 'update:modelValue', value: boolean): void
  /** 操作完成提示（父级 snackbar） */
  (e: 'done', message: string, color: 'success' | 'error'): void
}>()

/** 帧列表加载中标记 */
const loading = ref(false)
/** 分镜现有场景帧选项 */
const frames = ref<SceneFrameOption[]>([])
/** 当前选中的场景帧下标；null 表示未选中 */
const selectedIndex = ref<number | null>(null)
/** 新增场景图可推导的新帧定义（null 表示禁用新增） */
const newFrameBody = ref<{ 基础场景: string; 登场角色: string[]; prompt: string } | null>(null)
/** 新增场景图是否可用 */
const canAdd = ref(false)

/**
 * 打开对话框：读取 stage.json 列出场景帧，并推导可新增的新帧定义。
 */
async function open(): Promise<void> {
  const node = props.node
  if (!node) return
  loading.value = true
  frames.value = []
  canAdd.value = false
  newFrameBody.value = null
  selectedIndex.value = null
  try {
    const raw = await readFs(props.project, `prompt/scene/${props.episode}/${props.shot}/stage.json`)
    let defs: { 基础场景?: string; prompt?: string }[] = []
    if (Array.isArray(raw)) {
      defs = raw as { 基础场景?: string; prompt?: string }[]
    } else if (typeof raw === 'string' && raw.trim()) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) defs = parsed as { 基础场景?: string; prompt?: string }[]
    }
    const ts = Date.now()
    frames.value = buildSceneFrameOptions(
      defs,
      (i) => `/api/fs/${props.project}/assert/scene/${props.episode}/${props.shot}/stage/${i}.jpg?t=${ts}`,
    )
    newFrameBody.value = deriveStageFrameBody(props.inputs, defs, node.config.prompt)
    canAdd.value = newFrameBody.value !== null
  } catch {
    // stage.json 不存在：按空帧处理，仅可新增（若有可用基础场景）
    newFrameBody.value = deriveStageFrameBody(props.inputs, [], node.config.prompt)
    canAdd.value = newFrameBody.value !== null
  } finally {
    loading.value = false
  }
}

// 打开时加载帧列表
watch(
  () => props.modelValue,
  (visible) => {
    if (visible) void open()
  },
)

/**
 * 确认「设为分镜场景图」：把当前选中的场景帧应用为分镜场景图。
 */
function confirmSetAsScene(): void {
  if (selectedIndex.value === null) return
  const frame = frames.value[selectedIndex.value]
  if (frame) void applySetAsScene(frame)
}

/** 新增场景图：追加一帧并复制当前产物 */
function addNewFrame(): void {
  void applySetAsScene(null)
}

/**
 * 应用「设为分镜场景图」：覆盖选中帧，或新增场景图帧并复制当前产物。
 *
 * @param frame 要覆盖的帧；null 表示新增场景图
 */
async function applySetAsScene(frame: SceneFrameOption | null): Promise<void> {
  const node = props.node
  // 当前产物优先取 AssetCanvas 下发的固定路径产物（"当前结果"为文件系统事实），回落到 config.current 旧数据
  const cur = props.output ?? (node?.config.current as { path?: string } | undefined)
  if (!node || !cur?.path) {
    emit('update:modelValue', false)
    return
  }
  const ep = props.episode
  const shot = props.shot
  try {
    if (frame) {
      await copyFs(props.project, cur.path, `assert/scene/${ep}/${shot}/stage/${frame.index}.jpg`)
    } else if (newFrameBody.value) {
      const res = await createSceneStageFrame(props.project, ep ?? '', shot ?? '', newFrameBody.value)
      await copyFs(props.project, cur.path, `assert/scene/${ep}/${shot}/stage/${res.index}.jpg`)
    }
    emit('done', '已设为分镜场景图', 'success')
  } catch (e) {
    emit('done', e instanceof Error ? e.message : '设为分镜场景图失败', 'error')
  } finally {
    emit('update:modelValue', false)
  }
}
</script>

<style scoped>
.scene-frame-option {
  width: 150px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.scene-frame-option:hover {
  border-color: rgb(25, 118, 210);
  box-shadow: 0 0 0 1px rgb(25, 118, 210);
}

.scene-frame-option--selected {
  border-color: rgb(25, 118, 210);
  box-shadow: 0 0 0 2px rgb(25, 118, 210);
}

.scene-frame-option__img-wrap {
  height: 100px;
  background: rgba(0, 0, 0, 0.04);
  position: relative;
}

.scene-frame-option__check {
  position: absolute;
  top: 4px;
  right: 4px;
  color: rgb(25, 118, 210);
  background: #fff;
  border-radius: 50%;
}

.scene-frame-option__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.scene-frame-option__img--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.38);
}

.scene-frame-option__label {
  padding: 4px 6px;
  font-size: 12px;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: #fff;
}
</style>
