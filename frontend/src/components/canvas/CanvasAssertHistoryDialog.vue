<template>
  <v-dialog
    :model-value="modelValue"
    max-width="780"
    @update:model-value="onDialogUpdate"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          class="mr-2"
          size="small"
        >
          mdi-history
        </v-icon>
        <span>版本历史</span>
      </v-card-title>
      <v-card-text>
        <div
          v-if="entries.length === 0 && !loading"
          class="text-grey text-body-medium"
        >
          暂无历史版本
        </div>
        <div
          v-else
          class="history-body"
        >
          <!-- 左侧大图/视频/音频预览（按选中条目媒体类型渲染） -->
          <div class="history-preview">
            <video
              v-if="previewKind === 'video' && !previewBroken"
              :src="previewUrl"
              controls
              class="history-preview__media"
              @error="previewBroken = true"
            >
              您的浏览器不支持视频预览
            </video>
            <audio
              v-else-if="previewKind === 'audio' && !previewBroken"
              :src="previewUrl"
              controls
              class="history-preview__audio"
              @error="previewBroken = true"
            >
              您的浏览器不支持音频预览
            </audio>
            <img
              v-else-if="!previewBroken"
              :src="previewUrl"
              class="history-preview__img"
              @error="previewBroken = true"
            >
            <div
              v-else
              class="history-preview__img history-preview__img--empty"
            >
              <v-icon :icon="emptyIcon" />
            </div>
            <div class="history-preview__label">
              {{ selectedLabel }}
            </div>
          </div>
          <!-- 右侧历史列表（首条为当前产物虚拟项，其余来自服务端历史目录） -->
          <v-list
            class="history-list"
            density="compact"
          >
            <v-list-item
              v-for="(h, idx) in entries"
              :key="h.path"
              :class="{ 'history-item--current': h.isCurrent }"
              @click="selectEntry(h)"
            >
              <template #prepend>
                <video
                  v-if="thumbKind(h) === 'video' && !isBroken(idx)"
                  :src="thumbUrl(h)"
                  muted
                  preload="metadata"
                  class="history-item__thumb"
                  @error="markBroken(idx)"
                />
                <div
                  v-else-if="thumbKind(h) === 'audio' && !isBroken(idx)"
                  class="history-item__thumb history-item__thumb--audio"
                >
                  <v-icon
                    icon="mdi-music-note"
                    size="small"
                  />
                </div>
                <img
                  v-else-if="!isBroken(idx)"
                  :src="thumbUrl(h)"
                  class="history-item__thumb"
                  @error="markBroken(idx)"
                >
                <div
                  v-else
                  class="history-item__thumb history-item__thumb--empty"
                >
                  <v-icon
                    icon="mdi-image-off-outline"
                    size="small"
                  />
                </div>
              </template>
              <v-list-item-title class="text-body-medium">
                {{ h.isCurrent ? '当前版本' : h.name }}
                <v-chip
                  v-if="h.isCurrent"
                  size="x-small"
                  color="primary"
                  class="ml-1"
                >
                  当前
                </v-chip>
              </v-list-item-title>
              <v-list-item-subtitle class="text-body-small">
                {{ formatDate(h.date) }}
              </v-list-item-subtitle>
              <template #append>
                <div class="history-item__actions">
                  <v-btn
                    size="x-small"
                    variant="text"
                    color="error"
                    icon="mdi-delete-outline"
                    :disabled="h.isCurrent || loading"
                    :title="h.isCurrent ? '当前版本不可删除' : '删除该版本'"
                    @click.stop="deleteEntry(h)"
                  />
                  <v-btn
                    size="x-small"
                    variant="tonal"
                    color="primary"
                    :disabled="h.isCurrent || loading"
                    @click.stop="activateEntry(h)"
                  >
                    设为当前
                  </v-btn>
                </div>
              </template>
            </v-list-item>
          </v-list>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="closeDialog"
        >
          关闭
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasNodeData } from '../../canvas/types'
import { buildPreviewUrl } from '../../canvas/preview'
import { activateAssetHistory, deleteAssetHistory, listAssetHistory } from '../../api/assets'
import { confirm } from '../../utils/confirm'
import { getPreviewKind, isAudioFile, isVideoFile, type PreviewKind } from '../../utils/customAssetFile'

/** 历史条目（当前产物虚拟项 + 服务端历史目录条目） */
interface DialogEntry {
  /** 资产相对路径（当前项为固定产物路径；历史项为 history/ 下路径） */
  path: string
  /** 展示时间（ISO） */
  date: string
  /** 展示名（历史项为时间戳文件名） */
  name: string
  /** 是否为当前产物（虚拟项；不可激活/删除） */
  isCurrent: boolean
}

/** 组件 props：显隐、项目名、生成节点数据（null 时空态）、当前产物（固定路径 + mtime） */
const props = defineProps<{
  modelValue: boolean
  project: string
  node: CanvasNodeData | null
  output?: { path: string; token?: number } | null
}>()

/** 组件 emits：显隐同步；激活/删除成功后通知父级刷新节点产物展示与操作反馈 */
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'refresh', nodeId: string): void
  (e: 'notify', text: string, color: 'success' | 'error' | 'primary'): void
}>()

/** 历史条目列表（服务端历史 API；首条为当前产物虚拟项） */
const entries = ref<DialogEntry[]>([])
/** 正在加载/操作中标记（禁用按钮，防止重复提交） */
const loading = ref(false)

/** 当前选中的条目（驱动左侧大图预览；初始/激活后跟随当前项） */
const selected = ref<DialogEntry | null>(null)

/** 大图预览加载失败标记 */
const previewBroken = ref(false)

/** 缩略图加载失败的下标集合（按列表下标记忆） */
const brokenIndexes = ref<Set<number>>(new Set())

/** 当前产物路径（优先 AssetCanvas 下发的固定路径产物，回落到 config.current 旧数据） */
function currentOutputPath(): string | null {
  const out = props.output
  if (out?.path) return out.path
  const cur = props.node?.config.current as { path?: string } | undefined
  return cur?.path ?? null
}

/** 某下标是否已标记缩略图加载失败 */
function isBroken(idx: number): boolean {
  return brokenIndexes.value.has(idx)
}

/** 标记某下标缩略图加载失败 */
function markBroken(idx: number): void {
  brokenIndexes.value = new Set(brokenIndexes.value).add(idx)
}

/** 从服务端加载历史列表（含当前产物虚拟首条） */
async function loadHistory(): Promise<void> {
  const node = props.node
  if (!node || !props.modelValue) return
  const path = currentOutputPath()
  if (!path) {
    entries.value = []
    return
  }
  loading.value = true
  try {
    const { versions } = await listAssetHistory(props.project, path)
    const list: DialogEntry[] = [
      {
        path,
        date: props.output?.token ? new Date(props.output.token).toISOString() : '',
        name: '当前产物',
        isCurrent: true,
      },
    ]
    for (const v of versions) {
      list.push({ path: v.path, date: new Date(v.mtime).toISOString(), name: v.name, isCurrent: false })
    }
    entries.value = list
    selected.value = list[0] ?? null
    brokenIndexes.value = new Set()
  } finally {
    loading.value = false
  }
}

/** 大图预览 URL（无选中或加载失败时为空） */
const previewUrl = computed(() => {
  const s = selected.value
  return s ? buildPreviewUrl(props.project, s.path) : ''
})

/** 大图预览标签（展示名 + 时间） */
const selectedLabel = computed(() => {
  const s = selected.value
  return s ? `${s.name} · ${formatDate(s.date)}` : ''
})

/** 大图预览媒体类型（按选中条目路径扩展名推断；无选中时为 none） */
const previewKind = computed<PreviewKind>(() => {
  const s = selected.value
  return s ? getPreviewKind(s.path) : 'none'
})

/** 大图/缩略图加载失败或空态占位图标（按媒体类型） */
const emptyIcon = computed(() => {
  if (previewKind.value === 'video') return 'mdi-video-off-outline'
  if (previewKind.value === 'audio') return 'mdi-music-off-outline'
  return 'mdi-image-off-outline'
})

/**
 * 条目缩略图媒体类型（视频用 muted 视频缩略、音频用图标占位、其余按图片）。
 *
 * @param h 历史条目
 * @returns 媒体类型
 */
function thumbKind(h: DialogEntry): 'image' | 'video' | 'audio' {
  if (isVideoFile(h.path)) return 'video'
  if (isAudioFile(h.path)) return 'audio'
  return 'image'
}

/** 缩略图 URL */
function thumbUrl(h: DialogEntry): string {
  return buildPreviewUrl(props.project, h.path)
}

/** 点击列表行：仅更新大图预览（不激活） */
function selectEntry(h: DialogEntry): void {
  selected.value = h
  previewBroken.value = false
}

/**
 * 「设为当前」：服务端激活历史版本（history 文件换回当前产物固定路径）。
 * 成功后刷新列表与父级产物展示。
 *
 * @param h 历史条目
 */
async function activateEntry(h: DialogEntry): Promise<void> {
  if (h.isCurrent || loading.value) return
  const path = currentOutputPath()
  if (!path) return
  loading.value = true
  try {
    await activateAssetHistory(props.project, path, h.path)
    emit('refresh', props.node?.id ?? '')
    emit('notify', '已设为当前版本', 'success')
    await loadHistory()
  } catch (e) {
    emit('notify', e instanceof Error ? e.message : '激活历史版本失败', 'error')
  } finally {
    loading.value = false
  }
}

/**
 * 「删除」：确认后调用服务端删除该历史版本文件；成功后刷新列表。
 * 当前版本不可删除（列表已禁用）；删除后对话框保持打开。
 *
 * @param h 历史条目
 */
async function deleteEntry(h: DialogEntry): Promise<void> {
  if (h.isCurrent || loading.value) return
  const path = currentOutputPath()
  if (!path) return
  const ok = await confirm({
    title: '删除历史版本',
    content: `确定删除历史版本 ${h.name} 的文件吗？此操作不可撤销。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  loading.value = true
  try {
    await deleteAssetHistory(props.project, path, h.path)
    emit('notify', '已删除历史版本', 'success')
    await loadHistory()
  } catch (e) {
    emit('notify', e instanceof Error ? e.message : '删除历史版本失败', 'error')
  } finally {
    loading.value = false
  }
}

/** 内部 v-dialog 显隐变化 → 透传父组件 */
function onDialogUpdate(v: unknown): void {
  emit('update:modelValue', Boolean(v))
}

/** 关闭对话框 */
function closeDialog(): void {
  emit('update:modelValue', false)
}

/** 格式化 ISO 时间为本地可读文本 */
function formatDate(iso: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('zh-CN')
  } catch {
    return iso
  }
}

// 打开时加载历史（服务端）；关闭时清空
watch(
  () => props.modelValue,
  (open) => {
    if (open) void loadHistory()
    else entries.value = []
  },
)
</script>

<style scoped>
.history-body {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.history-preview {
  flex: none;
  width: 300px;
}

.history-preview__img {
  width: 300px;
  height: 300px;
  object-fit: contain;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: rgba(0, 0, 0, 0.04);
}

.history-preview__media {
  width: 300px;
  height: 300px;
  object-fit: contain;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #000;
}

.history-preview__audio {
  width: 100%;
  margin-top: 132px;
}

.history-preview__img--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.38);
}

.history-preview__label {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.6);
}

.history-list {
  flex: 1;
  min-width: 0;
  max-height: 340px;
  overflow-y: auto;
}

.history-item--current {
  background: rgba(25, 118, 210, 0.08);
}

.history-item__actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.history-item__thumb {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(0, 0, 0, 0.04);
}

.history-item__thumb--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.38);
}

.history-item__thumb--audio {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.54);
}
</style>