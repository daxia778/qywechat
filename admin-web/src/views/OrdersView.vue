<template>
  <div class="animate-fade-in-up flex flex-col gap-6 w-full max-w-[1400px] mx-auto min-h-full">
    
    <!-- Title Area -->
    <div class="flex justify-between items-center">
      <h1 class="text-2xl font-[Outfit] font-bold text-gray-900 tracking-tight">订单大厅</h1>
      <button @click="fetchOrders(true)" class="btn btn-primary" :disabled="loading">
        <svg class="w-4 h-4 mr-2" :class="{'animate-spin': loading}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        {{ loading ? '刷新中...' : '手动刷新' }}
      </button>
    </div>

    <!-- Main Card -->
    <div class="card-enterprise flex flex-col overflow-hidden bg-white">
      
      <!-- Filter Tabs -->
      <div class="px-5 pt-4 border-b border-gray-100 flex gap-6 overflow-x-auto scrollbar-hide">
        <button
          v-for="status in statuses"
          :key="status.value"
          @click="currentStatus = status.value"
          class="pb-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap bg-transparent border-t-0 border-l-0 border-r-0 cursor-pointer"
          :class="[
            currentStatus === status.value 
              ? 'border-primary text-primary' 
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          ]"
        >
          {{ status.label }}
          <span v-if="status.value === 'PENDING' && orders.filter(o => o.status === 'PENDING').length > 0" class="ml-1.5 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
            {{ orders.filter(o => o.status === 'PENDING').length }}
          </span>
        </button>
      </div>

      <!-- Table Section -->
      <div class="table-container relative min-h-[400px]">
        
        <!-- Loading overlay inside table -->
        <div v-if="loading && orders.length === 0" class="absolute inset-0 z-10 bg-white/50 backdrop-blur-sm flex items-center justify-center">
             <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>

        <table class="w-full text-left border-collapse">
          <thead>
            <tr>
              <th class="py-3 px-5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">订单号</th>
              <th class="py-3 px-5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">客户微信</th>
              <th class="py-3 px-5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">订单总价</th>
              <th class="py-3 px-5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">接单员/设计师</th>
              <th class="py-3 px-5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">状态</th>
              <th class="py-3 px-5 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">时间</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="order in filteredOrders" :key="order.id" class="hover:bg-gray-50 transition-colors">
              <td class="py-3 px-5 text-sm">
                <div class="font-medium text-gray-900">{{ order.order_sn }}</div>
              </td>
              <td class="py-3 px-5 text-sm text-gray-600">{{ order.customer_wx || '-' }}</td>
              <td class="py-3 px-5 text-sm font-medium text-gray-900">
                ¥{{ order.total_amount?.toFixed(2) || '0.00' }}
              </td>
              <td class="py-3 px-5 text-sm">
                <div class="flex flex-col gap-1">
                  <div class="text-xs text-gray-500">
                    客服: <span class="text-gray-900">{{ order.operator_id || '-' }}</span>
                  </div>
                  <div class="text-xs text-gray-500">
                    设计: <span class="text-gray-900">{{ order.designer_id || '-' }}</span>
                  </div>
                </div>
              </td>
              <td class="py-3 px-5">
                <span class="badge" :class="getStatusBadgeClass(order.status)">
                  {{ getStatusLabel(order.status) }}
                </span>
              </td>
              <td class="py-3 px-5 text-sm text-gray-500 text-right">
                {{ formatTime(order.created_at) }}
              </td>
            </tr>
            <tr v-if="filteredOrders.length === 0 && !loading">
              <td colspan="6" class="py-12 text-center text-gray-500">
                <div class="flex flex-col items-center justify-center">
                  <svg class="w-12 h-12 text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                  <p>当前无相关状态的订单记录</p>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      
      <!-- Footer pagination simplified -->
      <div class="bg-gray-50 px-5 py-3 border-t border-gray-200 flex justify-between items-center text-sm text-gray-500">
         <span>共展示 {{ filteredOrders.length }} 条订单数据</span>
         <span class="text-xs text-gray-400">系统每 15 秒自动拉取最新数据</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

const orders = ref([])
const loading = ref(false)
const currentStatus = ref('')
let timer = null

const statuses = [
  { value: '', label: '全部订单' },
  { value: 'PENDING', label: '待处理' },
  { value: 'GROUP_CREATED', label: '已建群' },
  { value: 'DESIGNING', label: '制作中' },
  { value: 'COMPLETED', label: '已完成' },
]

const filteredOrders = computed(() => {
  if (!currentStatus.value) return orders.value
  return orders.value.filter(o => o.status === currentStatus.value)
})

const getStatusLabel = (status) => {
  const map = {
    'PENDING': '待处理',
    'GROUP_CREATED': '已建群',
    'DESIGNING': '制作中',
    'COMPLETED': '已完成'
  }
  return map[status] || status
}

const getStatusBadgeClass = (status) => {
  const map = {
    'PENDING': 'warning',
    'GROUP_CREATED': 'primary',
    'DESIGNING': 'secondary',
    'COMPLETED': 'success'
  }
  return map[status] || 'secondary'
}

const formatTime = (timeStr) => {
  if (!timeStr) return '-'
  return new Date(timeStr).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

const fetchOrders = async (manual = false) => {
  if (manual) loading.value = true
  try {
    const res = await axios.get('/api/v1/orders/list')
    orders.value = res.data.data || []
  } catch (err) {
    console.error('Failed to fetch orders:', err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchOrders(true)
  timer = setInterval(() => fetchOrders(false), 15000)
})

onUnmounted(() => {
  clearInterval(timer)
})
</script>
