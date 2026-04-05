export default function LoadingSpinner({ text = '加载中...' }) {
  return (
    <div className="absolute inset-0 z-10 bg-white/60 backdrop-blur-[1px] flex items-center justify-center" role="status" aria-label="加载中">
      <div className="flex flex-col items-center gap-2">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-brand-500" />
        <span className="text-xs text-slate-400">{text}</span>
      </div>
    </div>
  );
}
