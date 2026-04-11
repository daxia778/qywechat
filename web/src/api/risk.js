import api from './client';

// 风控看板统计
export const getRiskDashboard = () => api.get('/admin/risk/dashboard');

// 告警列表
export const getRiskAlerts = (params) => api.get('/admin/risk/alerts', { params });

// 标记告警已处理
export const resolveRiskAlert = (id, remark) =>
  api.put(`/admin/risk/alerts/${id}/resolve`, { remark });

// 批量处理告警
export const batchResolveAlerts = (alertIds, remark) =>
  api.put('/admin/risk/alerts/batch-resolve', { alert_ids: alertIds, remark });

// 跟单操作流水
export const getRiskAuditLog = (params) => api.get('/admin/risk/audit-log', { params });

// 各跟单客服风险画像
export const getStaffRiskStats = () => api.get('/admin/risk/staff-stats');

// 风控概要（侧边栏徽章）
export const getRiskSummary = () => api.get('/admin/risk/summary');

// 审计配置
export const getAuditConfig = () => api.get('/admin/risk/audit-config');
export const updateAuditConfig = (data) => api.put('/admin/risk/audit-config', data);

// 跟单客服列表（供选择监控对象）
export const getFollowStaff = () => api.get('/admin/risk/follow-staff');

// 发送测试播报
export const sendTestBroadcast = () => api.post('/admin/risk/test-broadcast');
