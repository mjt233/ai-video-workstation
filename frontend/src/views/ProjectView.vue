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
      />
      <BatchGenerateDialog
        v-model="showBatchDialog"
        :project="project"
        @refresh="refreshTree"
      />
    </v-col>
    <v-col
      cols="9"
      class="pa-4 d-flex flex-column"
      style="overflow: hidden; height: 100%;"
    >
      <CharacterPanel
        v-if="type === 'character'"
        :project
        :name
      />
      <StagePanel
        v-else-if="type === 'stage'"
        :project
        :name
      />
      <ScenePanel
        v-else-if="type === 'scene'"
        :project
        :episode
        :shot
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
  </v-row>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import AssetTree from '../components/AssetTree.vue'
import CharacterPanel from '../components/CharacterPanel.vue'
import StagePanel from '../components/StagePanel.vue'
import ScenePanel from '../components/ScenePanel.vue'
import BatchGenerateDialog from '../components/BatchGenerateDialog.vue'

const route = useRoute()
const project = computed(() => route.query.project as string)
const type = computed(() => route.query.type as string)
const name = computed(() => route.query.name as string)
const episode = computed(() => route.query.episode as string)
const shot = computed(() => route.query.shot as string)

const showBatchDialog = ref(false)
const treeKey = ref(0)

function refreshTree() {
  treeKey.value++
}
</script>
