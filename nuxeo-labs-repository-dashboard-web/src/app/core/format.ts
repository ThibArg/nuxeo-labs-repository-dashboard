import { ValueFormat } from '../config/dashboard-config.model';

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];

/** Human readable byte size, base 1000 to match what file managers display. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const exponent = Math.min(Math.floor(Math.log10(bytes) / 3), BYTE_UNITS.length - 1);
  const value = bytes / 1000 ** exponent;
  const decimals = exponent === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${BYTE_UNITS[exponent]}`;
}

/** Milliseconds rendered as the largest sensible unit, as used by workflow durations. */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return '—';
  }
  const seconds = milliseconds / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  }
  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(0)} min`;
  }
  const hours = minutes / 60;
  if (hours < 48) {
    return `${hours.toFixed(1)} h`;
  }
  return `${(hours / 24).toFixed(1)} days`;
}

/** Short local date, tolerating the several shapes OpenSearch may return. */
export function formatDate(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
}

/** Signed number of whole days between now and a date, negative once it has passed. */
export function daysUntil(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

function formatDaysUntil(value: unknown): string {
  const days = daysUntil(value);
  if (days === null) {
    return '—';
  }
  if (days < 0) {
    return `${Math.abs(days)} days ago`;
  }
  return days === 0 ? 'today' : `${days} days`;
}

/** Applies a declared format to a numeric widget value. */
export function formatNumber(value: number, format: ValueFormat | undefined): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  switch (format) {
    case 'bytes':
      return formatBytes(value);
    case 'duration':
      return formatDuration(value);
    case 'percent':
      return `${(value * 100).toFixed(1)} %`;
    case 'decimal':
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    case 'integer':
    default:
      return Math.round(value).toLocaleString();
  }
}

/** Applies a declared format to a raw `_source` value. */
export function formatCell(value: unknown, format: ValueFormat | undefined): string {
  switch (format) {
    case 'date':
      return formatDate(value);
    case 'daysUntil':
      return formatDaysUntil(value);
    case 'bytes':
    case 'duration':
    case 'percent':
    case 'decimal':
    case 'integer':
      return typeof value === 'number' ? formatNumber(value, format) : '—';
    case 'text':
    default:
      if (value === null || value === undefined || value === '') {
        return '—';
      }
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

/**
 * Reads a dotted path out of an OpenSearch `_source`, e.g. `file:content.length`.
 *
 * The two sides of the API disagree on shape, so both are handled. An aggregation addresses a
 * complex property with a dotted field name (`file:content.length`), while `_source` returns the
 * object itself:
 *
 *   "file:content": { "mime-type": "application/pdf", "length": 57970 }
 *
 * Verified against a live LTS 2025 index. The flat lookup comes first all the same, so that a
 * property whose own name contains a dot would still resolve.
 */
export function readSource(source: Record<string, unknown>, field: string): unknown {
  if (field in source) {
    return source[field];
  }
  return field.split('.').reduce<unknown>((node, segment) => {
    if (node && typeof node === 'object' && segment in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
}
