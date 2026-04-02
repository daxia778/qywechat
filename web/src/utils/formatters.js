export function formatTime(timeStr) {
  if (!timeStr) return '-';
  return new Date(timeStr).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(dateString) {
  if (!dateString) return '-';
  const d = new Date(dateString);
  // 过滤 Go 零值时间 (year <= 1)
  if (isNaN(d.getTime()) || d.getFullYear() <= 1) return '-';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return sameYear
    ? `${month}-${day} ${hh}:${mm}`
    : `${d.getFullYear()}/${month}-${day} ${hh}:${mm}`;
}

export function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d.getTime()) || d.getFullYear() <= 1) return '';
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}天前`;
  return formatDate(dateString);
}

export function formatCurrency(value) {
  if (value == null) return '0.00';
  return Number(value).toFixed(2);
}
