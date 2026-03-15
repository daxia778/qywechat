import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import OrdersView from '../views/OrdersView.vue'
import TeamView from '../views/TeamView.vue'
import EmployeesView from '../views/EmployeesView.vue'
import RevenueView from '../views/RevenueView.vue'

const routes = [
  { path: '/', name: 'Dashboard', component: DashboardView, meta: { title: '仪表盘', icon: '📊' } },
  { path: '/orders', name: 'Orders', component: OrdersView, meta: { title: '订单大厅', icon: '📦' } },
  { path: '/team', name: 'Team', component: TeamView, meta: { title: '团队负载', icon: '👥' } },
  { path: '/employees', name: 'Employees', component: EmployeesView, meta: { title: '员工管理', icon: '🔑' } },
  { path: '/revenue', name: 'Revenue', component: RevenueView, meta: { title: '营收图表', icon: '📈' } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
