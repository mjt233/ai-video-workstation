<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        选择登场角色
        <v-spacer />
        <v-chip
          v-if="multiple"
          size="small"
          variant="tonal"
        >
          已选 {{ localSelected.length }}
        </v-chip>
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="filter"
          label="筛选角色 / 变体"
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
          暂无角色
        </div>
        <v-list
          v-else
          density="comfortable"
          lines="two"
        >
          <v-list-item
            v-for="item in filtered"
            :key="item.ref"
            :active="isSelected(item.ref)"
            @click="toggle(item.ref)"
          >
            <template #prepend>
              <v-avatar
                size="48"
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
                  mdi-account
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
              >已有外观图</span>
              <span
                v-else
                class="text-grey text-caption"
              >未生成资产</span>
            </v-list-item-subtitle>
            <template #append>
              <v-checkbox-btn
                v-if="multiple"
                :model-value="isSelected(item.ref)"
                @click.stop="toggle(item.ref)"
              />
              <v-icon
                v-else-if="isSelected(item.ref)"
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
import { listCharacterVariants } from '../api/assets'

interface CharacterOption {
  /** 选择值：角色名 或 角色名@变体id */
  ref: string
  name: string
  imageUrl: string
  isVariant?: boolean
  variantDesc?: string
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  project: string
  modelSelected?: string[]
  multiple?: boolean
}>(), {
  modelSelected: () => [],
  multiple: true,
})

const emit = defineEmits<{
  'update:modelValue': [boolean]
  /**
   * 确认选择。
   * @param refs 角色引用列表（可含 @变体）
   * @param imageUrls 引用 → 已探测图片 URL
   */
  confirm: [refs: string[], imageUrls: Record<string, string>]
}>()

const loading = ref(false)
const filter = ref('')
const options = ref<CharacterOption[]>([])
const localSelected = ref<string[]>([])

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return options.value
  return options.value.filter((o) =>
    o.ref.toLowerCase().includes(q)
    || o.name.toLowerCase().includes(q)
    || (o.variantDesc ?? '').toLowerCase().includes(q),
  )
})

function isSelected(ref: string) {
  return localSelected.value.includes(ref)
}

function toggle(ref: string) {
  if (props.multiple) {
    if (isSelected(ref)) {
      localSelected.value = localSelected.value.filter((n) => n !== ref)
    } else {
      localSelected.value = [...localSelected.value, ref]
    }
  } else {
    localSelected.value = [ref]
  }
}

function confirm() {
  const refs = [...localSelected.value]
  const imageUrls: Record<string, string> = {}
  for (const ref of refs) {
    const opt = options.value.find((o) => o.ref === ref)
    if (opt?.imageUrl) imageUrls[ref] = opt.imageUrl
  }
  emit('confirm', refs, imageUrls)
  emit('update:modelValue', false)
}

async function load() {
  loading.value = true
  try {
    const res = await readFs(props.project, 'prompt/character') as DirResponse
    const dirs = (res.entries ?? []).filter((e) => e.type === 'dir').map((e) => e.name)
    const ts = Date.now()
    const items: CharacterOption[] = []
    await Promise.all(dirs.map(async (name) => {
      const path = `assert/character/${name}/appearance.jpg`
      const has = await existsFs(props.project, path)
      items.push({
        ref: name,
        name,
        imageUrl: has ? `/api/fs/${props.project}/${path}?t=${ts}` : '',
        isVariant: false,
      })
      try {
        const { variants } = await listCharacterVariants(props.project, name)
        for (const v of variants) {
          items.push({
            ref: v.ref,
            name,
            imageUrl: v.hasImage ? `/api/fs/${props.project}/${v.imagePath}?t=${ts}` : '',
            isVariant: true,
            variantDesc: v.desc,
          })
        }
      } catch {
        // ignore
      }
    }))
    options.value = items.sort((a, b) => a.ref.localeCompare(b.ref, 'zh'))
  } catch {
    options.value = []
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (open) => {
  if (!open) return
  localSelected.value = [...(props.modelSelected ?? [])]
  filter.value = ''
  void load()
})
</script>
