<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ dialogTitle }}</v-card-title>
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

        <template v-else-if="type === 'prop-category'">
          <v-text-field
            v-model="form.name"
            label="分类名"
            required
            hint="如 武器、日常用品、家具"
            persistent-hint
          />
        </template>

        <template v-else-if="type === 'prop'">
          <v-text-field
            v-model="form.category"
            label="所属分类"
            required
            hint="分类不存在时会自动创建"
            persistent-hint
          />
          <v-text-field
            v-model="form.name"
            label="道具名"
            required
            hint="如 武士刀、茶杯、椅子"
            persistent-hint
          />
        </template>

        <template v-else-if="type === 'episode'">
          <v-text-field
            v-model="form.episode"
            label="集数编号（可空=自动）"
          />
          <div class="mt-2">
            <AliasFormFields
              :alias="form.alias"
              :show-prefix="form.showPrefix"
              @update:alias="form.alias = $event"
              @update:show-prefix="form.showPrefix = $event"
            />
          </div>
        </template>

        <template v-else-if="type === 'shot'">
          <!-- 新增分镜：所属集数可输入；移动分镜：固定为目标集数（只读显示） -->
          <v-text-field
            v-if="mode === 'create'"
            v-model="form.episode"
            label="所属集数"
            required
          />
          <v-text-field
            v-else
            :model-value="targetEpisodeLabel"
            label="目标集数"
            readonly
            required
          />

          <v-select
            v-model="form.position"
            :items="positionItems"
            label="插入位置"
            :hint="positionHint"
            persistent-hint
            variant="outlined"
          />

          <div class="mt-2">
            <AliasFormFields
              :alias="form.alias"
              :show-prefix="form.showPrefix"
              @update:alias="form.alias = $event"
              @update:show-prefix="form.showPrefix = $event"
            />
          </div>
        </template>

        <template v-else-if="type === 'script-episode'">
          <v-text-field
            v-model="form.episode"
            label="集数编号（可空 = 自动追加末尾）"
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
          {{ mode === 'move' ? '移动' : '创建' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import AliasFormFields from './AliasFormFields.vue'
import {
  createCharacter,
  createEpisode,
  createProp,
  createPropCategory,
  createScriptEpisode,
  createShot,
  createStage,
  createSubscene,
  moveShot,
  AssetApiError,
  type BrowserMeta,
  type RenamePair,
} from '../api/assets'
import { epDisplay } from '../utils/aliasDisplay'

export type CreateAssetType = 'character' | 'stage' | 'subscene' | 'prop-category' | 'prop' | 'episode' | 'shot' | 'script-episode'

/** 某集数下分镜选项（供「插入位置」下拉展示；label 已按别名规则生成） */
export interface ShotOption {
  shot: string
  label: string
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  project: string
  type: CreateAssetType
  defaults?: Partial<{
    name: string
    stage: string
    category: string
    episode: string
  }>
  /** 对话框模式：create = 新增；move = 移动分镜（type 须为 shot） */
  mode?: 'create' | 'move'
  /** 移动分镜的源位置（mode=move 时必填） */
  moveSource?: { episode: string; shot: string } | null
  /** 浏览器元数据（集数/分镜别名；用于下拉显示别名） */
  meta?: BrowserMeta | null
  /** 集数 → 分镜选项（含别名后的显示文案；供「插入位置」下拉） */
  shotsByEpisode?: Record<string, ShotOption[]>
}>(), {
  defaults: () => ({}),
  mode: 'create',
  moveSource: null,
  meta: null,
  shotsByEpisode: () => ({}),
})

const emit = defineEmits<{
  'update:modelValue': [boolean]
  created: [payload: {
    type: CreateAssetType
    name?: string
    stage?: string
    label?: string
    category?: string
    episode?: string
    shot?: string
    /** 新增分镜（插入/末尾）：集内重编号映射 */
    renames?: RenamePair[]
    /** 移动分镜：各集内重编号映射（含 episode 字段） */
    episodeRenames?: { episode: string; from: string; to: string }[]
    /** 移动分镜：源位置（前端据此修正 URL 与树） */
    from?: { episode: string; shot: string }
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
  category: '',
  episode: '',
  /** 插入位置：'end' = 末尾新增，其余为分镜号（成为该位置） */
  position: 'end' as string,
  alias: '',
  showPrefix: true,
})

const typeLabel = computed(() => ({
  character: '角色',
  stage: '场景',
  subscene: '子场景',
  'prop-category': '道具分类',
  prop: '道具',
  episode: '集数',
  shot: '分镜',
  'script-episode': '剧本分集',
}[props.type]))

const dialogTitle = computed(() => {
  if (props.type === 'shot' && props.mode === 'move') return '移动分镜'
  return `新增${typeLabel.value}`
})

/** 移动模式下目标集数的显示名（带别名） */
const targetEpisodeLabel = computed(() =>
  epDisplay(props.meta ?? null, form.episode || (props.moveSource?.episode ?? '')),
)

/** 当前候选分镜列表（新增 = 该集全部分镜；移动 = 排除自身） */
const candidateShots = computed<ShotOption[]>(() => {
  const list = props.shotsByEpisode[form.episode] ?? []
  if (props.mode !== 'move' || !props.moveSource) return list
  if (props.moveSource.episode !== form.episode) return list
  return list.filter((o) => o.shot !== props.moveSource!.shot)
})

/** 「插入位置」下拉选项：全部候选分镜 + 末尾选项 */
const positionItems = computed(() => {
  const shots = candidateShots.value
  const count = shots.length
  return [
    ...shots.map((o) => ({ title: o.label, value: o.shot })),
    { title: `末尾（第${count + 1}个）`, value: 'end' },
  ]
})

const positionHint = computed(() => {
  if (candidateShots.value.length === 0) return '该集暂无分镜，将作为第 1 个分镜'
  return '选择「分镜N」= 成为该集第 N 个分镜（原位置及之后顺延）；末尾 = 追加到最后'
})

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
  form.category = props.defaults?.category ?? ''
  form.episode = props.mode === 'move'
    ? (props.moveSource ? props.defaults?.episode ?? '' : '')
    : (props.defaults?.episode ?? '')
  form.position = 'end'
  form.alias = ''
  form.showPrefix = true
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
    } else if (props.type === 'prop-category') {
      await createPropCategory(props.project, form.name.trim())
      emit('created', { type: 'prop-category', name: form.name.trim() })
    } else if (props.type === 'prop') {
      await createProp(props.project, form.category.trim(), form.name.trim())
      emit('created', { type: 'prop', category: form.category.trim(), name: form.name.trim() })
    } else if (props.type === 'episode') {
      const r = await createEpisode(props.project, {
        episode: form.episode.trim() || undefined,
        alias: form.alias.trim() || null,
        showPrefix: form.showPrefix,
      })
      emit('created', { type: 'episode', episode: r.episode })
    } else if (props.type === 'script-episode') {
      const r = await createScriptEpisode(props.project, {
        episode: form.episode.trim() || undefined,
      })
      emit('created', { type: 'script-episode', episode: r.episode })
    } else if (props.type === 'shot' && props.mode === 'move') {
      const source = props.moveSource
      if (!source) throw new Error('缺少移动源分镜信息')
      const r = await moveShot(props.project, {
        fromEpisode: source.episode,
        fromShot: source.shot,
        toEpisode: form.episode.trim(),
        // 末尾 = 候选数 + 1（同集候选已排除自身，末尾即当前最后位置）
        position: form.position === 'end' ? candidateShots.value.length + 1 : Number(form.position),
        alias: form.alias.trim() || null,
        showPrefix: form.showPrefix,
      })
      emit('created', {
        type: 'shot',
        episode: r.episode,
        shot: r.shot,
        from: { episode: source.episode, shot: source.shot },
        episodeRenames: r.renames,
      })
    } else {
      const r = await createShot(props.project, {
        episode: form.episode.trim(),
        shot: form.position === 'end' ? undefined : form.position,
        position: form.position === 'end' ? 'end' : 'insert',
        alias: form.alias.trim() || null,
        showPrefix: form.showPrefix,
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
