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
          v-if="!props.node || entries.length === 0"
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
          <!-- 右侧历史列表 -->
          <v-list
            class="history-list"
            density="compact"
          >
            <v-list-item
              v-for="h in entries"
              :key="h.version"
              :class="{ 'history-item--current': isCurrent(h) }"
              @click="selectEntry(h)"
            >
              <template #prepend>
                <video
                  v-if="thumbKind(h) === 'video' && !isBroken(h)"
                  :src="thumbUrl(h)"
                  muted
                  preload="metadata"
                  class="history-item__thumb"
                  @error="markBroken(h)"
                />
                <div
                  v-else-if="thumbKind(h) === 'audio' && !isBroken(h)"
                  class="history-item__thumb history-item__thumb--audio"
                >
                  <v-icon
                    icon="mdi-music-note"
                    size="small"
                  />
                </div>
                <img
                  v-else-if="!isBroken(h)"
                  :src="thumbUrl(h)"
                  class="history-item__thumb"
                  @error="markBroken(h)"
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
                v{{ h.version }}
                <v-chip
                  v-if="isCurrent(h)"
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
                    :disabled="isCurrent(h)"
                    :title="isCurrent(h) ? '当前版本不可删除' : '删除该版本'"
                    @click.stop="deleteEntry(h)"
                  />
                  <v-btn
                    size="x-small"
                    variant="tonal"
                    color="primary"
                    :disabled="isCurrent(h)"
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
import { getHistory, type HistoryEntry } from '../../canvas/generate'
import { buildPreviewUrl } from '../../canvas/preview'
import { getPreviewKind, isAudioFile, isVideoFile, type PreviewKind } from '../../utils/customAssetFile'

/** 组件 props：显隐、项目名、生成节点数据（null 时空态） */
const props = defineProps<{
  modelValue: boolean
  project: string
  node: CanvasNodeData | null
}>()

/** 组件 emits：显隐同步、请求激活某历史版本、请求删除某历史版本 */
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'activate', entry: HistoryEntry): void
  (e: 'delete', entry: HistoryEntry): void
}>()

/** 历史条目列表（取节点 config.history） */
const entries = computed<HistoryEntry[]>(() => (props.node ? getHistory(props.node.config) : []))

/** 当前激活条目（config.current，用于标记与初始化选中） */
const currentEntry = computed<HistoryEntry | null>(() => {
  const cur = props.node?.config.current as { version?: number; path?: string; date?: string } | undefined
  if (!cur?.path) return null
  return { version: cur.version ?? 0, path: cur.path, date: cur.date ?? '' }
})

/** 当前选中的条目（驱动左侧大图预览；初始/激活后跟随当前项） */
const selected = ref<HistoryEntry | null>(null)

/** 大图预览加载失败标记 */
const previewBroken = ref(false)

/** 缩略图加载失败的版本集合（按 version 记忆） */
const brokenVersions = ref<Set<number>>(new Set())

/** 某版本是否已标记加载失败 */
function isBroken(h: HistoryEntry): boolean {
  return brokenVersions.value.has(h.version)
}

/** 标记某版本缩略图加载失败 */
function markBroken(h: HistoryEntry) {
  brokenVersions.value = new Set(brokenVersions.value).add(h.version)
}

/** 是否某条目为当前项（版本号 + 路径都一致） */
function isCurrent(h: HistoryEntry): boolean {
  const cur = currentEntry.value
  return cur !== null && cur.version === h.version && cur.path === h.path
}

/** 大图预览 URL（无选中或加载失败时为空） */
const previewUrl = computed(() => {
  const s = selected.value
  return s ? buildPreviewUrl(props.project, s.path, s.version) : ''
})

/** 大图预览标签（版本 + 生成时间） */
const selectedLabel = computed(() => {
  const s = selected.value
  return s ? `v${s.version} · ${formatDate(s.date)}` : ''
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
function thumbKind(h: HistoryEntry): 'image' | 'video' | 'audio' {
  if (isVideoFile(h.path)) return 'video'
  if (isAudioFile(h.path)) return 'audio'
  return 'image'
}

/** 缩略图 URL */
function thumbUrl(h: HistoryEntry): string {
  return buildPreviewUrl(props.project, h.path, h.version)
}

/** 点击列表行：仅更新大图预览（不激活） */
function selectEntry(h: HistoryEntry) {
  selected.value = h
  previewBroken.value = false
}

/** 点击「设为当前」：请求父组件激活（父组件写回 current 后本组件随 node 更新） */
function activateEntry(h: HistoryEntry) {
  emit('activate', h)
}

/** 点击「删除」：请求父组件删除该历史版本（父组件确认后删除文件并更新 history） */
function deleteEntry(h: HistoryEntry) {
  emit('delete', h)
}

/** 内部 v-dialog 显隐变化 → 透传父组件 */
function onDialogUpdate(v: unknown) {
  emit('update:modelValue', Boolean(v))
}

/** 关闭对话框 */
function closeDialog() {
  emit('update:modelValue', false)
}

/** 格式化 ISO 时间为本地可读文本 */
function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN')
  } catch {
    return iso
  }
}

// 打开时（或节点变化）：重置选中为当前项，清空大图加载失败标记
watch(
  [() => props.modelValue, () => props.node],
  () => {
    if (props.modelValue && props.node) {
      selected.value = currentEntry.value
      previewBroken.value = false
    }
  },
  { immediate: true },
)

// 激活后（node 变化导致 currentEntry 更新）：选中项跟随新的当前项，便于继续对比
watch(currentEntry, (cur) => {
  if (cur) {
    selected.value = cur
    previewBroken.value = false
  }
})

// 删除后（entries 变化）：若选中的条目已被移除，则回落到当前项，避免预览指向已删除文件
watch(entries, (list) => {
  const sel = selected.value
  if (sel && !list.some((h) => h.version === sel.version)) {
    selected.value = currentEntry.value
    previewBroken.value = false
  }
})
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
