const trimTrailingSlash = (value = '') => value.replace(/\/+$/, '');

const explicitBackendUrl = process.env.REACT_APP_BACKEND_URL?.trim();

export const API_BASE_URL = explicitBackendUrl
  ? `${trimTrailingSlash(explicitBackendUrl)}/api`
  : '/api';

export const buildApiUrl = (path = '') => {
  if (!path || path === '/') {
    return API_BASE_URL;
  }

  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
};
