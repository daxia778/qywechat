import client from './client';

export const getNotifications = (params) =>
  client.get('/admin/notifications', { params });

export const markNotificationRead = (id) =>
  client.put(`/admin/notifications/${id}/read`);

export const markAllNotificationsRead = () =>
  client.put('/admin/notifications/all/read');
