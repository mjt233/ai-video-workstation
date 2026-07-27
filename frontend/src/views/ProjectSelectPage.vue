<template>
  <v-container class="d-flex align-center justify-center" style="height: 80vh">
    <v-card min-width="420" class="pa-2" style="overflow: hidden">
      <v-card-title class="text-primary text-h5 font-weight-bold">
        <v-icon icon="mdi-folder-open" class="mr-2" color="primary" />
        选择项目
      </v-card-title>
      <v-divider class="mb-2" />
      <v-card-text>
        <v-list v-if="projects.length">
          <v-list-item
            v-for="p in projects"
            :key="p.name"
            @click="$router.push('/project?project=' + p.name)"
            class="rounded mb-1"
          >
            <template v-slot:prepend>
              <v-icon color="primary">mdi-folder</v-icon>
            </template>
            <v-list-item-title class="font-weight-medium">{{ p.name }}</v-list-item-title>
          </v-list-item>
        </v-list>
        <v-progress-circular v-else indeterminate color="primary" />
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { getProjects, type ProjectEntry } from '../api/client'

const projects = ref<ProjectEntry[]>([])
onMounted(async () => {
  projects.value = await getProjects()
})
</script>

<style scoped>
.project-item {
  transition: background-color 0.2s;
}
.project-item:hover {
  background-color: #E3F2FD !important;
}
</style>
