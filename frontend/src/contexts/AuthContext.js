import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { apiClient } from '../api';
import { API_BASE_URL } from '../lib/apiBase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [permissions, setPermissions] = useState(null);
  const [loading, setLoading] = useState(true);

  const axiosAuth = useCallback(() => {
    return apiClient;
  }, []);

  const fetchPermissions = useCallback(async () => {
    if (user?.mustChangePassword) {
      setPermissions(null);
      return null;
    }
    try {
      const res = await api.get('/auth/permissions');
      setPermissions(res.data);
      return res.data;
    } catch {
      setPermissions(null);
      return null;
    }
  }, [user?.mustChangePassword]);

  const applyAuthenticatedUser = useCallback(async (nextUser) => {
    setUser(nextUser);
    if (nextUser?.mustChangePassword) {
      setPermissions(null);
      return nextUser;
    }
    try {
      const permRes = await api.get('/auth/permissions');
      setPermissions(permRes.data);
    } catch {
      setPermissions(null);
    }
    return nextUser;
  }, []);

  const refreshUser = useCallback(async () => {
    const res = await api.get('/auth/me');
    await applyAuthenticatedUser(res.data);
    return res.data;
  }, [applyAuthenticatedUser]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        await refreshUser();
      } catch {
        setUser(null);
        setPermissions(null);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, [refreshUser]);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    return applyAuthenticatedUser(res.data);
  };

  const register = async (email, password, name) => {
    const res = await api.post('/auth/register', { email, password, name });
    return applyAuthenticatedUser(res.data);
  };

  const changePassword = async (newPassword, currentPassword = '') => {
    const payload = { newPassword };
    if (currentPassword) {
      payload.currentPassword = currentPassword;
    }
    const res = await api.post('/auth/change-password', payload);
    return applyAuthenticatedUser(res.data);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {}
    setUser(null);
    setPermissions(null);
  };

  // Convenience helpers for components
  const canEditPerson = useCallback((personId) => {
    if (!permissions) return false;
    return (permissions.editablePersonIds || []).includes(personId);
  }, [permissions]);

  const canEditProject = useCallback((projectId) => {
    if (!permissions) return false;
    return (permissions.editableProjectIds || []).includes(projectId);
  }, [permissions]);

  return (
    <AuthContext.Provider value={{
      user, loading, login, register, logout, changePassword, refreshUser, axiosAuth, apiBaseUrl: API_BASE_URL,
      permissions, canEditPerson, canEditProject, refreshPermissions: fetchPermissions,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
