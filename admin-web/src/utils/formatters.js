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
  return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function formatCurrency(value) {
  if (value == null) return '0.00';
  return Number(value).toFixed(2);
}
