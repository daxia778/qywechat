/**
 * MetricCard — Stripe/Linear/Vercel 风格
 * 布局：[小图标 + 标题] 同行 → 大数字主导 → pill 趋势徽章
 */
const MetricCard = ({
  title,
  value,
  currentRateVal,
  prevValue,
  icon,
  colorHex = '#434FCF',
  isCurrency = false,
  invertTrend = false,
  subtitle = null,
  formattedValue = null,
}) => {
  // 环比计算
  let growth = null;
  if (currentRateVal !== undefined && prevValue !== undefined && prevValue !== null) {
    if (prevValue === 0) {
      growth = currentRateVal > 0 ? 100 : 0;
    } else {
      growth = ((currentRateVal - prevValue) / prevValue) * 100;
    }
  }

  const isPositive = growth !== null && growth > 0;
  const isZero = growth !== null && growth === 0;
  const isGood = invertTrend ? !isPositive : isPositive;

  let trendClasses, trendIcon, trendPct, trendPeriod;
  if (growth !== null) {
    if (isZero) {
      trendClasses = 'bg-slate-100 text-slate-500';
      trendIcon = '—'; trendPct = '0%'; trendPeriod = '与上期持平';
    } else {
      trendClasses = isGood ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600';
      trendIcon = isPositive ? '↑' : '↓';
      trendPct = `${Math.abs(growth).toFixed(1)}%`;
      trendPeriod = 'vs 上期';
    }
  } else {
    trendClasses = 'bg-slate-50 text-slate-400';
    trendIcon = '·'; trendPct = '—'; trendPeriod = '暂无对比';
  }

  const displayVal = formattedValue
    ? formattedValue
    : isCurrency
    ? `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : value;

  return (
    <div
      className="group bg-white border border-black/[0.07] rounded-2xl px-6 pt-[22px] pb-5 flex flex-col shadow-[0_1px_3px_rgba(0,0,0,0.05),0_4px_12px_rgba(0,0,0,0.03)] transition-all duration-200 cursor-default hover:-translate-y-0.5 hover:shadow-[0_0_0_1.5px_var(--c-ring),0_8px_24px_var(--c-glow)]"
      style={{ '--c-ring': `${colorHex}30`, '--c-glow': `${colorHex}12` }}
    >
      {/* 第一行：小图标 + 标题 */}
      <div className="flex items-center gap-2 mb-3.5">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${colorHex}18`, color: colorHex }}
        >
          {icon}
        </div>
        <span className="text-[13px] font-medium text-slate-500 tracking-[0.01em]">
          {title}
        </span>
      </div>

      {/* 第二行：大数字（主角） */}
      <div className="font-['Outfit',sans-serif] text-2xl lg:text-[28px] font-bold text-slate-900 leading-[1.1] tracking-tight mb-4">
        {displayVal}
      </div>

      {/* 第三行：pill 趋势徽章 + 期间 + 副标题 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="inline-flex items-center gap-1.5 shrink-0">
          <span
            className={`${trendClasses} text-xs font-semibold py-[3px] px-2 rounded-full inline-flex items-center gap-0.5`}
          >
            <span className="text-[11px]">{trendIcon}</span>
            {trendPct}
          </span>
          <span className="text-xs text-slate-400">{trendPeriod}</span>
        </span>
        {subtitle && (
          <>
            <span className="text-xs text-slate-200">·</span>
            <span
              className="text-[11.5px] text-slate-400 truncate"
              title={typeof subtitle === 'string' ? subtitle : ''}
            >
              {subtitle}
            </span>
          </>
        )}
      </div>
    </div>
  );
};

export default MetricCard;
