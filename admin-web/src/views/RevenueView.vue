<template>
  <div class="revenue-view animate-fade-in">
    <div class="controls glass-card">
      <div class="control-group">
        <label>时间范围：</label>
        <div class="tabs">
          <button 
            v-for="d in [7, 14, 30]" 
            :key="d"
            :class="['tab-btn', { active: days === d }]"
            @click="setDays(d)"
          >
            最近 {{ d }} 天
          </button>
        </div>
      </div>
      <div class="total-revenue">
        <span class="text-secondary">期间总营收：</span>
        <span class="text-gradient">¥{{ totalRevenue }}</span>
      </div>
    </div>

    <div class="chart-container glass-card">
      <h3 class="chart-title">营收走向与订单量趋势</h3>
      <div class="canvas-wrapper">
        <canvas ref="chartCanvas"></canvas>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, shallowRef } from 'vue'
import axios from 'axios'
import Chart from 'chart.js/auto'

const days = ref(7)
const chartData = ref([])
const chartCanvas = ref(null)
const chartInstance = shallowRef(null)

const totalRevenue = computed(() => {
  return chartData.value.reduce((sum, item) => sum + item.revenue, 0)
})

const fetchCharData = async () => {
  try {
    const { data } = await axios.get(`/api/v1/admin/revenue_chart?days=${days.value}`)
    chartData.value = data
    renderChart()
  } catch (err) {
    console.error('Fetch chart error', err)
  }
}

const setDays = (d) => {
  days.value = d
  fetchCharData()
}

const renderChart = () => {
  if (!chartCanvas.value) return
  
  if (chartInstance.value) {
    chartInstance.value.destroy()
  }

  const ctx = chartCanvas.value.getContext('2d')

  // Create gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, 400)
  gradient.addColorStop(0, 'rgba(59, 130, 246, 0.5)')
  gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)')

  const labels = chartData.value.map(d => d.date.substring(5)) // mm-dd
  const revenueData = chartData.value.map(d => d.revenue)
  const ordersData = chartData.value.map(d => d.order_count)

  chartInstance.value = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '日营收 (￥)',
          data: revenueData,
          borderColor: '#3b82f6',
          backgroundColor: gradient,
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          yAxisID: 'y'
        },
        {
          label: '订单量 (单)',
          type: 'bar',
          data: ordersData,
          backgroundColor: 'rgba(139, 92, 246, 0.3)',
          borderColor: '#8b5cf6',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          labels: { color: '#f8fafc', font: { family: 'Inter', size: 13 } }
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          titleColor: '#f8fafc',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#94a3b8' }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#94a3b8' },
          title: { display: true, text: '营收 (￥)', color: '#60a5fa' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#94a3b8', stepSize: 1 },
          title: { display: true, text: '订单数', color: '#a78bfa' }
        }
      }
    }
  })
}

onMounted(() => {
  fetchCharData()
})

onUnmounted(() => {
  if (chartInstance.value) {
    chartInstance.value.destroy()
  }
})
</script>

<style scoped>
.revenue-view {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.controls {
  padding: 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.control-group {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.tabs {
  display: flex;
  gap: 0.25rem;
  background: rgba(0, 0, 0, 0.2);
  padding: 0.25rem;
  border-radius: 8px;
}

.tab-btn {
  background: transparent;
  border: none;
  padding: 0.375rem 0.75rem;
  color: var(--text-secondary);
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--bg-card-hover);
  color: white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.total-revenue {
  font-size: 1.125rem;
  font-weight: 500;
}

.total-revenue .text-gradient {
  font-size: 1.5rem;
  font-weight: 700;
  margin-left: 0.5rem;
}

.chart-container {
  padding: 1.5rem;
  height: 500px;
  display: flex;
  flex-direction: column;
}

.chart-title {
  font-size: 1.125rem;
  margin-bottom: 1.5rem;
  color: var(--text-secondary);
  font-weight: 600;
}

.canvas-wrapper {
  flex: 1;
  position: relative;
  width: 100%;
}
</style>
