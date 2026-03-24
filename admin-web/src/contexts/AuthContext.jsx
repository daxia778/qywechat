import { createContext, useState, useCallback, useEffect, useMemo } from 'react';
import { validateToken, login as apiLogin, logoutApi } from '../api/auth';
import { getToken, getUserName, getUserId, getRole, setAuth, clearAuth, setRole as setStoredRole, setStoredUserId } from '../utils/storage';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(getToken);
  const [userName, setUserName] = useState(getUserName);
  const [userId, setUserId] = useState(getUserId);
  const [role, setRole] = useState(getRole);
  const [ready, setReady] = useState(false);

  const isAuthenticated = !!token;

  const login = useCallback(async (username, password) => {
    const res = await apiLogin(username, password);
    const data = res.data;
    // V2 统一登录返回 { token, user: { id, name, role, username } }
    // V1 旧格式返回 { token, employee_name, wecom_userid, role }
    const t = data.token;
    const user = data.user || {};
    const empName = user.name || data.employee_name || username;
    const empId = user.wecom_userid || data.wecom_userid || user.username || '';
    const r = user.role || data.role || 'sales';
    setAuth({ token: t, employee_name: empName, wecom_userid: empId, role: r });
    setToken(t);
    setUserName(empName);
    setUserId(empId);
    setRole(r);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      if (getToken()) await logoutApi();
    } catch { /* token 可能已过期，忽略错误 */ }
    clearAuth();
    setToken(null);
    setUserName('Admin');
    setUserId('');
    setRole('');
  }, []);

  const checkToken = useCallback(async () => {
    if (!getToken()) {
      setReady(true);
      return false;
    }
    try {
      const res = await validateToken();
      const data = res.data;
      if (data.role) {
        setRole(data.role);
        setStoredRole(data.role);
      }
      if (data.wecom_userid) {
        setUserId(data.wecom_userid);
        setStoredUserId(data.wecom_userid);
      }
      setReady(true);
      return true;
    } catch {
      logout();
      setReady(true);
      return false;
    }
  }, [logout]);

  useEffect(() => {
    checkToken();
  }, [checkToken]);

  const value = useMemo(() => ({
    token, userName, userId, role, isAuthenticated, ready, login, logout, checkToken
  }), [token, userName, userId, role, isAuthenticated, ready, login, logout, checkToken]);

  // Listen for auth:logout events dispatched by the API client on 401
  useEffect(() => {
    const handleAuthLogout = () => logout();
    window.addEventListener('auth:logout', handleAuthLogout);
    return () => window.removeEventListener('auth:logout', handleAuthLogout);
  }, [logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
