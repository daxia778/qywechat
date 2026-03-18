import { cn } from '../../utils/cn';

const variants = {
  success: 'bg-[#DAF8E6] text-green-900',
  warning: 'bg-[#FEF4E4] text-amber-800',
  danger: 'bg-[#FEE4E2] text-red-800',
  primary: 'bg-brand-50 text-brand-500',
  secondary: 'bg-slate-100 text-slate-500',
};

export default function Badge({ variant = 'secondary', className, children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
