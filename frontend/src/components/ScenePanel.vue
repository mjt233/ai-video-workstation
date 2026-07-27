<template>
  <div
    v-if="data"
    style="flex: 1; min-height: 0; overflow-y: auto;"
  >
    <v-tabs v-model="tab">
      <v-tab value="overview">
        总览
      </v-tab>
      <v-tab value="script">
        台词
      </v-tab>
      <v-tab value="images">
        场景图片
      </v-tab>
      <v-tab value="prompt">
        prompt
      </v-tab>
    </v-tabs>

    <v-tabs-window v-model="tab">
      <v-tabs-window-item value="overview">
        <div class="d-flex mt-2 mb-2 ml-2">
          <v-btn
            @click="edit('overview')"
          >
            编辑
          </v-btn>
        </div>
        <MarkdownView :content="data.overview" />
      </v-tabs-window-item>

      <v-tabs-window-item value="script">
        <div class="d-flex mt-2 mb-2 ml-2">
          <v-btn
            @click="editJson('script')"
          >
            编辑
          </v-btn>
        </div>
        <v-list
          v-if="data.script.length"
          lines="two"
        >
          <v-list-item
            v-for="(entry, i) in data.script"
            :key="i"
          >
            <template #prepend>
              <v-avatar
                color="primary"
                size="32"
              >
                <span class="text-caption">{{ i + 1 }}</span>
              </v-avatar>
            </template>
            <v-list-item-title>
              <strong>{{ entry.角色名 }}</strong>
              <v-chip
                class="ml-2 mb-1"
                size="x-small"
                color="grey"
                variant="outlined"
              >
                {{ entry.情绪 }}
              </v-chip>
            </v-list-item-title>
            <v-list-item-subtitle>{{ entry.台词 }}</v-list-item-subtitle>
            <template #append>
              <div class="d-flex align-center ga-1">
                <v-icon
                  v-if="voiceAssets[i]"
                  color="success"
                  size="small"
                >
                  mdi-check-circle
                </v-icon>
                <v-btn
                  size="x-small"
                  variant="tonal"
                  prepend-icon="mdi-account-voice"
                  @click="genDialog = { show: true, type: 'voice', index: i }"
                >
                  生成语音
                </v-btn>
              </div>
            </template>
          </v-list-item>
        </v-list>
        <div v-else>
          <p>该分镜没有台词</p>
        </div>
      </v-tabs-window-item>

      <v-tabs-window-item value="images">
        <v-row>
          <v-col
            v-for="(img, i) in stageImages"
            :key="i"
            cols="6"
          >
            <v-card>
              <v-card-text class="text-center">
                场景{{ i }}
              </v-card-text>
              <v-img
                v-if="img"
                :src="img"
                max-height="400"
                contain
              />
              <div
                v-else
                class="text-grey d-flex align-center justify-center"
                style="height: 200px;"
              >
                暂无图片
              </div>
              <div class="d-flex justify-center mt-1">
                <v-btn
                  size="x-small"
                  color="primary"
                  variant="tonal"
                  prepend-icon="mdi-auto-fix"
                  @click="genDialog = { show: true, type: 'image', index: i }"
                >
                  生成
                </v-btn>
              </div>
            </v-card>
          </v-col>
          <v-col
            v-if="!stageImages.length"
            cols="12"
          >
            <div class="text-grey">
              暂无场景图片
            </div>
          </v-col>
        </v-row>
      </v-tabs-window-item>
      <v-tabs-window-item value="prompt">
        <div class="d-flex mt-2 mb-2 ml-2">
          <v-btn
            variant="text"
            size="small"
            @click="edit('prompt')"
          >
            编辑
          </v-btn>
        </div>
        <MarkdownView :content="data.prompt" />
        <div class="d-flex justify-center mt-2">
          <v-btn
            color="primary"
            variant="tonal"
            prepend-icon="mdi-video"
            @click="genDialog = { show: true, type: 'video', index: 0 }"
          >
            生成视频
          </v-btn>
        </div>
      </v-tabs-window-item>
    </v-tabs-window>

    <v-dialog
      v-model="dialog.show"
      max-width="800"
    >
      <v-card>
        <v-card-title>编辑 {{ dialog.field }}</v-card-title>
        <v-card-text>
          <v-textarea
            v-model="dialog.content"
            rows="15"
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="dialog.show = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            @click="save"
          >
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <GenerateDialog
      v-model="genImageDialog"
      :project="props.project"
      workflow-id="scene-stage-image"
      workflow-name="分镜场景图生成"
      :vars="{ episode: props.episode, shot: props.shot, index: String(genDialog.index) }"
      :output-path="`assert/scene/${props.episode}/${props.shot}/stage/${genDialog.index}.jpg`"
      :existing-asset="stageImages[genDialog.index] ? '已有图片' : undefined"
      @refresh="load"
    />
    <GenerateDialog
      v-model="genVoiceDialog"
      :project="props.project"
      workflow-id="scene-tts"
      workflow-name="分镜台词语音生成"
      :vars="{ episode: props.episode, shot: props.shot, character: data?.script[genDialog.index]?.角色名 ?? '' }"
      :output-path="`assert/scene/${props.episode}/${props.shot}/voice/${data?.script[genDialog.index]?.角色名}.flac`"
      :existing-asset="voiceAssets[genDialog.index] ? '已有音频' : undefined"
      @refresh="load"
    />
    <GenerateDialog
      v-model="genVideoDialog"
      :project="props.project"
      workflow-id="video-generate"
      workflow-name="视频生成"
      :vars="{ episode: props.episode, shot: props.shot, index: '0' }"
      :output-path="`assert/scene/${props.episode}/${props.shot}/video/0.mp4`"
      :existing-asset="hasVideo ? '已有视频' : undefined"
      @refresh="load"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { readFs, writeFs, existsFs } from '../api/client'
import MarkdownView from './MarkdownView.vue'
import GenerateDialog from './GenerateDialog.vue'

interface ScriptEntry {
  角色名: string
  台词: string
  情绪: string
}

interface DialogState {
  show: boolean
  field: string
  content: string
}

interface SceneData {
  overview: string
  script: ScriptEntry[],
  prompt: string
}

const props = defineProps<{ project: string; episode: string; shot: string }>()
const tab = ref<string | null>(null)
const data = ref<SceneData | null>(null)
const stageImages = ref<string[]>([])
const voiceAssets = ref<boolean[]>([])
const hasVideo = ref(false)
const dialog = ref<DialogState>({ show: false, field: '', content: '' })
const genDialog = ref<{ show: boolean; type: 'image' | 'voice' | 'video'; index: number }>({ show: false, type: 'image', index: 0 })

const genImageDialog = computed({
  get: () => genDialog.value.show && genDialog.value.type === 'image',
  set: (v) => { if (!v) genDialog.value.show = false }
})
const genVoiceDialog = computed({
  get: () => genDialog.value.show && genDialog.value.type === 'voice',
  set: (v) => { if (!v) genDialog.value.show = false }
})
const genVideoDialog = computed({
  get: () => genDialog.value.show && genDialog.value.type === 'video',
  set: (v) => { if (!v) genDialog.value.show = false }
})

const basePath = computed(() => `prompt/scene/${props.episode}/${props.shot}`)
const assertBase = computed(() => `/api/fs/${props.project}/assert/scene/${props.episode}/${props.shot}/stage`)

async function load() {
  const bp = basePath.value
  const ep = props.episode
  const shot = props.shot
  let scriptEntries: ScriptEntry[] = []

  try {
    const results = await Promise.all([
      readFs(props.project, `${bp}/overview.md`).catch(() => ''),
      readFs(props.project, `${bp}/script.json`).catch(() => '[]'),
      readFs(props.project, `${bp}/prompt.md`).catch(() => ''),
    ])
    const overview = results[0] as string
    scriptEntries = results[1] as any as ScriptEntry[]
    data.value = { overview, script: scriptEntries, prompt: results[2] as string }
  } catch(err) {
    console.log(err)
  }

  // Load stage images with existence check
  try {
    const stageRaw = await readFs(props.project, `${bp}/stage.json`) as string
    const stage = JSON.parse(stageRaw)
    if (Array.isArray(stage)) {
      const checks = await Promise.all(
        stage.map((_, i) => existsFs(props.project, `assert/scene/${ep}/${shot}/stage/${i}.jpg`))
      )
      stageImages.value = stage.map((_, i) =>
        checks[i] ? `${assertBase.value}/${i}.jpg?t=${Date.now()}` : ''
      )
    } else {
      stageImages.value = []
    }
  } catch {
    stageImages.value = []
  }

  // Check voice assets for each script entry
  if (scriptEntries.length) {
    const voiceChecks = await Promise.all(
      scriptEntries.map(entry => existsFs(props.project, `assert/scene/${ep}/${shot}/voice/${entry.角色名}.flac`))
    )
    voiceAssets.value = voiceChecks
  } else {
    voiceAssets.value = []
  }

  // Check video asset
  hasVideo.value = await existsFs(props.project, `assert/scene/${ep}/${shot}/video/0.mp4`)
}

function edit(field: string) {
  dialog.value = { show: true, field, content: data.value![field as keyof SceneData] as string }
}

function editJson(field: string) {
  dialog.value = { show: true, field, content: JSON.stringify(data.value![field as keyof SceneData], null, 2) }
}

async function save() {
  const field = dialog.value.field
  const file = field === 'script' ? 'script.json' : `${field}.md`
  const content = dialog.value.content
  if (field === 'script') {
    try { JSON.parse(content) } catch (e: unknown) { alert('JSON 格式错误: ' + (e as Error).message); return }
  }
  await writeFs(props.project, `${basePath.value}/${file}`, content)
  if (field === 'script' && data.value) data.value.script = JSON.parse(content)
  else if (data.value && field === 'overview') data.value.overview = content
  dialog.value.show = false
}

watch(() => [props.project, props.episode, props.shot], load, { immediate: true })
</script>
