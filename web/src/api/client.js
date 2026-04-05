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

// 刷新 CSRF token（通过一次 GET 请求获取新 token）
let csrfRefreshPromise = null;
async function refreshCSRFToken() {
  if (csrfRefreshPromise) return csrfRefreshPromise;
  csrfRefreshPromise = client.get('/auth/validate_token').then((res) => {
    const csrf = res.headers['x-csrf-token'];
    if (csrf) client.defaults.headers.common['X-CSRF-Token'] = csrf;
    return csrf;
  }).finally(() => { csrfRefreshPromise = null; });
  return csrfRefreshPromise;
}

// Response interceptor: handle 401, capture CSRF, retry on CSRF 403
client.interceptors.response.use(
  (response) => {
    const csrf = response.headers['x-csrf-token'];
    if (csrf) {
      client.defaults.headers.common['X-CSRF-Token'] = csrf;
    }
    return response;
  },
  async (error) => {
    if (error.response?.status === 401) {
      clearAuth();
      window.dispatchEvent(new Event('auth:logout'));
    }
    // CSRF token 过期/失效时自动重试一次
    if (error.response?.status === 403 && !error.config._csrfRetried) {
      const data = error.response?.data;
      if (data?.error?.includes?.('CSRF') || data?.error?.includes?.('csrf')) {
        error.config._csrfRetried = true;
        await refreshCSRFToken();
        error.config.headers['X-CSRF-Token'] = client.defaults.headers.common['X-CSRF-Token'];
        return client(error.config);
      }
    }
    const msg = error.response?.data?.message || error.message;
    error.displayMessage = msg;
    return Promise.reject(error);
  }
);

export default client;
