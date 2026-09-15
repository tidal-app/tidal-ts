import { describe, expect, it } from 'vitest';
import { annotationInView, type ChartAnnotation } from './TimeSeriesChart.js';

/**
 * Clipping annotations to the data's span.
 *
 * Written because the original clip tested the mark's **line position** rather than
 * its extent, and a session-spanning mark puts its line half a day past its own
 * start. At daily grain the upper bound IS a UTC midnight, so earnings on the last
 * in-view session fell outside it and the entire mark vanished — band and all.
 *
 * Nothing about that is visible in a screenshot: a dropped annotation looks exactly
 * like a quarter with no earnings. Hence a test.
 */

const DAY = 24 * 60 * 60 * 1000;
const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** A session-spanning mark, as `App` builds it: band over the day, line at midday. */
const spanning = (day: string): ChartAnnotation => ({
  id: `e:${day}`,
  at: d(day) + DAY / 2,
  role: 'earnings',
  color: '#4fd0c4',
  band: [d(day), d(day) + DAY],
});

/** A bare rule, as expirations are built — no band, line on the session key. */
const rule = (day: string): ChartAnnotation => ({
  id: `x:${day}`,
  at: d(day),
  role: 'expiration',
  color: '#4fd0c4',
});

describe('annotationInView', () => {
  it('keeps a spanning mark on the LAST in-view session', () => {
    // THE regression. `hi` is the last bar's key — a UTC midnight at daily grain —
    // and the mark's line sits at midnight + 12h, i.e. past it. Clipping on the
    // line dropped the most recent earnings; clipping on the band keeps it.
    const lo = d('2026-01-02');
    const hi = d('2026-08-21');
    const mark = spanning('2026-08-21');
    expect(mark.at).toBeGreaterThan(hi); // the line really is outside
    expect(annotationInView(mark, lo, hi)).toBe(true); // the mark is not
  });

  it('keeps a spanning mark on the FIRST in-view session', () => {
    // The mirror case: the band starts exactly at `lo`.
    const lo = d('2026-01-02');
    expect(annotationInView(spanning('2026-01-02'), lo, d('2026-08-21'))).toBe(true);
  });

  it('drops a mark wholly before the data', () => {
    // "Before this instrument listed" is not an annotation of anything on screen.
    expect(annotationInView(spanning('2011-06-15'), d('2026-01-02'), d('2026-08-21'))).toBe(false);
  });

  it('drops a mark wholly after the data', () => {
    expect(annotationInView(spanning('2027-01-15'), d('2026-01-02'), d('2026-08-21'))).toBe(false);
  });

  it('clips a bare rule on its own position, since it has no extent', () => {
    const lo = d('2026-01-02');
    const hi = d('2026-08-21');
    expect(annotationInView(rule('2026-08-21'), lo, hi)).toBe(true); // exactly on the edge
    expect(annotationInView(rule('2026-08-22'), lo, hi)).toBe(false); // one day past
    expect(annotationInView(rule('2026-01-01'), lo, hi)).toBe(false); // one day before
  });

  it('tests OVERLAP, not containment', () => {
    // A band straddling an edge is partly on screen and should draw the part that
    // is. Requiring full containment would drop it entirely, which is the same
    // failure in a different disguise.
    const lo = d('2026-03-02');
    const hi = d('2026-03-20');
    // Band [03-01, 03-02) ends exactly at `lo`. It does NOT count: the upper
    // bound is the next day's midnight, so this band covers only time before the
    // first visible bar. (Two of these assertions contradicted each other on the
    // first pass, which is how the half-open semantic got pinned down.)
    expect(annotationInView(spanning('2026-03-01'), lo, hi)).toBe(false);
    // Band [03-20, 03-21) starts exactly at `hi`.
    expect(annotationInView(spanning('2026-03-20'), lo, hi)).toBe(true);
    // Band [02-28, 03-01) ends a day before `lo` — genuinely outside.
    expect(annotationInView(spanning('2026-02-28'), lo, hi)).toBe(false);
  });

  it('handles a single-session span, where lo === hi', () => {
    // The 1D range. A mark on that session must survive.
    const only = d('2026-08-21');
    expect(annotationInView(spanning('2026-08-21'), only, only)).toBe(true);
    expect(annotationInView(rule('2026-08-21'), only, only)).toBe(true);
    expect(annotationInView(spanning('2026-08-20'), only, only)).toBe(false);
  });
});
