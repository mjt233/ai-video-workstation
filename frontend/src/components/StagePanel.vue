<template>
  <div
    ref="panelRef"
  >
    <v-select
      v-model="selected"
      :items="subScenes"
      item-title="label"
      item-value="label"
      placeholder="选择子场景"
      variant="outlined"
      hide-details
      class="flex-shrink-0"
      return-object
    />

    <div v-show="selected">
      <v-tabs
        v-model="tab"
        class="flex-shrink-0"
      >
        <v-tab value="prompt">
          Prompt
        </v-tab>
        <v-tab value="image">
          图片
        </v-tab>
      </v-tabs>

      <div
        ref="contentRef"
        :style="{ maxHeight: targetHeight + 'px', overflowY: 'auto' }"
      >
        <v-tabs-window
          v-if="selected"
          v-model="tab"
        >
          <v-tabs-window-item value="prompt">
            <div class="d-flex mt-2 mb-2 ml-2">
              <v-btn
                @click="editPrompt"
              >
                编辑
              </v-btn>
            </div>
            <MarkdownView :content="selected.promptMd" />
          </v-tabs-window-item>

          <v-tabs-window-item value="image">
            <v-img
              v-if="selected.imageUrl"
              :src="selected.imageUrl"
              contain
            />
            <div
              v-else
              class="text-grey"
            >
              暂无图片
            </div>
            <div class="d-flex justify-center mt-2">
              <v-btn
                size="small"
                color="primary"
                variant="tonal"
                prepend-icon="mdi-auto-fix"
                @click="genDialog = true"
              >
                生成
              </v-btn>
            </div>
          </v-tabs-window-item>
        </v-tabs-window>
      </div>
    </div>

    <v-dialog
      v-model="dialog.show"
      max-width="800"
    >
      <v-card>
        <v-card-title>编辑 Prompt</v-card-title>
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
            @click="savePrompt"
          >
            保存
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <GenerateDialog
      v-model="genDialog"
      :project="props.project"
      workflow-id="stage-image"
      workflow-name="场景图片生成"
      :vars="{ name: props.name, label: selected?.label ?? '' }"
      :output-path="`assert/stage/${props.name}/${selected?.label}.jpg`"
      :prompt-paths="[`prompt/stage/${props.name}/${selected?.label}.md`]"
      :existing-asset="selected?.imageUrl ? '已有图片' : undefined"
      @refresh="load"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { readFs, writeFs, type DirResponse } from '../api/client'
import MarkdownView from './MarkdownView.vue'
import { useAutoComputeHeight } from '../composables/useAutoComputeHeight'
import GenerateDialog from './GenerateDialog.vue'

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
const tab = ref<string | null>(null)
const subScenes = ref<SubScene[]>([])
const selected = ref<SubScene | null>(null)
const dialog = ref<DialogState>({ show: false, content: '' })
const genDialog = ref(false)

const panelRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)

const { targetHeight } = useAutoComputeHeight({
  autoComputeHeight: true,
  computeTarget: () => contentRef.value,
  observeTarget: () => panelRef.value!,
  offset: 0,
})

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

watch(() => [props.project, props.name], load, { immediate: true })
</script>
