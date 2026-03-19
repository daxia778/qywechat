import client from './client';

export const listCustomers = (params) => client.get('/admin/customers', { params });
export const getCustomerDetail = (id) => client.get(`/admin/customers/${id}`);
export const updateCustomer = (id, data) => client.put(`/admin/customers/${id}`, data);
