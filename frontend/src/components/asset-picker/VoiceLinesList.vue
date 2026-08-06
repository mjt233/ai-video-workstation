<template>
  <div
    v-if="tabLoading"
    class="d-flex align-center justify-center py-8"
  >
    <v-progress-circular
      indeterminate
      size="28"
    />
  </div>
  <template v-else>
    <div
      v-if="voiceLines.length"
      class="d-flex flex-column ga-1"
    >
      <div
        v-for="line in voiceLines"
        :key="line.index"
        class="audio-item d-flex align-center ga-2 px-2 py-1 rounded"
        :class="{
          'audio-item--disabled': !line.hasFile,
          'asset-card--selected': line.hasFile && isSelected(line.path),
        }"
        @click="line.hasFile && $emit('select', line.item)"
      >
        <v-icon
          :color="line.hasFile ? 'secondary' : 'grey'"
          size="20"
        >
          mdi-account-voice
        </v-icon>
        <div
          class="flex-grow-1"
          style="min-width: 0;"
        >
          <div class="text-body-small text-truncate">
            <strong>{{ line.index + 1 }}. {{ line.角色名 }}</strong>
            <span class="text-grey ml-1">{{ line.台词 }}</span>
          </div>
        </div>
        <v-chip
          v-if="!line.hasFile"
          size="x-small"
          variant="tonal"
          color="grey"
        >
          未生成语音
        </v-chip>
        <v-icon
          v-else-if="isSelected(line.path)"
          color="primary"
          size="18"
        >
          mdi-check-circle
        </v-icon>
      </div>
    </div>
    <div
      v-else
      class="text-grey text-body-medium text-center py-8"
    >
      该分镜暂无台词
    </div>
  </template>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { existsFs, readFs } from '../../api/client'
import type { AssetItem, VoiceLineItem } from './types'

/**
 * 台词音频子页签。
 *
 * 按选中的集数/分镜读取 script.json 的台词列表，逐条探测对应语音文件
 * （assert/scene/{ep}/{shot}/voice/{index}-{角色名}.flac）是否存在；
 * 无论是否已生成都展示，仅存在语音文件的台词可选。
 * 集数/分镜变化时自动重新加载（支持选择任意分镜的台词音频）。
 */
const props = withDefaults(defineProps<{
  /** 项目名 */
  project: string
  /** 选中的集数（可任意指定，不限于当前上下文） */
  episode?: string
  /** 选中的分镜（可任意指定，不限于当前上下文） */
  shot?: string
  /** 当前已选中的资产路径列表（用于高亮） */
  selectedPaths: string[]
  /** 该子页签是否激活（激活时加载数据） */
  active: boolean
  /** 弹窗打开时递增的重新加载信号 */
  reloadKey: number
}>(), {
  episode: undefined,
  shot: undefined,
})

defineEmits<{
  /** 点击可选的台词，携带其语音文件条目 */
  select: [item: AssetItem]
}>()

/** 加载中标记 */
const tabLoading = ref(false)
/** 台词列表（读 script.json，未生成语音的台词禁用） */
const voiceLines = ref<VoiceLineItem[]>([])

/**
 * 判断路径是否已被选中。
 *
 * @param path 语音文件相对路径
 * @returns true 表示已选中
 */
function isSelected(path: string): boolean {
  return props.selectedPaths.includes(path)
}

/**
 * 加载「台词音频」子页签数据。
 */
async function loadVoiceLines() {
  const ep = props.episode
  const shot = props.shot
  if (!ep || !shot) {
    voiceLines.value = []
    return
  }
  tabLoading.value = true
  try {
    const scriptRaw = await readFs(props.project, `prompt/scene/${ep}/${shot}/script.json`).catch(() => null)
    let script: Array<{ 角色名?: string; 台词?: string }> = []
    if (typeof scriptRaw === 'string') {
      const text = scriptRaw.trim()
      if (text) script = JSON.parse(text) as Array<{ 角色名?: string; 台词?: string }>
    } else if (Array.isArray(scriptRaw)) {
      script = scriptRaw as Array<{ 角色名?: string; 台词?: string }>
    }

    const lines: VoiceLineItem[] = []
    for (let i = 0; i < script.length; i++) {
      const role = (script[i]?.角色名 ?? '').trim()
      const text = (script[i]?.台词 ?? '').trim()
      if (!role) continue
      const path = `assert/scene/${ep}/${shot}/voice/${i}-${role}.flac`
      const hasFile = await existsFs(props.project, path)
      lines.push({
        index: i,
        角色名: role,
        台词: text,
        hasFile,
        path,
        item: {
          path,
          label: `${i + 1}. ${role}`, // 已选区域用简短标签
          thumbnail: '',
          depth: 0,
        },
      })
    }
    voiceLines.value = lines
  } finally {
    tabLoading.value = false
  }
}

/** 子页签激活、reloadKey 变化或集数/分镜切换时重新加载 */
watch(
  () => [props.active, props.reloadKey, props.episode, props.shot] as const,
  () => {
    if (props.active) void loadVoiceLines()
  },
  { immediate: true },
)
</script>

<style scoped>
/* 音频条目（台词行） */
.audio-item {
  cursor: pointer;
  transition: background 0.15s ease;
}

.audio-item:hover {
  background: rgba(var(--v-theme-primary), 0.05);
}

/* 未生成语音的台词：禁用态 */
.audio-item--disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.asset-card--selected {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}
</style>
