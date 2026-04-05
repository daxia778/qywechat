import { forwardRef } from 'react';
import { cn } from '../../utils/cn';

const variants = {
  primary:
    'bg-brand-500 text-white border-brand-500 shadow-[0_1px_2px_rgba(70,95,255,0.2)] hover:bg-brand-600 hover:border-brand-600 hover:shadow-[0_2px_6px_rgba(70,95,255,0.3)]',
  secondary:
    'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300',
  danger:
    'bg-white text-red-500 border-red-200 hover:bg-red-50 hover:border-red-500',
  success:
    'bg-white text-emerald-600 border-emerald-300 hover:bg-emerald-50 hover:border-emerald-500',
  ghost:
    'bg-transparent text-slate-500 border-transparent hover:bg-slate-100 hover:text-slate-700',
};

const sizes = {
  xs: 'px-2 py-1 text-[11px] gap-1',
  sm: 'px-3 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2.5 text-sm gap-1.5',
};

const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', className, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center font-semibold rounded-xl border cursor-pointer transition-all whitespace-nowrap leading-snug',
        'active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
});

export default Button;
