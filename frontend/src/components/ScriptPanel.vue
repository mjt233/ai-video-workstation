<template>
  <div style="flex: 1; min-height: 0; overflow-y: auto;">
    <v-alert
      v-if="loadError"
      type="error"
      variant="tonal"
      class="mb-2"
      density="compact"
    >
      {{ loadError }}
    </v-alert>
    <v-alert
      v-if="saveSuccess"
      type="success"
      variant="tonal"
      class="mb-2"
      density="compact"
    >
      {{ saveSuccess }}
    </v-alert>

    <!-- 剧本大纲 -->
    <template v-if="section === 'outline'">
      <div class="d-flex align-center mb-2">
        <div class="text-h6">
          剧本大纲
        </div>
        <v-spacer />
        <v-btn
          prepend-icon="mdi-pencil"
          :loading="loading"
          @click="openEditor"
        >
          编辑
        </v-btn>
      </div>
      <MarkdownView
        v-if="content"
        :content="content"
      />
      <div
        v-else-if="!loading"
        class="text-grey"
      >
        暂无大纲（prompt/script/outline.md），点击「编辑」创建。
      </div>
    </template>

    <!-- 分集分组：引导选择具体集数 -->
    <template v-else-if="section === 'episodes' && !episode">
      <div class="text-h6 mb-2">
        剧本分集
      </div>
      <div class="text-grey">
        从左侧「分集」中选择一个集数查看；点击分集节点的「+」可新增分集。
      </div>
    </template>

    <!-- 单集剧本 -->
    <template v-else-if="section === 'episodes' && episode">
      <div class="d-flex align-center mb-2 flex-wrap ga-2">
        <div class="text-h6">
          剧本 · 第{{ episode }}集
        </div>
        <v-spacer />
        <v-btn
          prepend-icon="mdi-chevron-left"
          :disabled="!prevEpisode"
          variant="tonal"
          @click="goEpisode(prevEpisode)"
        >
          上一集
        </v-btn>
        <v-btn
          append-icon="mdi-chevron-right"
          :disabled="!nextEpisode"
          variant="tonal"
          @click="goEpisode(nextEpisode)"
        >
          下一集
        </v-btn>
        <v-btn
          prepend-icon="mdi-pencil"
          color="primary"
          :loading="loading"
          @click="openEditor"
        >
          编辑
        </v-btn>
      </div>
      <MarkdownView
        v-if="content"
        :content="content"
      />
      <div
        v-else-if="!loading"
        class="text-grey"
      >
        第{{ episode }}集剧本尚未创建（prompt/script/episodes/{{ episode }}.md），点击「编辑」创建。
      </div>
    </template>

    <!-- 剧本根节点：引导选择 -->
    <div
      v-else
      class="d-flex align-center justify-center"
      style="height: 100%"
    >
      <div class="text-center">
        <v-icon
          icon="mdi-book-open-variant"
          size="48"
          color="grey-lighten-1"
        />
        <div class="text-grey mt-2">
          从左侧选择「大纲」或具体分集查看剧本
        </div>
      </div>
    </div>

    <!-- 在线编辑弹窗 -->
    <v-dialog
      v-model="editDialog.show"
      max-width="800"
      persistent
    >
      <v-card>
        <v-card-title>{{ editorTitle }}</v-card-title>
        <v-card-text>
          <v-alert
            v-if="editDialog.error"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-2"
          >
            {{ editDialog.error }}
          </v-alert>
          <v-textarea
            v-model="editDialog.content"
            rows="18"
            variant="outlined"
            class="font-mono"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="saving"
            @click="editDialog.show = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :loading="saving"
            @click="save"
          >
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { readFs, writeFs, type DirResponse } from '../api/client'
import MarkdownView from './MarkdownView.vue'

const props = defineProps<{
  /** 项目名 */
  project: string
  /** 剧本区块：'outline'（大纲）| 'episodes'（分集）；为空表示剧本根节点 */
  section?: string
  /** 当前查看的分集编号（仅 section === 'episodes' 时有效） */
  episode?: string
}>()

const route = useRoute()
const router = useRouter()

/** 当前文件内容（Markdown 原文）；为空表示文件尚未创建 */
const content = ref('')
const loading = ref(false)
const loadError = ref('')
const saveSuccess = ref('')
const saving = ref(false)

const editDialog = reactive({
  show: false,
  content: '',
  error: '',
})

/** 全部分集编号（升序），用于上一集/下一集导航 */
const episodeIds = ref<string[]>([])

const isOutline = computed(() => props.section === 'outline')
const isEpisode = computed(() => props.section === 'episodes' && !!props.episode)

/** 当前编辑目标文件的相对路径；不在大纲/单集视图时为空 */
const filePath = computed(() => {
  if (isOutline.value) return 'prompt/script/outline.md'
  if (isEpisode.value) return `prompt/script/episodes/${props.episode}.md`
  return ''
})

const editorTitle = computed(() => {
  if (isOutline.value) return '编辑剧本大纲'
  return `编辑剧本 · 第${props.episode}集`
})

/** 上一集编号（小于当前编号的最大集数，无则 null） */
const prevEpisode = computed(() => {
  const cur = Number(props.episode)
  const smaller = episodeIds.value.map(Number).filter(n => n < cur)
  return smaller.length ? String(Math.max(...smaller)) : null
})

/** 下一集编号（大于当前编号的最小集数，无则 null） */
const nextEpisode = computed(() => {
  const cur = Number(props.episode)
  const larger = episodeIds.value.map(Number).filter(n => n > cur)
  return larger.length ? String(Math.min(...larger)) : null
})

/**
 * 读取分集编号列表（prompt/script/episodes/ 下的数字 .md 文件，升序）。
 * 仅在单集视图加载，供上一集/下一集按钮计算相邻集数。
 */
async function loadEpisodeList() {
  try {
    const res = await readFs(props.project, 'prompt/script/episodes/')
    if (typeof res !== 'string' && res && 'entries' in res) {
      episodeIds.value = (res as DirResponse).entries
        .filter(e => e.type === 'file' && /^[1-9]\d*\.md$/.test(e.name))
        .map(e => e.name.replace(/\.md$/, ''))
        .sort((a, b) => Number(a) - Number(b))
    }
  } catch (e) {
    // 分集目录尚不存在（还未创建任何分集）属正常情况，按空列表处理
    console.error('[ScriptPanel] 读取分集列表失败（目录可能尚未创建）:', e)
    episodeIds.value = []
  }
}

/** 加载当前目标文件内容；404 视为「尚未创建」正常流程，其余错误提示用户 */
async function load() {
  loadError.value = ''
  saveSuccess.value = ''
  content.value = ''
  if (!filePath.value) return
  loading.value = true
  try {
    const res = await readFs(props.project, filePath.value)
    if (typeof res === 'string') {
      content.value = res
    } else {
      loadError.value = '目标路径不是文件，请检查目录结构'
    }
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status
    if (status === 404) {
      // 文件不存在 = 尚未创建，面板会提示「点击编辑创建」
      content.value = ''
    } else {
      console.error('[ScriptPanel] 读取剧本文件失败:', e)
      loadError.value = '读取剧本文件失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}

function openEditor() {
  editDialog.error = ''
  editDialog.content = content.value
  editDialog.show = true
}

/** 保存编辑内容；writeFs 会在文件/目录不存在时自动创建 */
async function save() {
  if (!filePath.value) return
  saving.value = true
  editDialog.error = ''
  try {
    await writeFs(props.project, filePath.value, editDialog.content)
    content.value = editDialog.content
    saveSuccess.value = `${editorTitle.value.replace('编辑', '')}已保存`
    editDialog.show = false
    // 新建分集后集数列表可能变化，刷新以便上一集/下一集导航生效
    if (isEpisode.value) await loadEpisodeList()
  } catch (e) {
    console.error('[ScriptPanel] 保存剧本文件失败:', e)
    editDialog.error = '保存失败，请稍后重试'
  } finally {
    saving.value = false
  }
}

/** 切换到指定集数（保持 type/section 查询参数不变） */
function goEpisode(n: string | null) {
  if (!n) return
  router.push({ query: { ...route.query, episode: n } })
}

watch(
  () => [props.project, props.section, props.episode],
  async () => {
    await load()
    if (props.section === 'episodes') await loadEpisodeList()
  },
  { immediate: true },
)
</script>
