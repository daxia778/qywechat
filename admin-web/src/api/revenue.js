import client from './client';

export const getRevenueChart = (days, config) =>
  client.get('/admin/revenue_chart', { params: { days }, ...config });

export const getProfitBreakdown = (params, config) =>
  client.get('/admin/profit_breakdown', { params, ...config });
