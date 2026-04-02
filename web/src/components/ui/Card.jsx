import { cn } from '../../utils/cn';

export function Card({ className, children, ...props }) {
  return (
    <div
      className={cn(
        'bg-white border border-slate-200 rounded-2xl',
        'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]',
        'transition-shadow duration-200 hover:shadow-[0_4px_16px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.03)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, title, subtitle, children }) {
  return (
    <div
      className={cn(
        'px-5 lg:px-7 py-5 border-b border-slate-200 flex items-center justify-between',
        className,
      )}
    >
      <div>
        <h2 className="font-bold text-slate-800 text-lg font-[Outfit]">{title}</h2>
        {subtitle && (
          <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}
