/** One calendar year from examination/issue, inclusive; Feb 29 clamps to Feb 28. */
export function healthCertificateExpiry(issuedOn: string | null | undefined): string | null {
  if (!issuedOn || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(issuedOn) || issuedOn.startsWith('0000-'))
    return null;
  const date = new Date(`${issuedOn}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== issuedOn) return null;
  const year = date.getUTCFullYear() + 1;
  if (year > 9999) return null;
  const month = date.getUTCMonth() + 1;
  const day = month === 2 && date.getUTCDate() === 29 ? 28 : date.getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
