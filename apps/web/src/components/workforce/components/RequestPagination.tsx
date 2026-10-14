import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import React from 'react';
import { Button } from '../../ui';

export function RequestPagination({
  page,
  size,
  total,
  onChange,
}: {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
}) {
  useTranslation();

  if (total <= 0) return null;
  const last = Math.max(0, Math.ceil(total / size) - 1);
  return (
    <nav
      aria-label={tr('common.request_pagination')}
      className="flex items-center justify-between gap-3 text-xs"
    >
      <span>
        {tr('request_pagination.value_requests_page_value_of_value', {
          value1: total,
          value2: page + 1,
          value3: last + 1,
        })}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onChange(Math.max(0, page - 1))}
        >
          {tr('common.previous')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= last}
          onClick={() => onChange(Math.min(last, page + 1))}
        >
          {tr('common.next')}
        </Button>
      </div>
    </nav>
  );
}
