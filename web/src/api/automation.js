import client from './client';

// Agent API（管理端查看）
export const listAutomationTasks = (params) => client.get('/admin/automation/tasks', { params });
export const retryAutomationTask = (id) => client.put(`/admin/automation/tasks/${id}/retry`);
export const cancelAutomationTask = (id) => client.put(`/admin/automation/tasks/${id}/cancel`);
export const getAutomationStats = () => client.get('/admin/automation/stats');
export const getAgentStatus = () => client.get('/admin/automation/agent-status');
