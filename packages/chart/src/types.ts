import type { SeriesSchema, TimeSeries } from 'pond-ts';

/**
 * The series the chart reads: a pond `TimeSeries` in the **erased** schema.
 * Rows are heterogeneous (a vol series in `%`, a price series in `$`), so a
 * host casts its specific schemas to this one at the boundary; a config names
 * its `column` and the chart reads it structurally. One home for the type, so
 * the prepare step and the renderer agree without importing each other.
 */
export type ChartSeries = TimeSeries<SeriesSchema>;
