import client from './client';

export const listOrders = (params) => client.get('/orders/list', { params });
export const getOrderDetail = (id) => client.get(`/orders/${id}/detail`);
export const getOrderTimeline = (id) => client.get(`/orders/${id}/timeline`);
export const updateOrderStatus = (id, data) => client.put(`/orders/${id}/status`, data);
export const uploadOCR = (formData) =>
  client.post('/orders/upload_ocr', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
