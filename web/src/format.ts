export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "image/png" -> "png"; keeps the table narrow without hiding the real type. */
export function shortType(mimeType: string): string {
  const subtype = mimeType.split('/')[1] ?? mimeType;
  return subtype.split(';')[0] ?? subtype;
}

/**
 * Only same-origin, non-protocol-relative paths. React Router resolves
 * `next` against the current location, and `//evil.com` makes
 * history.pushState throw SecurityError — a crash on a crafted link rather
 * than an open redirect, but neither is acceptable.
 */
export function safeNext(raw: string | null, fallback = '/workspaces'): string {
  if (!raw) return fallback;
  return /^\/(?!\/)/.test(raw) ? raw : fallback;
}
