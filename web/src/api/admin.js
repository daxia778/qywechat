import client from './client';
import apiCache from '../utils/apiCache';

export const getDashboard = (config) => client.get('/admin/dashboard', config);
export const listEmployees = (config) => client.get('/admin/employees', config);
export const createEmployee = (data) => {
  apiCache.invalidate('employees');
  return client.post('/admin/employees', data);
};
export const toggleEmployee = (id) => {
  apiCache.invalidate('employees');
  return client.put(`/admin/employees/${id}/toggle`);
};
export const resetPassword = (id) => client.put(`/admin/employees/${id}/reset_password`);
export const unbindDevice = (id) => {
  apiCache.invalidate('employees');
  return client.put(`/admin/employees/${id}/unbind`);
};
export const getTeamWorkload = () => client.get('/admin/team_workload');
export const getProfitSummary = (month, config) => client.get('/admin/profit_breakdown', { params: { month }, ...config });
export const pauseActivationCode = (id) => {
  apiCache.invalidate('employees');
  return client.put(`/admin/activation_codes/${id}/pause`);
};
export const listActivationCodes = (params = {}) => client.get('/admin/activation_codes', { params });
export const createActivationCode = (employeeId) => client.post('/admin/activation_codes', { employee_id: employeeId });
export const updateEmployee = (id, data) => {
  apiCache.invalidate('employees');
  return client.put(`/admin/employees/${id}`, data);
};
export const deleteEmployee = (id) => {
  apiCache.invalidate('employees');
  return client.delete(`/admin/employees/${id}`);
};
export const batchToggleEmployees = (ids, active) => {
  apiCache.invalidate('employees');
  return client.put('/admin/employees/batch_toggle', { ids, active });
};
export const batchDeleteEmployees = (ids) => {
  apiCache.invalidate('employees');
  return client.post('/admin/employees/batch_delete', { ids });
};

export const exportOrdersCSV = async (params = {}) => {
  const res = await client.get('/admin/orders/export', {
    params,
    responseType: 'blob',
  });
  const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const exportExcel = async (params = {}) => {
  const res = await client.get('/admin/export/excel', {
    params,
    responseType: 'blob',
  });
  const blob = new Blob([res.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const start = params.start_date || '';
  const end = params.end_date || '';
  a.download = `PDD报表_${start}_${end}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const regenerateActivationCode = (id) => client.put(`/admin/activation_codes/${id}/regenerate`);
export const getGrabAlerts = (params) => client.get('/admin/grab_alerts', { params });
export const getGrabAlertStats = () => client.get('/admin/grab_alerts/stats');
export const dismissGrabAlert = (id) => client.put(`/admin/grab_alerts/${id}/dismiss`);
export const batchDismissGrabAlerts = (ids) => client.put('/admin/grab_alerts/batch_dismiss', { ids });
export const getTeamRoster = () => client.get('/admin/team_roster');

// 企微通讯录
export const listWecomMembers = (keyword) => client.get('/admin/wecom/members', { params: { keyword } });

// 联系我管理
export const createContactWay = (data) => client.post('/admin/contact_way', data);
export const listContactWays = () => client.get('/admin/contact_ways');

// 客户转接
export const getExternalContacts = (userid) => client.get('/admin/transfer/external-contacts', { params: { userid } });
export const executeTransfer = (data) => client.post('/admin/transfer/execute', data);
export const getTransferRecords = (params) => client.get('/admin/transfer/records', { params });
export const checkTransferStatus = (data) => client.post('/admin/transfer/check-status', data);

// 自动转接规则
export const createTransferRule = (data) => client.post('/admin/transfer/rules', data);
export const listTransferRules = () => client.get('/admin/transfer/rules');
export const updateTransferRule = (id, data) => client.put(`/admin/transfer/rules/${id}`, data);
export const deleteTransferRule = (id) => client.delete(`/admin/transfer/rules/${id}`);

// ─── 缓存包装函数 ─────────────────────────────────────────
// 使用策略: 稳定数据用 TTL 缓存，写操作自动 invalidate

/** 员工列表（2分钟缓存，人员变动低频） */
export const listEmployeesCached = (config) =>
  apiCache.get('employees', () => listEmployees(config), {
    ttl: 120000,
    staleWhileRevalidate: true,
  });

/** 团队工作量（1分钟缓存） */
export const getTeamWorkloadCached = () =>
  apiCache.get('team_workload', () => getTeamWorkload(), {
    ttl: 60000,
    staleWhileRevalidate: true,
  });

/** 团队花名册（5分钟缓存，变化极低频） */
export const getTeamRosterCached = () =>
  apiCache.get('team_roster', () => getTeamRoster(), {
    ttl: 300000,
    staleWhileRevalidate: true,
  });

/** 企微通讯录（按关键词缓存，2分钟） */
export const listWecomMembersCached = (keyword) =>
  apiCache.get(`wecom_members:${keyword || ''}`, () => listWecomMembers(keyword), {
    ttl: 120000,
  });

