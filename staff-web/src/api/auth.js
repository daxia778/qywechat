import client from './client'

// 设备登录（客服/设计师用激活码登录）
// 后端字段: activation_code + machine_id (设备指纹)
export const deviceLogin = (activationCode, machineId) =>
  client.post('/auth/device_login', {
    activation_code: activationCode,
    machine_id: machineId,
  })

// 验证 token 有效性
export const validateToken = () => client.get('/auth/validate_token')
