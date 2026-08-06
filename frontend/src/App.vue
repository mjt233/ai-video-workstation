<template>
  <v-app>
    <v-app-bar
      color="primary"
      elevation="2"
    >
      <v-btn
        v-if="$route.path !== '/'"
        icon="mdi-arrow-left"
        variant="text"
        color="white"
        @click="$router.push('/')"
      />
      <v-toolbar-title class="text-white">
        视频项目管理器
      </v-toolbar-title>
      <v-spacer />
      <v-btn
        icon="mdi-cog"
        variant="text"
        color="white"
        aria-label="服务商配置"
        @click="showProviderSettings = true"
      />
    </v-app-bar>
    <v-main>
      <router-view />
    </v-main>
    <ProviderSettingsDialog v-model="showProviderSettings" />
  </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ProviderSettingsDialog from './components/ProviderSettingsDialog.vue'

const showProviderSettings = ref(false)
</script>
