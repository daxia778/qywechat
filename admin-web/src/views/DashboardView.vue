<template>
  <div class="dashboard-view animate-fade-in">
    <div class="stats-grid">
      <div class="stat-card glass-card">
        <div class="stat-icon primary">📋</div>
        <div class="stat-content">
          <div class="stat-label">总订单数</div>
          <div class="stat-value">{{ stats.total_orders }}</div>
        </div>
      </div>
      <div class="stat-card glass-card">
        <div class="stat-icon warning">⏳</div>
        <div class="stat-content">
          <div class="stat-label">待处理 (PENDING)</div>
          <div class="stat-value text-warning">{{ stats.pending_orders }}</div>
        </div>
      </div>
      <div class="stat-card glass-card">
        <div class="stat-icon info">💻</div>
        <div class="stat-content">
          <div class="stat-label">制作中</div>
          <div class="stat-value text-info">{{ stats.designing_orders }}</div>
        </div>
      </div>
      <div class="stat-card glass-card">
        <div class="stat-icon success">✅</div>
        <div class="stat-content">
          <div class="stat-label">已完成</div>
          <div class="stat-value text-success">{{ stats.completed_orders }}</div>
        </div>
      </div>
    </div>

    <div class="lower-grid">
      <div class="revenue-card glass-card">
        <h3 class="card-title">今日经营概况</h3>
        <div class="revenue-content">
          <div class="rev-item">
            <div class="rev-label">今日总营收</div>
            <div class="rev-value text-gradient">¥{{ stats.today_revenue }}</div>
          </div>
          <div class="rev-item">
            <div class="rev-label">今日接单数</div>
            <div class="rev-value">{{ stats.today_order_count }} 单</div>
          </div>
        </div>
      </div>
      
      <div class="team-card glass-card">
        <h3 class="card-title">团队当前状态</h3>
        <div class="team-stats">
          <div class="t-stat">
            <div class="t-label">活跃设计师 (接单中)</div>
            <div class="t-value">{{ stats.active_designers }}</div>
          </div>
          <div class="t-stat">
            <div class="t-label">空闲设计师 (可派单)</div>
            <div class="t-value text-success">{{ stats.idle_designers }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

const stats = ref({
  total_orders: 0,
  pending_orders: 0,
  designing_orders: 0,
  completed_orders: 0,
  today_revenue: 0,
  today_order_count: 0,
  active_designers: 0,
  idle_designers: 0
})

let timer = null

const fetchStats = async () => {
  try {
    const res = await axios.get('/api/v1/admin/dashboard')
    stats.value = res.data
  } catch (err) {
    console.error('Failed to fetch dashboard stats', err)
  }
}

onMounted(() => {
  fetchStats()
  timer = setInterval(fetchStats, 10000) // Poll every 10s
})

onUnmounted(() => {
  clearInterval(timer)
})
</script>

<style scoped>
.dashboard-view {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1.5rem;
}

.stat-card {
  padding: 1.5rem;
  display: flex;
  align-items: center;
  gap: 1.25rem;
}

.stat-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
}

.stat-icon.primary { background: rgba(59, 130, 246, 0.2); }
.stat-icon.warning { background: rgba(245, 158, 11, 0.2); }
.stat-icon.info { background: rgba(139, 92, 246, 0.2); }
.stat-icon.success { background: rgba(16, 185, 129, 0.2); }

.stat-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 0.25rem;
}

.stat-value {
  font-size: 1.75rem;
  font-weight: 700;
}

.text-warning { color: var(--warning-color); }
.text-info { color: #8b5cf6; }
.text-success { color: var(--success-color); }

.lower-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 1.5rem;
}

.revenue-card, .team-card {
  padding: 1.5rem;
}

.card-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 1.5rem;
  color: var(--text-secondary);
}

.revenue-content {
  display: flex;
  gap: 2rem;
}

.rev-item {
  flex: 1;
  background: rgba(0, 0, 0, 0.2);
  padding: 1.25rem;
  border-radius: 12px;
  border: 1px solid var(--border-color);
}

.rev-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.rev-value {
  font-size: 2rem;
  font-weight: 700;
}

.team-stats {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.t-stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  border: 1px solid var(--border-color);
}

.t-label {
  font-weight: 500;
}

.t-value {
  font-size: 1.25rem;
  font-weight: 700;
}
</style>
