import { describe, expect, it } from 'vitest';
import { formatBytes, formatCountdown, formatDue, formatDuration, formatTime, sanitiseFileName } from '@/lib/domain/format';

describe('formatBytes', () => {
  it('formats gigabytes with one decimal', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
  });

  it('formats megabytes rounded', () => {
    expect(formatBytes(640 * 1024 * 1024)).toBe('640 MB');
  });

  it('formats megabytes with one decimal below 100', () => {
    expect(formatBytes(12.6 * 1024 * 1024)).toBe('12.6 MB');
  });
});

describe('formatCountdown', () => {
  it('formats minutes and seconds', () => {
    expect(formatCountdown(161_000)).toBe('2:41');
  });

  it('formats zero', () => {
    expect(formatCountdown(0)).toBe('0:00');
  });
});

describe('formatDuration', () => {
  it('formats the default claim TTL as whole minutes', () => {
    expect(formatDuration(180_000)).toBe('3 minutes');
  });

  it('singularises one minute', () => {
    expect(formatDuration(60_000)).toBe('1 minute');
  });

  it('formats a sub-minute TTL in seconds (the CLAIM_TTL_MS demo override)', () => {
    expect(formatDuration(20_000)).toBe('20 seconds');
  });

  it('formats a mixed duration as minutes and seconds', () => {
    expect(formatDuration(90_000)).toBe('1 minute 30 seconds');
  });

  it('never goes negative', () => {
    expect(formatDuration(-5_000)).toBe('0 seconds');
  });
});

describe('formatDue', () => {
  it('formats an ISO date as day + short month', () => {
    expect(formatDue('2026-09-24T12:00:00.000Z')).toBe('24 Sep');
  });
});

describe('formatTime', () => {
  it('formats an ISO datetime as 24h HH:mm', () => {
    const iso = new Date();
    iso.setHours(12, 4, 0, 0);
    expect(formatTime(iso.toISOString())).toBe('12:04');
  });
});

describe('sanitiseFileName', () => {
  it('collapses disallowed characters to underscore', () => {
    expect(sanitiseFileName('my file (1).pdf')).toBe('my_file_1_.pdf');
  });

  it('caps length at 120 characters', () => {
    const long = 'a'.repeat(200) + '.pdf';
    expect(sanitiseFileName(long).length).toBe(120);
  });
});
