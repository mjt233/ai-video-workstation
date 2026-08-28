<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>新增{{ typeLabel }}</v-card-title>
      <v-card-text>
        <v-alert
          v-if="error"
          type="error"
          density="compact"
          class="mb-3"
        >
          {{ error }}
        </v-alert>

        <template v-if="type === 'character'">
          <v-text-field
            v-model="form.name"
            label="角色名"
            required
          />
          <v-text-field
            v-model="form.gender"
            label="性别"
          />
          <v-text-field
            v-model="form.age"
            label="年龄"
          />
          <v-text-field
            v-model="form.personality"
            label="性格"
          />
        </template>

        <template v-else-if="type === 'stage'">
          <v-text-field
            v-model="form.name"
            label="场景名"
            required
          />
        </template>

        <template v-else-if="type === 'subscene'">
          <v-text-field
            v-model="form.stage"
            label="所属场景"
            required
          />
          <v-text-field
            v-model="form.label"
            label="子场景标签"
            required
            hint="如 正门入口、走廊通道"
            persistent-hint
          />
          <v-textarea
            v-model="form.description"
            label="画面简述"
            rows="3"
          />
        </template>

        <template v-else-if="type === 'episode'">
          <v-text-field
            v-model="form.episode"
            label="集数编号（可空=自动）"
          />
        </template>

        <template v-else-if="type === 'shot'">
          <v-text-field
            v-model="form.episode"
            label="所属集数"
            required
          />
          <v-select
            v-model="form.insertMode"
            :items="[
              { title: '末尾新增', value: 'end' },
              { title: '插入到指定序号', value: 'insert' },
            ]"
            label="插入位置"
          />
          <v-text-field
            v-if="form.insertMode === 'insert'"
            v-model="form.shot"
            label="插入序号"
            required
          />
        </template>
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
          创建
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  createCharacter,
  createEpisode,
  createShot,
  createStage,
  createSubscene,
  AssetApiError,
  type RenamePair,
} from '../api/assets'

export type CreateAssetType = 'character' | 'stage' | 'subscene' | 'episode' | 'shot'

const props = defineProps<{
  modelValue: boolean
  project: string
  type: CreateAssetType
  defaults?: Partial<{
    name: string
    stage: string
    episode: string
  }>
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  created: [payload: {
    type: CreateAssetType
    name?: string
    stage?: string
    label?: string
    episode?: string
    shot?: string
    renames?: RenamePair[]
  }]
}>()

const saving = ref(false)
const error = ref('')
const form = reactive({
  name: '',
  gender: '',
  age: '',
  personality: '',
  stage: '',
  label: '',
  description: '',
  episode: '',
  shot: '',
  insertMode: 'end' as 'end' | 'insert',
})

const typeLabel = computed(() => ({
  character: '角色',
  stage: '场景',
  subscene: '子场景',
  episode: '集数',
  shot: '分镜',
}[props.type]))

watch(() => props.modelValue, (open) => {
  if (!open) return
  error.value = ''
  form.name = props.defaults?.name ?? ''
  form.gender = ''
  form.age = ''
  form.personality = ''
  form.stage = props.defaults?.stage ?? ''
  form.label = ''
  form.description = ''
  form.episode = props.defaults?.episode ?? ''
  form.shot = ''
  form.insertMode = 'end'
})

async function submit() {
  saving.value = true
  error.value = ''
  try {
    if (props.type === 'character') {
      await createCharacter(props.project, {
        name: form.name.trim(),
        gender: form.gender,
        age: form.age,
        personality: form.personality,
      })
      emit('created', { type: 'character', name: form.name.trim() })
    } else if (props.type === 'stage') {
      await createStage(props.project, { name: form.name.trim() })
      emit('created', { type: 'stage', name: form.name.trim() })
    } else if (props.type === 'subscene') {
      await createSubscene(props.project, {
        stage: form.stage.trim(),
        label: form.label.trim(),
        description: form.description,
      })
      emit('created', { type: 'subscene', stage: form.stage.trim(), label: form.label.trim() })
    } else if (props.type === 'episode') {
      const r = await createEpisode(props.project, {
        episode: form.episode.trim() || undefined,
      })
      emit('created', { type: 'episode', episode: r.episode })
    } else {
      const r = await createShot(props.project, {
        episode: form.episode.trim(),
        shot: form.insertMode === 'insert' ? form.shot.trim() : undefined,
        position: form.insertMode,
      })
      emit('created', {
        type: 'shot',
        episode: r.episode,
        shot: r.shot,
        renames: r.renames,
      })
    }
    emit('update:modelValue', false)
  } catch (e) {
    error.value = e instanceof AssetApiError ? e.message : '创建失败'
  } finally {
    saving.value = false
  }
}
</script>
