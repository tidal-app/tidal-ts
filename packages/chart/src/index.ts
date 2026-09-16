/**
 * The **chart entry** — the surface that becomes `@tidal-ts/chart` (TDL-LIB).
 *
 * Rules, enforced by `boundary.test.ts`: this folder imports only `@tidal-ts/core`,
 * the pond family, React and itself. No CSS, no provider, no token names, no
 * control-panel or shell code. A host hands the chart its theme, its colour
 * resolver and its settings as props; this entry decides nothing about where
 * they come from.
 *
 * Exports are chosen, not inherited: what a second host needs to render a chart
 * and prepare its data. Internals (`splitBarColumns`, `columnNames`, the candle
 * style builders) stay internal until a consumer asks.
 */
export {
  TimeSeriesChart,
  annotationInView,
  type ChartAnnotation,
  type ChartStats,
  type TimeSeriesChartProps,
  type TimeSeriesChartRow,
} from './TimeSeriesChart.js';
export type { ChartSeries } from './types.js';
export {
  configAxisId,
  effectiveSplit,
  formatSeriesValue,
  isStudySeries,
  LINE_WIDTHS,
  PAIR_JOINS,
  PAIR_LENSES,
  seriesAxisId,
  readsCompare,
  seriesDrawn,
  seriesLineDashArray,
  seriesLineWidth,
  sharedAxisId,
  type AxisRange,
  effectiveAxisBounds,
  clampBoundsToLocks,
  barZeroLock,
  centerOnZero,
  axisRangeIsEmpty,
  axisFormat,
  bandColumns,
  configColumns,
  hasBarOutput,
  logAllowed,
  AXIS_PRECISIONS,
  type PairJoinOp,
  type PairLensOp,
  type SeriesGroup,
  type PairPartView,
  type PairView,
  type SeriesBinding,
  type SeriesConfig,
  type SeriesAxis,
  type SeriesStyle,
  type SeriesWindow,
  type CandleVariant,
  type ColorBy,
} from './series.js';
export {
  DEFAULT_CHART_SETTINGS,
  mergeChartSettings,
  type AnnotationOverride,
  type ChartSettings,
  type CategoryLineStyle,
  type SessionDividers,
  type SplitColorDefault,
  type LineDash,
} from './chartSettings.js';
export { useMeasuredWidth, useMeasuredSize } from './useMeasuredWidth.js';
export {
  assembleRows,
  carries,
  foldKey,
  foldSources,
  prepareChart,
  sourceFacts,
  type ConfigRow,
  type PreparedRow,
  type SourceFacts,
  type SourceInput,
  type SourceInputs,
} from './prepare.js';
export { finiteColumns, firstLast, lastRow } from './seriesFacts.js';
// Re-exported so a host wires the live pill / tracker without a second import
// site for the library the chart is built on.
export { createLiveValue } from '@pond-ts/charts';
export type { TrackerInfo, TrackerSample, LiveValue } from '@pond-ts/charts';
