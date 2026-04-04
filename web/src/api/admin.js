import client from './client';

export const getDashboard = (config) => client.get('/admin/dashboard', config);
export const listEmployees = (config) => client.get('/admin/employees', config);
export const createEmployee = (data) => client.post('/admin/employees', data);
export const toggleEmployee = (id) => client.put(`/admin/employees/${id}/toggle`);
export const resetPassword = (id) => client.put(`/admin/employees/${id}/reset_password`);
export const unbindDevice = (id) => client.put(`/admin/employees/${id}/unbind`);
export const getTeamWorkload = () => client.get('/admin/team_workload');
export const getProfitSummary = (month, config) => client.get('/admin/profit_breakdown', { params: { month }, ...config });
export const pauseActivationCode = (id) => client.put(`/admin/activation_codes/${id}/pause`);
export const listActivationCodes = (status) => client.get('/admin/activation_codes', { params: status ? { status } : {} });
export const deleteEmployee = (id) => client.delete(`/admin/employees/${id}`);
export const batchToggleEmployees = (ids, active) => client.put('/admin/employees/batch_toggle', { ids, active });
export const batchDeleteEmployees = (ids) => client.post('/admin/employees/batch_delete', { ids });

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
export const getGrabAlerts = () => client.get('/admin/grab_alerts');
export const getTeamRoster = () => client.get('/admin/team_roster');
