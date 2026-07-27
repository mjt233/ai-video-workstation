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
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { readFs, writeFs } from '../api/client'
import MarkdownView from './MarkdownView.vue'

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
const appearanceImg = computed(() => `/api/fs/${props.project}/assert/character/${props.name}/appearance.jpg`)
const voiceAudio = computed(() => `/api/fs/${props.project}/assert/character/${props.name}/voice.flac`)

const dialog = ref<DialogState>({ show: false, field: '', content: '' })

async function load() {
  const results = await Promise.all([
    readFs(props.project, `prompt/character/${props.name}/overview.md`).catch(() => ''),
    readFs(props.project, `prompt/character/${props.name}/appearance.md`).catch(() => ''),
    readFs(props.project, `prompt/character/${props.name}/voice.md`).catch(() => ''),
  ])
  const overview = results[0] as string
  const appearance = results[1] as string
  const voice = results[2] as string
  data.value = { overview, appearance, voice }
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
