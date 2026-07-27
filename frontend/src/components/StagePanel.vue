<template>
  <v-row v-if="subScenes.length">
    <v-col cols="4">
      <v-list>
        <v-list-item
          v-for="s in subScenes"
          :key="s.label"
          @click="selected = s"
          :active="selected?.label === s.label"
        >
          <v-list-item-title>{{ s.label }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-col>
    <v-col cols="8">
      <template v-if="selected">
        <v-expansion-panels>
          <v-expansion-panel value="prompt">
            <v-expansion-panel-title>Prompt</v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="d-flex justify-end mb-2">
                <v-btn icon variant="text" size="small" @click="editPrompt"><v-icon>mdi-pencil</v-icon></v-btn>
              </div>
              <div v-html="renderMd(selected.promptMd)"></div>
            </v-expansion-panel-text>
          </v-expansion-panel>

          <v-expansion-panel value="image">
            <v-expansion-panel-title>图片</v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-img v-if="selected.imageUrl" :src="selected.imageUrl" max-height="500" contain />
              <div v-else class="text-grey">暂无图片</div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </template>
    </v-col>

    <v-dialog v-model="dialog.show" max-width="800">
      <v-card>
        <v-card-title>编辑 Prompt</v-card-title>
        <v-card-text>
          <v-textarea v-model="dialog.content" rows="15" variant="outlined" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.show = false">取消</v-btn>
          <v-btn color="primary" @click="savePrompt">保存</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-row>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { readFs, writeFs, type DirResponse } from '../api/client'
import { marked } from 'marked'

interface SubScene {
  label: string
  promptMd: string
  imageUrl: string
}

interface DialogState {
  show: boolean
  content: string
}

const props = defineProps<{ project: string; name: string }>()
const subScenes = ref<SubScene[]>([])
const selected = ref<SubScene | null>(null)
const dialog = ref<DialogState>({ show: false, content: '' })

async function load() {
  try {
    const result = await readFs(props.project, `prompt/stage/${props.name}/`) as DirResponse
    const items: SubScene[] = []
    for (const entry of result.entries) {
      if (entry.type === 'file' && entry.name.endsWith('.md')) {
        const label = entry.name.replace(/\.md$/, '')
        const promptMd = await readFs(props.project, `prompt/stage/${props.name}/${entry.name}`) as string
        const imageUrl = `/api/fs/${props.project}/assert/stage/${props.name}/${label}.jpg`
        items.push({ label, promptMd, imageUrl })
      }
    }
    subScenes.value = items
    if (items.length) selected.value = items[0]
  } catch {}
}

function editPrompt() {
  dialog.value = { show: true, content: selected.value!.promptMd }
}

async function savePrompt() {
  const fileName = selected.value!.label + '.md'
  await writeFs(props.project, `prompt/stage/${props.name}/${fileName}`, dialog.value.content)
  selected.value!.promptMd = dialog.value.content
  dialog.value.show = false
}

function renderMd(text: string) {
  return marked.parse(text || '')
}

watch(() => [props.project, props.name], load, { immediate: true })
</script>
