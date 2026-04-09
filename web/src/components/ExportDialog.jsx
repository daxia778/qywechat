import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { listEmployees, exportExcel, exportOrdersCSV } from '../api/admin';

const QUICK_OPTIONS = [
  { key: 'thisWeek', label: '本周' },
  { key: 'thisMonth', label: '本月' },
  { key: 'lastMonth', label: '上月' },
  { key: 'last30', label: '近30天' },
  { key: 'last90', label: '近90天' },
  { key: 'custom', label: '自定义' },
];

const ROLE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'sales', label: '谈单客服' },
  { value: 'designer', label: '设计师' },
  { value: 'follow', label: '跟单客服' },
];

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'PENDING', label: '待处理' },
  { value: 'DESIGNING', label: '设计中' },
  { value: 'REVISION', label: '修改中' },
  { value: 'AFTER_SALE', label: '售后中' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'REFUNDED', label: '已退款' },
];

const getQuickRange = (key) => {
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  switch (key) {
    case 'thisWeek': {
      const d = new Date(today);
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      return { start: fmt(d), end: fmt(today) };
    }
    case 'thisMonth':
      return { start: fmt(today).slice(0, 7) + '-01', end: fmt(today) };
    case 'lastMonth': {
      const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: fmt(d), end: fmt(e) };
    }
    case 'last30': {
      const d = new Date(today);
      d.setDate(d.getDate() - 30);
      return { start: fmt(d), end: fmt(today) };
    }
    case 'last90': {
      const d = new Date(today);
      d.setDate(d.getDate() - 90);
      return { start: fmt(d), end: fmt(today) };
    }
    default:
      return null;
  }
};

export default function ExportDialog({ visible, onClose }) {
  const generatedId = useId();
  const titleId = `export-dialog-title-${generatedId}`;
  const modalRef = useRef(null);
  const previousActiveElement = useRef(null);
  const employeeDropdownRef = useRef(null);

  // Form state
  const [quickKey, setQuickKey] = useState('thisMonth');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [employees, setEmployees] = useState([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeDropdownOpen, setEmployeeDropdownOpen] = useState(false);
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [format, setFormat] = useState('excel');
  const [exporting, setExporting] = useState(false);

  // Animation state
  const [show, setShow] = useState(false);

  // Initialize dates when quick key changes
  useEffect(() => {
    if (quickKey !== 'custom') {
      const range = getQuickRange(quickKey);
      if (range) {
        setStartDate(range.start);
        setEndDate(range.end);
      }
    }
  }, [quickKey]);

  // Load employees and reset form when dialog opens
  useEffect(() => {
    if (visible) {
      previousActiveElement.current = document.activeElement;
      const range = getQuickRange('thisMonth');
      if (range) {
        setStartDate(range.start);
        setEndDate(range.end);
      }
      setQuickKey('thisMonth');
      setSelectedEmployeeIds([]);
      setEmployeeSearch('');
      setEmployeeDropdownOpen(false);
      setRole('');
      setStatus('');
      setFormat('excel');
      setExporting(false);

      listEmployees()
        .then((res) => {
          const list = res.data?.data || res.data || [];
          setEmployees(Array.isArray(list) ? list : []);
        })
        .catch(() => setEmployees([]));

      // Trigger enter animation
      requestAnimationFrame(() => setShow(true));
      const timer = setTimeout(() => modalRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
    }
  }, [visible]);

  // Escape key + focus trap
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }
      if (e.key === 'Tab') {
        const modal = modalRef.current;
        if (!modal) return;
        const focusable = Array.from(
          modal.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.disabled && el.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !modal.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !modal.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousActiveElement.current?.focus) {
        previousActiveElement.current.focus();
      }
    };
  }, [visible]);

  // Close employee dropdown when clicking outside
  useEffect(() => {
    if (!employeeDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (employeeDropdownRef.current && !employeeDropdownRef.current.contains(e.target)) {
        setEmployeeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [employeeDropdownOpen]);

  const handleClose = useCallback(() => {
    setShow(false);
    setTimeout(() => onClose(), 200);
  }, [onClose]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = { start_date: startDate, end_date: endDate };
      if (selectedEmployeeIds.length > 0) params.employee_ids = selectedEmployeeIds.join(',');
      if (role) params.role = role;
      if (status) params.status = status;
      if (format === 'excel') await exportExcel(params);
      else await exportOrdersCSV(params);
      handleClose();
    } catch (err) {
      console.error('导出失败:', err);
    } finally {
      setExporting(false);
    }
  };

  const toggleEmployee = (id) => {
    setSelectedEmployeeIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const filteredEmployees = employees.filter((emp) => {
    const keyword = employeeSearch.trim().toLowerCase();
    if (!keyword) return true;
    const name = (emp.name || emp.nickname || '').toLowerCase();
    const phone = (emp.phone || '').toLowerCase();
    return name.includes(keyword) || phone.includes(keyword);
  });

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      ref={modalRef}
      tabIndex={-1}
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-200"
        style={{ opacity: show ? 1 : 0 }}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto transition-all duration-200"
        style={{
          opacity: show ? 1 : 0,
          transform: show ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(8px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 id={titleId} className="text-lg font-bold text-slate-800">导出报表</h3>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">

          {/* Quick date selection */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">时间范围</label>
            <div className="inline-flex rounded-lg bg-slate-100 p-1 flex-wrap gap-0.5">
              {QUICK_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setQuickKey(opt.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer whitespace-nowrap ${
                    quickKey === opt.key
                      ? 'bg-white shadow-sm text-blue-600 font-medium'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date range inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">开始日期</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setQuickKey('custom');
                }}
                readOnly={quickKey !== 'custom'}
                className={`w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors ${
                  quickKey !== 'custom' ? 'bg-slate-50 text-slate-500' : 'bg-white text-slate-800'
                }`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">结束日期</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setQuickKey('custom');
                }}
                readOnly={quickKey !== 'custom'}
                className={`w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors ${
                  quickKey !== 'custom' ? 'bg-slate-50 text-slate-500' : 'bg-white text-slate-800'
                }`}
              />
            </div>
          </div>

          {/* Employee multi-select */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">员工筛选</label>
            <div className="relative" ref={employeeDropdownRef}>
              <button
                type="button"
                onClick={() => setEmployeeDropdownOpen((prev) => !prev)}
                className="w-full flex items-center justify-between border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white hover:border-slate-300 transition-colors cursor-pointer text-left"
              >
                <span className={selectedEmployeeIds.length > 0 ? 'text-slate-800' : 'text-slate-400'}>
                  {selectedEmployeeIds.length > 0
                    ? `已选择员工`
                    : '全部员工'}
                </span>
                <div className="flex items-center gap-2">
                  {selectedEmployeeIds.length > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-semibold text-white bg-blue-500 rounded-full">
                      {selectedEmployeeIds.length}
                    </span>
                  )}
                  <svg
                    className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${employeeDropdownOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Dropdown panel */}
              {employeeDropdownOpen && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                  {/* Search */}
                  <div className="p-2 border-b border-slate-100">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="搜索员工姓名..."
                        value={employeeSearch}
                        onChange={(e) => setEmployeeSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-slate-50 focus:bg-white transition-colors"
                      />
                      <svg
                        className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                  </div>

                  {/* List */}
                  <div className="max-h-48 overflow-y-auto py-1">
                    {filteredEmployees.length === 0 ? (
                      <div className="px-3 py-4 text-center text-sm text-slate-400">
                        {employees.length === 0 ? '暂无员工数据' : '无匹配结果'}
                      </div>
                    ) : (
                      filteredEmployees.map((emp) => {
                        const empId = emp.id || emp.ID;
                        const checked = selectedEmployeeIds.includes(empId);
                        return (
                          <label
                            key={empId}
                            className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                              checked ? 'bg-blue-50' : 'hover:bg-slate-50'
                            }`}
                          >
                            <span
                              className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                                checked
                                  ? 'bg-blue-500 border-blue-500'
                                  : 'border-slate-300 bg-white'
                              }`}
                            >
                              {checked && (
                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              onChange={() => toggleEmployee(empId)}
                            />
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                                {(emp.name || emp.nickname || '?')[0]}
                              </div>
                              <span className="text-sm text-slate-700 truncate">
                                {emp.name || emp.nickname || '未命名'}
                              </span>
                              {emp.role && (
                                <span className="text-[10px] text-slate-400 shrink-0">
                                  {emp.role === 'sales' ? '谈单' : emp.role === 'designer' ? '设计' : emp.role === 'follow' ? '跟单' : emp.role}
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>

                  {/* Footer: select all / clear */}
                  {filteredEmployees.length > 0 && (
                    <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50/50">
                      <button
                        type="button"
                        onClick={() => {
                          const allIds = filteredEmployees.map((e) => e.id || e.ID);
                          const allSelected = allIds.every((id) => selectedEmployeeIds.includes(id));
                          if (allSelected) {
                            setSelectedEmployeeIds((prev) => prev.filter((id) => !allIds.includes(id)));
                          } else {
                            setSelectedEmployeeIds((prev) => [...new Set([...prev, ...allIds])]);
                          }
                        }}
                        className="text-xs text-blue-500 hover:text-blue-700 font-medium cursor-pointer"
                      >
                        {filteredEmployees.every((e) => selectedEmployeeIds.includes(e.id || e.ID))
                          ? '取消全选'
                          : '全选'}
                      </button>
                      {selectedEmployeeIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedEmployeeIds([])}
                          className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          清空
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Role filter */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">角色筛选</label>
            <div className="inline-flex rounded-lg bg-slate-100 p-1">
              {ROLE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRole(opt.value)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer whitespace-nowrap ${
                    role === opt.value
                      ? 'bg-white shadow-sm text-blue-600 font-medium'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Status filter */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">订单状态</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors cursor-pointer appearance-none"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                backgroundPosition: 'right 0.5rem center',
                backgroundRepeat: 'no-repeat',
                backgroundSize: '1.5em 1.5em',
                paddingRight: '2.5rem',
              }}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Export format */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">导出格式</label>
            <div className="grid grid-cols-2 gap-3">
              {/* Excel card */}
              <label
                className={`border-2 rounded-xl p-3 cursor-pointer transition-all duration-150 flex items-center gap-3 ${
                  format === 'excel'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="exportFormat"
                  value="excel"
                  checked={format === 'excel'}
                  onChange={() => setFormat('excel')}
                  className="sr-only"
                />
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    format === 'excel' ? 'bg-green-100' : 'bg-slate-100'
                  }`}
                >
                  <svg className={`w-5 h-5 ${format === 'excel' ? 'text-green-600' : 'text-slate-400'}`} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H14a1 1 0 01-1-1V3.5zM10.88 14l2.12 3.5h-1.62L10 15.38 8.62 17.5H7l2.12-3.5L7.08 10.5h1.62L10 12.62l1.3-2.12h1.62L10.88 14z" />
                  </svg>
                </div>
                <div>
                  <div className={`text-sm font-semibold ${format === 'excel' ? 'text-slate-800' : 'text-slate-600'}`}>
                    Excel
                  </div>
                  <div className="text-[11px] text-slate-400">.xlsx</div>
                </div>
                {format === 'excel' && (
                  <div className="ml-auto">
                    <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                    </svg>
                  </div>
                )}
              </label>

              {/* CSV card */}
              <label
                className={`border-2 rounded-xl p-3 cursor-pointer transition-all duration-150 flex items-center gap-3 ${
                  format === 'csv'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="exportFormat"
                  value="csv"
                  checked={format === 'csv'}
                  onChange={() => setFormat('csv')}
                  className="sr-only"
                />
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    format === 'csv' ? 'bg-blue-100' : 'bg-slate-100'
                  }`}
                >
                  <svg className={`w-5 h-5 ${format === 'csv' ? 'text-blue-600' : 'text-slate-400'}`} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H14a1 1 0 01-1-1V3.5zM8 17v-1h2v1H8zm0-3v-1h4v1H8zm0-3v-1h8v1H8z" />
                  </svg>
                </div>
                <div>
                  <div className={`text-sm font-semibold ${format === 'csv' ? 'text-slate-800' : 'text-slate-600'}`}>
                    CSV
                  </div>
                  <div className="text-[11px] text-slate-400">.csv</div>
                </div>
                {format === 'csv' && (
                  <div className="ml-auto">
                    <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                    </svg>
                  </div>
                )}
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/30">
          <button
            type="button"
            onClick={handleClose}
            disabled={exporting}
            className="text-slate-600 hover:text-slate-800 font-medium px-4 py-2.5 text-sm rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || !startDate || !endDate}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 text-sm rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {exporting ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                导出中...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                导出
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
