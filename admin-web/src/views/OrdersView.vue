<template>
  <div class="orders-view animate-fade-in">
    <div class="filters glass-card">
      <div class="tabs">
        <button 
          v-for="tab in tabs" 
          :key="tab.value"
          :class="['tab-btn', { active: currentTab === tab.value }]"
          @click="setTab(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>
      <div class="actions">
        <button class="btn btn-primary" @click="fetchOrders">🔄 刷新</button>
      </div>
    </div>

    <div class="orders-list glass-card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>订单号</th>
              <th>客户联系方式</th>
              <th>金额 (￥)</th>
              <th>录单人 / 设计师</th>
              <th>状态</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="orders.length === 0">
              <td colspan="6" class="empty-state">暂无订单数据</td>
            </tr>
            <tr v-for="order in orders" :key="order.id">
              <td>
                <div class="order-sn">{{ order.order_sn }}</div>
                <div class="order-topic text-secondary">{{ order.topic || '无主题' }}</div>
              </td>
              <td>{{ order.customer_contact || '-' }}</td>
              <td class="price text-gradient font-bold">{{ order.price }}</td>
              <td>
                <div class="person">录入: {{ order.operator_id }}</div>
                <div class="person" v-if="order.designer_id">承接: {{ order.designer_id }}</div>
              </td>
              <td>
                <span :class="['badge', getStatusClass(order.status)]">
                  {{ order.status }}
                </span>
              </td>
              <td class="time-col">{{ formatDate(order.created_at) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import axios from 'axios'

const tabs = [
  { label: '全部订单', value: '' },
  { label: '待抢单 (PENDING)', value: 'PENDING' },
  { label: '已建群', value: 'GROUP_CREATED' },
  { label: '制作中', value: 'DESIGNING' },
  { label: '已完成', value: 'COMPLETED' },
]

const currentTab = ref('')
const orders = ref([])
let timer = null

const setTab = (val) => {
  currentTab.value = val
  fetchOrders()
}

const fetchOrders = async () => {
  try {
    const url = currentTab.value 
      ? `/api/v1/orders/list?status=${currentTab.value}` 
      : `/api/v1/orders/list`
    const { data } = await axios.get(url)
    orders.value = data
  } catch (err) {
    console.error('Fetch orders error', err)
  }
}

const getStatusClass = (status) => {
  switch (status) {
    case 'PENDING': return 'warning'
    case 'COMPLETED': return 'success'
    case 'DESIGNING': return 'primary'
    case 'GROUP_CREATED': return 'info'
    default: return 'secondary'
  }
}

const formatDate = (dateStr) => {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(() => {
  fetchOrders()
  timer = setInterval(fetchOrders, 15000)
})

onUnmounted(() => {
  clearInterval(timer)
})
</script>

<style scoped>
.orders-view {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.filters {
  padding: 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.tabs {
  display: flex;
  gap: 0.5rem;
  background: rgba(0, 0, 0, 0.2);
  padding: 0.25rem;
  border-radius: 10px;
}

.tab-btn {
  background: transparent;
  border: none;
  padding: 0.5rem 1rem;
  color: var(--text-secondary);
  border-radius: 8px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: var(--text-primary);
}

.tab-btn.active {
  background: var(--bg-card-hover);
  color: white;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}

.orders-list {
  padding: 1px; /* border gradient illusion */
  overflow: hidden;
}

.order-sn {
  font-family: monospace;
  font-weight: 600;
  font-size: 0.95rem;
}

.text-secondary {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.person {
  font-size: 0.875rem;
}

.font-bold {
  font-weight: 700;
  font-size: 1.1rem;
}

.time-col {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.empty-state {
  text-align: center;
  padding: 4rem !important;
  color: var(--text-secondary);
}

.badge.info {
  background: rgba(139, 92, 246, 0.2);
  color: #a78bfa;
}
</style>
