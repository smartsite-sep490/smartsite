import React from 'react';
import { Button } from '../ui';

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
  if (total <= 0) return null;
  const last = Math.max(0, Math.ceil(total / size) - 1);
  return (
    <nav
      aria-label="Request pagination"
      className="flex items-center justify-between gap-3 text-xs"
    >
      <span>
        {total} requests · Page {page + 1} of {last + 1}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onChange(Math.max(0, page - 1))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= last}
          onClick={() => onChange(Math.min(last, page + 1))}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
