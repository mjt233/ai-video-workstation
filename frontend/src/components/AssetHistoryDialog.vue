<template>
  <v-dialog
    :model-value="modelValue"
    max-width="760"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">
          mdi-history
        </v-icon>
        历史版本
      </v-card-title>
      <v-card-subtitle class="text-wrap">
        {{ assetPath }}
      </v-card-subtitle>
      <v-card-text>
        <v-alert
          v-if="error"
          type="error"
          density="compact"
          class="mb-3"
        >
          {{ error }}
        </v-alert>

        <div
          v-if="loading"
          class="text-center py-6"
        >
          <v-progress-circular indeterminate />
        </div>

        <div
          v-else-if="!versions.length"
          class="text-grey text-body-2 py-4"
        >
          暂无历史版本
        </div>

        <v-row v-else>
          <v-col
            v-for="v in versions"
            :key="v.path"
            cols="12"
            sm="6"
            md="4"
          >
            <v-card
              variant="outlined"
              class="h-100"
            >
              <div class="pa-2 d-flex justify-center align-center history-preview">
                <v-img
                  v-if="isImage"
                  :src="urlFor(v.path)"
                  max-height="160"
                  contain
                />
                <audio
                  v-else-if="isAudio"
                  :src="urlFor(v.path)"
                  controls
                  style="width: 100%;"
                />
                <video
                  v-else-if="isVideo"
                  :src="urlFor(v.path)"
                  controls
                  style="width: 100%; max-height: 160px;"
                />
                <div
                  v-else
                  class="text-grey text-caption"
                >
                  {{ v.name }}
                </div>
              </div>
              <v-card-text class="pt-1 pb-1">
                <div class="text-body-2 font-weight-medium">
                  {{ v.name }}
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ formatTime(v.mtime) }} · {{ formatSize(v.size) }}
                </div>
              </v-card-text>
              <v-card-actions>
                <v-btn
                  size="small"
                  color="error"
                  variant="text"
                  :loading="deleting === v.path"
                  :disabled="!!activating || (!!deleting && deleting !== v.path)"
                  @click="remove(v.path)"
                >
                  删除
                </v-btn>
                <v-spacer />
                <v-btn
                  size="small"
                  color="primary"
                  variant="tonal"
                  :loading="activating === v.path"
                  :disabled="!!deleting || (!!activating && activating !== v.path)"
                  @click="activate(v.path)"
                >
                  激活为当前
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="$emit('update:modelValue', false)"
        >
          关闭
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AssetApiError,
  activateAssetHistory,
  deleteAssetHistory,
  listAssetHistory,
  type HistoryVersion,
} from '../api/assets'

const props = defineProps<{
  modelValue: boolean
  project: string
  assetPath: string
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  activated: []
}>()

const loading = ref(false)
const error = ref('')
const versions = ref<HistoryVersion[]>([])
const activating = ref('')
const deleting = ref('')

const ext = computed(() => {
  const p = props.assetPath.toLowerCase()
  const i = p.lastIndexOf('.')
  return i >= 0 ? p.slice(i) : ''
})
const isImage = computed(() => ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext.value))
const isAudio = computed(() => ['.flac', '.mp3', '.wav'].includes(ext.value))
const isVideo = computed(() => ['.mp4', '.webm'].includes(ext.value))

function urlFor(rel: string) {
  return `/api/fs/${props.project}/${rel}?t=${Date.now()}`
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('zh-CN')
  } catch {
    return iso
  }
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

async function load() {
  if (!props.assetPath) return
  loading.value = true
  error.value = ''
  try {
    const res = await listAssetHistory(props.project, props.assetPath)
    versions.value = res.versions
  } catch (e) {
    versions.value = []
    error.value = e instanceof AssetApiError ? e.message : '加载历史版本失败'
  } finally {
    loading.value = false
  }
}

async function activate(versionPath: string) {
  if (!confirm('确定将该历史版本激活为当前使用版本？当前版本将归档到历史。')) return
  activating.value = versionPath
  error.value = ''
  try {
    await activateAssetHistory(props.project, props.assetPath, versionPath)
    emit('activated')
    await load()
  } catch (e) {
    error.value = e instanceof AssetApiError ? e.message : '激活失败'
  } finally {
    activating.value = ''
  }
}

async function remove(versionPath: string) {
  if (!confirm('确定永久删除该历史版本？此操作不可撤销。')) return
  deleting.value = versionPath
  error.value = ''
  try {
    await deleteAssetHistory(props.project, props.assetPath, versionPath)
    await load()
  } catch (e) {
    error.value = e instanceof AssetApiError ? e.message : '删除失败'
  } finally {
    deleting.value = ''
  }
}

watch(() => props.modelValue, (open) => {
  if (open) void load()
})
</script>

<style scoped>
.history-preview {
  min-height: 120px;
  background: rgba(0, 0, 0, 0.03);
}
</style>
