import { describe, expect, it } from 'vitest';
import { autoBarWindow, MIN_BAR_PX, WINDOW_LADDER, WINDOW_MS } from './aggregate.js';
import type { SeriesWindow } from './aggregate.js';

/**
 * The bar-density chooser.
 *
 * The numbers below are not invented: they are the AAPL case that produced the
 * bug, measured off the canvas at 1138 CSS px on 2026-08-26. Red-pixel share held
 * at 42–43% while bars stayed above ~4.5px, then climbed as they went sub-pixel —
 * 50% at 0.9px, 82% at 0.31px — against a true 47.5% of down days. So the tests
 * assert the ranges that were WRONG now coarsen, and the ones that were right are
 * left alone.
 */
const DAY = WINDOW_MS['1d'];
const MIN = WINDOW_MS['1m'];
const W = 1138; // the measured plot width

/** Trading days in view, at a plot width of 1138px. */
const daily = (bars: number, widthPx = W) => autoBarWindow({ bars, nativeMs: DAY, widthPx });

describe('autoBarWindow — never ask for more bars than there are pixels', () => {
  it('leaves ranges alone while their bars are already wide enough', () => {
    // 3M/6M/1Y measured 42–43% red, which matches the data's 47.5% down days.
    // Nothing to fix, so nothing should change: coarsening these would throw away
    // real resolution to solve a problem they do not have.
    expect(daily(63)).toBe('1d'); // 3M — 18.1 px/bar
    expect(daily(126)).toBe('1d'); // 6M — 9.0 px/bar
    expect(daily(252)).toBe('1d'); // 1Y — 4.5 px/bar
  });

  it('coarsens the ranges that were drawing sub-pixel bars', () => {
    // 5Y measured 0.9 px/bar and 50% red; All measured 0.31 px/bar and 82%.
    expect(daily(1260)).toBe('1w'); // 5Y
    expect(daily(3623)).toBe('1mo'); // All — AAPL's whole history
  });

  it('picks the FINEST window that fits, not merely one that does', () => {
    // The point is to lose as little resolution as the pixels allow. 5Y at weekly
    // is 180 bars in 1138px; jumping to monthly would discard four fifths of the
    // detail for nothing.
    const w = daily(1260);
    expect(w).toBe('1w');
    const bars = Math.ceil((1260 * DAY) / WINDOW_MS[w]);
    expect(bars * MIN_BAR_PX).toBeLessThanOrEqual(W);
    // ...and the window one step finer genuinely does NOT fit.
    expect(1260 * MIN_BAR_PX).toBeGreaterThan(W);
  });

  it('whatever it picks, the bars actually fit — up to the reach of the ladder', () => {
    // The invariant, over the ladder rather than the cases above. 7,900 daily bars
    // is where monthly stops fitting in 1138px (7900/21 × 3 ≈ 1129) — about 31
    // YEARS of dailies, and out of reach: the archive spans 2012-03-26 to
    // 2026-08-21 and its longest single-ticker history is 3,623 rows (measured
    // 2026-08-26). Beyond it the ladder is exhausted and the chooser returns its
    // coarsest as a best effort, which is a real remaining hole rather than a
    // solved case — see `TDL-BARFLOOR`.
    for (const bars of [10, 63, 252, 700, 1260, 3623, 7900]) {
      const w = autoBarWindow({ bars, nativeMs: DAY, widthPx: W });
      const drawn = Math.max(1, Math.ceil((bars * DAY) / Math.max(WINDOW_MS[w], DAY)));
      expect(drawn * MIN_BAR_PX, `${bars} bars → ${w}`).toBeLessThanOrEqual(W);
    }
  });

  it('returns its coarsest, not an error, once the ladder runs out', () => {
    // 20,000 dailies (~80 years) cannot be made to fit: monthly is still 953 bars
    // in 1138px. It must degrade to the coarsest rather than throw or pick
    // something finer — the caller then still draws SOMETHING, just not a readable
    // direction. Pinned so the day the archive deepens, this is a failing
    // expectation about colour rather than a mystery.
    expect(autoBarWindow({ bars: 20_000, nativeMs: DAY, widthPx: W })).toBe('1mo');
    expect(Math.ceil((20_000 * DAY) / WINDOW_MS['1mo']) * MIN_BAR_PX).toBeGreaterThan(W);
  });

  it('never returns a window FINER than the data', () => {
    // Daily data can't be rolled up into hours. Asking for it would emit a bucket
    // per hour with 23 of every 24 empty.
    for (const bars of [10, 1000, 100_000]) {
      const w = autoBarWindow({ bars, nativeMs: DAY, widthPx: W });
      expect(WINDOW_MS[w]).toBeGreaterThanOrEqual(DAY);
    }
  });

  it('is the FINEST window that fits, at every scale — the definition, checked', () => {
    // Asserted as a property rather than a table of expected windows. Writing that
    // table by hand got three entries wrong in a row, always the same way: 390 bars
    // need 1170px and we have 1138, so `390` keeps recurring one rung further up
    // and the ladder skips a window. A test whose expectations are as easy to get
    // wrong as the code is not checking the code.
    //
    // The definition has two halves — what it returns fits, and everything finer
    // does not — and together they pin exactly one window.
    const drawn = (bars: number, nativeMs: number, w: SeriesWindow) =>
      WINDOW_MS[w] > nativeMs ? Math.max(1, Math.ceil((bars * nativeMs) / WINDOW_MS[w])) : bars;

    const cases: [number, number][] = [
      [390, MIN], // one session of minutes
      [390 * 5, MIN], // a week
      [390 * 60, MIN], // a quarter
      [390 * 252, MIN], // a year of minutes — 98k bars
      [3623 * 390, MIN], // the whole archive at minute resolution
      [63, DAY],
      [252, DAY],
      [1260, DAY],
      [3623, DAY],
    ];

    for (const [bars, nativeMs] of cases) {
      const got = autoBarWindow({ bars, nativeMs, widthPx: W });
      expect(
        drawn(bars, nativeMs, got) * MIN_BAR_PX,
        `${bars}@${nativeMs} → ${got}`,
      ).toBeLessThanOrEqual(W);
      for (const finer of WINDOW_LADDER) {
        if (WINDOW_MS[finer] >= WINDOW_MS[got] || WINDOW_MS[finer] < nativeMs) continue;
        expect(
          drawn(bars, nativeMs, finer) * MIN_BAR_PX,
          `${bars}@${nativeMs}: ${finer} was finer and also fitted, so ${got} was not the finest`,
        ).toBeGreaterThan(W);
      }
    }
  });

  it('widens back down as the window grows', () => {
    // Resizing is the other half: a wider plot should RECOVER resolution, not keep
    // whatever it chose when it was narrow.
    expect(daily(1260, 600)).toBe('1w');
    expect(daily(1260, 4000)).toBe('1d'); // 1260 × 3 = 3780 ≤ 4000
  });

  it('changes nothing when the width is unknown', () => {
    // Before the first measure, width is 0. Guessing a window there would flash a
    // monthly chart on first paint and then re-aggregate.
    expect(autoBarWindow({ bars: 3623, nativeMs: DAY, widthPx: 0 })).toBe('1d');
  });

  it('survives an empty or unknown series', () => {
    expect(autoBarWindow({ bars: 0, nativeMs: DAY, widthPx: W })).toBe('1d');
    expect(autoBarWindow({ bars: 100, nativeMs: 0, widthPx: W })).toBe(WINDOW_LADDER[0]);
  });
});
