import client from './client';
import { getToken } from '../utils/storage';

export const getDashboard = () => client.get('/admin/dashboard');
export const listEmployees = () => client.get('/admin/employees');
export const createEmployee = (data) => client.post('/admin/employees', data);
export const toggleEmployee = (id) => client.put(`/admin/employees/${id}/toggle`);
export const unbindDevice = (id) => client.put(`/admin/employees/${id}/unbind`);
export const getTeamWorkload = () => client.get('/admin/team_workload');
export const getProfitSummary = (month) => client.get('/admin/profit_breakdown', { params: { month } });
export const pauseActivationCode = (id) => client.put(`/admin/activation_codes/${id}/pause`);
export const listActivationCodes = (status) => client.get('/admin/activation_codes', { params: status ? { status } : {} });
export const deleteEmployee = (id) => client.delete(`/admin/employees/${id}`);
export const batchToggleEmployees = (ids, active) => client.put('/admin/employees/batch_toggle', { ids, active });
export const batchDeleteEmployees = (ids) => client.post('/admin/employees/batch_delete', { ids });

export const exportOrdersCSV = (params) => {
  const qs = new URLSearchParams(params).toString();
  window.open(`/api/v1/admin/orders/export?${qs}&token=${getToken()}`, '_blank');
};

export const regenerateActivationCode = (id) => client.put(`/admin/activation_codes/${id}/regenerate`);
