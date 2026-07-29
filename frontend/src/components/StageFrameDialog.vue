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
        <div class="d-flex align-center ga-3 mb-2">
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
              <template v-if="isPrevRef">
                prev
                <span class="text-medium-emphasis">（上一分镜最后场景）</span>
              </template>
              <template v-else>
                {{ form.基础场景 }}
              </template>
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
              {{ isPrevRef ? '上一分镜最后场景图尚未生成' : '未生成资产' }}
            </div>
          </div>
        </div>
        <div class="d-flex flex-wrap ga-2 mb-4">
          <v-btn
            variant="tonal"
            color="primary"
            @click="stagePickerOpen = true"
          >
            选择基础场景
          </v-btn>
          <v-btn
            variant="tonal"
            color="secondary"
            :disabled="!canUsePrev"
            :title="canUsePrev ? '引用同集上一分镜最后一个场景图（仅直接引用）' : '第 1 个分镜无上一分镜，无法使用 prev'"
            @click="selectPrevStage"
          >
            引用上一分镜最后场景
          </v-btn>
        </div>
        <v-alert
          v-if="isPrevRef"
          type="info"
          density="compact"
          variant="tonal"
          class="mb-4"
        >
          prev 仅支持直接引用：将复制上一分镜最后一帧场景图，不可叠加角色或合成 Prompt。
        </v-alert>

        <div class="text-caption text-medium-emphasis mb-1">
          登场角色
        </div>
        <div class="d-flex flex-wrap align-center ga-2 mb-2">
          <v-chip
            v-for="name in form.登场角色"
            :key="name"
            :closable="!isPrevRef"
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
          >{{ isPrevRef ? '无（prev 仅直接引用）' : '无（直接引用基础场景时可不选）' }}</span>
          <v-btn
            size="small"
            variant="tonal"
            :disabled="isPrevRef"
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
          :disabled="isPrevRef"
          :hint="isPrevRef ? 'prev 仅直接引用，不可填写合成 Prompt' : '直接引用基础场景时留空；有登场角色时必填'"
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
import { computed, reactive, ref, watch } from 'vue'
import { existsFs, readFs } from '../api/client'
import {
  AssetApiError,
  createSceneStageFrame,
  updateSceneStageFrame,
} from '../api/assets'
import StagePicker from './StagePicker.vue'
import CharacterPicker from './CharacterPicker.vue'

/** 引用同集上一分镜最后场景图的固定关键字。 */
const PREV_STAGE_REF = 'prev'

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

/**
 * 当前是否选择了 prev 引用。
 */
const isPrevRef = computed(() => form.基础场景.trim() === PREV_STAGE_REF)

/**
 * 当前分镜是否允许使用 prev（同集 shot > 1）。
 */
const canUsePrev = computed(() => {
  const n = Number(String(props.shot).trim())
  return Number.isInteger(n) && n > 1
})

/**
 * 移除登场角色。
 * @param name 角色引用
 */
function removeCharacter(name: string) {
  if (isPrevRef.value) return
  form.登场角色 = form.登场角色.filter((n) => n !== name)
}

/**
 * 解析普通基础场景引用为 assert 路径。
 * 支持 `场景/标签` 与 `场景/标签@变体`；`prev` 返回 null（需上下文解析）。
 * @param ref 场景引用
 * @returns assert 相对路径或 null
 */
function stageRefToAssertPath(ref: string): string | null {
  const trimmed = ref.trim()
  if (!trimmed || trimmed === PREV_STAGE_REF) return null
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
 * @param ref 角色引用
 * @returns assert 相对路径或 null
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

/**
 * 解析 prev 对应的上一分镜最后场景图 assert 路径。
 * @returns assert 相对路径；无法解析时返回 null
 */
async function resolvePrevAssertPath(): Promise<string | null> {
  if (!canUsePrev.value) return null
  const prevShot = String(Number(props.shot) - 1)
  try {
    const raw = await readFs(props.project, `prompt/scene/${props.episode}/${prevShot}/stage.json`)
    let defs: unknown = raw
    if (typeof raw === 'string') {
      defs = JSON.parse(raw || '[]')
    }
    if (!Array.isArray(defs) || defs.length === 0) return null
    const lastIndex = defs.length - 1
    return `assert/scene/${props.episode}/${prevShot}/stage/${lastIndex}.jpg`
  } catch {
    return null
  }
}

/**
 * 刷新基础场景预览。
 * @param ref 场景引用
 * @param knownImageUrl 选择器已探测到的图片 URL（优先使用，避免二次 HEAD 失败误判）
 */
async function refreshStagePreview(ref: string, knownImageUrl?: string) {
  if (!ref) {
    stagePreviewUrl.value = ''
    return
  }
  if (knownImageUrl) {
    stagePreviewUrl.value = knownImageUrl
    return
  }
  stagePreviewUrl.value = ''
  if (ref.trim() === PREV_STAGE_REF) {
    const path = await resolvePrevAssertPath()
    if (path && await existsFs(props.project, path)) {
      stagePreviewUrl.value = `/api/fs/${props.project}/${path}?t=${Date.now()}`
    }
    return
  }
  const path = stageRefToAssertPath(ref)
  if (!path) return
  if (await existsFs(props.project, path)) {
    stagePreviewUrl.value = `/api/fs/${props.project}/${path}?t=${Date.now()}`
  }
}

/**
 * 刷新登场角色预览图。
 * @param names 角色引用列表（可含 @变体）
 * @param knownImageUrls 选择器已探测到的图片 URL 映射
 */
async function refreshCharacterPreviews(
  names: string[],
  knownImageUrls?: Record<string, string>,
) {
  const next: Record<string, string> = {}
  const ts = Date.now()
  await Promise.all(names.map(async (name) => {
    const known = knownImageUrls?.[name]
    if (known) {
      next[name] = known
      return
    }
    const path = characterRefToAssertPath(name)
    if (!path) return
    if (await existsFs(props.project, path)) {
      next[name] = `/api/fs/${props.project}/${path}?t=${ts}`
    }
  }))
  characterPreviewUrls.value = next
}

/**
 * 选择引用上一分镜最后场景（prev）。
 * 强制清空角色与 prompt，仅直接引用。
 */
function selectPrevStage() {
  if (!canUsePrev.value) {
    error.value = '第 1 个分镜不能使用 prev'
    return
  }
  error.value = ''
  form.基础场景 = PREV_STAGE_REF
  form.登场角色 = []
  form.prompt = ''
  characterPreviewUrls.value = {}
  void refreshStagePreview(PREV_STAGE_REF)
}

/**
 * 选择器确认基础场景。
 * @param payload 引用与可选已有图 URL
 */
function onStagePicked(payload: { ref: string; imageUrl: string } | string) {
  // 兼容旧签名（仅 string）
  if (typeof payload === 'string') {
    form.基础场景 = payload
    void refreshStagePreview(payload)
    return
  }
  form.基础场景 = payload.ref
  void refreshStagePreview(payload.ref, payload.imageUrl || undefined)
}

/**
 * 选择器确认登场角色。
 * @param names 角色引用列表
 * @param imageUrls 可选：引用 → 图片 URL
 */
function onCharactersPicked(names: string[], imageUrls?: Record<string, string>) {
  if (isPrevRef.value) return
  form.登场角色 = names
  void refreshCharacterPreviews(names, imageUrls)
}

/**
 * 提交新增/编辑场景帧。
 */
async function submit() {
  error.value = ''
  const base = form.基础场景.trim()
  if (!base) {
    error.value = '请选择基础场景'
    return
  }
  if (base === PREV_STAGE_REF) {
    if (!canUsePrev.value) {
      error.value = '第 1 个分镜不能使用 prev'
      return
    }
    if (form.登场角色.length > 0 || form.prompt.trim()) {
      error.value = 'prev 仅支持直接引用（登场角色与 prompt 必须为空）'
      return
    }
  } else if (form.登场角色.length > 0 && !form.prompt.trim()) {
    error.value = '有登场角色时必须填写合成 Prompt'
    return
  }

  saving.value = true
  try {
    const body = {
      基础场景: base,
      登场角色: base === PREV_STAGE_REF ? [] : form.登场角色,
      prompt: base === PREV_STAGE_REF ? '' : form.prompt.trim(),
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
  if (form.基础场景.trim() === PREV_STAGE_REF) {
    form.登场角色 = []
    form.prompt = ''
  }
  void refreshStagePreview(form.基础场景)
  void refreshCharacterPreviews(form.登场角色)
})
</script>
