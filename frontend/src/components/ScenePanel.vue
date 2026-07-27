<template>
  <div v-if="data">
    <v-tabs v-model="tab">
      <v-tab value="overview">总览</v-tab>
      <v-tab value="script">台词</v-tab>
      <v-tab value="images">场景图片</v-tab>
    </v-tabs>

    <v-tabs-window v-model="tab">
      <v-tabs-window-item value="overview">
        <div class="d-flex justify-end mt-2 mb-2">
          <v-btn icon variant="text" size="small" @click="edit('overview')"><v-icon>mdi-pencil</v-icon></v-btn>
        </div>
        <div v-html="renderMd(data.overview)"></div>
      </v-tabs-window-item>

      <v-tabs-window-item value="script">
        <div class="d-flex justify-end mt-2 mb-2">
          <v-btn icon variant="text" size="small" @click="editJson('script')"><v-icon>mdi-pencil</v-icon></v-btn>
        </div>
        <pre>{{ JSON.stringify(data.script, null, 2) }}</pre>
      </v-tabs-window-item>

      <v-tabs-window-item value="images">
        <v-row>
          <v-col v-for="(img, i) in stageImages" :key="i" cols="6">
            <v-card>
              <v-card-text class="text-center">场景{{ i }}</v-card-text>
              <v-img :src="img" max-height="400" contain />
            </v-card>
          </v-col>
          <v-col v-if="!stageImages.length" cols="12">
            <div class="text-grey">暂无场景图片</div>
          </v-col>
        </v-row>
      </v-tabs-window-item>
    </v-tabs-window>

    <v-dialog v-model="dialog.show" max-width="800">
      <v-card>
        <v-card-title>编辑 {{ dialog.field }}</v-card-title>
        <v-card-text>
          <v-textarea v-model="dialog.content" rows="15" variant="outlined" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.show = false">取消</v-btn>
          <v-btn color="primary" @click="save">保存</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue'
import { readFs, writeFs } from '../api/client.js'
import { marked } from 'marked'

const props = defineProps({ project: String, episode: String, shot: String })
const tab = ref(null)
const data = ref(null)
const stageImages = ref([])
const dialog = ref({ show: false, field: '', content: '' })

const basePath = computed(() => `prompt/scene/${props.episode}/${props.shot}`)
const assertBase = computed(() => `/api/fs/${props.project}/assert/scene/${props.episode}/${props.shot}/stage`)

async function load() {
  const bp = basePath.value
  try {
    const [overview, scriptRaw] = await Promise.all([
      readFs(props.project, `${bp}/overview.md`).catch(() => ''),
      readFs(props.project, `${bp}/script.json`).catch(() => '[]'),
    ])
    let script = []
    try { script = JSON.parse(scriptRaw) } catch {}
    data.value = { overview, script }
  } catch {}

  try {
    const stageRaw = await readFs(props.project, `${bp}/stage.json`)
    const stage = JSON.parse(stageRaw)
    if (Array.isArray(stage)) {
      stageImages.value = stage.map((_, i) => `${assertBase.value}/${i}.jpg`)
    } else {
      stageImages.value = []
    }
  } catch {
    stageImages.value = []
  }
}

function edit(field) {
  dialog.value = { show: true, field, content: data.value[field] }
}

function editJson(field) {
  dialog.value = { show: true, field, content: JSON.stringify(data.value[field], null, 2) }
}

async function save() {
  const field = dialog.value.field
  const file = field === 'script' ? 'script.json' : `${field}.md`
  let content = dialog.value.content
  if (field === 'script') {
    try { JSON.parse(content) } catch (e) { alert('JSON 格式错误: ' + e.message); return }
  }
  await writeFs(props.project, `${basePath.value}/${file}`, content)
  if (field === 'script') data.value[field] = JSON.parse(content)
  else data.value[field] = content
  dialog.value.show = false
}

function renderMd(text) {
  return marked.parse(text || '')
}

watch(() => [props.project, props.episode, props.shot], load, { immediate: true })
</script>
