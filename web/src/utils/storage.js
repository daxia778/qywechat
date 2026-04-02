const KEY_TOKEN = 'pdd_token';
const KEY_USER_NAME = 'pdd_user_name';
const KEY_USER_ID = 'pdd_user_id';
const KEY_ROLE = 'pdd_role';

export function getToken() {
  return localStorage.getItem(KEY_TOKEN);
}

export function getUserName() {
  return localStorage.getItem(KEY_USER_NAME) || 'Admin';
}

export function getUserId() {
  return localStorage.getItem(KEY_USER_ID) || '';
}

export function getRole() {
  return localStorage.getItem(KEY_ROLE) || '';
}

export function setAuth({ token, employee_name, wecom_userid, role }) {
  if (token) localStorage.setItem(KEY_TOKEN, token);
  if (employee_name) localStorage.setItem(KEY_USER_NAME, employee_name);
  if (wecom_userid) localStorage.setItem(KEY_USER_ID, wecom_userid);
  if (role) localStorage.setItem(KEY_ROLE, role);
}

export function setRole(role) {
  if (role) localStorage.setItem(KEY_ROLE, role);
}

export function setStoredUserId(id) {
  if (id) localStorage.setItem(KEY_USER_ID, id);
}

export function clearAuth() {
  localStorage.removeItem(KEY_TOKEN);
  localStorage.removeItem(KEY_USER_NAME);
  localStorage.removeItem(KEY_USER_ID);
  localStorage.removeItem(KEY_ROLE);
}
