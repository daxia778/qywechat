import client from './client';

export const login = (username, password) =>
  client.post('/auth/login', { username, password });

// 兼容旧调用
export const adminLogin = login;

export const validateToken = () => client.get('/auth/validate_token');
