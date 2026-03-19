import { createContext, useState, useCallback, useEffect } from 'react';
import { validateToken, adminLogin } from '../api/auth';
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
    const res = await adminLogin(username, password);
    const { token: t, employee_name, wecom_userid, role: r } = res.data;
    setAuth({ token: t, employee_name, wecom_userid, role: r || 'admin' });
    setToken(t);
    setUserName(employee_name || username);
    setUserId(wecom_userid || '');
    setRole(r || 'admin');
    return res.data;
  }, []);

  const logout = useCallback(() => {
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

  return (
    <AuthContext.Provider value={{ token, userName, userId, role, isAuthenticated, ready, login, logout, checkToken }}>
      {children}
    </AuthContext.Provider>
  );
}
