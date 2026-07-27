<template>
  <v-treeview
    :items="treeItems"
    item-title="name"
    item-key="path"
    return-object
    color="primary"
    hoverable
    open-on-click
    @update:selected="onSelect"
  >
    <template #prepend="{ item }">
      <v-icon :color="item.type === 'character' ? 'amber-darken-1' : item.type === 'stage' ? 'green-darken-1' : 'primary'">
        {{ item.icon }}
      </v-icon>
    </template>
  </v-treeview>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { readFs, type DirResponse } from '../api/client'
import { useRouter } from 'vue-router'

interface TreeItem {
  name: string
  path: string
  icon: string
  type?: string
  episode?: string
  shot?: string
  children?: TreeItem[]
}

const props = defineProps<{ project: string }>()
const router = useRouter()
const treeItems = ref<TreeItem[]>([])

async function buildTree() {
  const characters = await readFs(props.project, 'prompt/character/') as DirResponse
  const stages = await readFs(props.project, 'prompt/stage/') as DirResponse
  const episodes = await readFs(props.project, 'prompt/scene/') as DirResponse

  const charItems: TreeItem[] = characters.entries.map(c => ({
    name: c.name,
    path: `character-${c.name}`,
    icon: 'mdi-account',
    type: 'character'
  }))

  const stageItems: TreeItem[] = stages.entries.map(s => ({
    name: s.name,
    path: `stage-${s.name}`,
    icon: 'mdi-city',
    type: 'stage'
  }))

  const episodeItems: TreeItem[] = []
  for (const ep of episodes.entries) {
    const shots = await readFs(props.project, `prompt/scene/${ep.name}/`) as DirResponse
    episodeItems.push({
      name: `第${ep.name}集`,
      path: `episode-${ep.name}`,
      icon: 'mdi-filmstrip',
      children: shots.entries.map(sh => ({
        name: `分镜${sh.name}`,
        path: `scene-${ep.name}-${sh.name}`,
        icon: 'mdi-image-multiple',
        type: 'scene',
        episode: ep.name,
        shot: sh.name
      }))
    })
  }

  treeItems.value = [
    { name: '角色', path: 'root-character', icon: 'mdi-account-group', children: charItems },
    { name: '场景', path: 'root-stage', icon: 'mdi-city', children: stageItems },
    { name: '集数分镜', path: 'root-scene', icon: 'mdi-filmstrip', children: episodeItems },
  ]
}

function onSelect(items: unknown) {
  const selected = items as TreeItem[]
  if (!selected.length) return
  const item = selected[0]
  if (!item.type) return
  router.push({
    query: { ...router.currentRoute.value.query, type: item.type, name: item.name, episode: item.episode, shot: item.shot }
  })
}

watch(() => props.project, buildTree, { immediate: true })
</script>
