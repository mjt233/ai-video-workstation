<template>
  <div
    v-if="data"
    style="flex: 1; min-height: 0; overflow-y: auto;"
  >
    <v-tabs v-model="tab">
      <v-tab value="overview">
        角色总览
      </v-tab>
      <v-tab value="appearance">
        外观设计
      </v-tab>
      <v-tab value="voice">
        声音
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

      <v-tabs-window-item value="appearance">
        <div class="d-flex mt-2 mb-2 ml-2">
          <v-btn
            @click="edit('appearance')"
          >
            编辑
          </v-btn>
        </div>
        <v-row>
          <v-col cols="6">
            <MarkdownView :content="data.appearance" />
          </v-col>
          <v-col cols="6">
            <div class="d-flex justify-center mb-4 ga-2 flex-wrap">
              <v-btn
                size="small"
                color="primary"
                variant="tonal"
                prepend-icon="mdi-auto-fix"
                @click="genDialog = { show: true, type: 'appearance' }"
              >
                生成图片
              </v-btn>
              <AssetImageUploadButton
                :project="props.project"
                :asset-path="`assert/character/${props.name}/appearance.jpg`"
                @uploaded="load"
              />
              <v-btn
                size="small"
                variant="text"
                prepend-icon="mdi-history"
                :disabled="!appearanceImg"
                @click="openHistory(`assert/character/${props.name}/appearance.jpg`)"
              >
                历史版本
              </v-btn>
            </div>
            <v-img
              v-if="appearanceImg"
              :src="appearanceImg"
              max-height="400"
              contain
            />
            <div
              v-else
              class="text-grey"
            >
              暂无图片
            </div>
          </v-col>
        </v-row>

        <VariantPanel
          :project="props.project"
          kind="character"
          :owner="props.name"
        />

        <!-- 角色自定义资产：映射到 assert/custom/character/{name}/（置于衍生变体之下） -->
        <v-divider class="my-4" />
        <div class="text-body-large font-weight-medium mb-2 d-flex align-center">
          <v-icon
            icon="mdi-folder-star-outline"
            size="small"
            color="primary"
            class="mr-2"
          />
          自定义资产
        </div>
        <div class="text-body-medium text-medium-emphasis mb-2">
          该角色的自定义资产存储在 <code>assert/custom/character/{{ props.name }}/</code> 下，支持上传、预览与删除。
        </div>
        <CustomAssetSection
          :project="props.project"
          :dir-rel-path="`character/${props.name}`"
        />
      </v-tabs-window-item>

      <v-tabs-window-item value="voice">
        <div class="d-flex mt-2 mb-2 ml-2">
          <v-btn
            @click="edit('voice')"
          >
            编辑
          </v-btn>
        </div>
        <v-row>
          <v-col cols="6">
            <MarkdownView :content="data.voice" />
          </v-col>
          <v-col cols="6">
            <audio
              v-if="voiceAudio"
              :src="voiceAudio"
              controls
              style="width: 100%"
            />
            <div
              v-else
              class="text-grey"
            >
              暂无音频
            </div>
          </v-col>
        </v-row>
        <div class="d-flex justify-center mt-2 ga-2 flex-wrap">
          <v-btn
            size="small"
            color="primary"
            variant="tonal"
            prepend-icon="mdi-auto-fix"
            @click="genDialog = { show: true, type: 'voice' }"
          >
            生成
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            prepend-icon="mdi-history"
            :disabled="!voiceAudio"
            @click="openHistory(`assert/character/${props.name}/voice.flac`)"
          >
            历史版本
          </v-btn>
        </div>

        <!-- 声音变体：基于角色音色设计的单层衍生变体 -->
        <v-divider class="my-4" />
        <div class="d-flex align-center ga-2 mb-2">
          <div class="text-title-small">
            声音变体
          </div>
          <v-btn
            size="small"
            color="primary"
            variant="tonal"
            icon="mdi-plus"
            title="新增声音变体"
            @click="openVoiceVariantCreate"
          />
        </div>
        <div
          v-if="voiceVariantsLoading"
          class="text-center py-4"
        >
          <v-progress-circular
            indeterminate
            size="24"
          />
        </div>
        <div
          v-else-if="!voiceVariants.length"
          class="text-grey text-body-medium mb-2"
        >
          暂无声音变体。可为当前角色创建声音变体（如「哭腔」「激动」），在角色音色设计描述基础上追加或覆盖提示词，并指定台词生成试听音频。
        </div>
        <div
          v-else
          class="d-flex flex-column ga-3"
        >
          <v-card
            v-for="v in voiceVariants"
            :key="v.id"
            variant="outlined"
            class="pa-3"
          >
            <div class="d-flex align-center ga-2 mb-2">
              <span class="text-title-small text-truncate">{{ v.id }}</span>
              <v-chip
                size="x-small"
                :color="v.promptMode === 'append' ? 'primary' : 'warning'"
                variant="tonal"
              >
                {{ v.promptMode === 'append' ? '追加' : '覆盖' }}
              </v-chip>
              <v-spacer />
              <v-btn
                size="small"
                color="primary"
                variant="tonal"
                prepend-icon="mdi-auto-fix"
                @click="openVoiceVariantGenerate(v)"
              >
                {{ v.hasAudio ? '重新生成' : '生成' }}
              </v-btn>
              <v-btn
                size="small"
                variant="text"
                icon="mdi-pencil"
                title="编辑声音变体"
                @click="openVoiceVariantEdit(v)"
              />
              <v-btn
                size="small"
                variant="text"
                icon="mdi-delete"
                color="error"
                title="删除声音变体"
                @click="onDeleteVoiceVariant(v)"
              />
            </div>
            <div
              v-if="v.hasAudio"
              class="mb-2"
            >
              <audio
                :src="voiceVariantAudioUrl(v)"
                controls
                style="width: 100%"
              />
            </div>
            <div class="text-body-medium text-medium-emphasis mb-1">
              <span class="text-body-small text-grey">提示词：</span>
              <span style="white-space: pre-wrap;">{{ v.prompt }}</span>
            </div>
            <div class="text-body-medium text-medium-emphasis">
              <span class="text-body-small text-grey">台词：</span>
              <span style="white-space: pre-wrap;">{{ v.台词 }}</span>
            </div>
          </v-card>
        </div>
      </v-tabs-window-item>
    </v-tabs-window>

    <GenerateDialog
      v-model="genDialog.show"
      :project="props.project"
      :workflow-id="genConfig.workflowId"
      :workflow-name="genConfig.workflowName"
      :vars="genConfig.vars"
      :output-path="genConfig.outputPath"
      :prompt-paths="genConfig.promptPaths"
      :existing-asset="genConfig.existingAsset"
      @refresh="load"
    />

    <GenerateDialog
      v-model="voiceVariantGen.show"
      :project="props.project"
      workflow-id="tts-voice-design"
      workflow-name="声音变体生成（音色设计）"
      :vars="voiceVariantGen.vars"
      :output-path="voiceVariantGen.outputPath"
      :prompt-paths="voiceVariantGen.promptPaths"
      :existing-asset="voiceVariantGen.existingAsset"
      @refresh="load"
    />

    <AssetHistoryDialog
      v-model="historyDialog.show"
      :project="props.project"
      :asset-path="historyDialog.path"
      @activated="load"
    />

    <!-- 声音变体 新增/编辑 对话框 -->
    <v-dialog
      v-model="voiceVariantForm.show"
      max-width="600"
    >
      <v-card>
        <v-card-title>{{ voiceVariantForm.mode === 'create' ? '新增声音变体' : '编辑声音变体' }}</v-card-title>
        <v-card-text>
          <v-alert
            v-if="voiceVariantForm.error"
            type="error"
            density="compact"
            class="mb-3"
          >
            {{ voiceVariantForm.error }}
          </v-alert>

          <v-text-field
            v-model="voiceVariantForm.id"
            label="变体名称"
            hint="如：哭腔、激动、耳语"
            persistent-hint
            variant="outlined"
            class="mb-3"
          />

          <v-textarea
            v-model="voiceVariantForm.prompt"
            label="提示词"
            rows="3"
            auto-grow
            variant="outlined"
            hint="音色风格/语气描述，相对角色音色设计原描述"
            persistent-hint
            class="mb-3"
          />

          <v-radio-group
            v-model="voiceVariantForm.promptMode"
            label="提示词模式"
            inline
            class="mb-3"
          >
            <v-radio
              label="追加"
              value="append"
            />
            <v-radio
              label="覆盖"
              value="overwrite"
            />
          </v-radio-group>

          <v-textarea
            v-model="voiceVariantForm.台词"
            label="台词"
            rows="2"
            auto-grow
            variant="outlined"
            hint="变体朗读的文本"
            persistent-hint
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="voiceVariantForm.saving"
            @click="voiceVariantForm.show = false"
          >
            取消
          </v-btn>
          <v-btn
            color="primary"
            :loading="voiceVariantForm.saving"
            @click="submitVoiceVariant"
          >
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

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
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { readFs, writeFs, existsFs } from '../api/client'
import {
  AssetApiError,
  createCharacterVoiceVariant,
  deleteCharacterVoiceVariant,
  listCharacterVoiceVariants,
  renameCharacterVoiceVariant,
  updateCharacterVoiceVariant,
  type VoicePromptMode,
  type VoiceVariantInfo,
} from '../api/assets'
import { confirm } from '../utils/confirm'
import MarkdownView from './MarkdownView.vue'
import GenerateDialog from './GenerateDialog.vue'
import AssetHistoryDialog from './AssetHistoryDialog.vue'
import AssetImageUploadButton from './AssetImageUploadButton.vue'
import VariantPanel from './VariantPanel.vue'
import CustomAssetSection from './CustomAssetSection.vue'

interface DialogState {
  show: boolean
  field: string
  content: string
}

interface CharData {
  overview: string
  appearance: string
  voice: string
}

const props = defineProps<{ project: string; name: string }>()

const tab = ref<string | null>(null)
const data = ref<CharData | null>(null)
const appearanceImg = ref('')
const voiceAudio = ref('')

const dialog = ref<DialogState>({ show: false, field: '', content: '' })

const historyDialog = ref<{ show: boolean; path: string }>({ show: false, path: '' })

// ── 声音变体状态 ────────────────────────────────────────────────

const voiceVariants = ref<VoiceVariantInfo[]>([])
const voiceVariantsLoading = ref(false)

/** 声音变体 新增/编辑 表单状态 */
const voiceVariantForm = ref({
  show: false,
  mode: 'create' as 'create' | 'edit',
  id: '',
  originalId: '',
  prompt: '',
  promptMode: 'append' as VoicePromptMode,
  台词: '',
  error: '',
  saving: false,
})

/** 声音变体生成对话框状态（复用 GenerateDialog） */
const voiceVariantGen = ref({
  show: false,
  vars: {} as Record<string, string>,
  outputPath: '',
  promptPaths: [] as string[],
  existingAsset: undefined as string | undefined,
})

function openHistory(path: string) {
  historyDialog.value = { show: true, path }
}

const genDialog = ref<{ show: boolean; type: 'appearance' | 'voice' }>({ show: false, type: 'appearance' })
const genConfig = computed(() => {
  const type = genDialog.value.type
  if (type === 'appearance') {
    const promptPath = `prompt/character/${props.name}/appearance.md`
    return {
      workflowId: 'text-to-image',
      workflowName: '角色外观生成（文生图）',
      outputPath: `assert/character/${props.name}/appearance.jpg`,
      vars: {
        promptPath,
        width: '1280',
        height: '720',
        purpose: 'character-appearance',
        name: props.name,
      } as Record<string, string>,
      promptPaths: [promptPath],
      existingAsset: appearanceImg.value ? '已有图片' : undefined,
    }
  }
  // 角色声音：音色设计；desc 优先用已加载的 voice.md，引擎也会在缺失时补全
  return {
    workflowId: 'tts-voice-design',
    workflowName: '角色声音生成（音色设计）',
    outputPath: `assert/character/${props.name}/voice.flac`,
    vars: {
      desc: data.value?.voice?.trim() || '',
      text: `你好，我叫${props.name}`,
      purpose: 'character-voice',
      character: props.name,
      name: props.name,
    } as Record<string, string>,
    promptPaths: [`prompt/character/${props.name}/voice.md`],
    existingAsset: voiceAudio.value ? '已有音频' : undefined,
  }
})

async function load() {
  const results = await Promise.all([
    readFs(props.project, `prompt/character/${props.name}/overview.md`).catch(() => ''),
    readFs(props.project, `prompt/character/${props.name}/appearance.md`).catch(() => ''),
    readFs(props.project, `prompt/character/${props.name}/voice.md`).catch(() => ''),
    existsFs(props.project, `assert/character/${props.name}/appearance.jpg`),
    existsFs(props.project, `assert/character/${props.name}/voice.flac`),
  ])
  const overview = results[0] as string
  const appearance = results[1] as string
  const voice = results[2] as string
  data.value = { overview, appearance, voice }
  appearanceImg.value = results[3] ? `/api/fs/${props.project}/assert/character/${props.name}/appearance.jpg?t=${Date.now()}` : ''
  voiceAudio.value = results[4] ? `/api/fs/${props.project}/assert/character/${props.name}/voice.flac?t=${Date.now()}` : ''
  await loadVoiceVariants()
}

function edit(field: string) {
  dialog.value = { show: true, field, content: data.value![field as keyof CharData] }
}

async function save() {
  const field = dialog.value.field as keyof CharData
  const file = `${field}.md`
  await writeFs(props.project, `prompt/character/${props.name}/${file}`, dialog.value.content)
  if (data.value) data.value[field] = dialog.value.content
  dialog.value.show = false
}

// ── 声音变体逻辑 ─────────────────────────────────────────────────

/**
 * 加载当前角色的声音变体列表（静默失败）。
 */
async function loadVoiceVariants() {
  voiceVariantsLoading.value = true
  try {
    const res = await listCharacterVoiceVariants(props.project, props.name)
    voiceVariants.value = res.variants
  } catch {
    voiceVariants.value = []
  } finally {
    voiceVariantsLoading.value = false
  }
}

/** 生成声音变体音频的预览 URL（带缓存破坏参数） */
function voiceVariantAudioUrl(v: VoiceVariantInfo): string {
  return `/api/fs/${props.project}/${v.audioPath}?t=${Date.now()}`
}

/** 打开「新增声音变体」对话框 */
function openVoiceVariantCreate() {
  voiceVariantForm.value = {
    show: true, mode: 'create', id: '', originalId: '', prompt: '', promptMode: 'append', 台词: '', error: '', saving: false,
  }
}

/** 打开「编辑声音变体」对话框 */
function openVoiceVariantEdit(v: VoiceVariantInfo) {
  voiceVariantForm.value = {
    show: true, mode: 'edit', id: v.id, originalId: v.id, prompt: v.prompt, promptMode: v.promptMode, 台词: v.台词, error: '', saving: false,
  }
}

/**
 * 根据提示词模式拼接变体实际使用的声线描述。
 * 追加模式：在原描述后换行追加提示词；覆盖模式：仅使用提示词。
 *
 * @param base 角色音色设计原描述（voice.md 内容）
 * @param prompt 变体提示词
 * @param mode 提示词模式
 * @returns 实际用于生成的声音描述
 */
function buildVoiceVariantDesc(base: string, prompt: string, mode: VoicePromptMode): string {
  const p = prompt.trim()
  if (mode === 'overwrite') return p
  const b = base.trim()
  return b ? `${b}\n${p}` : p
}

/** 提交声音变体表单（新增/编辑，编辑时名称变更走 rename） */
async function submitVoiceVariant() {
  const f = voiceVariantForm.value
  f.error = ''
  const id = f.id.trim()
  const prompt = f.prompt.trim()
  const line = f.台词.trim()
  if (!id) { f.error = '请填写变体名称'; return }
  if (!prompt) { f.error = '请填写提示词'; return }
  if (!line) { f.error = '请填写台词'; return }
  f.saving = true
  try {
    if (f.mode === 'create') {
      await createCharacterVoiceVariant(props.project, props.name, { id, prompt, promptMode: f.promptMode, 台词: line })
    } else {
      await updateCharacterVoiceVariant(props.project, props.name, f.originalId, { prompt, promptMode: f.promptMode, 台词: line })
      if (id !== f.originalId) {
        await renameCharacterVoiceVariant(props.project, props.name, f.originalId, id)
      }
    }
    f.show = false
    await loadVoiceVariants()
  } catch (e) {
    f.error = e instanceof AssetApiError ? e.message : (e instanceof Error ? e.message : String(e))
  } finally {
    f.saving = false
  }
}

/** 删除声音变体（弹窗确认后删除 meta 与音频资产） */
async function onDeleteVoiceVariant(v: VoiceVariantInfo) {
  const ok = await confirm({
    title: '删除声音变体',
    content: `确定删除声音变体「${v.id}」？将同时删除其音频资产。`,
    confirmText: '删除',
    confirmColor: 'error',
  })
  if (!ok) return
  try {
    await deleteCharacterVoiceVariant(props.project, props.name, v.id)
    await loadVoiceVariants()
  } catch (e) {
    window.alert(e instanceof AssetApiError ? e.message : String(e))
  }
}

/** 打开声音变体生成对话框（tts-voice-design，desc 按模式拼接、text 为台词） */
function openVoiceVariantGenerate(v: VoiceVariantInfo) {
  voiceVariantGen.value = {
    show: true,
    vars: {
      desc: buildVoiceVariantDesc(data.value?.voice ?? '', v.prompt, v.promptMode),
      text: v.台词,
      purpose: 'character-voice',
      character: props.name,
      name: props.name,
    },
    outputPath: v.audioPath,
    promptPaths: [v.metaPath],
    existingAsset: v.hasAudio ? '已有音频' : undefined,
  }
}

watch(() => [props.project, props.name], load, { immediate: true })
</script>
