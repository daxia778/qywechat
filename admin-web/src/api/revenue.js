import client from './client';

export const getRevenueChart = (days) =>
  client.get('/admin/revenue_chart', { params: { days } });

export const getProfitBreakdown = (params) =>
  client.get('/admin/profit_breakdown', { params });
