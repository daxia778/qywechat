import React from 'react';

const MetricCard = ({ 
  title, 
  value, 
  currentRateVal, 
  prevValue, 
  icon, 
  progress = 0, 
  colorHex = "#10B981", 
  isCurrency = false, 
  invertTrend = false 
}) => {
  let growth = null;
  if (currentRateVal !== undefined && prevValue !== undefined && prevValue !== null) {
    if (prevValue === 0) {
      growth = currentRateVal > 0 ? 100 : 0;
    } else {
      growth = ((currentRateVal - prevValue) / prevValue) * 100;
    }
  }

  let trendIcon = null;
  let trendColor = "";
  let trendText = "";

  if (growth !== null) {
    const isPositive = growth > 0;
    const isZero = growth === 0;
    const isGood = invertTrend ? !isPositive : isPositive;
    
    if (isZero) {
      trendColor = "text-gray-500";
      trendText = "0%";
    } else {
      trendColor = isGood ? "text-[#02972f]" : "text-red-500";
      trendText = Math.abs(growth).toFixed(1) + "%";
      trendIcon = isPositive ? (
        <svg width={14} height={14} fill="currentColor" viewBox="0 0 1792 1792" xmlns="http://www.w3.org/2000/svg">
          <path d="M1408 1216q0 26-19 45t-45 19h-896q-26 0-45-19t-19-45 19-45l448-448q19-19 45-19t45 19l448 448q19 19 19 45z"></path>
        </svg>
      ) : (
        <svg width={14} height={14} fill="currentColor" viewBox="0 0 1792 1792" xmlns="http://www.w3.org/2000/svg" style={{transform: "rotate(180deg)"}}>
          <path d="M1408 1216q0 26-19 45t-45 19h-896q-26 0-45-19t-19-45 19-45l448-448q19-19 45-19t45 19l448 448q19 19 19 45z"></path>
        </svg>
      );
    }
  }

  return (
    <div className="p-5 bg-white rounded-[20px] border-2 border-[#E5E7EB] hover:border-[#C4B5FD] hover:translate-y-[-2px] transition-all duration-200" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.03)' }}>
      <div className="flex items-center">
        <span 
          className="relative w-10 h-10 rounded-full flex items-center justify-center text-white" 
          style={{ backgroundColor: colorHex }}
        >
          {icon}
        </span>
        <p className="ml-3 text-gray-800 text-lg font-bold whitespace-nowrap">
          {title}
        </p>
        {growth !== null && (
          <p className={`ml-auto font-semibold flex items-center gap-0.5 text-[13px] ${trendColor}`}>
            {trendIcon} {trendText}
          </p>
        )}
      </div>
      <div className="flex flex-col justify-start mt-6">
        <p className="mb-5 text-[#1F2937] text-[32px] leading-[36px] font-bold text-left font-[Outfit] tabular-nums tracking-tight">
          {isCurrency ? `¥${Number(value).toFixed(2)}` : value}
        </p>
        <div className="relative bg-gray-200 w-full h-2 rounded-sm overflow-hidden">
          <div 
            className="absolute top-0 left-0 h-full rounded-sm transition-all duration-500" 
            style={{ width: `${Math.min(Math.max(progress, 0), 100)}%`, backgroundColor: colorHex }}
          ></div>
        </div>
      </div>
    </div>
  );
};

export default MetricCard;
