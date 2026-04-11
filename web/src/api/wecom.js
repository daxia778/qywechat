import client from './client';

// ─── 会话存档 ─────────────────────────────────

/** 获取有存档消息的群聊列表 */
export const listArchivedGroups = (keyword) =>
  client.get('/admin/wecom/archive/groups', { params: { keyword } });

/** 获取指定群聊的存档消息（分页） */
export const getArchiveMessages = (chatId, params = {}) =>
  client.get(`/admin/wecom/groups/${chatId}/archive`, { params });

/** 获取存档媒体文件 URL */
export const getArchiveMediaUrl = (filepath) =>
  `/api/v1/admin/wecom/archive/media/${filepath}`;

// ─── 群聊管理 ─────────────────────────────────

/** 获取群聊详情（企微 API 实时 + 本地数据） */
export const getGroupChatDetail = (chatId) =>
  client.get(`/admin/wecom/groups/${chatId}/detail`);

/** 更新群成员（添加/移除） */
export const updateGroupMembers = (chatId, data) =>
  client.post(`/admin/wecom/groups/${chatId}/members`, data);

/** 重命名群聊 */
export const renameGroupChat = (chatId, name) =>
  client.put(`/admin/wecom/groups/${chatId}/rename`, { name });

/** 关联群聊到订单 */
export const associateGroupToOrder = (chatId, orderId) =>
  client.post(`/admin/wecom/groups/${chatId}/associate`, { order_id: orderId });

// ─── 企微诊断 ─────────────────────────────────

/** 企微 API 连通性诊断 */
export const wecomDiagnostic = () =>
  client.get('/admin/wecom/diagnostic');

/** 企微通讯录成员列表 */
export const listWecomMembers = (keyword) =>
  client.get('/admin/wecom/members', { params: { keyword } });
