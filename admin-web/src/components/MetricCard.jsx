/**
 * MetricCard — 参考营收分析页设计
 * 布局：左上角大图标块 + 右侧趋势 → 下方大数字 + 标签
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

  let trendBg, trendColor, trendSymbol, trendText;
  if (growth !== null) {
    const isPositive = growth > 0;
    const isZero = growth === 0;
    const isGood = invertTrend ? !isPositive : isPositive;
    if (isZero) {
      trendBg = '#f1f5f9'; trendColor = '#64748b'; trendSymbol = '—'; trendText = '0%';
    } else {
      trendBg = isGood ? '#d1fae5' : '#fee2e2';
      trendColor = isGood ? '#065f46' : '#991b1b';
      trendSymbol = isPositive ? '↑' : '↓';
      trendText = `${Math.abs(growth).toFixed(1)}% vs 上期`;
    }
  }

  // 显示值
  const displayVal = formattedValue
    ? formattedValue
    : isCurrency
    ? `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : value;

  // 图标背景色：colorHex + 18% 透明度
  const iconBg = colorHex + '2E';

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid rgba(0,0,0,0.06)',
        borderRadius: '18px',
        padding: '22px 22px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
        transition: 'box-shadow 0.2s, transform 0.2s, border-color 0.2s',
        cursor: 'default',
        minHeight: '148px',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.09)';
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.borderColor = colorHex + '33';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '0 1px 6px rgba(0,0,0,0.04)';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.borderColor = 'rgba(0,0,0,0.06)';
      }}
    >
      {/* 第一行：图标（左）+ 趋势徽章（右） */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* 图标方块 */}
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '14px',
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

        {/* 趋势徽章 */}
        {growth !== null && (
          <span
            style={{
              backgroundColor: trendBg,
              color: trendColor,
              fontSize: '12px',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: '8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              whiteSpace: 'nowrap',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            <span style={{ fontSize: '11px', fontWeight: 700 }}>{trendSymbol}</span>
            {trendText}
          </span>
        )}
      </div>

      {/* 第二行：大数字 + 标签 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: '28px',
            fontWeight: 700,
            color: '#1d1d1f',
            lineHeight: 1.15,
            letterSpacing: '-0.02em',
          }}
        >
          {displayVal}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              fontSize: '13px',
              color: '#8e8e93',
              fontWeight: 500,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            {title}
          </span>
          {subtitle && (
            <span
              style={{
                fontSize: '11px',
                color: '#aeaeb2',
                fontFamily: 'Inter, sans-serif',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '160px',
              }}
              title={typeof subtitle === 'string' ? subtitle : ''}
            >
              · {subtitle}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default MetricCard;
