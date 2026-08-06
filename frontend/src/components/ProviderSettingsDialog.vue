<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon
          icon="mdi-cog"
          class="mr-2"
        />
        服务商配置
        <v-spacer />
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-card-text>
        <v-alert
          v-if="error"
          type="error"
          class="mb-3"
          :text="error"
          closable
          @click:close="error = ''"
        />
        <div
          v-if="loading"
          class="d-flex justify-center pa-6"
        >
          <v-progress-circular indeterminate />
        </div>
        <template v-else>
          <v-card
            v-for="p in providers"
            :key="p.id"
            variant="outlined"
            class="mb-4"
          >
            <v-card-title class="text-subtitle-1 font-weight-bold">
              {{ p.name }}
              <span class="text-caption text-medium-emphasis ml-2">{{ p.id }}</span>
            </v-card-title>
            <v-card-text>
              <p
                v-if="p.description"
                class="text-body-2 text-medium-emphasis mb-3"
              >
                {{ p.description }}
              </p>

              <!-- boolean 字段 -->
              <v-switch
                v-for="f in booleanFields(p)"
                :key="f.key"
                v-model="forms[p.id][f.key]"
                :label="f.label"
                :hint="f.description"
                persistent-hint
                color="primary"
                class="mt-0"
              />

              <!-- select 字段 -->
              <v-select
                v-for="f in selectFields(p)"
                :key="f.key"
                v-model="forms[p.id][f.key]"
                :label="f.label"
                :items="f.options ?? []"
                item-title="label"
                item-value="value"
                :hint="f.description"
                persistent-hint
                density="comfortable"
                class="mt-2"
              />

              <!-- string / password / number 字段 -->
              <v-text-field
                v-for="f in textFields(p)"
                :key="f.key"
                v-model="forms[p.id][f.key]"
                :label="f.label"
                :type="fieldInputType(p, f)"
                :append-inner-icon="f.type === 'password' ? (showSecret[p.id + '/' + f.key] ? 'mdi-eye-off' : 'mdi-eye') : undefined"
                :placeholder="f.type === 'password' && forms[p.id][f.key] === MASKED_SECRET ? '已设置（留空保持不变）' : f.placeholder"
                :hint="f.description"
                persistent-hint
                density="comfortable"
                class="mt-2"
                @click:append-inner="toggleSecret(p, f)"
              />

              <div class="d-flex justify-end">
                <v-btn
                  color="primary"
                  variant="tonal"
                  size="small"
                  :loading="saving[p.id]"
                  @click="save(p)"
                >
                  保存
                </v-btn>
              </div>
            </v-card-text>
          </v-card>
        </template>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  MASKED_SECRET,
  getProviders,
  saveProviderConfig,
  type ProviderConfigField,
  type ProviderInfo,
} from '../api/providers'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const providers = ref<ProviderInfo[]>([])
const loading = ref(false)
const saving = ref<Record<string, boolean>>({})
const error = ref('')
const showSecret = ref<Record<string, boolean>>({})
const forms = ref<Record<string, Record<string, string | number | boolean>>>({})

/** 构建表单初始值：已保存值（secret 为 '__set__' 时保持占位），否则 defaultValue */
function buildForm(p: ProviderInfo): Record<string, string | number | boolean> {
  const form: Record<string, string | number | boolean> = {}
  for (const f of p.configSchema) {
    if (p.config[f.key] !== undefined) {
      form[f.key] = p.config[f.key]
    } else if (f.defaultValue !== undefined) {
      form[f.key] = f.defaultValue
    } else {
      form[f.key] = f.type === 'boolean' ? false : ''
    }
  }
  return form
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const list = await getProviders()
    providers.value = list
    forms.value = {}
    for (const p of list) {
      forms.value[p.id] = buildForm(p)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) load()
  },
)

function toggleSecret(p: ProviderInfo, f: ProviderConfigField) {
  const key = p.id + '/' + f.key
  showSecret.value[key] = !showSecret.value[key]
}

function fieldInputType(p: ProviderInfo, f: ProviderConfigField): string {
  if (f.type === 'number') return 'number'
  if (f.type === 'password') {
    return showSecret.value[p.id + '/' + f.key] ? 'text' : 'password'
  }
  return 'text'
}

const booleanFields = (p: ProviderInfo) => p.configSchema.filter((f) => f.type === 'boolean')
const selectFields = (p: ProviderInfo) => p.configSchema.filter((f) => f.type === 'select')
const textFields = (p: ProviderInfo) =>
  p.configSchema.filter((f) => f.type === 'string' || f.type === 'password' || f.type === 'number')

async function save(p: ProviderInfo) {
  saving.value[p.id] = true
  error.value = ''
  try {
    const payload: Record<string, unknown> = { ...forms.value[p.id] }
    // secret 占位符不上送（服务端空串 = 保留原值）
    for (const f of p.configSchema) {
      if (f.secret && payload[f.key] === MASKED_SECRET) {
        delete payload[f.key]
      }
    }
    await saveProviderConfig(p.id, payload)
    // 保存成功后重新加载，刷新 '__set__' 占位
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value[p.id] = false
  }
}
</script>
