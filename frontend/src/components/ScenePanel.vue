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
          <v-btn @click="editOverview">
            编辑
          </v-btn>
        </div>
        <v-card
          v-if="data.overview"
          class="ma-2"
        >
          <v-card-title class="text-h6">
            {{ data.overview.title || '（无标题）' }}
            <v-chip
              class="ml-2"
              size="small"
              color="primary"
              variant="tonal"
            >
              {{ data.overview.duration }} 秒
            </v-chip>
          </v-card-title>
          <v-card-text>
            <div class="mb-3">
              <div class="text-caption text-medium-emphasis mb-1">
                叙事节拍
              </div>
              <div class="text-body-2 overview-text">
                {{ data.overview.beat || '（空）' }}
              </div>
            </div>
            <div class="mb-3">
              <div class="text-caption text-medium-emphasis mb-1">
                画面描述
              </div>
              <div class="text-body-2 overview-text">
                {{ data.overview.visual || '（空）' }}
              </div>
            </div>
            <div class="mb-3">
              <div class="text-caption text-medium-emphasis mb-1">
                镜头运动
              </div>
              <div class="text-body-2 overview-text">
                {{ data.overview.camera || '（空）' }}
              </div>
            </div>
            <div>
              <div class="text-caption text-medium-emphasis mb-1">
                情绪基调
              </div>
              <div class="text-body-2 overview-text">
                {{ data.overview.mood || '（空）' }}
              </div>
            </div>
          </v-card-text>
        </v-card>
        <div
          v-else
          class="text-grey ml-2"
        >
          暂无 overview.json
        </div>
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
            <v-list-item-subtitle>
              <div class="d-flex flex-column">
                <p>{{ entry.台词 }}</p>
                <audio
                  v-if="voiceAssets[i]"
                  class="mt-2"
                  style="height: 32px;"
                  :src="voiceAssets[i]"
                  controls
                  preload="metadata"
                />
              </div>
            </v-list-item-subtitle>
            <template #append>
              <div class="d-flex align-center ga-2">
                <v-btn
                  size="x-small"
                  variant="tonal"
                  prepend-icon="mdi-account-voice"
                  @click="genDialog = { show: true, type: 'voice', index: i }"
                >
                  {{ voiceAssets[i] ? '重新生成' : '生成语音' }}
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
        <div class="d-flex mt-2 mb-2 ml-2">
          <v-btn @click="editStageJson">
            编辑 stage.json
          </v-btn>
        </div>

        <div
          v-for="(stage, i) in stageDefs"
          :key="i"
          class="mb-4"
        >
          <v-card variant="outlined">
            <v-card-title class="text-subtitle-1 d-flex align-center">
              <span>场景{{ i }}</span>
              <v-spacer />
              <v-btn
                icon="mdi-arrow-up"
                size="x-small"
                variant="text"
                :disabled="i === 0 || reordering"
                @click="moveStage(i, i - 1)"
              />
              <v-btn
                icon="mdi-arrow-down"
                size="x-small"
                variant="text"
                :disabled="i === stageDefs.length - 1 || reordering"
                @click="moveStage(i, i + 1)"
              />
            </v-card-title>
            <v-card-text>
              <v-row>
                <v-col cols="6">
                  <div class="mb-2">
                    <div class="text-caption text-medium-emphasis mb-1">
                      基础场景
                    </div>
                    <v-menu
                      v-if="stage.基础场景"
                      open-on-hover
                      :close-on-content-click="false"
                      location="top"
                      offset="8"
                    >
                      <template #activator="{ props: menuProps }">
                        <v-chip
                          v-bind="menuProps"
                          size="small"
                          color="primary"
                          variant="tonal"
                        >
                          {{ stage.基础场景 }}
                        </v-chip>
                      </template>
                      <v-card
                        max-width="280"
                        class="pa-2"
                      >
                        <v-img
                          v-if="stageAssetUrls[stage.基础场景]"
                          :src="stageAssetUrls[stage.基础场景]"
                          width="260"
                          max-height="260"
                          contain
                        />
                        <div
                          v-else
                          class="d-flex flex-column align-center ga-2 pa-2"
                        >
                          <div class="text-caption text-medium-emphasis">
                            暂无设定图
                          </div>
                          <v-btn
                            size="small"
                            color="primary"
                            variant="tonal"
                            prepend-icon="mdi-auto-fix"
                            :disabled="!parseStageRef(stage.基础场景)"
                            @click="openStageAssetGen(stage.基础场景)"
                          >
                            生成场景设定图
                          </v-btn>
                        </div>
                      </v-card>
                    </v-menu>
                    <v-chip
                      v-else
                      size="small"
                      color="primary"
                      variant="tonal"
                    >
                      未指定
                    </v-chip>
                  </div>
                  <div class="mb-2">
                    <div class="text-caption text-medium-emphasis mb-1">
                      登场角色
                    </div>
                    <div
                      v-if="stage.登场角色?.length"
                      class="d-flex flex-wrap ga-1"
                    >
                      <v-menu
                        v-for="charName in stage.登场角色"
                        :key="charName"
                        open-on-hover
                        :close-on-content-click="false"
                        location="top"
                        offset="8"
                      >
                        <template #activator="{ props: menuProps }">
                          <v-chip
                            v-bind="menuProps"
                            size="small"
                            variant="outlined"
                          >
                            {{ charName }}
                          </v-chip>
                        </template>
                        <v-card
                          max-width="280"
                          class="pa-2"
                        >
                          <v-img
                            v-if="characterAssetUrls[charName]"
                            :src="characterAssetUrls[charName]"
                            width="260"
                            max-height="260"
                            contain
                          />
                          <div
                            v-else
                            class="d-flex flex-column align-center ga-2 pa-2"
                          >
                            <div class="text-caption text-medium-emphasis">
                              暂无设定图
                            </div>
                            <v-btn
                              size="small"
                              color="primary"
                              variant="tonal"
                              prepend-icon="mdi-auto-fix"
                              @click="openCharacterAssetGen(charName)"
                            >
                              生成角色设定图
                            </v-btn>
                          </div>
                        </v-card>
                      </v-menu>
                    </div>
                    <div
                      v-else
                      class="text-grey text-body-2"
                    >
                      {{ isDirectStageRef(stage) ? '直接引用基础场景' : '无' }}
                    </div>
                  </div>
                  <div>
                    <div class="text-caption text-medium-emphasis mb-1">
                      合成 Prompt
                    </div>
                    <div class="text-body-2 stage-prompt">
                      {{ stage.prompt || (isDirectStageRef(stage) ? '（直接引用，不做修改）' : '（空）') }}
                    </div>
                  </div>
                </v-col>
                <v-col
                  cols="6"
                  class="d-flex flex-column align-center"
                >
                  <div class="d-flex justify-center mb-3">
                    <v-btn
                      size="small"
                      color="primary"
                      variant="tonal"
                      prepend-icon="mdi-auto-fix"
                      @click="genDialog = { show: true, type: 'image', index: i }"
                    >
                      生成图片
                    </v-btn>
                  </div>
                  <v-img
                    v-if="stage.imageUrl"
                    :src="stage.imageUrl"
                    max-height="65vh"
                    contain
                    width="100%"
                  />
                  <div
                    v-else
                    class="text-grey d-flex align-center justify-center"
                    style="height: 200px; width: 100%;"
                  >
                    暂无图片
                  </div>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </div>

        <div
          v-if="!stageDefs.length"
          class="text-grey ml-2"
        >
          暂无场景图片定义（stage.json）
        </div>
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

    <v-dialog
      v-model="overviewDialog.show"
      max-width="720"
    >
      <v-card>
        <v-card-title>编辑分镜总览</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="overviewDialog.form.title"
            label="标题"
            variant="outlined"
            density="comfortable"
            class="mb-2"
          />
          <v-text-field
            v-model.number="overviewDialog.form.duration"
            label="时长（秒）"
            type="number"
            min="1"
            step="1"
            variant="outlined"
            density="comfortable"
            class="mb-2"
            :error-messages="overviewDurationError"
          />
          <v-textarea
            v-model="overviewDialog.form.beat"
            label="叙事节拍"
            rows="3"
            auto-grow
            variant="outlined"
            class="mb-2"
          />
          <v-textarea
            v-model="overviewDialog.form.visual"
            label="画面描述"
            rows="4"
            auto-grow
            variant="outlined"
            class="mb-2"
          />
          <v-textarea
            v-model="overviewDialog.form.camera"
            label="镜头运动"
            rows="3"
            auto-grow
            variant="outlined"
            class="mb-2"
          />
          <v-textarea
            v-model="overviewDialog.form.mood"
            label="情绪基调"
            rows="2"
            auto-grow
            variant="outlined"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="overviewDialog.show = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :loading="overviewDialog.saving"
            @click="saveOverview"
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
      :prompt-paths="[`${basePath}/stage.json`]"
      :existing-asset="stageDefs[genDialog.index]?.imageUrl ? '已有图片' : undefined"
      @refresh="load"
    />
    <GenerateDialog
      v-model="genVoiceDialog"
      :project="props.project"
      workflow-id="scene-tts"
      workflow-name="分镜台词语音生成"
      :vars="{ episode: props.episode, shot: props.shot, index: String(genDialog.index) }"
      :output-path="`assert/scene/${props.episode}/${props.shot}/voice/${genDialog.index}-${data?.script[genDialog.index]?.角色名 ?? ''}.flac`"
      :prompt-paths="[`${basePath}/script.json`]"
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
      :prompt-paths="[`${basePath}/prompt.md`]"
      :existing-asset="hasVideo ? '已有视频' : undefined"
      @refresh="load"
    />
    <GenerateDialog
      v-model="genStageAssetDialog"
      :project="props.project"
      workflow-id="stage-image"
      workflow-name="场景设定图生成"
      :vars="{ name: refGenDialog.name, label: refGenDialog.label }"
      :output-path="`assert/stage/${refGenDialog.name}/${refGenDialog.label}.jpg`"
      :prompt-paths="[`prompt/stage/${refGenDialog.name}/${refGenDialog.label}.md`]"
      :existing-asset="stageAssetUrls[`${refGenDialog.name}/${refGenDialog.label}`] ? '已有图片' : undefined"
      @refresh="load"
    />
    <GenerateDialog
      v-model="genCharacterAssetDialog"
      :project="props.project"
      workflow-id="character-appearance"
      workflow-name="角色设定图生成"
      :vars="{ name: refGenDialog.name }"
      :output-path="`assert/character/${refGenDialog.name}/appearance.jpg`"
      :prompt-paths="[`prompt/character/${refGenDialog.name}/appearance.md`]"
      :existing-asset="characterAssetUrls[refGenDialog.name] ? '已有图片' : undefined"
      @refresh="load"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { readFs, writeFs, existsFs } from '../api/client'
import { reorderSceneStage, AssetApiError } from '../api/assets'
import MarkdownView from './MarkdownView.vue'
import GenerateDialog from './GenerateDialog.vue'

interface ScriptEntry {
  角色名: string
  台词: string
  情绪: string
}

interface ShotOverview {
  title: string
  beat: string
  visual: string
  camera: string
  duration: number
  mood: string
}

interface StageDefinition {
  基础场景: string
  登场角色?: string[]
  prompt: string
  imageUrl: string
}

interface DialogState {
  show: boolean
  field: string
  content: string
}

interface OverviewDialogState {
  show: boolean
  saving: boolean
  form: ShotOverview
}

interface SceneData {
  overview: ShotOverview | null
  script: ScriptEntry[]
  prompt: string
  stage: StageDefinition[]
}

function emptyOverview(): ShotOverview {
  return {
    title: '',
    beat: '',
    visual: '',
    camera: '',
    duration: 5,
    mood: '',
  }
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function cloneOverview(source?: ShotOverview | null): ShotOverview {
  if (!source) return emptyOverview()
  return {
    title: source.title ?? '',
    beat: source.beat ?? '',
    visual: source.visual ?? '',
    camera: source.camera ?? '',
    duration: isPositiveInt(source.duration) ? source.duration : 5,
    mood: source.mood ?? '',
  }
}

function parseOverview(raw: unknown): ShotOverview | null {
  if (!raw) return null
  let obj: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return null
    try {
      obj = JSON.parse(text)
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const data = obj as Record<string, unknown>
  const durationRaw = data.duration
  let duration = 5
  if (isPositiveInt(durationRaw)) {
    duration = durationRaw
  } else if (typeof durationRaw === 'string' && durationRaw.trim()) {
    const n = Number(durationRaw)
    if (isPositiveInt(n)) duration = n
  }
  return {
    title: typeof data.title === 'string' ? data.title : '',
    beat: typeof data.beat === 'string' ? data.beat : '',
    visual: typeof data.visual === 'string' ? data.visual : '',
    camera: typeof data.camera === 'string' ? data.camera : '',
    duration,
    mood: typeof data.mood === 'string' ? data.mood : '',
  }
}

const props = defineProps<{ project: string; episode: string; shot: string }>()
const tab = ref<string | null>(null)
const data = ref<SceneData | null>(null)
const stageDefs = ref<StageDefinition[]>([])
/** 每条台词对应的语音 URL；无资产时为空字符串 */
const voiceAssets = ref<string[]>([])
const hasVideo = ref(false)
const stageAssetUrls = ref<Record<string, string>>({})
const characterAssetUrls = ref<Record<string, string>>({})
const dialog = ref<DialogState>({ show: false, field: '', content: '' })
const overviewDialog = ref<OverviewDialogState>({
  show: false,
  saving: false,
  form: emptyOverview(),
})
const reordering = ref(false)
const genDialog = ref<{ show: boolean; type: 'image' | 'voice' | 'video'; index: number }>({ show: false, type: 'image', index: 0 })
const refGenDialog = ref<{ show: boolean; type: 'character' | 'stage'; name: string; label: string }>({
  show: false,
  type: 'character',
  name: '',
  label: '',
})

const overviewDurationError = computed(() => {
  const duration = overviewDialog.value.form.duration
  if (!isPositiveInt(duration)) {
    return '时长必须是大于 0 的整数秒'
  }
  return ''
})

async function moveStage(from: number, to: number) {
  if (reordering.value) return
  reordering.value = true
  try {
    await reorderSceneStage(props.project, props.episode, props.shot, from, to)
    await load()
  } catch (e) {
    alert(e instanceof AssetApiError ? e.message : '调整顺序失败')
  } finally {
    reordering.value = false
  }
}

const genImageDialog = computed({
  get: () => genDialog.value.show && genDialog.value.type === 'image',
  set: (v) => { if (!v) genDialog.value.show = false },
})
const genVoiceDialog = computed({
  get: () => genDialog.value.show && genDialog.value.type === 'voice',
  set: (v) => { if (!v) genDialog.value.show = false },
})
const genVideoDialog = computed({
  get: () => genDialog.value.show && genDialog.value.type === 'video',
  set: (v) => { if (!v) genDialog.value.show = false },
})
const genStageAssetDialog = computed({
  get: () => refGenDialog.value.show && refGenDialog.value.type === 'stage',
  set: (v) => { if (!v) refGenDialog.value.show = false },
})
const genCharacterAssetDialog = computed({
  get: () => refGenDialog.value.show && refGenDialog.value.type === 'character',
  set: (v) => { if (!v) refGenDialog.value.show = false },
})

const basePath = computed(() => `prompt/scene/${props.episode}/${props.shot}`)
const assertBase = computed(() => `/api/fs/${props.project}/assert/scene/${props.episode}/${props.shot}/stage`)

/** 登场角色与 prompt 同时为空 = 直接引用基础场景 */
function isDirectStageRef(stage: Pick<StageDefinition, '登场角色' | 'prompt'>): boolean {
  return !(stage.登场角色?.length) && !(stage.prompt ?? '').trim()
}

/** 基础场景引用格式：场景名/子场景标签 */
function parseStageRef(ref: string): { name: string; label: string } | null {
  if (!ref) return null
  const idx = ref.indexOf('/')
  if (idx <= 0 || idx >= ref.length - 1) return null
  return { name: ref.slice(0, idx), label: ref.slice(idx + 1) }
}

function openStageAssetGen(stageRef: string) {
  const parsed = parseStageRef(stageRef)
  if (!parsed) return
  refGenDialog.value = { show: true, type: 'stage', name: parsed.name, label: parsed.label }
}

function openCharacterAssetGen(charName: string) {
  if (!charName) return
  refGenDialog.value = { show: true, type: 'character', name: charName, label: '' }
}

async function loadRefAssets(stages: StageDefinition[]) {
  const stageRefs = new Set<string>()
  const charNames = new Set<string>()
  for (const stage of stages) {
    if (stage.基础场景) stageRefs.add(stage.基础场景)
    for (const name of stage.登场角色 ?? []) {
      if (name) charNames.add(name)
    }
  }

  const nextStageUrls: Record<string, string> = {}
  const nextCharUrls: Record<string, string> = {}
  const ts = Date.now()

  await Promise.all([
    ...[...stageRefs].map(async (ref) => {
      const parsed = parseStageRef(ref)
      if (!parsed) return
      const path = `assert/stage/${parsed.name}/${parsed.label}.jpg`
      if (await existsFs(props.project, path)) {
        nextStageUrls[ref] = `/api/fs/${props.project}/${path}?t=${ts}`
      }
    }),
    ...[...charNames].map(async (name) => {
      const path = `assert/character/${name}/appearance.jpg`
      if (await existsFs(props.project, path)) {
        nextCharUrls[name] = `/api/fs/${props.project}/${path}?t=${ts}`
      }
    }),
  ])

  stageAssetUrls.value = nextStageUrls
  characterAssetUrls.value = nextCharUrls
}

async function load() {
  const bp = basePath.value
  const ep = props.episode
  const shot = props.shot
  let scriptEntries: ScriptEntry[] = []

  try {
    const results = await Promise.all([
      readFs(props.project, `${bp}/overview.json`).catch(() => null),
      readFs(props.project, `${bp}/script.json`).catch(() => '[]'),
      readFs(props.project, `${bp}/prompt.md`).catch(() => ''),
      readFs(props.project, `${bp}/stage.json`).catch(() => ''),
    ])
    const overview = parseOverview(results[0])
    const scriptRaw = results[1]
    if (typeof scriptRaw === 'string') {
      scriptEntries = JSON.parse(scriptRaw || '[]') as ScriptEntry[]
    } else if (Array.isArray(scriptRaw)) {
      scriptEntries = scriptRaw as ScriptEntry[]
    } else {
      scriptEntries = []
    }
    data.value = {
      overview,
      script: scriptEntries,
      prompt: results[2] as string,
      stage: results[3] as unknown as StageDefinition[],
    }
  } catch (err) {
    console.log(err)
  }

  // 无论是否已生成图片，都展示 stage.json 原型定义
  try {
    const stage = data.value?.stage
    if (Array.isArray(stage)) {
      const checks = await Promise.all(
        stage.map((_, i) => existsFs(props.project, `assert/scene/${ep}/${shot}/stage/${i}.jpg`)),
      )
      stageDefs.value = stage.map((item, i) => ({
        基础场景: item.基础场景 ?? '',
        登场角色: item.登场角色 ?? [],
        prompt: item.prompt ?? '',
        imageUrl: checks[i] ? `${assertBase.value}/${i}.jpg?t=${Date.now()}` : '',
      }))
      await loadRefAssets(stageDefs.value)
    } else {
      stageDefs.value = []
      stageAssetUrls.value = {}
      characterAssetUrls.value = {}
    }
  } catch {
    stageDefs.value = []
    stageAssetUrls.value = {}
    characterAssetUrls.value = {}
  }

  // Check voice assets for each script entry: {index}-{角色名}.flac
  if (scriptEntries.length) {
    const ts = Date.now()
    const voiceUrls = await Promise.all(
      scriptEntries.map(async (entry, i) => {
        const rel = `assert/scene/${ep}/${shot}/voice/${i}-${entry.角色名}.flac`
        if (await existsFs(props.project, rel)) {
          return `/api/fs/${props.project}/${rel}?t=${ts}`
        }
        return ''
      }),
    )
    voiceAssets.value = voiceUrls
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

function editOverview() {
  overviewDialog.value = {
    show: true,
    saving: false,
    form: cloneOverview(data.value?.overview),
  }
}

function editStageJson() {
  dialog.value = {
    show: true,
    field: 'stage',
    content: JSON.stringify(
      stageDefs.value.map(({ 基础场景, 登场角色, prompt }) => ({ 基础场景, 登场角色, prompt })),
      null,
      2,
    ),
  }
}

async function saveOverview() {
  if (overviewDurationError.value) {
    alert(overviewDurationError.value)
    return
  }

  const form = overviewDialog.value.form
  const duration = Number(form.duration)
  if (!isPositiveInt(duration)) {
    alert('时长必须是大于 0 的整数秒')
    return
  }
  const payload: ShotOverview = {
    title: (form.title ?? '').trim(),
    beat: form.beat ?? '',
    visual: form.visual ?? '',
    camera: form.camera ?? '',
    duration,
    mood: form.mood ?? '',
  }

  overviewDialog.value.saving = true
  try {
    await writeFs(props.project, `${basePath.value}/overview.json`, JSON.stringify(payload, null, 2))
    if (data.value) data.value.overview = payload
    overviewDialog.value.show = false
  } catch (e: unknown) {
    alert(e instanceof Error ? e.message : '保存失败')
  } finally {
    overviewDialog.value.saving = false
  }
}

async function save() {
  const field = dialog.value.field
  const content = dialog.value.content

  if (field === 'stage') {
    try {
      const parsed = JSON.parse(content)
      if (!Array.isArray(parsed)) {
        alert('stage.json 必须是数组')
        return
      }
    } catch (e: unknown) {
      alert('JSON 格式错误: ' + (e as Error).message)
      return
    }
    await writeFs(props.project, `${basePath.value}/stage.json`, content)
    dialog.value.show = false
    await load()
    return
  }

  const file = field === 'script' ? 'script.json' : `${field}.md`
  if (field === 'script') {
    try { JSON.parse(content) } catch (e: unknown) { alert('JSON 格式错误: ' + (e as Error).message); return }
  }
  await writeFs(props.project, `${basePath.value}/${file}`, content)
  if (field === 'script' && data.value) data.value.script = JSON.parse(content)
  else if (data.value && field === 'prompt') data.value.prompt = content
  dialog.value.show = false
}

watch(() => [props.project, props.episode, props.shot], load, { immediate: true })
</script>

<style scoped>

.stage-prompt,
.overview-text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}
</style>
