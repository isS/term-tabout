import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatRelative,
  formatStartedAt,
  tildify,
} from './format.js';

describe('formatDuration', () => {
  it.each([
    [2 * 3600 * 1000 + 18 * 60 * 1000, '2h 18m'],
    [7 * 3600 * 1000 + 4 * 60 * 1000, '7h 04m'],
    [47 * 60 * 1000, '47m'],
    [86_400_000 + 4 * 3600 * 1000, '1d 4h'],
    [12 * 1000, '12s'],
    [0, '0s'],
    [3 * 60 * 1000 + 45 * 1000, '3m'],
    [60 * 60 * 1000, '1h 00m'],
  ])('formats %i ms as "%s"', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('clamps negative durations to 0s', () => {
    expect(formatDuration(-1000)).toBe('0s');
  });
});

describe('formatStartedAt', () => {
  it('returns HH:MM for the same calendar day', () => {
    const now = new Date('2026-05-08T15:30:00').getTime();
    const ms = new Date('2026-05-08T09:14:00').getTime();
    expect(formatStartedAt(ms, now)).toBe('09:14');
  });

  it('returns weekday + HH:MM within the past 7 days', () => {
    const now = new Date('2026-05-08T15:30:00').getTime(); // Friday
    const ms = new Date('2026-05-05T09:14:00').getTime(); // Tuesday
    expect(formatStartedAt(ms, now)).toBe('Tue 09:14');
  });

  it('returns MM-DD HH:MM beyond 7 days', () => {
    const now = new Date('2026-05-08T15:30:00').getTime();
    const ms = new Date('2026-04-30T09:14:00').getTime();
    expect(formatStartedAt(ms, now)).toBe('04-30 09:14');
  });
});

describe('formatRelative', () => {
  it('renders the gap between now and ms', () => {
    const now = 1_000_000_000;
    expect(formatRelative(now - 60_000, now)).toBe('1m');
  });
});

describe('tildify', () => {
  it('shortens cwd inside home', () => {
    expect(tildify('/Users/foo/bar', '/Users/foo')).toBe('~/bar');
  });
  it('returns ~ when cwd === home', () => {
    expect(tildify('/Users/foo', '/Users/foo')).toBe('~');
  });
  it('passes through paths outside home', () => {
    expect(tildify('/etc/hosts', '/Users/foo')).toBe('/etc/hosts');
  });
  it("doesn't shorten home prefix not followed by /", () => {
    expect(tildify('/Users/foobar', '/Users/foo')).toBe('/Users/foobar');
  });
});
