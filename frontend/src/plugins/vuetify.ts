import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

/**
 * 共享 Vuetify 实例：主应用与动态挂载的对话框共用同一主题/组件注册。
 */
export const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        colors: {
          primary: '#1565C0',
          secondary: '#42A5F5',
          accent: '#0D47A1',
          surface: '#F5F8FC',
        },
      },
    },
  },
})

export default vuetify
