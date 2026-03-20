import axios from 'axios'

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// 请求拦截器：注入 JWT + CSRF
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('staff_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  // CSRF token（写操作需要）
  const csrfToken = client.defaults.headers.common['X-CSRF-Token']
  if (csrfToken && ['post', 'put', 'delete', 'patch'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = csrfToken
  }
  return config
})

// 响应拦截器：捕获 CSRF token + 401 跳转
client.interceptors.response.use(
  (res) => {
    const csrf = res.headers['x-csrf-token']
    if (csrf) {
      client.defaults.headers.common['X-CSRF-Token'] = csrf
    }
    return res
  },
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('staff_token')
      localStorage.removeItem('staff_user')
      window.location.href = '/s/login'
    }
    return Promise.reject(err)
  }
)

export default client
