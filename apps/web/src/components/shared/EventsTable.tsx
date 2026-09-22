import React from 'react';
import { IconClock } from '../icons';

export interface TableColumn<T> {
  header: string;
  key: string;
  render?: (item: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
}

interface EventsTableProps<T> {
  title: string;
  subtitle: string;
  data: T[];
  columns: TableColumn<T>[];
  keyExtractor: (item: T) => string;
}

export function EventsTable<T>({
  title,
  subtitle,
  data,
  columns,
  keyExtractor,
}: EventsTableProps<T>) {
  return (
    <div className="w-full bg-slate-50 border border-slate-200 p-1.5 rounded-[2rem] shadow-sm">
      <div className="bg-white rounded-[calc(2rem-0.375rem)] shadow-[inset_0_1px_1px_rgba(255,255,255,1)] border border-slate-100 p-6 space-y-5">
        
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900 tracking-tight">{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-all active:scale-[0.98]">
            <IconClock className="w-3.5 h-3.5" />
            <span>Last 24 hours</span>
          </button>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400 font-bold uppercase tracking-[0.08em] text-[10px]">
                {columns.map((col, idx) => (
                  <th
                    key={col.key}
                    className={`py-3 px-3 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/80">
              {data.map((item, idx) => (
                <tr key={keyExtractor(item)} className="hover:bg-slate-50/50 transition-colors group">
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`py-3 px-3 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
                    >
                      {col.render ? col.render(item) : (item as any)[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Utility component for consistent status badges
export function StatusBadge({ status, type }: { status: string, type: 'error' | 'warning' | 'success' | 'info' }) {
  const styles = {
    error: 'bg-red-50 text-red-600 border border-red-100',
    warning: 'bg-amber-50 text-amber-600 border border-amber-100',
    success: 'bg-emerald-50 text-emerald-600 border border-emerald-100',
    info: 'bg-slate-50 text-slate-600 border border-slate-100',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase ${styles[type]}`}>
      {status}
    </span>
  );
}
