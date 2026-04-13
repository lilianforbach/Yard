import axios from 'axios';
import { API_BASE_URL, buildApiUrl } from './lib/apiBase';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 15000,
});

// Handle 401 responses globally and return the user to login.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const detail = error.response?.data?.detail;
    const path = window.location.pathname;
    const requestUrl = error.config?.url || '';
    const isAuthRequest = (
      requestUrl.includes('/auth/login')
      || requestUrl.includes('/auth/register')
      || requestUrl.includes('/auth/activation-status')
      || requestUrl.includes('/auth/activate-account')
    );

    if (status === 403 && detail === 'Password change required' && path !== '/set-password') {
      const next = `${path}${window.location.search || ''}`;
      const search = next && next !== '/set-password' ? `?next=${encodeURIComponent(next)}` : '';
      window.location.assign(`/set-password${search}`);
    }

    if (status === 401 && !isAuthRequest) {
      const isAuthPage = path === '/login' || path === '/activate';
      if (!isAuthPage) {
        const next = `${path}${window.location.search || ''}`;
        const search = next && next !== '/' ? `?next=${encodeURIComponent(next)}` : '';
        window.location.assign(`/login${search}`);
      }
    }
    return Promise.reject(error);
  }
);

const api = {
  client: apiClient,
  get: (path, config = {}) => apiClient.get(path, config),
  post: (path, data, config = {}) => apiClient.post(path, data, {
    headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
    ...config,
  }),
  put: (path, data, config = {}) => apiClient.put(path, data, {
    headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
    ...config,
  }),
  delete: (path, config = {}) => apiClient.delete(path, config),
  buildUrl: buildApiUrl,
};

export default api;
