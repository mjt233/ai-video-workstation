<template>
  <v-container class="d-flex align-center justify-center" style="height: 80vh">
    <v-card min-width="400">
      <v-card-title>选择项目</v-card-title>
      <v-card-text>
        <v-list v-if="projects.length">
          <v-list-item
            v-for="p in projects"
            :key="p.name"
            @click="$router.push('/project?project=' + p.name)"
          >
            <v-list-item-title>{{ p.name }}</v-list-item-title>
          </v-list-item>
        </v-list>
        <v-progress-circular v-else indeterminate />
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getProjects } from '../api/client.js'

const projects = ref([])
onMounted(async () => {
  projects.value = await getProjects()
})
</script>
