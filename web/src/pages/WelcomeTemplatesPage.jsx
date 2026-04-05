import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import client from '../api/client';
import { useToast } from '../hooks/useToast';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/EmptyState';
import ConfirmModal from '../components/ConfirmModal';
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  Power,
  Image,
  Link2,
  X,
  Loader2,
  MessageSquareText,
  Tag,
  FileText,
  ChevronDown,
} from 'lucide-react';

const EMPTY_FORM = {
  name: '',
  content: '',
  attachment_type: '',
  attachment_media_id: '',
  link_title: '',
  link_desc: '',
  link_url: '',
  link_pic_url: '',
  state: '',
  is_default: false,
};

export default function WelcomeTemplatesPage() {
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [defaultingId, setDefaultingId] = useState(null);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      const res = await client.get('/admin/welcome_templates');
      setItems(res.data?.items || res.data?.data || []);
    } catch (err) {
      toast(err.displayMessage || '加载欢迎语模板失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      name: item.name || '',
      content: item.content || '',
      attachment_type: item.attachment_type || '',
      attachment_media_id: item.attachment_media_id || '',
      link_title: item.link_title || '',
      link_desc: item.link_desc || '',
      link_url: item.link_url || '',
      link_pic_url: item.link_pic_url || '',
      state: item.state || '',
      is_default: !!item.is_default,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const handleField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast('请输入模板名称', 'warning');
      return;
    }
    if (!form.content.trim()) {
      toast('请输入消息内容', 'warning');
      return;
    }
    try {
      setSubmitting(true);
      const payload = { ...form };
      if (!payload.attachment_type) {
        payload.attachment_media_id = '';
        payload.link_title = '';
        payload.link_desc = '';
        payload.link_url = '';
        payload.link_pic_url = '';
      }
      if (editing) {
        await client.put(`/admin/welcome_templates/${editing.id}`, payload);
        toast('模板已更新', 'success');
      } else {
        await client.post('/admin/welcome_templates', payload);
        toast('模板已创建', 'success');
      }
      closeModal();
      fetchList();
    } catch (err) {
      toast(err.displayMessage || '操作失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleEnabled = async (item) => {
    try {
      setTogglingId(item.id);
      await client.put(`/admin/welcome_templates/${item.id}`, {
        ...item,
        is_enabled: !item.is_enabled,
      });
      toast(item.is_enabled ? '已停用' : '已启用', 'success');
      fetchList();
    } catch (err) {
      toast(err.displayMessage || '操作失败', 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const handleSetDefault = async (item) => {
    try {
      setDefaultingId(item.id);
      await client.put(`/admin/welcome_templates/${item.id}`, {
        ...item,
        is_default: true,
      });
      toast('已设为默认模板', 'success');
      fetchList();
    } catch (err) {
      toast(err.displayMessage || '操作失败', 'error');
    } finally {
      setDefaultingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await client.delete(`/admin/welcome_templates/${deleteTarget.id}`);
      toast('模板已删除', 'success');
      setDeleteTarget(null);
      fetchList();
    } catch (err) {
      toast(err.displayMessage || '删除失败', 'error');
    }
  };

  const attachmentLabel = (type) => {
    if (type === 'image') return '图片';
    if (type === 'link') return '链接';
    return null;
  };

  const previewContent = (text) => {
    if (!text) return '';
    return text.length > 100 ? text.slice(0, 100) + '...' : text;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="欢迎语模板管理" subtitle="管理客户添加企微后的自动欢迎消息">
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4" />
          新建模板
        </Button>
      </PageHeader>

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-10 h-10 rounded-full border-[3px] border-slate-200 border-t-[#434FCF] animate-spin" />
          <p className="text-sm text-slate-400 mt-4">加载中...</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <EmptyState
            icon={<MessageSquareText className="w-12 h-12 text-slate-300 mb-3" strokeWidth={1.5} />}
            title="暂无欢迎语模板"
            description="创建欢迎语模板，客户添加企微时自动发送"
          />
          <Button className="mt-4" onClick={openCreate}>
            <Plus className="w-4 h-4" />
            创建第一个模板
          </Button>
        </div>
      ) : (
        <>
          {/* Stats bar */}
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <MessageSquareText className="w-4 h-4 text-slate-400" />
            共 <span className="font-semibold text-slate-700">{items.length}</span> 个模板
            {items.filter((i) => i.is_enabled).length > 0 && (
              <span className="text-slate-400">
                ，{items.filter((i) => i.is_enabled).length} 个启用中
              </span>
            )}
          </div>

          {/* Card Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="group bg-white rounded-2xl border border-black/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_8px_32px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)] hover:-translate-y-0.5 transition-all duration-200"
                style={{ animation: `fadeInUp 0.35s cubic-bezier(0.16,1,0.3,1) ${idx * 0.05}s both` }}
              >
                <div className="p-5">
                  {/* Header: name + badges */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-slate-800 font-[Outfit] tracking-tight truncate">
                        {item.name}
                      </h3>
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {item.is_default && (
                        <Badge variant="primary" className="text-[11px] px-2 py-0.5">
                          <Star className="w-3 h-3" />
                          默认
                        </Badge>
                      )}
                      <div
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${
                          item.is_enabled
                            ? 'bg-emerald-50 border-emerald-100'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${
                            item.is_enabled ? 'bg-emerald-500' : 'bg-slate-400'
                          }`}
                        />
                        <span
                          className={`text-[11px] font-semibold ${
                            item.is_enabled ? 'text-emerald-600' : 'text-slate-500'
                          }`}
                        >
                          {item.is_enabled ? '启用' : '停用'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Content preview */}
                  <div className="mb-3 bg-slate-50/80 rounded-xl px-3.5 py-3 border border-slate-100/60">
                    <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap break-all">
                      {previewContent(item.content)}
                    </p>
                  </div>

                  {/* Tags: attachment + state */}
                  <div className="flex flex-wrap items-center gap-1.5 mb-3">
                    {attachmentLabel(item.attachment_type) && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-[11px] text-slate-500 font-medium">
                        {item.attachment_type === 'image' ? (
                          <Image className="w-3 h-3" />
                        ) : (
                          <Link2 className="w-3 h-3" />
                        )}
                        {attachmentLabel(item.attachment_type)}
                      </span>
                    )}
                    {item.state && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#434FCF]/[0.06] text-[11px] text-[#434FCF] font-medium">
                        <Tag className="w-3 h-3" />
                        {item.state}
                      </span>
                    )}
                  </div>

                  {/* Divider + actions */}
                  <div className="border-t border-slate-100 pt-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => openEdit(item)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#434FCF] bg-[#434FCF]/[0.04] hover:bg-[#434FCF]/[0.08] border border-[#434FCF]/10 hover:border-[#434FCF]/20 transition-all duration-150 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        编辑
                      </button>
                      <button
                        onClick={() => handleToggleEnabled(item)}
                        disabled={togglingId === item.id}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-150 cursor-pointer disabled:opacity-50 ${
                          item.is_enabled
                            ? 'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100'
                            : 'text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                        }`}
                      >
                        {togglingId === item.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Power className="w-3.5 h-3.5" />
                        )}
                        {item.is_enabled ? '停用' : '启用'}
                      </button>
                      {!item.is_default && (
                        <button
                          onClick={() => handleSetDefault(item)}
                          disabled={defaultingId === item.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-500 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-slate-300 transition-all duration-150 cursor-pointer disabled:opacity-50"
                        >
                          {defaultingId === item.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Star className="w-3.5 h-3.5" />
                          )}
                          设默认
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteTarget(item)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-500 bg-red-50/60 hover:bg-red-100 border border-red-200/60 hover:border-red-300 transition-all duration-150 cursor-pointer ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Create/Edit Modal */}
      {showModal &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeModal();
            }}
          >
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" style={{ animation: 'fadeInUp 0.2s ease both' }} />
            <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.12)] border border-black/[0.06] animate-modal-in">
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 font-[Outfit]">
                    {editing ? '编辑模板' : '新建模板'}
                  </h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {editing ? '修改欢迎语模板内容及配置' : '创建一个新的欢迎语模板'}
                  </p>
                </div>
                <button
                  onClick={closeModal}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
                {/* Name */}
                <div>
                  <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                    模板名称
                    <span className="text-red-400 text-xs">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => handleField('name', e.target.value)}
                    placeholder="如: 默认欢迎语、活动欢迎语..."
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#434FCF]/15 focus:border-[#434FCF]/40 focus:bg-white transition-all"
                  />
                </div>

                {/* Content */}
                <div>
                  <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
                    <MessageSquareText className="w-3.5 h-3.5 text-slate-400" />
                    消息内容
                    <span className="text-red-400 text-xs">*</span>
                  </label>
                  <textarea
                    value={form.content}
                    onChange={(e) => handleField('content', e.target.value)}
                    placeholder={"你好 {{客户昵称}}，我是 {{员工姓名}}，很高兴为你服务！"}
                    rows="4"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#434FCF]/15 focus:border-[#434FCF]/40 focus:bg-white transition-all resize-none"
                  />
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                    支持变量：<code className="px-1 py-0.5 bg-slate-100 rounded text-[#434FCF] font-mono">{'{{客户昵称}}'}</code>
                    <code className="px-1 py-0.5 bg-slate-100 rounded text-[#434FCF] font-mono ml-1">{'{{员工姓名}}'}</code>
                  </p>
                </div>

                {/* Attachment Type */}
                <div>
                  <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
                    <Image className="w-3.5 h-3.5 text-slate-400" />
                    附件类型
                    <span className="text-xs font-normal text-slate-400 ml-1">可选</span>
                  </label>
                  <div className="relative">
                    <select
                      value={form.attachment_type}
                      onChange={(e) => handleField('attachment_type', e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm focus:outline-none focus:ring-2 focus:ring-[#434FCF]/15 focus:border-[#434FCF]/40 focus:bg-white transition-all appearance-none cursor-pointer"
                    >
                      <option value="">无附件</option>
                      <option value="image">图片</option>
                      <option value="link">链接</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                {/* Image fields */}
                {form.attachment_type === 'image' && (
                  <div className="pl-4 border-l-2 border-[#434FCF]/15">
                    <label className="text-sm font-semibold text-slate-700 mb-2 block">Media ID</label>
                    <input
                      type="text"
                      value={form.attachment_media_id}
                      onChange={(e) => handleField('attachment_media_id', e.target.value)}
                      placeholder="企微素材 Media ID"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#434FCF]/15 focus:border-[#434FCF]/40 focus:bg-white transition-all"
                    />
                  </div>
                )}

                {/* Link fields */}
                {form.attachment_type === 'link' && (
                  <div className="pl-4 border-l-2 border-[#434FCF]/15 space-y-4">
                    <div>
                      <label className="text-sm font-semibold text-slate-700 mb-2 block">链接标题</label>
                      <input
                        type="text"
                        value={form.link_title}
                        onChange={(e) => handleField('link_title', e.target.value)}
                        placeholder="链接卡片标题"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#434FCF]/15 focus:border-[#434FCF]/40 focus:bg-white transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700 mb-2 block">链接描述</label>
                      <input
                        type="text"
                        value={form.link_desc}
                        onChange={(e) => handleField('link_desc', e.target.value)}
                        placeholder="链接卡片描述文字"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#434FCF]/15 focus:border-[#434FCF]/40 focus:bg-white transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700 mb-2 block">链接 URL</label>
                      <input
                        type="url"
                        value={form.link_url}
                        onChange={(e) => handleField('link_url', e.target.value)}
                        placeholder="https://..."
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#434FCF]/15 focus:border-[#434FCF]/40 focus:bg-white transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-semibold text-slate-700 mb-2 block">封面图 URL</label>
                      <input
                        type="url"
                        value={form.link_pic_url}
                        onChange={(e) => handleField('link_pic_url', e.target.value)}
                        placeholder="https://... (可选)"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#434FCF]/15 focus:border-[#434FCF]/40 focus:bg-white transition-all"
                      />
                    </div>
                  </div>
                )}

                {/* State */}
                <div>
                  <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
                    <Tag className="w-3.5 h-3.5 text-slate-400" />
                    渠道 State
                    <span className="text-xs font-normal text-slate-400 ml-1">可选</span>
                  </label>
                  <input
                    type="text"
                    value={form.state}
                    onChange={(e) => handleField('state', e.target.value)}
                    placeholder="匹配「联系我」渠道标识，留空则不限"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50/50 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#434FCF]/15 focus:border-[#434FCF]/40 focus:bg-white transition-all"
                  />
                  <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                    设置后仅在对应渠道添加时使用此模板
                  </p>
                </div>

                {/* Is Default */}
                <div className="flex items-center justify-between bg-slate-50/80 rounded-xl px-4 py-3 border border-slate-100/60">
                  <div>
                    <span className="text-sm font-semibold text-slate-700">设为默认模板</span>
                    <p className="text-xs text-slate-400 mt-0.5">未匹配到渠道时使用此模板</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleField('is_default', !form.is_default)}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 cursor-pointer ${
                      form.is_default ? 'bg-[#434FCF]' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                        form.is_default ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
                <Button variant="secondary" onClick={closeModal}>
                  取消
                </Button>
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {submitting ? '保存中...' : editing ? '保存修改' : '创建模板'}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Delete Confirm Modal */}
      <ConfirmModal
        visible={!!deleteTarget}
        title="删除欢迎语模板"
        message={`确定要删除模板「${deleteTarget?.name || ''}」吗？删除后不可恢复。`}
        type="danger"
        confirmText="确认删除"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
