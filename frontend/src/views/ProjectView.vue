<template>
  <v-row class="ma-0" style="height: calc(100vh - 64px)">
    <v-col cols="3" class="pa-2 border-e">
      <AssetTree :project="project" />
    </v-col>
    <v-col cols="9" class="pa-4">
      <CharacterPanel v-if="type === 'character'" :project :name />
      <StagePanel v-else-if="type === 'stage'" :project :name />
      <ScenePanel v-else-if="type === 'scene'" :project :episode :shot />
      <div v-else class="d-flex align-center justify-center text-grey" style="height: 100%">
        从左侧选择一个资产查看
      </div>
    </v-col>
  </v-row>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AssetTree from '../components/AssetTree.vue'
import CharacterPanel from '../components/CharacterPanel.vue'
import StagePanel from '../components/StagePanel.vue'
import ScenePanel from '../components/ScenePanel.vue'

const route = useRoute()
const project = computed(() => route.query.project)
const type = computed(() => route.query.type)
const name = computed(() => route.query.name)
const episode = computed(() => route.query.episode)
const shot = computed(() => route.query.shot)
</script>
