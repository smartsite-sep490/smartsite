export function formatShiftTime(timeStr?: string): string {
  if (!timeStr) return '--:--';
  if (/^\d{2}:\d{2}/.test(timeStr)) {
    return timeStr.slice(0, 5);
  }
  try {
    const d = new Date(timeStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  } catch {
    // ignore
  }
  return timeStr;
}

export function formatShiftRange(startsAt?: string, endsAt?: string): string {
  const start = formatShiftTime(startsAt);
  const end = formatShiftTime(endsAt);
  if (!startsAt || !endsAt) return `${start} - ${end}`;
  return `${start} - ${end}`;
}

export function formatDateTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  } catch {
    // ignore
  }
  return dateStr;
}
