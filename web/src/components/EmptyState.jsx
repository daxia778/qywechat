export default function EmptyState({ icon, title, description }) {
  return (
    <div className="flex flex-col items-center justify-center text-slate-400 py-20">
      {icon || (
        <svg className="w-12 h-12 mb-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      )}
      <p className="font-medium text-slate-600">{title || '暂无数据'}</p>
      {description && <p className="text-sm mt-0.5">{description}</p>}
    </div>
  );
}
