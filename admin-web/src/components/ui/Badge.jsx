import { cn } from '../../utils/cn';

const variants = {
  success: 'bg-success-bg text-green-900',
  warning: 'bg-warning-bg text-amber-800',
  danger: 'bg-danger-bg text-red-800',
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
