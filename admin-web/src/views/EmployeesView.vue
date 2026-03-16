<template>
  <div class="animate-fade-in-up flex flex-col gap-6 w-full max-w-[1400px] mx-auto min-h-full">
    
    <div class="flex justify-between items-center mb-2">
      <h1 class="text-2xl font-[Outfit] font-bold text-gray-900 tracking-tight">员工管理</h1>
      <button @click="showAddModal = true" class="btn btn-primary">
         <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
         新增员工
      </button>
    </div>

    <!-- Table Card -->
    <div class="card-enterprise flex flex-col overflow-hidden">
      <div class="table-container min-h-[400px] relative">
        <div v-if="loading" class="absolute inset-0 z-10 bg-white/50 backdrop-blur-sm flex items-center justify-center">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>

        <table class="w-full text-left border-collapse">
          <thead>
            <tr>
              <th>员工 (WeCom ID)</th>
              <th>角色权限</th>
              <th>激活码</th>
              <th>MAC 绑定</th>
              <th>状态</th>
              <th class="text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="emp in employees" :key="emp.id" class="hover:bg-gray-50 transition-colors">
              <td>
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-slate-800 text-white font-medium flex items-center justify-center text-xs">
                    {{ emp.name ? emp.name.substring(0, 2).toUpperCase() : '?' }}
                  </div>
                  <div class="flex flex-col">
                    <span class="font-medium text-gray-900">{{ emp.name }}</span>
                    <span class="text-xs text-gray-400">{{ emp.wecom_userid }}</span>
                  </div>
                </div>
              </td>
              <td>
                <span class="badge" :class="getRoleClass(emp.role)">
                  {{ getRoleName(emp.role) }}
                </span>
              </td>
              <td>
                <div class="flex items-center gap-2" v-if="emp.activation_code">
                  <code class="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-mono font-bold tracking-widest border border-gray-200">
                    {{ emp.activation_code }}
                  </code>
                  <button @click="copyText(emp.activation_code)" class="text-gray-400 hover:text-primary transition-colors bg-transparent border-none cursor-pointer p-1" title="复制激活码">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                </div>
                <span v-else class="text-xs text-gray-400">-</span>
              </td>
              <td>
                <span v-if="emp.mac_address" class="text-xs font-mono text-gray-500 bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded">{{ emp.mac_address }}</span>
                <span v-else class="text-xs text-gray-400 italic">未绑定</span>
              </td>
              <td>
                <div class="flex items-center gap-1.5">
                   <span class="w-2 h-2 rounded-full" :class="emp.is_active ? 'bg-emerald-500' : 'bg-red-500'"></span>
                   <span class="text-xs font-medium" :class="emp.is_active ? 'text-emerald-700' : 'text-red-600'">
                     {{ emp.is_active ? '已启用' : '已停用' }}
                   </span>
                </div>
              </td>
              <td class="text-right">
                <div class="flex items-center justify-end gap-2">
                  <button 
                    v-if="emp.mac_address"
                    @click="unbindDevice(emp)"
                    class="btn text-xs px-3 py-1.5 btn-secondary text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                    title="解绑设备后可在新设备上使用该激活码"
                  >
                    🔓 解绑设备
                  </button>
                  <button 
                    @click="toggleActive(emp)"
                    class="btn text-xs px-3 py-1.5"
                    :class="emp.is_active ? 'btn-danger bg-white hover:bg-red-50' : 'btn-secondary text-emerald-600 hover:text-emerald-700'"
                  >
                    {{ emp.is_active ? '停用账号' : '恢复启用' }}
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="employees.length === 0 && !loading">
              <td colspan="6" class="py-12 text-center text-gray-500">
                暂无员工数据
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add Modal -->
    <div v-if="showAddModal" class="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/40 backdrop-blur-sm transition-opacity">
      <div class="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-fade-in-up">
        <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 class="text-lg font-bold text-gray-900 font-[Outfit]">添加组织成员</h3>
          <button @click="showAddModal = false" class="text-gray-400 hover:text-gray-600 bg-transparent border-none cursor-pointer">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        
        <form @submit.prevent="submitAdd" class="p-6">
          <div class="form-group">
            <label class="form-label">企微 UserID</label>
            <input v-model="form.wecom_userid" type="text" class="form-input" placeholder="在企微后台中的唯一账号ID" required />
          </div>
          <div class="form-group">
            <label class="form-label">姓名</label>
            <input v-model="form.name" type="text" class="form-input" placeholder="员工真实姓名" required />
          </div>
          <div class="form-group">
            <label class="form-label">系统角色</label>
            <div class="relative">
              <select v-model="form.role" class="form-input appearance-none bg-white font-medium" required>
                <option value="operator">客服管家 (Operator)</option>
                <option value="designer">设计师 (Designer)</option>
                <option value="admin">系统管理员 (Admin)</option>
              </select>
              <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500">
                <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
              </div>
            </div>
          </div>
          
          <div class="mt-8 flex justify-end gap-3">
            <button type="button" @click="showAddModal = false" class="btn btn-secondary px-5">取消</button>
            <button type="submit" class="btn btn-primary px-5 shadow-sm" :disabled="adding">
              {{ adding ? '提交中...' : '生成激活码并保存' }}
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
const loading = ref(false)
const showAddModal = ref(false)
const adding = ref(false)

const form = ref({
  wecom_userid: '',
  name: '',
  role: 'operator'
})

const getRoleName = (role) => {
  const m = { 'operator': '客服', 'designer': '设计师', 'admin': '管理员' }
  return m[role] || role
}

const getRoleClass = (role) => {
  const m = { 'operator': 'primary', 'designer': 'secondary', 'admin': 'warning' }
  return m[role] || 'secondary'
}

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text)
    alert('激活码复制成功')
  } catch (err) {
    alert('复制失败')
  }
}

const fetchEmployees = async () => {
  loading.value = true
  try {
    const res = await axios.get('/api/v1/admin/employees')
    employees.value = res.data.data || []
  } catch (err) {
    console.error('Failed to fetch employees:', err)
  } finally {
    loading.value = false
  }
}

const toggleActive = async (emp) => {
  if (!confirm(`确定要${emp.is_active ? '停用' : '启用'}员工 ${emp.name} 吗？`)) return
  try {
    await axios.put(`/api/v1/admin/employees/${emp.id}/toggle`)
    fetchEmployees()
  } catch (err) {
    alert('操作失败 ' + err.message)
  }
}

const unbindDevice = async (emp) => {
  if (!confirm(`确定要解绑 ${emp.name} 的设备吗？\n解绑后该激活码可在新设备上使用。`)) return
  try {
    const res = await axios.put(`/api/v1/admin/employees/${emp.id}/unbind`)
    alert(res.data.message || '解绑成功')
    fetchEmployees()
  } catch (err) {
    alert('解绑失败: ' + (err.response?.data?.error || err.message))
  }
}

// Client-side quick UUID-like generator for 6-char activation code
const generateActivationCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for(let i=0; i<6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

const submitAdd = async () => {
  if (!form.value.wecom_userid || !form.value.name) return
  adding.value = true
  try {
    const code = generateActivationCode()
    const payload = { ...form.value, activation_code: code }
    await axios.post('/api/v1/admin/employees', payload)
    showAddModal.value = false
    form.value = { wecom_userid: '', name: '', role: 'operator' }
    fetchEmployees()
  } catch (err) {
    alert('添加失败: ' + err.message)
  } finally {
    adding.value = false
  }
}

onMounted(() => {
  fetchEmployees()
})
</script>
