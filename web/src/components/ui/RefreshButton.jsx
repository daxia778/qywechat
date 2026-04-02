import { cn } from '../../utils/cn';
import Button from './Button';

export default function RefreshButton({
  onClick,
  loading = false,
  label = '刷新',
  loadingLabel = '同步中...',
  size = 'md',
  className,
}) {
  return (
    <Button
      variant="secondary"
      size={size}
      onClick={onClick}
      disabled={loading}
      className={className}
    >
      <svg
        className={cn('w-4 h-4', loading && 'animate-spin')}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      <span>{loading ? loadingLabel : label}</span>
    </Button>
  );
}
