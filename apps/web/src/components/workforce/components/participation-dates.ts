function localMidnight(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

export function participationDates(from: string, until: string) {
  const end = until ? localMidnight(until) : null;
  if (end) end.setDate(end.getDate() + 1);
  return { validFrom: localMidnight(from).toISOString(), validUntil: end?.toISOString() ?? null };
}
