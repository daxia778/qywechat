<template>
  <div class="animate-fade-in-up flex flex-col gap-6 w-full max-w-[1400px] mx-auto min-h-full">

    <div class="flex justify-between items-center">
      <h1 class="text-2xl font-[Outfit] font-bold text-gray-900 tracking-tight">概览数据</h1>
      <button class="btn btn-secondary text-sm">
        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        刷新数据
      </button>
    </div>

    <!-- KPI Cards Mosaic Style -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
      
      <!-- KPI 1 -->
      <div class="card-enterprise flex flex-col relative overflow-hidden">
        <div class="p-5 border-b border-transparent">
          <header class="flex justify-between items-start mb-2">
            <h2 class="text-[17px] font-semibold text-gray-900 tracking-tight">总订单数</h2>
            <div class="p-2 bg-[#ecf3ff] rounded-lg text-[#465FFF]">📋</div>
          </header>
          <div class="flex items-baseline gap-2 mt-4">
            <div class="text-3xl font-bold text-gray-900">{{ stats.total_orders }}</div>
          </div>
        </div>
        <div class="grow h-12 w-full -mt-4 -mb-1 opacity-80" ref="sparkChart1"></div>
      </div>

      <!-- KPI 2 -->
      <div class="card-enterprise flex flex-col relative overflow-hidden">
        <div class="p-5 border-b border-transparent">
          <header class="flex justify-between items-start mb-2">
            <h2 class="text-[17px] font-semibold text-gray-900 tracking-tight">待处理单</h2>
            <div class="p-2 bg-amber-50 rounded-lg text-amber-500">⏳</div>
          </header>
          <div class="flex items-baseline gap-2 mt-4">
            <div class="text-3xl font-bold text-gray-900">{{ stats.pending_orders }}</div>
            <div class="text-xs font-medium text-amber-700 px-1.5 py-0.5 bg-amber-100 rounded-md">PENDING</div>
          </div>
        </div>
        <div class="grow h-12 w-full -mt-4 -mb-1 opacity-80" ref="sparkChart2"></div>
      </div>

      <!-- KPI 3 -->
      <div class="card-enterprise flex flex-col relative overflow-hidden">
        <div class="p-5 border-b border-transparent">
          <header class="flex justify-between items-start mb-2">
            <h2 class="text-[17px] font-semibold text-gray-900 tracking-tight">制作中</h2>
            <div class="p-2 bg-violet-50 rounded-lg text-violet-500">💻</div>
          </header>
          <div class="flex items-baseline gap-2 mt-4">
            <div class="text-3xl font-bold text-gray-900">{{ stats.designing_orders }}</div>
          </div>
        </div>
        <div class="grow h-12 w-full -mt-4 -mb-1 opacity-80" ref="sparkChart3"></div>
      </div>

      <!-- KPI 4 -->
      <div class="card-enterprise flex flex-col relative overflow-hidden">
        <div class="p-5 border-b border-transparent">
          <header class="flex justify-between items-start mb-2">
            <h2 class="text-[17px] font-semibold text-gray-900 tracking-tight">今日营收</h2>
            <div class="p-2 bg-emerald-50 rounded-lg text-emerald-500">💰</div>
          </header>
          <div class="flex items-baseline gap-2 mt-4">
            <div class="text-3xl font-bold text-gray-900">¥{{ stats.today_revenue }}</div>
            <div class="text-sm font-medium text-emerald-700">{{ stats.today_order_count }} 单</div>
          </div>
        </div>
        <div class="grow h-12 w-full -mt-4 -mb-1 opacity-80" ref="sparkChart4"></div>
      </div>

    </div>

    <!-- lower section -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
       <!-- Team Load -->
      <div class="card-enterprise flex flex-col">
        <header class="px-5 py-4 border-b border-gray-100">
          <h2 class="font-semibold text-gray-900 font-[Outfit]">团队实时负载</h2>
        </header>
        <div class="p-5 flex gap-4">
          <div class="flex-1 bg-gray-50 border border-gray-100 rounded-xl p-4 flex flex-col items-center justify-center">
             <div class="text-sm text-gray-500 mb-1">接单中 (活跃)</div>
             <div class="text-2xl font-bold text-gray-900">{{ stats.active_designers }} <span class="text-sm font-normal text-gray-400">人</span></div>
          </div>
          <div class="flex-1 bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex flex-col items-center justify-center">
             <div class="text-sm text-emerald-600 mb-1">可派单 (闲置)</div>
             <div class="text-2xl font-bold text-emerald-700">{{ stats.idle_designers }} <span class="text-sm font-normal text-emerald-500/50">人</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, shallowRef } from 'vue'
import axios from 'axios'
import { use, init, graphic } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([LineChart, GridComponent, CanvasRenderer])

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

const sparkChart1 = ref(null)
const sparkChart2 = ref(null)
const sparkChart3 = ref(null)
const sparkChart4 = ref(null)
const chartInstances = shallowRef([])

let timer = null

const initSparkline = (el, color) => {
  if (!el) return null
  const chart = init(el)
  // Demo trends
  let data = []
  let val = 10
  for(let i=0; i<15; i++) {
    val += Math.random() * 5 - 2
    data.push(Math.max(0, val))
  }

  chart.setOption({
    grid: { top: 0, bottom: 0, left: -5, right: -5 },
    xAxis: { type: 'category', show: false, boundaryGap: false },
    yAxis: { type: 'value', show: false, min: 'dataMin' },
    series: [{
      type: 'line',
      data: data,
      smooth: 0.3,
      symbol: 'none',
      lineStyle: { width: 2, color: color },
      areaStyle: {
        color: new graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: `${color}30` },
          { offset: 1, color: `${color}00` }
        ])
      }
    }]
  })
  return chart
}

const renderCharts = () => {
  chartInstances.value.forEach(c => c?.dispose())
  chartInstances.value = [
    initSparkline(sparkChart1.value, '#465FFF'), // blue
    initSparkline(sparkChart2.value, '#f59e0b'), // amber
    initSparkline(sparkChart3.value, '#8b5cf6'), // violet
    initSparkline(sparkChart4.value, '#10b981')  // emerald
  ].filter(Boolean)
}

const fetchStats = async () => {
  try {
    const res = await axios.get('/api/v1/admin/dashboard')
    stats.value = res.data
  } catch (err) {
    console.error('Failed to fetch stats', err)
  }
}

onMounted(() => {
  fetchStats()
  setTimeout(renderCharts, 100)
  timer = setInterval(fetchStats, 10000)
  window.addEventListener('resize', () => {
    chartInstances.value.forEach(c => c.resize())
  })
})

onUnmounted(() => {
  clearInterval(timer)
  chartInstances.value.forEach(c => c?.dispose())
})
</script>
