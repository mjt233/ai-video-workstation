<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ mode === 'edit' ? '编辑场景' : '新增场景' }}</v-card-title>
      <v-card-text>
        <v-alert
          v-if="error"
          type="error"
          density="compact"
          class="mb-3"
        >
          {{ error }}
        </v-alert>

        <div class="text-caption text-medium-emphasis mb-1">
          基础场景
        </div>
        <div class="d-flex align-center ga-3 mb-4">
          <v-avatar
            size="64"
            rounded="lg"
          >
            <v-img
              v-if="stagePreviewUrl"
              :src="stagePreviewUrl"
              cover
            />
            <v-icon
              v-else
              color="grey"
            >
              mdi-image-off
            </v-icon>
          </v-avatar>
          <div class="flex-grow-1">
            <div
              v-if="form.基础场景"
              class="text-body-2"
            >
              {{ form.基础场景 }}
            </div>
            <div
              v-else
              class="text-grey text-body-2"
            >
              未选择
            </div>
            <div
              v-if="form.基础场景 && !stagePreviewUrl"
              class="text-grey text-caption"
            >
              未生成资产
            </div>
          </div>
          <v-btn
            variant="tonal"
            color="primary"
            @click="stagePickerOpen = true"
          >
            选择基础场景
          </v-btn>
        </div>

        <div class="text-caption text-medium-emphasis mb-1">
          登场角色
        </div>
        <div class="d-flex flex-wrap align-center ga-2 mb-2">
          <v-chip
            v-for="name in form.登场角色"
            :key="name"
            closable
            @click:close="removeCharacter(name)"
          >
            <v-avatar
              start
              size="24"
            >
              <v-img
                v-if="characterPreviewUrls[name]"
                :src="characterPreviewUrls[name]"
              />
              <v-icon
                v-else
                size="16"
              >
                mdi-account
              </v-icon>
            </v-avatar>
            {{ name }}
          </v-chip>
          <span
            v-if="!form.登场角色.length"
            class="text-grey text-body-2"
          >无（直接引用基础场景时可不选）</span>
          <v-btn
            size="small"
            variant="tonal"
            @click="characterPickerOpen = true"
          >
            选择角色
          </v-btn>
        </div>
        <div
          v-for="name in form.登场角色.filter((n) => !characterPreviewUrls[n])"
          :key="`miss-${name}`"
          class="text-grey text-caption mb-1"
        >
          {{ name }}：未生成资产
        </div>

        <v-textarea
          v-model="form.prompt"
          class="mt-3"
          label="合成 Prompt"
          rows="5"
          auto-grow
          variant="outlined"
          hint="直接引用基础场景时留空；有登场角色时必填"
          persistent-hint
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="saving"
          @click="$emit('update:modelValue', false)"
        >
          取消
        </v-btn>
        <v-btn
          color="primary"
          :loading="saving"
          @click="submit"
        >
          保存
        </v-btn>
      </v-card-actions>
    </v-card>

    <StagePicker
      v-model="stagePickerOpen"
      :project="project"
      :model-selected="form.基础场景"
      @confirm="onStagePicked"
    />
    <CharacterPicker
      v-model="characterPickerOpen"
      :project="project"
      :model-selected="form.登场角色"
      multiple
      @confirm="onCharactersPicked"
    />
  </v-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { existsFs } from '../api/client'
import {
  AssetApiError,
  createSceneStageFrame,
  updateSceneStageFrame,
} from '../api/assets'
import StagePicker from './StagePicker.vue'
import CharacterPicker from './CharacterPicker.vue'

const props = defineProps<{
  modelValue: boolean
  project: string
  episode: string
  shot: string
  mode: 'create' | 'edit'
  index?: number
  initial?: {
    基础场景: string
    登场角色?: string[]
    prompt?: string
  }
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  saved: []
}>()

const saving = ref(false)
const error = ref('')
const stagePickerOpen = ref(false)
const characterPickerOpen = ref(false)
const stagePreviewUrl = ref('')
const characterPreviewUrls = ref<Record<string, string>>({})

const form = reactive({
  基础场景: '',
  登场角色: [] as string[],
  prompt: '',
})

function removeCharacter(name: string) {
  form.登场角色 = form.登场角色.filter((n) => n !== name)
}

/**
 * 解析基础场景引用为 assert 路径。
 * 支持 `场景/标签` 与 `场景/标签@变体`。
 */
function stageRefToAssertPath(ref: string): string | null {
  const trimmed = ref.trim()
  if (!trimmed) return null
  const at = trimmed.indexOf('@')
  const main = at >= 0 ? trimmed.slice(0, at) : trimmed
  const variantId = at >= 0 ? trimmed.slice(at + 1).trim() : ''
  const slash = main.indexOf('/')
  if (slash <= 0 || slash === main.length - 1) return null
  const stage = main.slice(0, slash)
  const label = main.slice(slash + 1)
  if (variantId) {
    return `assert/stage/${stage}/variants/${label}/${variantId}.jpg`
  }
  return `assert/stage/${stage}/${label}.jpg`
}

/**
 * 解析角色引用为 assert 路径。
 * 支持 `角色名` 与 `角色名@变体`。
 */
function characterRefToAssertPath(ref: string): string | null {
  const trimmed = ref.trim()
  if (!trimmed) return null
  const at = trimmed.indexOf('@')
  if (at < 0) return `assert/character/${trimmed}/appearance.jpg`
  const name = trimmed.slice(0, at).trim()
  const variantId = trimmed.slice(at + 1).trim()
  if (!name || !variantId) return null
  return `assert/character/${name}/variants/${variantId}.jpg`
}

async function refreshStagePreview(ref: string) {
  stagePreviewUrl.value = ''
  if (!ref) return
  const path = stageRefToAssertPath(ref)
  if (!path) return
  if (await existsFs(props.project, path)) {
    stagePreviewUrl.value = `/api/fs/${props.project}/${path}?t=${Date.now()}`
  }
}

async function refreshCharacterPreviews(names: string[]) {
  const next: Record<string, string> = {}
  const ts = Date.now()
  await Promise.all(names.map(async (name) => {
    const path = characterRefToAssertPath(name)
    if (!path) return
    if (await existsFs(props.project, path)) {
      next[name] = `/api/fs/${props.project}/${path}?t=${ts}`
    }
  }))
  characterPreviewUrls.value = next
}

function onStagePicked(ref: string) {
  form.基础场景 = ref
  void refreshStagePreview(ref)
}

function onCharactersPicked(names: string[]) {
  form.登场角色 = names
  void refreshCharacterPreviews(names)
}

async function submit() {
  error.value = ''
  if (!form.基础场景.trim()) {
    error.value = '请选择基础场景'
    return
  }
  if (form.登场角色.length > 0 && !form.prompt.trim()) {
    error.value = '有登场角色时必须填写合成 Prompt'
    return
  }

  saving.value = true
  try {
    const body = {
      基础场景: form.基础场景.trim(),
      登场角色: form.登场角色,
      prompt: form.prompt.trim(),
    }
    if (props.mode === 'edit') {
      if (props.index == null) throw new Error('缺少场景索引')
      await updateSceneStageFrame(props.project, props.episode, props.shot, props.index, body)
    } else {
      await createSceneStageFrame(props.project, props.episode, props.shot, body)
    }
    emit('saved')
    emit('update:modelValue', false)
  } catch (e) {
    error.value = e instanceof AssetApiError ? e.message : (e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

watch(() => props.modelValue, (open) => {
  if (!open) return
  error.value = ''
  form.基础场景 = props.initial?.基础场景 ?? ''
  form.登场角色 = [...(props.initial?.登场角色 ?? [])]
  form.prompt = props.initial?.prompt ?? ''
  void refreshStagePreview(form.基础场景)
  void refreshCharacterPreviews(form.登场角色)
})
</script>
