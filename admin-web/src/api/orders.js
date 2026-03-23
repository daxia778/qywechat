import client from './client';

export const listOrders = (params, config) => client.get('/orders/list', { params, ...config });
export const getOrderDetail = (id, config) => client.get(`/orders/${id}/detail`, config);
export const getOrderTimeline = (id, config) => client.get(`/orders/${id}/timeline`, config);
export const updateOrderStatus = (id, data) => client.put(`/orders/${id}/status`, data);
export const updateOrderAmount = (id, data) => client.put(`/orders/${id}/amount`, data);
export const uploadOCR = (formData) =>
  client.post('/orders/upload_ocr', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
export const batchUpdateOrderStatus = (data) => client.put('/orders/batch-status', data);
export const listPendingMatchOrders = (params) => client.get('/orders/pending-match', { params });
export const matchOrderContact = (id, data) => client.post(`/orders/${id}/match`, data);
export const reassignOrder = (id, designerUserid) => client.put(`/orders/${id}/reassign`, { designer_userid: designerUserid });
export const getMyStats = (config) => client.get('/orders/my-stats', config);
