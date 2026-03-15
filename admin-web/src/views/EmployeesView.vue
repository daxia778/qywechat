<template>
  <div class="employees-view animate-fade-in">
    <div class="header-card glass-card">
      <div class="header-info">
        <h3>员工账号管理</h3>
        <p class="text-secondary">添加客服或设计师账号，获取用于客户端免密绑定的激活码。</p>
      </div>
      <button class="btn btn-primary" @click="showAddModal = true">+ 添加新员工</button>
    </div>

    <div class="table-card glass-card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>企微 UserID</th>
              <th>姓名</th>
              <th>角色</th>
              <th>激活码 / MAC 绑定</th>
              <th>系统状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="employees.length === 0">
              <td colspan="6" class="empty-state">暂无员工数据</td>
            </tr>
            <tr v-for="emp in employees" :key="emp.id">
              <td class="uid">{{ emp.wecom_userid }}</td>
              <td class="font-bold">{{ emp.name }}</td>
              <td>
                <span :class="['role-badge', emp.role]">{{ formatRole(emp.role) }}</span>
              </td>
              <td>
                <div v-if="emp.activation_code" class="code-box">
                  <span class="code">{{ emp.activation_code }}</span>
                  <button class="copy-btn" @click="copyCode(emp.activation_code)">📋</button>
                </div>
                <div v-else class="text-secondary">-</div>
                <div class="mac-address" v-if="emp.mac_address">
                  已绑定MAC: <span class="text-info">{{ emp.mac_address }}</span>
                </div>
                <div class="mac-address text-warning" v-else>未绑定设备</div>
              </td>
              <td>
                <span :class="['badge', emp.is_active ? 'success' : 'danger']">
                  {{ emp.is_active ? '启用中' : '已禁用' }}
                </span>
              </td>
              <td>
                <button 
                  class="btn" 
                  :class="emp.is_active ? 'btn-danger' : 'btn-success'"
                  @click="toggleStatus(emp)"
                >
                  {{ emp.is_active ? '禁用' : '启用' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 添加模态框 -->
    <div v-if="showAddModal" class="modal-overlay">
      <div class="modal glass-card animate-fade-in">
        <h3 class="modal-title">添加新员工</h3>
        <form @submit.prevent="submitAdd" class="modal-form">
          <div class="form-group">
            <label class="form-label">企微 UserID</label>
            <input v-model="form.wecom_userid" required class="form-input" placeholder="例如: ZhangSan" />
          </div>
          <div class="form-group">
            <label class="form-label">真实姓名</label>
            <input v-model="form.name" required class="form-input" placeholder="例如: 张三" />
          </div>
          <div class="form-group">
            <label class="form-label">系统角色</label>
            <select v-model="form.role" class="form-input custom-select">
              <option value="operator">客服人员 (仅浮窗录单)</option>
              <option value="designer">设计师 (排单设计群主)</option>
              <option value="admin">管理员 (全部权限)</option>
            </select>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-secondary" @click="closeModal">取消</button>
            <button type="submit" class="btn btn-primary" :disabled="loading">
              {{ loading ? '提交中...' : '生成激活码并保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

const employees = ref([])
const showAddModal = ref(false)
const loading = ref(false)

const form = ref({
  wecom_userid: '',
  name: '',
  role: 'operator'
})

// 生成随机6位激活码
const generateActivationCode = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

const fetchEmployees = async () => {
  try {
    const { data } = await axios.get('/api/v1/admin/employees')
    employees.value = data
  } catch (err) {
    console.error('Fetch error', err)
  }
}

const submitAdd = async () => {
  if (loading.value) return
  loading.value = true
  try {
    const payload = {
      ...form.value,
      activation_code: generateActivationCode()
    }
    await axios.post('/api/v1/admin/employees', payload)
    showAddModal.value = false
    form.value = { wecom_userid: '', name: '', role: 'operator' }
    fetchEmployees()
    alert(`添加成功！激活码为: ${payload.activation_code}\n请妥善保管并发送给员工用于客户端登录绑定。`)
  } catch (err) {
    const msg = err.response?.data?.error || err.message
    alert('添加失败: ' + msg)
  } finally {
    loading.value = false
  }
}

const toggleStatus = async (emp) => {
  if (!confirm(`确定要${emp.is_active ? '禁用' : '启用'}员工 [${emp.name}] 吗？`)) return
  try {
    await axios.put(`/api/v1/admin/employees/${emp.id}/toggle`)
    fetchEmployees()
  } catch (err) {
    alert('操作失败')
  }
}

const formatRole = (role) => {
  const map = { operator: '录单客服', designer: '设计师', admin: '超级管理员' }
  return map[role] || role
}

const copyCode = (code) => {
  navigator.clipboard.writeText(code)
  alert('激活码已复制到剪贴板: ' + code)
}

const closeModal = () => {
  showAddModal.value = false
  form.value = { wecom_userid: '', name: '', role: 'operator' }
}

onMounted(() => {
  fetchEmployees()
})
</script>

<style scoped>
.employees-view {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.header-card {
  padding: 1.5rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-info h3 {
  font-size: 1.25rem;
  margin-bottom: 0.25rem;
}

.table-card {
  padding: 1px;
}

.uid {
  font-family: monospace;
  color: var(--text-secondary);
}

.font-bold {
  font-weight: 600;
  font-size: 1rem;
}

.role-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
}

.role-badge.operator { background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); }
.role-badge.designer { background: rgba(139, 92, 246, 0.15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.3); }
.role-badge.admin { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }

.code-box {
  display: inline-flex;
  align-items: center;
  background: rgba(0,0,0,0.3);
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  border: 1px dashed var(--border-color);
  gap: 0.5rem;
}

.code {
  font-family: monospace;
  font-weight: 700;
  color: var(--success-color);
  letter-spacing: 1px;
}

.copy-btn {
  background: none;
  border: none;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.2s;
}

.copy-btn:hover {
  opacity: 1;
}

.mac-address {
  font-size: 0.75rem;
  margin-top: 0.5rem;
}

.btn-danger {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.btn-danger:hover {
  background: rgba(239, 68, 68, 0.2);
}

.btn-success {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.btn-success:hover {
  background: rgba(16, 185, 129, 0.2);
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(4px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  width: 100%;
  max-width: 480px;
  padding: 2rem;
  background: #111827;
}

.modal-title {
  margin-bottom: 1.5rem;
  text-align: center;
  font-size: 1.25rem;
}

.modal-form {
  display: flex;
  flex-direction: column;
}

.custom-select {
  appearance: none;
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 1rem center;
  background-size: 1em;
}

.custom-select option {
  background: #111827;
  color: white;
}

.modal-actions {
  margin-top: 2rem;
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
}
</style>
