<template>
  <div class="team-view animate-fade-in">
    <div class="header-actions">
      <button class="btn btn-primary" @click="fetchTeam">🔄 刷新数据</button>
    </div>

    <div class="workload-grid">
      <div v-if="team.length === 0" class="empty-state glass-card">
        暂无设计师数据，请先在员工管理中添加
      </div>
      
      <div 
        v-for="member in team" 
        :key="member.wecom_userid" 
        class="member-card glass-card"
      >
        <div class="m-header">
          <div class="m-avatar">{{ member.name.charAt(0) }}</div>
          <div class="m-info">
            <h3 class="name">{{ member.name }}</h3>
            <div class="uid">{{ member.wecom_userid }}</div>
          </div>
          <div class="m-status">
            <span :class="['status-dot', member.status]"></span>
            <span class="status-txt">{{ member.status === 'busy' ? '繁忙' : '空闲' }}</span>
          </div>
        </div>
        
        <div class="m-body">
          <div class="stat-box">
            <div class="s-label">当前活跃订单</div>
            <div class="s-val text-gradient">{{ member.active_orders }}</div>
          </div>
          <div class="progress-container">
            <div class="p-label">
              <span>负载进度</span>
              <span>{{ Math.min(member.active_orders * 25, 100) }}%</span>
            </div>
            <div class="p-bar-bg">
              <div 
                class="p-bar-fill" 
                :style="{ width: Math.min(member.active_orders * 25, 100) + '%' }"
                :class="{ 
                  'high': member.active_orders >= 4, 
                  'medium': member.active_orders > 1 && member.active_orders < 4 
                }"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

const team = ref([])
let timer = null

const fetchTeam = async () => {
  try {
    const { data } = await axios.get('/api/v1/admin/team_workload')
    team.value = data
  } catch (err) {
    console.error('Fetch team error', err)
  }
}

onMounted(() => {
  fetchTeam()
  timer = setInterval(fetchTeam, 10000)
})

onUnmounted(() => {
  clearInterval(timer)
})
</script>

<style scoped>
.team-view {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.header-actions {
  display: flex;
  justify-content: flex-end;
}

.workload-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1.5rem;
}

.member-card {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.empty-state {
  grid-column: 1 / -1;
  padding: 3rem;
  text-align: center;
  color: var(--text-secondary);
}

.m-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.m-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: linear-gradient(135deg, #8b5cf6, #ec4899);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  font-weight: bold;
}

.m-info {
  flex: 1;
}

.name {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 0.125rem;
}

.uid {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-family: monospace;
}

.m-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(0,0,0,0.2);
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border-color);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.busy { background: var(--warning-color); box-shadow: 0 0 8px var(--warning-color); }
.status-dot.idle { background: var(--success-color); box-shadow: 0 0 8px var(--success-color); }

.status-txt {
  font-size: 0.75rem;
  font-weight: 500;
}

.m-body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.stat-box {
  background: rgba(0,0,0,0.2);
  border-radius: 12px;
  padding: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid rgba(255,255,255,0.05);
}

.s-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.s-val {
  font-size: 1.5rem;
  font-weight: 700;
}

.progress-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.p-label {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.p-bar-bg {
  height: 8px;
  background: rgba(255,255,255,0.1);
  border-radius: 999px;
  overflow: hidden;
}

.p-bar-fill {
  height: 100%;
  background: var(--success-color);
  border-radius: 999px;
  transition: width 0.5s ease, background-color 0.3s;
}

.p-bar-fill.medium { background: var(--warning-color); }
.p-bar-fill.high { background: var(--danger-color); }
</style>
