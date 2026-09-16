import { defaultTheme } from '@pond-ts/charts';
import type { ChartTheme } from '@pond-ts/charts';

/**
 * A **literal** `ChartTheme` — the workshop's whole point.
 *
 * `TimeSeriesChart` takes its theme as a prop and reads no CSS token, so a host
 * can build one however it likes. Tidal generates its own from `--td-*` custom
 * properties with `cssVarTheme`; this one is written out by hand, so the
 * stories prove the chart renders with no design system behind it at all — and
 * double as the smallest example of what a `theme` prop has to contain.
 *
 * Only the slots a chart actually reads are named; everything else falls
 * through to the library's `defaultTheme`.
 */
const ink = (fg: string, grid: string, cursor: string) => ({
  axis: { ...defaultTheme.axis, label: fg, grid, sessionDivider: grid },
  font: { ...defaultTheme.font, family: "'IBM Plex Mono', ui-monospace, monospace" },
  cursor,
});

export const demoDark: ChartTheme = {
  ...defaultTheme,
  background: undefined, // sit on the page's own surface
  ...ink('#6d7689', 'rgba(233,237,246,0.08)', '#4f9cd9'),
};

export const demoLight: ChartTheme = {
  ...defaultTheme,
  background: undefined,
  ...ink('#6b7280', 'rgba(17,24,39,0.10)', '#2563eb'),
};
