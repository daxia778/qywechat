import { createRouter, createWebHistory } from 'vue-router'
import DashboardView from '../views/DashboardView.vue'
import OrdersView from '../views/OrdersView.vue'
import TeamView from '../views/TeamView.vue'
import EmployeesView from '../views/EmployeesView.vue'
import RevenueView from '../views/RevenueView.vue'
import LoginView from '../views/LoginView.vue'

const routes = [
  { path: '/login', name: 'Login', component: LoginView, meta: { title: '登录', public: true } },
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

// 全局路由守卫: 未登录重定向到 /login
router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('pdd_token')
  if (!to.meta.public && !token) {
    next('/login')
  } else if (to.path === '/login' && token) {
    next('/')
  } else {
    next()
  }
})

export default router
