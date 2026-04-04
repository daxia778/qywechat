import { useState, useCallback, useEffect } from 'react';
import { useToast } from '../hooks/useToast';
import { usePolling } from '../hooks/usePolling';
import { getTeamRoster } from '../api/admin';
import { fmtYuan } from '../utils/constants';
import {
  Users, TrendingUp, DollarSign, AlertTriangle,
  RefreshCw, Loader2, ArrowUpDown, Phone, Headphones,
  BarChart3, Award, Hash,
} from 'lucide-react';

const ROLE_LABEL = { sales: '谈单客服', follow: '跟单客服' };
const ROLE_COLOR = {
  sales:  { bg: '#DBEAFE', text: '#1D4ED8', border: '#93C5FD' },
  follow: { bg: '#F3E8FF', text: '#7C3AED', border: '#C4B5FD' },
};

export default function TeamPage() {
  const { toast } = useToast();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortKey, setSortKey] = useState('total_orders');
  const [sortDir, setSortDir] = useState('desc');
  const [roleFilter, setRoleFilter] = useState('all');

  const fetch = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await getTeamRoster();
      setStaff(res.data.data || []);
      if (manual) toast('绩效数据已刷新', 'success');
    } catch (err) {
      if (manual) toast('加载失败: ' + err.message, 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => { fetch(); }, [fetch]);
  usePolling(fetch, 30000);

  const filtered = staff.filter(s => roleFilter === 'all' || s.role === roleFilter);
  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortKey] ?? 0, vb = b[sortKey] ?? 0;
    return sortDir === 'desc' ? vb - va : va - vb;
  });

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // KPI aggregations
  const totalStaff = staff.length;
  const onlineCount = staff.filter(s => s.is_online).length;
  const totalMonthOrders = staff.reduce((s, m) => s + (m.month_orders || 0), 0);
  const totalMonthRevenue = staff.reduce((s, m) => s + (m.month_revenue || 0), 0);

  const SortHeader = ({ label, field, style }) => (
    <th
      onClick={() => toggleSort(field)}
      style={{ ...thStyle, cursor: 'pointer', userSelect: 'none', ...style }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        <ArrowUpDown className="w-3 h-3" style={{ color: sortKey === field ? '#434FCF' : '#CBD5E1' }} />
      </span>
    </th>
  );

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', margin: 0, fontFamily: "'Outfit', sans-serif", display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 14, background: 'linear-gradient(135deg, #434FCF, #2834B7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BarChart3 className="w-5 h-5" style={{ color: '#fff' }} />
            </div>
            客服绩效大盘
          </h1>
          <p style={{ color: '#64748B', fontSize: 14, margin: '6px 0 0 54px' }}>
            谈单客服 & 跟单客服 全量绩效追踪
          </p>
        </div>
        <button
          onClick={() => fetch(true)}
          disabled={refreshing}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px',
            fontSize: 14, fontWeight: 700, color: '#434FCF',
            background: '#F0F0FF', border: '2px solid #E0E0FF',
            borderRadius: 14, cursor: 'pointer',
            transition: 'all 0.15s', opacity: refreshing ? 0.6 : 1,
          }}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? '刷新中...' : '刷新数据'}
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 }}>
        <KpiCard icon={<Users className="w-5 h-5" />} label="客服总数" value={totalStaff} color="#434FCF" />
        <KpiCard icon={<Headphones className="w-5 h-5" />} label="当前在线" value={onlineCount} color="#10B981" />
        <KpiCard icon={<Hash className="w-5 h-5" />} label="本月订单" value={totalMonthOrders} color="#F59E0B" />
        <KpiCard icon={<DollarSign className="w-5 h-5" />} label="本月营收" value={`¥${fmtYuan(totalMonthRevenue)}`} color="#EF4444" />
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          { key: 'all', label: '全部' },
          { key: 'sales', label: '谈单客服' },
          { key: 'follow', label: '跟单客服' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setRoleFilter(t.key)}
            style={{
              padding: '7px 18px', fontSize: 13, fontWeight: 600,
              borderRadius: 10, border: '1.5px solid',
              cursor: 'pointer', transition: 'all 0.15s',
              ...(roleFilter === t.key
                ? { background: '#434FCF', color: '#fff', borderColor: '#434FCF' }
                : { background: '#fff', color: '#64748B', borderColor: '#E2E8F0' }),
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#434FCF', margin: '0 auto' }} />
          <p style={{ color: '#94A3B8', marginTop: 12 }}>加载中...</p>
        </div>
      ) : sorted.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#94A3B8' }}>
          <Users className="w-12 h-12" style={{ margin: '0 auto 12px', opacity: 0.3 }} />
          <p style={{ fontSize: 15 }}>暂无客服数据</p>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 20, border: '1px solid rgba(0,0,0,0.06)', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '2px solid #F1F5F9' }}>
                  <th style={{ ...thStyle, textAlign: 'left', paddingLeft: 24 }}>客服</th>
                  <th style={thStyle}>角色</th>
                  <th style={thStyle}>状态</th>
                  <SortHeader label="总订单" field="total_orders" />
                  <SortHeader label="进行中" field="designing_orders" />
                  <SortHeader label="已完成" field="completed_orders" />
                  <SortHeader label="退款率" field="refund_rate" />
                  <SortHeader label="本月单量" field="month_orders" />
                  <SortHeader label="本月营收" field="month_revenue" />
                  <SortHeader label="累计佣金" field="total_commission" />
                </tr>
              </thead>
              <tbody>
                {sorted.map(m => {
                  const rc = ROLE_COLOR[m.role] || ROLE_COLOR.sales;
                  return (
                    <tr
                      key={m.id}
                      style={{ borderBottom: '1px solid #F5F5F5', transition: 'background 0.12s' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#FAFBFF'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {/* Name */}
                      <td style={{ ...tdStyle, paddingLeft: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ position: 'relative' }}>
                            <div style={{
                              width: 36, height: 36, borderRadius: 10,
                              background: `linear-gradient(135deg, ${getAvatarColor(m.name)})`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: '#fff', fontSize: 14, fontWeight: 800, flexShrink: 0,
                            }}>
                              {(m.name || '?').charAt(0)}
                            </div>
                            {/* online dot */}
                            <div style={{
                              position: 'absolute', bottom: -1, right: -1,
                              width: 10, height: 10, borderRadius: '50%',
                              border: '2px solid #fff',
                              background: m.is_online ? '#10B981' : '#CBD5E1',
                            }} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 14 }}>{m.name}</div>
                            <div style={{ fontSize: 11, color: '#94A3B8' }}>{m.username}</div>
                          </div>
                        </div>
                      </td>
                      {/* Role */}
                      <td style={tdStyle}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                          background: rc.bg, color: rc.text, border: `1px solid ${rc.border}`,
                        }}>
                          {ROLE_LABEL[m.role] || m.role}
                        </span>
                      </td>
                      {/* Online */}
                      <td style={tdStyle}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 12, fontWeight: 600,
                          color: m.is_online ? '#059669' : '#94A3B8',
                        }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: m.is_online ? '#10B981' : '#CBD5E1',
                            ...(m.is_online ? { boxShadow: '0 0 6px rgba(16,185,129,0.5)' } : {}),
                          }} />
                          {m.is_online ? '在线' : '离线'}
                        </span>
                      </td>
                      {/* Total orders */}
                      <td style={{ ...tdStyle, fontWeight: 800, color: '#0F172A', fontSize: 16 }}>{m.total_orders}</td>
                      {/* Designing */}
                      <td style={tdStyle}>
                        {m.designing_orders > 0 ? (
                          <span style={{ background: '#DBEAFE', color: '#1D4ED8', fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 999 }}>{m.designing_orders}</span>
                        ) : <span style={{ color: '#CBD5E1' }}>0</span>}
                      </td>
                      {/* Completed */}
                      <td style={{ ...tdStyle, color: '#059669', fontWeight: 600 }}>{m.completed_orders}</td>
                      {/* Refund rate */}
                      <td style={tdStyle}>
                        <RateBar value={m.refund_rate || 0} color={m.refund_rate > 15 ? '#EF4444' : '#F59E0B'} warn={m.refund_rate > 15} />
                      </td>
                      {/* Month orders */}
                      <td style={{ ...tdStyle, fontWeight: 700, color: '#0F172A' }}>{m.month_orders}</td>
                      {/* Month revenue */}
                      <td style={{ ...tdStyle, fontWeight: 700, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>¥{fmtYuan(m.month_revenue)}</td>
                      {/* Commission */}
                      <td style={{ ...tdStyle, fontWeight: 600, color: '#7C3AED', fontVariantNumeric: 'tabular-nums' }}>¥{fmtYuan(m.total_commission)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sub Components ── */

function KpiCard({ icon, label, value, color }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
      borderRadius: 18, padding: '20px 22px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 14,
        background: `${color}15`, display: 'flex',
        alignItems: 'center', justifyContent: 'center', color,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', fontVariantNumeric: 'tabular-nums', fontFamily: "'Outfit', sans-serif" }}>{value}</div>
      </div>
    </div>
  );
}

function RateBar({ value, color, warn }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 80 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#F1F5F9', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(value, 100)}%`, height: '100%', borderRadius: 3, background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 38, textAlign: 'right', display: 'flex', alignItems: 'center', gap: 2 }}>
        {warn && <AlertTriangle className="w-3 h-3" />}
        {(value || 0).toFixed(1)}%
      </span>
    </div>
  );
}

/* ── Style Constants ── */

const thStyle = {
  padding: '12px 14px', fontSize: 11, fontWeight: 700,
  color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em',
  textAlign: 'center', whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '14px 14px', textAlign: 'center', whiteSpace: 'nowrap',
};

function getAvatarColor(name) {
  const colors = [
    '#434FCF, #6366F1', '#EC4899, #F43F5E', '#10B981, #14B8A6',
    '#F59E0B, #EF4444', '#3B82F6, #6366F1', '#8B5CF6, #EC4899',
  ];
  const code = [...(name || '')].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return colors[code % colors.length];
}
