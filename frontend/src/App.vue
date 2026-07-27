<template>
  <v-app>
    <v-app-bar color="primary" elevation="2">
      <v-btn
        v-if="$route.path !== '/'"
        icon="mdi-arrow-left"
        variant="text"
        color="white"
        @click="$router.push('/')"
      />
      <v-toolbar-title class="text-white">视频项目管理器</v-toolbar-title>
    </v-app-bar>
    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
</script>
