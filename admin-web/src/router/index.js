import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/login', name: 'Login', component: () => import('../views/LoginView.vue'), meta: { title: '登录', public: true } },
  { path: '/', name: 'Dashboard', component: () => import('../views/DashboardView.vue'), meta: { title: '仪表盘', icon: '📊' } },
  { path: '/orders', name: 'Orders', component: () => import('../views/OrdersView.vue'), meta: { title: '订单大厅', icon: '📦' } },
  { path: '/team', name: 'Team', component: () => import('../views/TeamView.vue'), meta: { title: '团队负载', icon: '👥' } },
  { path: '/employees', name: 'Employees', component: () => import('../views/EmployeesView.vue'), meta: { title: '员工管理', icon: '🔑' } },
  { path: '/revenue', name: 'Revenue', component: () => import('../views/RevenueView.vue'), meta: { title: '营收图表', icon: '📈' } },
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
