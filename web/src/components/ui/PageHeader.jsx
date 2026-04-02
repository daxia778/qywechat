import { cn } from '../../utils/cn';

export default function PageHeader({ title, subtitle, className, children }) {
  return (
    <div className={cn('flex justify-between items-center flex-wrap gap-3', className)}>
      <div>
        <h1 className="text-[1.625rem] font-bold text-slate-800 font-[Outfit] tracking-[-0.02em] leading-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
        )}
      </div>
      {children && (
        <div className="flex items-center gap-2">{children}</div>
      )}
    </div>
  );
}
