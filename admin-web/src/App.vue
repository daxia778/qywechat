<template>
  <!-- Login page: full-screen, no sidebar -->
  <router-view v-if="isLoginPage" />

  <!-- Main layout: sidebar + content -->
  <div v-else class="h-screen flex bg-gray-50 text-gray-800 font-sans overflow-hidden">
    
    <!-- Sidebar -->
    <aside
      class="h-screen flex flex-col shrink-0 z-50 bg-white border-r border-[#e5e7eb] relative transition-all duration-300 ease-in-out"
      :class="collapsed ? 'w-[72px]' : 'w-[260px]'"
    >
      <!-- Logo -->
      <div class="flex items-center z-10 relative py-6 shrink-0" :class="collapsed ? 'justify-center px-3' : 'px-5'">
        <div class="w-9 h-9 bg-[#465FFF] rounded-xl flex items-center justify-center shrink-0 shadow-sm">
          <span class="text-white text-[13px] font-black tracking-tighter">PN</span>
        </div>
        <div
          class="transition-all duration-300 overflow-hidden whitespace-nowrap ml-3"
          :class="collapsed ? 'w-0 opacity-0 ml-0' : 'w-auto opacity-100'"
        >
          <h1 class="text-[17px] font-[Outfit] font-bold text-gray-900 tracking-tight" style="margin: 0;">企微中控平台</h1>
        </div>
      </div>

      <!-- Navigation -->
      <nav class="flex-1 z-10 overflow-y-auto pb-6">
        <div class="mb-4">
          <p
            class="px-5 text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap transition-all duration-300 overflow-hidden"
            :class="collapsed ? 'h-0 opacity-0 mb-0' : 'h-5 opacity-100 mb-3'"
          >业务管理</p>

          <div class="flex flex-col gap-1 px-3">
            <router-link
              v-for="route in navRoutes"
              :key="route.name"
              :to="route.path"
              class="relative group flex items-center transition-all cursor-pointer rounded-lg text-decoration-none"
              :class="[
                collapsed ? 'px-3 py-2.5 justify-center' : 'px-3 py-2.5 gap-3',
                $route.path === route.path
                  ? 'bg-[#ecf3ff] text-[#465FFF]'
                  : 'text-gray-600 hover:bg-gray-100'
              ]"
              :title="collapsed ? route.meta.title : ''"
            >
              <div class="w-5 h-5 shrink-0 flex items-center justify-center text-lg" :class="$route.path === route.path ? 'text-[#465FFF]' : 'text-gray-500 group-hover:text-gray-700'">
                 {{ route.meta.icon }}
              </div>
              <span
                class="text-sm font-medium whitespace-nowrap transition-all duration-300 overflow-hidden"
                :class="collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'"
              >{{ route.meta.title }}</span>
            </router-link>
          </div>
        </div>
      </nav>

      <!-- Footer -->
      <div class="shrink-0 border-t border-gray-200 py-4 px-3 space-y-1">
        <div class="flex items-center rounded-lg px-3 py-2 transition-all duration-300" :class="collapsed ? 'justify-center' : ''">
          <div class="w-1.5 h-1.5 bg-emerald-500 rounded-full shrink-0 relative">
            <div class="absolute inset-0 bg-emerald-400 rounded-full animate-pulse opacity-60"></div>
          </div>
          <span class="text-xs font-medium text-gray-500 ml-2.5 whitespace-nowrap transition-all duration-300 overflow-hidden" :class="collapsed ? 'w-0 opacity-0 ml-0' : 'w-auto opacity-100'">系统在线</span>
        </div>
        <button
          @click="collapsed = !collapsed"
          class="w-full flex items-center text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-all cursor-pointer rounded-lg border-none bg-transparent"
          :class="collapsed ? 'px-3 py-2.5 justify-center' : 'px-3 py-2 gap-3'"
          :title="collapsed ? '展开侧边栏' : '收起侧边栏'"
        >
          <svg class="w-5 h-5 shrink-0 transition-transform duration-300" :class="collapsed ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"></path></svg>
          <span class="text-sm font-medium whitespace-nowrap transition-all duration-300 overflow-hidden" :class="collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'">收起菜单</span>
        </button>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative bg-gray-50">
      
      <!-- Header -->
      <header class="sticky top-0 h-16 border-b border-gray-200 bg-white flex items-center justify-between px-6 shrink-0 w-full z-30">
        <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-gray-500 cursor-pointer hover:text-gray-900 transition-colors">控制台</span>
            <svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
            <span class="font-bold text-gray-900 text-sm">{{ currentRouteName }}</span>
        </div>

        <div class="flex items-center gap-5">
            <div class="text-sm text-gray-500 font-medium">{{ currentTime }}</div>
            <div class="w-px h-5 bg-gray-200 hidden sm:block"></div>
            <!-- User -->
            <div class="flex items-center gap-2 p-1 rounded-md">
              <div class="w-8 h-8 rounded-full bg-slate-800 text-white font-medium flex items-center justify-center text-xs shadow-sm">{{ userInitials }}</div>
              <span class="text-sm font-medium text-gray-700 hidden sm:block">{{ userName }}</span>
            </div>
            <!-- Logout -->
            <button @click="handleLogout" class="text-gray-400 hover:text-red-500 transition-colors bg-transparent border-none cursor-pointer p-1" title="退出登录">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H8a3 3 0 01-3-3V7a3 3 0 013-3h2a3 3 0 013 3v1" /></svg>
            </button>
        </div>
      </header>
      
      <!-- Page View -->
      <div class="flex-1 w-full overflow-y-auto overflow-x-hidden p-6">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </div>

    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()
const collapsed = ref(false)

const isLoginPage = computed(() => route.path === '/login')

const navRoutes = computed(() => {
  return router.options.routes.filter(r => !r.meta?.public)
})

const currentRouteName = computed(() => {
  return route.meta.title || ''
})

const userName = computed(() => {
  return localStorage.getItem('pdd_user_name') || 'Admin'
})

const userInitials = computed(() => {
  const name = userName.value
  return name.substring(0, 2).toUpperCase()
})

const handleLogout = () => {
  localStorage.removeItem('pdd_token')
  localStorage.removeItem('pdd_user_name')
  localStorage.removeItem('pdd_user_id')
  router.push('/login')
}

const currentTime = ref('')
let timer

onMounted(() => {
  const updateTime = () => {
    const now = new Date()
    currentTime.value = now.toLocaleString('zh-CN', { 
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }
  updateTime()
  timer = setInterval(updateTime, 60000)
})

onUnmounted(() => {
  clearInterval(timer)
})
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-enter-from {
  opacity: 0;
  transform: translateY(5px);
}

.fade-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}

a {
  text-decoration: none;
}
</style>
