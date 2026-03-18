import client from './client';

export const adminLogin = (username, password) =>
  client.post('/auth/admin_login', { username, password });

export const validateToken = () => client.get('/auth/validate_token');
