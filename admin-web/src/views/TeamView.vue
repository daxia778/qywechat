<template>
  <div class="animate-fade-in-up flex flex-col gap-6 w-full max-w-[1400px] mx-auto min-h-full">
    
    <div class="flex justify-between items-center">
      <h1 class="text-2xl font-[Outfit] font-bold text-gray-900 tracking-tight">团队监控</h1>
      <button @click="fetchTeam(true)" class="btn btn-primary" :disabled="loading">
        <svg class="w-4 h-4 mr-2" :class="{'animate-spin': loading}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        {{ loading ? '刷新中...' : '手动刷新' }}
      </button>
    </div>

    <!-- Empty State -->
    <div v-if="team.length === 0 && !loading" class="card-enterprise p-12 flex flex-col items-center justify-center text-gray-500">
      <svg class="w-12 h-12 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
      <p>暂无设计师账号，请在员工管理中添加</p>
    </div>

    <!-- Team Grid -->
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      
      <div v-for="member in team" :key="member.userid" class="card-enterprise flex flex-col bg-white overflow-hidden transition-all duration-300">
        
        <!-- Header: Avatar, Name, Status -->
        <div class="p-5 flex items-start justify-between border-b border-gray-100">
          <div class="flex items-center gap-3">
            <!-- Initials Avatar -->
            <div class="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-white font-semibold shadow-sm">
              {{ member.name.substring(0, 2).toUpperCase() }}
            </div>
            <div>
              <div class="font-bold text-gray-900 text-sm leading-tight">{{ member.name }}</div>
              <div class="text-xs text-gray-500 mt-0.5 max-w-[100px] truncate" :title="member.userid">UID: {{ member.userid }}</div>
            </div>
          </div>
          
          <!-- Status Badge -->
          <span class="badge flex items-center gap-1.5" :class="member.status === 'idle' ? 'success' : 'warning'">
             <span class="w-1.5 h-1.5 rounded-full" :class="member.status === 'idle' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'"></span>
             {{ member.status === 'idle' ? '空闲中' : '服务中' }}
          </span>
        </div>

        <!-- Body: Active Orders -->
        <div class="p-5 bg-gray-50/50 flex-1">
          <div class="flex justify-between items-end mb-2">
             <div class="text-xs text-gray-500 font-medium tracking-wide">进行中订单</div>
             <div class="text-xl font-bold font-mono" :class="getLoadColorClass(member.active_orders, true)">{{ member.active_orders }}</div>
          </div>
          
          <!-- Progress Bar -->
          <div class="w-full bg-gray-200 rounded-full h-2 mb-1 overflow-hidden">
            <div 
              class="h-2 rounded-full transition-all duration-700"
              :class="getLoadColorClass(member.active_orders)"
              :style="{ width: `${Math.min((member.active_orders / 10) * 100, 100)}%` }"
            ></div>
          </div>
          <div class="text-[10px] text-right text-gray-400 font-medium">设计负载水位线估测</div>
        </div>

      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

const team = ref([])
const loading = ref(false)
let timer = null

// Helper to determine color based on workload
const getLoadColorClass = (count, isText = false) => {
  if (count === 0) return isText ? 'text-gray-400' : 'bg-gray-400'
  if (count <= 3) return isText ? 'text-emerald-500' : 'bg-emerald-500' // low load
  if (count <= 7) return isText ? 'text-amber-500' : 'bg-amber-500' // medium load
  return isText ? 'text-red-500' : 'bg-red-500' // high load
}

const fetchTeam = async (manual = false) => {
  if (manual) loading.value = true
  try {
    const res = await axios.get('/api/v1/admin/team_workload')
    team.value = res.data.data || []
  } catch (err) {
    console.error('Failed to fetch team info:', err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchTeam(true)
  timer = setInterval(() => fetchTeam(false), 10000) // Poll every 10s
})

onUnmounted(() => {
  clearInterval(timer)
})
</script>
