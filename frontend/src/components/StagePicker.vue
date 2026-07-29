<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>选择基础场景</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="filter"
          label="筛选场景 / 变体"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          class="mb-3"
          prepend-inner-icon="mdi-magnify"
        />
        <div
          v-if="loading"
          class="text-center py-6"
        >
          <v-progress-circular indeterminate />
        </div>
        <div
          v-else-if="!filtered.length"
          class="text-grey text-body-2"
        >
          暂无子场景
        </div>
        <v-list
          v-else
          density="comfortable"
          lines="two"
        >
          <v-list-item
            v-for="item in filtered"
            :key="item.ref"
            :active="localSelected === item.ref"
            @click="localSelected = item.ref"
          >
            <template #prepend>
              <v-avatar
                size="56"
                rounded="lg"
                class="mr-2"
              >
                <v-img
                  v-if="item.imageUrl"
                  :src="item.imageUrl"
                  cover
                />
                <v-icon
                  v-else
                  color="grey"
                >
                  mdi-image-off
                </v-icon>
              </v-avatar>
            </template>
            <v-list-item-title>
              {{ item.ref }}
              <v-chip
                v-if="item.isVariant"
                size="x-small"
                class="ml-1"
                color="secondary"
                variant="tonal"
              >
                变体
              </v-chip>
            </v-list-item-title>
            <v-list-item-subtitle>
              <span
                v-if="item.isVariant"
                class="text-caption"
              >{{ item.variantDesc || '衍生变体' }} · </span>
              <span
                v-if="item.imageUrl"
                class="text-success"
              >已有设定图</span>
              <span
                v-else
                class="text-grey text-caption"
              >未生成资产</span>
            </v-list-item-subtitle>
            <template #append>
              <v-icon
                v-if="localSelected === item.ref"
                color="primary"
              >
                mdi-check
              </v-icon>
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="$emit('update:modelValue', false)"
        >
          取消
        </v-btn>
        <v-btn
          color="primary"
          :disabled="!localSelected"
          @click="confirm"
        >
          确定
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { existsFs, readFs, type DirResponse } from '../api/client'
import { listStageVariants } from '../api/assets'

interface StageOption {
  ref: string
  stage: string
  label: string
  imageUrl: string
  isVariant?: boolean
  variantDesc?: string
}

const props = defineProps<{
  modelValue: boolean
  project: string
  modelSelected?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  confirm: [string]
}>()

const loading = ref(false)
const filter = ref('')
const options = ref<StageOption[]>([])
const localSelected = ref('')

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return options.value
  return options.value.filter((o) =>
    o.ref.toLowerCase().includes(q)
    || (o.variantDesc ?? '').toLowerCase().includes(q),
  )
})

function confirm() {
  if (!localSelected.value) return
  emit('confirm', localSelected.value)
  emit('update:modelValue', false)
}

async function load() {
  loading.value = true
  try {
    const stageRoot = await readFs(props.project, 'prompt/stage') as DirResponse
    const stages = (stageRoot.entries ?? []).filter((e) => e.type === 'dir').map((e) => e.name)
    const ts = Date.now()
    const all: StageOption[] = []

    await Promise.all(stages.map(async (stage) => {
      try {
        const dir = await readFs(props.project, `prompt/stage/${stage}`) as DirResponse
        const labels = (dir.entries ?? [])
          .filter((e) => e.type === 'file' && e.name.endsWith('.md'))
          .map((e) => e.name.replace(/\.md$/i, ''))
        await Promise.all(labels.map(async (label) => {
          const ref = `${stage}/${label}`
          const path = `assert/stage/${stage}/${label}.jpg`
          const has = await existsFs(props.project, path)
          all.push({
            ref,
            stage,
            label,
            imageUrl: has ? `/api/fs/${props.project}/${path}?t=${ts}` : '',
            isVariant: false,
          })
          // 衍生变体
          try {
            const { variants } = await listStageVariants(props.project, stage, label)
            for (const v of variants) {
              all.push({
                ref: v.ref,
                stage,
                label,
                imageUrl: v.hasImage ? `/api/fs/${props.project}/${v.imagePath}?t=${ts}` : '',
                isVariant: true,
                variantDesc: v.desc,
              })
            }
          } catch {
            // ignore variant load errors
          }
        }))
      } catch {
        // ignore missing stage dir
      }
    }))

    options.value = all.sort((a, b) => a.ref.localeCompare(b.ref, 'zh'))
  } catch {
    options.value = []
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (open) => {
  if (!open) return
  localSelected.value = props.modelSelected ?? ''
  filter.value = ''
  void load()
})
</script>
