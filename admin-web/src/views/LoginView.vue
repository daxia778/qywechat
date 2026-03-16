<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
    <div class="w-full max-w-sm animate-fade-in-up">
      
      <!-- Logo -->
      <div class="text-center mb-8">
        <div class="w-14 h-14 bg-[#465FFF] rounded-2xl flex items-center justify-center mx-auto shadow-lg mb-4">
          <span class="text-white text-xl font-black tracking-tighter">PN</span>
        </div>
        <h1 class="text-2xl font-[Outfit] font-bold text-gray-900 tracking-tight">企微中控平台</h1>
        <p class="text-sm text-gray-500 mt-1">使用管理员激活码登录控制台</p>
      </div>

      <!-- Login Card -->
      <div class="card-enterprise p-6">
        <form @submit.prevent="handleLogin">
          <div class="form-group">
            <label class="form-label">激活码</label>
            <input
              v-model="activationCode"
              type="text"
              class="form-input text-center tracking-[0.3em] font-mono font-bold text-lg uppercase"
              placeholder="请输入 6 位激活码"
              maxlength="8"
              required
              autofocus
            />
          </div>

          <div v-if="errorMsg" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 flex items-center gap-2">
            <svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {{ errorMsg }}
          </div>

          <button
            type="submit"
            class="btn btn-primary w-full py-3 text-base font-semibold"
            :disabled="loading"
          >
            <svg v-if="loading" class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {{ loading ? '登录中...' : '管理员登录' }}
          </button>
        </form>
      </div>

      <p class="text-center text-xs text-gray-400 mt-6">PDD 派单管理系统 v1.0 &middot; 仅限授权管理员访问</p>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'

const router = useRouter()
const activationCode = ref('')
const loading = ref(false)
const errorMsg = ref('')

// 生成浏览器指纹作为 "MAC 地址" 替代
const getBrowserFingerprint = () => {
  const nav = window.navigator
  const raw = [
    nav.userAgent,
    nav.language,
    screen.width + 'x' + screen.height,
    new Date().getTimezoneOffset(),
    nav.hardwareConcurrency || 'unknown'
  ].join('|')
  
  // Simple hash
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    const chr = raw.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return 'WEB-' + Math.abs(hash).toString(16).toUpperCase()
}

const handleLogin = async () => {
  if (!activationCode.value.trim()) return
  
  loading.value = true
  errorMsg.value = ''
  
  try {
    const res = await axios.post('/api/v1/auth/device_login', {
      activation_code: activationCode.value.trim().toUpperCase(),
      mac_address: getBrowserFingerprint()
    })
    
    const { token, employee_name, wecom_userid } = res.data
    
    // 存储认证信息
    localStorage.setItem('pdd_token', token)
    localStorage.setItem('pdd_user_name', employee_name)
    localStorage.setItem('pdd_user_id', wecom_userid)
    
    // 跳转到仪表盘
    router.push('/')
  } catch (err) {
    if (err.response) {
      errorMsg.value = err.response.data?.error || '登录失败，请检查激活码'
    } else {
      errorMsg.value = '无法连接服务器: ' + err.message
    }
  } finally {
    loading.value = false
  }
}
</script>
