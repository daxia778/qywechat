import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import {
  listArchivedGroups,
  getArchiveMessages,
  getGroupChatDetail,
  updateGroupMembers,
  renameGroupChat,
  associateGroupToOrder,
  getArchiveMediaUrl,
  listWecomMembers,
  createCustomGroup
} from '../api/wecom';
import { formatTime } from '../utils/formatters';

export default function WecomArchivePage() {
  const { role } = useAuth();
  const { toast } = useToast();
  
  const [groups, setGroups] = useState([]);
  const [keyword, setKeyword] = useState('');
  const [loadingGroups, setLoadingGroups] = useState(false);
  
  const [activeGroup, setActiveGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [hasMoreMsgs, setHasMoreMsgs] = useState(true);
  
  // 群管理弹窗状态
  const [manageVisible, setManageVisible] = useState(false);
  const [groupDetail, setGroupDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [newName, setNewName] = useState('');
  const [newOrderId, setNewOrderId] = useState('');

  // 建群弹窗状态
  const [createVisible, setCreateVisible] = useState(false);
  const [allMembers, setAllMembers] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [searchMemberKeyword, setSearchMemberKeyword] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);

  const messagesEndRef = useRef(null);

  // 加载群列表
  const fetchGroups = async () => {
    setLoadingGroups(true);
    try {
      const res = await listArchivedGroups(keyword);
      setGroups(res.data.data || []);
    } catch (err) {
      toast('获取群聊列表失败', 'error');
    } finally {
      setLoadingGroups(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, [keyword]);

  // 加载消息
  const fetchMessages = async (chatId, isLoadMore = false) => {
    if (!chatId) return;
    setLoadingMsgs(true);
    try {
      // 简单实现，暂不传 lastSeq 等游标，获取最新 100 条
      const res = await getArchiveMessages(chatId, { limit: 100 });
      const newMsgs = res.data.data || [];
      if (isLoadMore) {
        setMessages(prev => [...newMsgs, ...prev]);
      } else {
        setMessages(newMsgs);
        setTimeout(() => scrollToBottom(), 100);
      }
      setHasMoreMsgs(newMsgs.length >= 100);
    } catch (err) {
      toast('获取消息记录失败', 'error');
    } finally {
      setLoadingMsgs(false);
    }
  };

  useEffect(() => {
    if (activeGroup) {
      fetchMessages(activeGroup.chat_id);
    } else {
      setMessages([]);
    }
  }, [activeGroup]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // 群管理
  const openManageModal = async () => {
    if (!activeGroup) return;
    setManageVisible(true);
    setLoadingDetail(true);
    try {
      const res = await getGroupChatDetail(activeGroup.chat_id);
      setGroupDetail(res.data.data);
      setNewName(res.data.data.name || '');
      setNewOrderId(activeGroup.order_sn || '');
    } catch (err) {
      toast('获取群详情失败', 'error');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleRename = async () => {
    if (!newName) return;
    try {
      await renameGroupChat(activeGroup.chat_id, newName);
      toast('重命名成功', 'success');
      activeGroup.name = newName;
      setGroupDetail({ ...groupDetail, name: newName });
    } catch (err) {
      toast('重命名失败', 'error');
    }
  };
  
  const handleAssociateOrder = async () => {
    if (!newOrderId) return;
    try {
      await associateGroupToOrder(activeGroup.chat_id, newOrderId);
      toast('关联订单成功', 'success');
      fetchGroups(); // 刷新列表
    } catch (err) {
      toast('关联失败', 'error');
    }
  };

  // 搜索企微成员
  const handleSearchMembers = async () => {
    setSearchLoading(true);
    try {
      const res = await listWecomMembers(searchMemberKeyword);
      setAllMembers(res.data.data || []);
    } catch (err) {
      toast('搜索成员失败', 'error');
    } finally {
      setSearchLoading(false);
    }
  };

  useEffect(() => {
    if (createVisible) {
      handleSearchMembers();
    }
  }, [createVisible, searchMemberKeyword]);

  const toggleMemberSelection = (member) => {
    if (selectedMembers.find(m => m.userid === member.userid)) {
      setSelectedMembers(selectedMembers.filter(m => m.userid !== member.userid));
    } else {
      setSelectedMembers([...selectedMembers, member]);
    }
  };

  const handleCreateGroup = async () => {
    if (selectedMembers.length < 2) {
      toast('请至少选择2名成员建群', 'warning');
      return;
    }
    setCreatingGroup(true);
    try {
      const memberIds = selectedMembers.map(m => m.userid);
      await createCustomGroup({ member_ids: memberIds });
      toast('群聊创建成功', 'success');
      setCreateVisible(false);
      setSelectedMembers([]);
      fetchGroups();
    } catch (err) {
      toast('群聊创建失败', 'error');
    } finally {
      setCreatingGroup(false);
    }
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4">
      {/* 左侧群聊列表 */}
      <div className="w-full lg:w-80 bg-white border border-slate-200 rounded-xl flex flex-col shrink-0 overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-bold text-slate-800">会话存档</h2>
            {role === 'admin' && (
              <button onClick={() => setCreateVisible(true)} className="px-3 py-1.5 bg-brand-500 text-white text-xs font-bold rounded hover:bg-brand-600 shadow-sm flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                新建群聊
              </button>
            )}
          </div>
          <div className="relative">
            <input
              type="text"
              placeholder="搜索群名、订单号..."
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 scrollbar-hide">
          {loadingGroups ? (
            <div className="text-center py-6 text-slate-400 text-sm">加载中...</div>
          ) : groups.length === 0 ? (
            <div className="text-center py-6 text-slate-400 text-sm">暂无群聊数据</div>
          ) : (
            groups.map(g => (
              <div
                key={g.chat_id}
                onClick={() => setActiveGroup(g)}
                className={`p-3 border-b border-slate-100 cursor-pointer rounded-lg mb-1 transition-colors ${activeGroup?.chat_id === g.chat_id ? 'bg-brand-50 border-brand-200' : 'hover:bg-slate-50'}`}
              >
                <div className="flex justify-between items-start mb-1">
                  <div className="font-medium text-slate-800 text-sm line-clamp-1">{g.name}</div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {g.order_sn && <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">#{g.order_sn}</span>}
                  <span className="text-slate-500">成员: {g.member_count}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右侧聊天窗口 */}
      <div className="flex-1 bg-white border border-slate-200 rounded-xl flex flex-col overflow-hidden relative">
        {activeGroup ? (
          <>
            {/* Header */}
            <div className="h-16 border-b border-slate-200 flex items-center justify-between px-6 bg-slate-50 shrink-0">
              <div>
                <h3 className="font-bold text-slate-800 text-lg">{activeGroup.name}</h3>
                <span className="text-xs text-slate-500">
                  {activeGroup.order_sn ? `关联订单: ${activeGroup.order_sn}` : '未关联订单'} · 成员 {activeGroup.member_count} 人
                </span>
              </div>
              <button onClick={openManageModal} className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-brand-600 transition-colors shadow-sm flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                群管理
              </button>
            </div>

            {/* Message Flow */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
              {loadingMsgs ? (
                <div className="flex justify-center my-4"><span className="text-slate-400 text-sm">加载中...</span></div>
              ) : messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-400">暂无消息记录</div>
              ) : (
                <div className="space-y-6">
                  {messages.map((msg, idx) => {
                    const isSystem = msg.sender_id === 'system';
                    const isDesigner = msg.is_designer;
                    const isCustomer = msg.is_customer;
                    // Mocking right-aligned for "my" messages if we knew our userid, for now all left except system in center
                    
                    if (isSystem) {
                      return (
                        <div key={msg.id} className="flex justify-center my-4">
                          <div className="bg-slate-200/60 text-slate-500 text-xs px-3 py-1.5 rounded-full">
                            {msg.content}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={msg.id} className="flex gap-3 max-w-[85%]">
                        {/* Avatar */}
                        <div className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center text-white font-bold text-sm ${isDesigner ? 'bg-purple-500' : isCustomer ? 'bg-amber-500' : 'bg-brand-500'}`}>
                          {msg.sender_name?.substring(0,2) || '未知'}
                        </div>
                        
                        <div>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-xs font-medium text-slate-500">{msg.sender_name}</span>
                            {isDesigner && <span className="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0.5 rounded font-bold border border-purple-200 shadow-sm flex items-center gap-1">🎨 设计师</span>}
                            {isCustomer && <span className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded font-bold border border-amber-200">👤 客户</span>}
                            <span className="text-[10px] text-slate-400">{formatTime(msg.msg_time)}</span>
                          </div>
                          
                          <div className={`p-3 rounded-2xl rounded-tl-sm text-sm shadow-sm inline-block ${isDesigner ? 'bg-purple-50 border border-purple-100 text-purple-900' : isCustomer ? 'bg-white border border-slate-100 text-slate-800' : 'bg-brand-50 border border-brand-100 text-brand-900'}`}>
                            {msg.msg_type === 'image' && msg.media_url ? (
                              <a href={getArchiveMediaUrl(msg.media_url)} target="_blank" rel="noreferrer">
                                <img src={getArchiveMediaUrl(msg.media_url)} alt="聊天图片" className="max-w-[200px] max-h-[200px] rounded object-contain bg-slate-100" />
                              </a>
                            ) : (
                              <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8">
            <svg className="w-16 h-16 mb-4 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            <p>请在左侧选择一个群聊查看会话存档</p>
          </div>
        )}
      </div>

      {/* 管理弹窗 */}
      {manageVisible && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden animate-fade-in-up">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="text-lg font-bold text-slate-800">群聊管理</h3>
              <button onClick={() => setManageVisible(false)} className="text-slate-400 hover:text-slate-600 bg-white shadow-sm p-1.5 rounded-lg border border-slate-200">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6 bg-slate-50">
              {loadingDetail ? (
                <div className="text-center py-4 text-slate-500">加载中...</div>
              ) : groupDetail ? (
                <>
                  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                       基础设置
                    </h4>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-medium text-slate-500 mb-1.5 block">群名称</label>
                        <div className="flex gap-2">
                          <input type="text" className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:bg-white focus:ring-2 focus:ring-brand-500" value={newName} onChange={e => setNewName(e.target.value)} />
                          <button onClick={handleRename} className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors">修改</button>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500 mb-1.5 block">关联订单 (输入订单号如: PPT-123456)</label>
                        <div className="flex gap-2">
                          <input type="text" className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:bg-white focus:ring-2 focus:ring-brand-500" value={newOrderId} onChange={e => setNewOrderId(e.target.value)} placeholder="未关联"/>
                          <button onClick={handleAssociateOrder} className="px-4 py-2 bg-brand-500 text-white text-sm font-medium rounded-lg hover:bg-brand-600 transition-colors">关联</button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="text-sm font-bold text-slate-800">群成员 ({groupDetail.members?.length || 0})</h4>
                      <p className="text-xs text-slate-400">目前暂不支持前端踢人拉人，需到企微操作</p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {(groupDetail.members || []).map(m => {
                         const isDesigner = !!m.is_designer;
                         const isCustomer = !!m.is_customer;
                         return (
                          <div key={m.userid} className={`flex items-center gap-2 p-2 rounded-lg border ${isDesigner ? 'bg-purple-50 border-purple-100' : isCustomer ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-200'}`}>
                            <div className={`w-8 h-8 rounded shrink-0 flex items-center justify-center text-white text-xs font-bold ${isDesigner ? 'bg-purple-500' : isCustomer ? 'bg-amber-500' : 'bg-brand-500'}`}>
                               {m.name?.substring(0,2) || '未知'}
                            </div>
                            <div className="truncate">
                              <div className="text-xs font-medium text-slate-800 truncate">{m.name}</div>
                              <div className="text-[10px] text-slate-500 truncate">{isDesigner ? '设计师' : isCustomer ? '客户' : (m.type === 2 ? '外部联系人' : '内部员工')}</div>
                            </div>
                          </div>
                         )
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-4 text-slate-500">无法获取群详情</div>
              )}
            </div>
            
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex justify-end">
              <button onClick={() => setManageVisible(false)} className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-50 transition-colors shadow-sm">
                关闭
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 新建群聊弹窗 */}
      {createVisible && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[68vh] flex flex-col overflow-hidden animate-fade-in-up">
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-brand-50 to-slate-50">
              <div>
                <h3 className="text-lg font-bold text-slate-800">新建内部群聊</h3>
                <p className="text-xs text-slate-500 mt-0.5">从企微通讯录选择成员，自动创建「订单信息跟进群」</p>
              </div>
              <button onClick={() => setCreateVisible(false)} className="text-slate-400 hover:text-slate-600 bg-white shadow-sm p-1.5 rounded-lg border border-slate-200">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* 已选成员区域 */}
              <div className="px-6 pt-5 pb-3 bg-white shrink-0">
                <div className="flex items-center gap-2 mb-3">
                  <h4 className="text-sm font-bold text-slate-700">已选成员</h4>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${selectedMembers.length >= 2 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {selectedMembers.length} 人{selectedMembers.length < 2 && '（至少2人）'}
                  </span>
                </div>
                {selectedMembers.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedMembers.map(m => (
                      <span key={m.userid} className="inline-flex items-center gap-1.5 bg-brand-50 text-brand-700 text-sm pl-1.5 pr-2 py-1 rounded-lg border border-brand-200 shadow-sm">
                        <span className="w-5 h-5 rounded bg-brand-500 text-white text-[10px] flex items-center justify-center font-bold shrink-0">{m.name?.substring(0,1)}</span>
                        {m.name}
                        <button onClick={() => toggleMemberSelection(m)} className="text-brand-400 hover:text-brand-700 ml-0.5">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-400 py-2">请在下方列表中点击选择群成员</div>
                )}
              </div>

              {/* 搜索 + 成员列表 */}
              <div className="px-6 pb-5 flex-1 flex flex-col overflow-hidden">
                <div className="relative mb-4 shrink-0">
                  <input
                    type="text"
                    placeholder="输入姓名搜索企微通讯录..."
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-brand-500 focus:bg-white transition-colors"
                    value={searchMemberKeyword}
                    onChange={(e) => setSearchMemberKeyword(e.target.value)}
                  />
                  <svg className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                </div>
                
                <div className="flex-1 overflow-y-auto">
                  {searchLoading ? (
                    <div className="text-center py-8 text-slate-400 text-sm">加载中...</div>
                  ) : allMembers.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-sm">未查找到企微通讯录成员</div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      {allMembers.map(m => {
                        const isSelected = !!selectedMembers.find(sm => sm.userid === m.userid);
                        return (
                          <div
                            key={m.userid}
                            onClick={() => toggleMemberSelection(m)}
                            className={`flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer border-2 transition-all ${isSelected ? 'bg-brand-50 border-brand-400 shadow-md shadow-brand-100' : 'bg-white border-slate-100 hover:border-brand-200 hover:shadow-sm'}`}
                          >
                            <div className={`w-10 h-10 rounded-lg shrink-0 flex items-center justify-center text-white text-sm font-bold ${isSelected ? 'bg-brand-500' : m.is_employee ? 'bg-brand-400' : 'bg-slate-400'}`}>
                              {m.name?.substring(0,2)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-slate-800 truncate">{m.name}</div>
                              <div className="text-[11px] text-slate-400 truncate">{m.is_employee ? '系统员工' : '企微成员'}</div>
                            </div>
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-brand-500 border-brand-500' : 'bg-white border-slate-300'}`}>
                              {isSelected && <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <span className="text-xs text-slate-400">群名将自动生成为「订单信息跟进群-N」</span>
              <div className="flex gap-3">
                <button onClick={() => setCreateVisible(false)} className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-bold rounded-xl hover:bg-slate-50 transition-colors shadow-sm">
                  取消
                </button>
                <button 
                  onClick={handleCreateGroup} 
                  disabled={creatingGroup || selectedMembers.length < 2}
                  className="px-5 py-2.5 bg-brand-600 text-white text-sm font-bold rounded-xl hover:bg-brand-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {creatingGroup && <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" strokeWidth="4" stroke="currentColor" strokeOpacity="0.25"></circle><path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" fill="currentColor"></path></svg>}
                  确认建群（{selectedMembers.length}人）
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
