import { createApp } from 'vue'
import axios from 'axios'
import App from './App.vue'
import router from './router'
import './assets/main.css'

// ── Axios 全局拦截器 ──────────────────────────

// 请求拦截: 自动附加 JWT Token
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('pdd_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截: 401 自动清除 Token 并重定向到登录页
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('pdd_token')
      localStorage.removeItem('pdd_user_name')
      localStorage.removeItem('pdd_user_id')
      router.push('/login')
    }
    return Promise.reject(error)
  }
)

const app = createApp(App)
app.use(router)
app.mount('#app')
