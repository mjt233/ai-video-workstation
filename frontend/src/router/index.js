import { createRouter, createWebHistory } from 'vue-router'
import ProjectSelectPage from '../views/ProjectSelectPage.vue'
import ProjectView from '../views/ProjectView.vue'

const routes = [
  { path: '/', component: ProjectSelectPage },
  { path: '/project', component: ProjectView },
]

export default createRouter({ history: createWebHistory(), routes })
