<template>
  <v-row
    class="ma-0"
    style="height: calc(100vh - 64px); overflow: hidden;"
  >
    <v-col
      cols="3"
      class="pa-2 border-e bg-surface"
      style="overflow-y: auto; height: 100%;"
    >
      <div class="d-flex align-center mb-2 text-primary font-weight-bold">
        <v-icon
          icon="mdi-file-tree"
          class="mr-1"
          color="primary"
          size="small"
        />
        资产浏览器
        <v-spacer />
        <v-btn
          size="x-small"
          color="primary"
          variant="tonal"
          prepend-icon="mdi-lightning-bolt"
          @click="showBatchDialog = true"
        >
          一键生成
        </v-btn>
      </div>
      <v-divider class="mb-2" />
      <AssetTree
        :key="treeKey"
        :project="project"
        @refresh="refreshTree"
      />
      <BatchGenerateDialog
        v-model="showBatchDialog"
        :project="project"
        :batch-id="activeBatchId"
        :summary="summary"
        :tasks="tasks"
        @update:batch-id="activeBatchId = $event"
        @refresh="refreshTree"
        @clear-batch="clearBatch"
      />
    </v-col>
    <v-col
      cols="9"
      class="pa-4 d-flex flex-column"
      style="overflow: hidden; height: 100%;"
    >
      <ProjectPanel
        v-if="type === 'project'"
        :project
      />
      <CharacterPanel
        v-else-if="type === 'character'"
        :project
        :name
      />
      <StagePanel
        v-else-if="type === 'stage'"
        :project
        :name
        :subscene
      />
      <ScenePanel
        v-else-if="type === 'scene'"
        :project
        :episode
        :shot
      />
      <CustomAssetPanel
        v-else-if="type === 'custom'"
        :project
      />
      <div
        v-else
        class="d-flex align-center justify-center"
        style="height: 100%"
      >
        <div class="text-center">
          <v-icon
            icon="mdi-hand-pointing-left"
            size="48"
            color="grey-lighten-1"
          />
          <div class="text-grey mt-2">
            从左侧选择一个资产查看
          </div>
        </div>
      </div>
    </v-col>

    <!-- Floating batch progress card (visible when dialog closed and batch active) -->
    <v-card
      v-if="activeBatchId && !showBatchDialog"
      class="batch-float-card"
      elevation="8"
      @click="showBatchDialog = true"
    >
      <div class="d-flex align-center mb-1">
        <v-icon
          icon="mdi-lightning-bolt"
          color="primary"
          size="small"
          class="mr-1"
        />
        <span class="text-body-medium font-weight-medium">一键生成</span>
        <v-spacer />
        <span class="text-body-small text-grey">
          {{ summary.completed + summary.failed }} / {{ summary.total }}
        </span>
        <v-btn
          v-if="batchFinished"
          icon="mdi-close"
          size="x-small"
          variant="text"
          class="ml-1"
          @click.stop="dismissFloatingCard"
        />
      </div>
      <v-progress-linear
        :model-value="progressPercent"
        :color="batchFailed ? 'error' : batchFinished ? 'success' : 'primary'"
        height="6"
        rounded
        class="mb-1"
      />
      <div class="text-body-small text-medium-emphasis">
        {{ floatingStatusText }}
      </div>
    </v-card>
  </v-row>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import AssetTree from '../components/AssetTree.vue'
import ProjectPanel from '../components/ProjectPanel.vue'
import CharacterPanel from '../components/CharacterPanel.vue'
import StagePanel from '../components/StagePanel.vue'
import ScenePanel from '../components/ScenePanel.vue'
import CustomAssetPanel from '../components/CustomAssetPanel.vue'
import BatchGenerateDialog from '../components/BatchGenerateDialog.vue'
import { useBatchTask } from '../composables/useBatchTask'

const route = useRoute()
const project = computed(() => route.query.project as string)
const type = computed(() => route.query.type as string)
const name = computed(() => route.query.name as string)
const subscene = computed(() => route.query.subscene as string | undefined)
const episode = computed(() => route.query.episode as string)
const shot = computed(() => route.query.shot as string)

const showBatchDialog = ref(false)
const treeKey = ref(0)
const activeBatchId = ref<string | null>(null)
const { summary, tasks } = useBatchTask(activeBatchId)

const progressPercent = computed(() => {
  if (summary.total === 0) return 0
  return ((summary.completed + summary.failed) / summary.total) * 100
})

const batchFinished = computed(() =>
  summary.total > 0
  && summary.completed + summary.failed === summary.total,
)

const batchFailed = computed(() => batchFinished.value && summary.failed > 0)

const floatingStatusText = computed(() => {
  if (batchFinished.value) {
    if (summary.failed > 0) return `已完成，${summary.failed} 个失败`
    return '全部完成'
  }
  if (summary.running > 0) return `生成中… ${summary.running} 个运行中`
  if (summary.pending > 0) return `排队中… ${summary.pending} 个待执行`
  return '准备中…'
})

function refreshTree() {
  treeKey.value++
}

function clearBatch() {
  activeBatchId.value = null
}

function dismissFloatingCard() {
  if (batchFinished.value) {
    if (summary.completed > 0) refreshTree()
    clearBatch()
  }
}
</script>

<style scoped>
.batch-float-card {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 280px;
  padding: 12px 14px;
  z-index: 1000;
  cursor: pointer;
  border-radius: 12px;
}
</style>
