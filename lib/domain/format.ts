/**
 * Display formatting for the board and detail sheet, plus `sanitiseFileName`,
 * which the server uses to build storage keys. Pure so unit tests can pin the
 * exact strings the design (`docs/design/DESIGN.md`) specifies.
 */

/** `1.2 GB`, `100 MB` (no decimals from 100 MB up), `12.6 MB`, `512 KB`, `40 B`. */
export function formatBytes(n: number): string {
  const GB = 1024 ** 3;
  const MB = 1024 * 1024;
  const KB = 1024;
  if (n >= GB) return `${(n / GB).toFixed(1)} GB`;
  if (n >= MB) {
    const mb = n / MB;
    return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
  }
  if (n >= KB) return `${Math.round(n / KB)} KB`;
  return `${n} B`;
}

/** `m:ss` for the claim countdown; rounds to the nearest second (the chip rounds *up* before calling, so a live claim never reads 0:00). */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * A duration as sentence copy ("3 minutes", "20 seconds", "1 minute 30
 * seconds"). Used for the claim TTL, which the dialog must not hardcode: the
 * server's `CLAIM_TTL_MS` override has to read correctly in the copy too.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (seconds > 0 || minutes === 0) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/** Card due-date chip, `12 Sep` (en-GB day-month, month clipped to three letters across locales' data). */
export function formatDue(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).formatToParts(new Date(iso));
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = (parts.find((p) => p.type === 'month')?.value ?? '').slice(0, 3);
  return `${day} ${month}`;
}

/** 24-hour `HH:mm` for history timeline rows (UI spec §4.4). */
export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/**
 * Makes a user-supplied file name safe as the last segment of an R2 object key
 * (`storageKeyFor`): anything outside `[A-Za-z0-9._-]` collapses to `_` and
 * the result is capped at 120 chars. Prevents `/`, `..` and unicode from
 * shaping the key; the original name is kept verbatim on the Asset row.
 */
export function sanitiseFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
}
