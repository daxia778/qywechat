<template>
  <div class="app-container">
    <aside class="sidebar glass-panel">
      <div class="logo-area">
        <div class="logo-icon">🚀</div>
        <h1 class="logo-text text-gradient">DataNexus</h1>
      </div>
      
      <nav class="nav-menu">
        <router-link 
          v-for="route in routes" 
          :key="route.name" 
          :to="route.path"
          class="nav-item"
          active-class="active"
        >
          <span class="nav-icon">{{ route.meta.icon }}</span>
          <span class="nav-text">{{ route.meta.title }}</span>
        </router-link>
      </nav>

      <div class="sidebar-footer">
        <div class="user-profile">
          <div class="avatar">A</div>
          <div class="user-info">
            <div class="user-name">管理员</div>
            <div class="user-role">系统拥有者</div>
          </div>
        </div>
      </div>
    </aside>

    <main class="main-content">
      <header class="top-bar glass-panel">
        <h2 class="page-title">{{ currentRouteName }}</h2>
        <div class="time-display">{{ currentTime }}</div>
      </header>
      
      <div class="page-wrapper">
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

const routes = computed(() => {
  return router.options.routes
})

const currentRouteName = computed(() => {
  return route.meta.title || ''
})

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
.app-container {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: radial-gradient(circle at 50% -20%, rgba(59, 130, 246, 0.15), transparent 60%),
              radial-gradient(circle at -20% 50%, rgba(139, 92, 246, 0.1), transparent 50%),
              var(--bg-dark);
}

.sidebar {
  width: 260px;
  display: flex;
  flex-direction: column;
  z-index: 10;
}

.logo-area {
  padding: 2rem 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.logo-icon {
  font-size: 1.5rem;
}

.logo-text {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.nav-menu {
  flex: 1;
  padding: 0 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.875rem 1rem;
  border-radius: 12px;
  color: var(--text-secondary);
  text-decoration: none;
  font-weight: 500;
  transition: all 0.2s;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-primary);
}

.nav-item.active {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(37, 99, 235, 0.05));
  color: #60a5fa;
  border: 1px solid rgba(59, 130, 246, 0.2);
}

.sidebar-footer {
  padding: 1.5rem;
  border-top: 1px solid var(--border-color);
}

.user-profile {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
}

.user-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.user-role {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.top-bar {
  height: 72px;
  padding: 0 2rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 5;
}

.page-title {
  font-size: 1.25rem;
  font-weight: 600;
}

.time-display {
  font-size: 0.875rem;
  color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.2);
  padding: 0.5rem 1rem;
  border-radius: 999px;
  border: 1px solid var(--border-color);
}

.page-wrapper {
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
}

/* Page Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
