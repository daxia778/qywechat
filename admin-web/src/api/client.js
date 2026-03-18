import axios from 'axios';
import { getToken, clearAuth } from '../utils/storage';

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: attach JWT token
client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Attach CSRF token if available
  const csrfToken = client.defaults.headers.common['X-CSRF-Token'];
  if (csrfToken && ['post', 'put', 'delete', 'patch'].includes(config.method)) {
    config.headers['X-CSRF-Token'] = csrfToken;
  }
  return config;
});

// Response interceptor: handle 401, capture CSRF
client.interceptors.response.use(
  (response) => {
    const csrf = response.headers['x-csrf-token'];
    if (csrf) {
      client.defaults.headers.common['X-CSRF-Token'] = csrf;
    }
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      clearAuth();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default client;
