import client from './client';

export const listCustomers = (params) => client.get('/admin/customers', { params });
export const getCustomerDetail = (id) => client.get(`/admin/customers/${id}`);
export const updateCustomer = (id, data) => client.put(`/admin/customers/${id}`, data);
export const mergeCustomers = (primaryId, duplicateId) => client.post('/admin/customers/merge', { primary_id: primaryId, duplicate_id: duplicateId });
