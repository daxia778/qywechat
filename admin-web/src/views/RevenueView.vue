<template>
  <div class="animate-fade-in-up flex flex-col gap-6 w-full max-w-[1400px] mx-auto min-h-full">
    
    <div class="flex justify-between items-center mb-2">
      <h1 class="text-2xl font-[Outfit] font-bold text-gray-900 tracking-tight">营收与分单走势</h1>
      
      <!-- Time Range Selector -->
      <div class="flex bg-white shadow-sm border border-gray-200 rounded-lg p-1">
        <button 
          v-for="range in ranges" 
          :key="range.days"
          @click="selectDays(range.days)"
          class="px-4 py-1.5 text-sm font-medium rounded-md transition-colors border-none cursor-pointer"
          :class="days === range.days ? 'bg-[#465FFF] text-white' : 'bg-transparent text-gray-500 hover:text-gray-900'"
        >
          {{ range.label }}
        </button>
      </div>
    </div>

    <!-- Summary KPI -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="card-enterprise p-5 flex flex-col justify-center">
        <div class="text-sm text-gray-500 font-medium mb-1 uppercase tracking-wider">区间总营收</div>
        <div class="text-3xl font-bold text-gray-900 font-mono">¥{{ summary.total_revenue.toFixed(2) }}</div>
      </div>
      <div class="card-enterprise p-5 flex flex-col justify-center">
        <div class="text-sm text-gray-500 font-medium mb-1 uppercase tracking-wider">区间总订单数</div>
        <div class="text-3xl font-bold text-gray-900 font-mono">{{ summary.total_orders }} <span class="text-base text-gray-400 font-normal">单</span></div>
      </div>
    </div>

    <!-- ECharts Container -->
    <div class="card-enterprise flex flex-col p-5 min-h-[450px]">
      <div v-if="loading && !chartInstance" class="flex items-center justify-center flex-1">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
      <div class="w-full h-[400px]" ref="chartRef" v-show="!loading || chartInstance"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import axios from 'axios'
import { use, init, graphic } from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const ranges = [
  { label: '最近 7 天', days: 7 },
  { label: '最近 14 天', days: 14 },
  { label: '最近 30 天', days: 30 }
]

const days = ref(7)
const summary = ref({ total_revenue: 0, total_orders: 0 })
const rawData = ref([])
const loading = ref(false)

const chartRef = ref(null)
let chartInstance = null

const initChart = () => {
  if (chartInstance) {
    chartInstance.dispose()
  }
  chartInstance = init(chartRef.value)
  window.addEventListener('resize', () => chartInstance?.resize())
}

const updateChart = () => {
  if (!chartInstance) return

  const dates = rawData.value.map(d => {
    // extract MM-DD from YYYY-MM-DD
    const parts = d.date.split('-')
    return `${parts[1]}/${parts[2]}`
  })
  const revenueData = rawData.value.map(d => d.revenue)
  const orderData = rawData.value.map(d => d.order_count)

  const option = {
    grid: { top: 40, right: 10, bottom: 20, left: 40, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#e5e7eb',
      textStyle: { color: '#374151' },
      axisPointer: { type: 'cross', crossStyle: { color: '#9ca3af' } }
    },
    legend: {
      data: ['每日营收 (元)', '每日订单量 (单)'],
      bottom: 0,
      icon: 'circle',
      itemGap: 24,
      textStyle: { color: '#6b7280' }
    },
    xAxis: [
      {
        type: 'category',
        data: dates,
        axisPointer: { type: 'shadow' },
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { color: '#6b7280', margin: 12 }
      }
    ],
    yAxis: [
      {
        type: 'value',
        name: '营收 (元)',
        nameTextStyle: { color: '#9ca3af', padding: [0, 30, 0, 0] },
        min: 0,
        axisLabel: { color: '#6b7280' },
        splitLine: { lineStyle: { color: '#f3f4f6', type: 'dashed' } }
      },
      {
        type: 'value',
        name: '单量 (单)',
        nameTextStyle: { color: '#9ca3af', padding: [0, 0, 0, 30] },
        min: 0,
        axisLabel: { color: '#6b7280' },
        splitLine: { show: false } // only one split line
      }
    ],
    series: [
      {
        name: '每日订单量 (单)',
        type: 'bar',
        yAxisIndex: 1,
        data: orderData,
        barWidth: '25%',
        itemStyle: { color: '#38bdf8', borderRadius: [4, 4, 0, 0] } // Sky blue
      },
      {
        name: '每日营收 (元)',
        type: 'line',
        data: revenueData,
        smooth: 0.3,
        symbolSize: 8,
        itemStyle: { color: '#465FFF' }, // Primary TailAdmin blue
        lineStyle: { width: 3, color: '#465FFF' },
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(70, 95, 255, 0.2)' },
            { offset: 1, color: 'rgba(70, 95, 255, 0)' }
          ])
        }
      }
    ]
  }

  chartInstance.setOption(option)
}

const fetchData = async () => {
  loading.value = true
  try {
    const res = await axios.get(`/api/v1/admin/revenue_chart?days=${days.value}`)
    summary.value = res.data.summary || { total_revenue: 0, total_orders: 0 }
    rawData.value = res.data.data || []
    await nextTick()
    if (!chartInstance) initChart()
    updateChart()
  } catch (err) {
    console.error('Failed to fetch revenue data:', err)
  } finally {
    loading.value = false
  }
}

const selectDays = (d) => {
  days.value = d
  fetchData()
}

onMounted(() => {
  fetchData()
})

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.dispose()
  }
})
</script>
