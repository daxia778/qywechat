import { cn } from '../../utils/cn';

export default function StatCard({
  icon,
  iconBgClass = 'bg-slate-100',
  value,
  label,
  trend,
  hoverBorderClass = 'hover:border-slate-200',
  className,
  children,
}) {
  return (
    <div
      className={cn(
        'bg-white border border-slate-200 rounded-2xl p-5 lg:p-6 group transition-all duration-200',
        'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]',
        'hover:shadow-[0_4px_16px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.03)]',
        hoverBorderClass,
        className,
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <div
          className={cn(
            'w-11 h-11 rounded-xl flex items-center justify-center transition-colors',
            iconBgClass,
          )}
        >
          {icon}
        </div>
        {trend && <div>{trend}</div>}
      </div>
      <h4 className="text-2xl lg:text-[28px] font-bold text-slate-800 font-[Outfit] tabular-nums leading-tight">
        {value}
      </h4>
      <span className="text-xs lg:text-[13px] font-medium text-slate-500 mt-1 block">
        {label}
      </span>
      {children}
    </div>
  );
}
