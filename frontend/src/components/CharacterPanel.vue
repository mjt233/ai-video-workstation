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

    <AssetHistoryDialog
      v-model="historyDialog.show"
      :project="props.project"
      :asset-path="historyDialog.path"
      @activated="load"
    />

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
import MarkdownView from './MarkdownView.vue'
import GenerateDialog from './GenerateDialog.vue'
import AssetHistoryDialog from './AssetHistoryDialog.vue'
import AssetImageUploadButton from './AssetImageUploadButton.vue'

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

function openHistory(path: string) {
  historyDialog.value = { show: true, path }
}

const genDialog = ref<{ show: boolean; type: 'appearance' | 'voice' }>({ show: false, type: 'appearance' })
const genConfig = computed(() => {
  const type = genDialog.value.type
  return {
    workflowId: type === 'appearance' ? 'character-appearance' : 'character-voice',
    workflowName: type === 'appearance' ? '角色外观生成' : '角色声音生成',
    outputPath: type === 'appearance'
      ? `assert/character/${props.name}/appearance.jpg`
      : `assert/character/${props.name}/voice.flac`,
    vars: { name: props.name },
    promptPaths: type === 'appearance'
      ? [`prompt/character/${props.name}/appearance.md`]
      : [`prompt/character/${props.name}/voice.md`],
    existingAsset: type === 'appearance'
      ? (appearanceImg.value ? '已有图片' : undefined)
      : (voiceAudio.value ? '已有音频' : undefined),
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

watch(() => [props.project, props.name], load, { immediate: true })
</script>
