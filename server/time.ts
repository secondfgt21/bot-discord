const JAKARTA_TZ = 'Asia/Jakarta';

export function getJakartaDateParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  periodKey: string;
  dateStr: string;
} {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const monthPad = String(month).padStart(2, '0');
  const dayPad = String(day).padStart(2, '0');

  return {
    year,
    month,
    day,
    hour,
    minute,
    periodKey: `${year}-${monthPad}`,
    dateStr: `${year}-${monthPad}-${dayPad}`,
  };
}

export function getMonthDaysInJakarta(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function formatIdr(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(amount));
  return `${sign}Rp${abs.toLocaleString('id-ID')}`;
}

export function utcNowIso(): string {
  return new Date().toISOString();
}
