import { memo } from 'react';
import { Link } from 'react-router-dom';
import { STATUS_MAP, STATUS_BADGE_MAP, BADGE_VARIANT_CLASSES } from '../utils/constants';
import { formatTime } from '../utils/formatters';

/** 从通知内容中提取订单号 */
function extractOrderSn(notification) {
  // 尝试从 title/content 匹配订单号 (数字-数字 格式 或纯长数字)
  const text = (notification.title || '') + ' ' + (notification.content || '');
  const match = text.match(/(\d{6,}-\d{10,}|\d{15,})/);
  return match ? match[1] : null;
}

/** 从通知内容中提取状态 */
function extractStatus(notification) {
  const content = notification.content || '';
  for (const [key, label] of Object.entries(STATUS_MAP)) {
    if (content.includes(label) || content.includes(key)) {
      return key;
    }
  }
  return null;
}

/**
 * 通知条目内嵌的订单预览卡片
 * 解析通知内容中的订单号和状态，展示为可点击的小卡片
 */
const OrderPreviewCard = memo(function OrderPreviewCard({ notification }) {
  const orderSn = extractOrderSn(notification);
  if (!orderSn) return null;

  const status = extractStatus(notification);
  const statusLabel = status ? STATUS_MAP[status] : null;
  const badgeVariant = status ? STATUS_BADGE_MAP[status] : 'secondary';

  return (
    <Link
      to={`/orders?keyword=${orderSn}`}
      onClick={(e) => e.stopPropagation()}
      className="mt-2 flex items-center gap-2.5 p-2 bg-white border border-slate-100 rounded-lg hover:border-brand-200 hover:shadow-sm transition-all group/card no-underline"
    >
      {/* 订单图标 */}
      <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0 group-hover/card:bg-brand-100 transition-colors">
        <svg className="w-4 h-4 text-brand-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
        </svg>
      </div>

      {/* 订单信息 */}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold text-slate-700 font-mono truncate">
          {orderSn}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {statusLabel && (
            <span className={`inline-flex items-center px-1.5 py-0 rounded text-[9px] font-semibold leading-[16px] ${BADGE_VARIANT_CLASSES[badgeVariant] || BADGE_VARIANT_CLASSES.secondary}`}>
              {statusLabel}
            </span>
          )}
          <span className="text-[10px] text-slate-400">点击查看</span>
        </div>
      </div>

      {/* 箭头 */}
      <svg className="w-3.5 h-3.5 text-slate-300 shrink-0 group-hover/card:text-brand-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
});

export default OrderPreviewCard;
