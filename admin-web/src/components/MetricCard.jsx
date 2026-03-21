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

  let trendBg, trendColor, trendIcon, trendPct, trendPeriod;
  if (growth !== null) {
    if (isZero) {
      trendBg = '#f1f5f9'; trendColor = '#64748b';
      trendIcon = '—'; trendPct = '0%'; trendPeriod = '与上期持平';
    } else {
      trendBg = isGood ? '#ecfdf5' : '#fef2f2';
      trendColor = isGood ? '#059669' : '#dc2626';
      trendIcon = isPositive ? '↑' : '↓';
      trendPct = `${Math.abs(growth).toFixed(1)}%`;
      trendPeriod = 'vs 上期';
    }
  } else {
    trendBg = '#f8fafc'; trendColor = '#94a3b8';
    trendIcon = '·'; trendPct = '—'; trendPeriod = '暂无对比';
  }

  const displayVal = formattedValue
    ? formattedValue
    : isCurrency
    ? `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : value;

  const iconBg = colorHex + '18';

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid rgba(0,0,0,0.07)',
        borderRadius: '16px',
        padding: '22px 24px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.03)',
        transition: 'box-shadow 0.2s, transform 0.2s, border-color 0.2s',
        cursor: 'default',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = `0 0 0 1.5px ${colorHex}30, 0 8px 24px ${colorHex}12`;
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.03)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* 第一行：小图标 + 标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '9px',
            backgroundColor: iconBg,
            color: colorHex,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <span
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: '#6b7280',
            fontFamily: 'Inter, sans-serif',
            letterSpacing: '0.01em',
          }}
        >
          {title}
        </span>
      </div>

      {/* 第二行：大数字（主角） */}
      <div
        style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: 'clamp(24px, 3vw, 30px)',
          fontWeight: 700,
          color: '#111827',
          lineHeight: 1.1,
          letterSpacing: '-0.025em',
          marginBottom: '16px',
        }}
      >
        {displayVal}
      </div>

      {/* 第三行：pill 趋势徽章 + 期间 + 副标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span
          style={{
            backgroundColor: trendBg,
            color: trendColor,
            fontSize: '12px',
            fontWeight: 600,
            padding: '3px 8px',
            borderRadius: '999px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
            fontFamily: 'Inter, sans-serif',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: '11px' }}>{trendIcon}</span>
          {trendPct}
        </span>
        <span style={{ fontSize: '12px', color: '#9ca3af', fontFamily: 'Inter, sans-serif' }}>
          {trendPeriod}
        </span>
        {subtitle && (
          <>
            <span style={{ color: '#e5e7eb', fontSize: '12px' }}>·</span>
            <span
              style={{
                fontSize: '11.5px',
                color: '#9ca3af',
                fontFamily: 'Inter, sans-serif',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
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
