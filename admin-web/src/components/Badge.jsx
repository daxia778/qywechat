import { STATUS_BADGE_MAP } from '../utils/constants';

const badgeClasses = {
  success: 'bg-[#DAF8E6] text-[#14532D]',
  warning: 'bg-[#FEF4E4] text-[#92400E]',
  danger: 'bg-[#FEE4E2] text-[#991B1B]',
  primary: 'bg-[#EFF4FF] text-[#465FFF]',
  secondary: 'bg-[#F1F5F9] text-[#64748B]',
};

export default function Badge({ type, children, className = '' }) {
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide inline-flex items-center gap-1 ${badgeClasses[type] || badgeClasses.secondary} ${className}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status, label }) {
  const type = STATUS_BADGE_MAP[status] || 'secondary';
  return <Badge type={type}>{label}</Badge>;
}
