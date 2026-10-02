import React from 'react';

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
    <div className="w-full bg-white border border-[#EAEAEA] rounded-lg">
      <div className="p-6 space-y-5">
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-[#111111] tracking-tight">{title}</h3>
            <p className="text-xs text-[#6B6B6B] mt-0.5">{subtitle}</p>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[#EAEAEA] text-[#6B6B6B] font-bold uppercase tracking-[0.08em] text-[10px]">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`py-3 px-3 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAEAEA]/60">
              {data.map((item) => (
                <tr key={keyExtractor(item)} className="hover:bg-[#FBFBFA] transition-colors group">
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`py-3 px-3 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
                    >
                      {col.render
                        ? col.render(item)
                        : String((item as Record<string, unknown>)[col.key])}
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
export function StatusBadge({
  status,
  type,
}: {
  status: string;
  type: 'error' | 'warning' | 'success' | 'info';
}) {
  const styles = {
    error: 'bg-[#FDEBEC] text-[#9F2F2D] border border-[#EAEAEA]',
    warning: 'bg-[#FBF3DB] text-[#956400] border border-[#EAEAEA]',
    success: 'bg-[#EDF3EC] text-[#346538] border border-[#EAEAEA]',
    info: 'bg-[#F7F6F3] text-[#6B6B6B] border border-[#EAEAEA]',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wide uppercase ${styles[type]}`}
    >
      {status}
    </span>
  );
}
