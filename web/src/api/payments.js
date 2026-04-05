import client from './client';

export const listPayments = (params) => client.get('/payments', { params });
export const createPayment = (data) => client.post('/payments', data);
export const matchPayment = (id, data) => client.put(`/payments/${id}/match`, data);
export const getPaymentSummary = () => client.get('/payments/summary');
export const getPaymentReport = (params) => client.get('/payments/report', { params });
export const syncWecom = () => client.post('/payments/sync-wecom');
