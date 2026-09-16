import { TimeSeries } from 'pond-ts';

/**
 * Adapter for a **columnar** time-series wire envelope → a pond `TimeSeries`.
 * A market-data backend streams pond-ts
 * struct-of-arrays payloads (a `Replace` snapshot, then `Merge` appends for
 * streaming datasets); this turns the decoded snapshot into the same `TimeSeries`
 * carrier the chart layer already renders, and rowifies appends for the live
 * path.
 *
 * pond-ts 0.41's `TimeSeries.fromColumns` is the columnar ingress, so the
 * snapshot path is a thin pass-through — no hand-rolled transpose. Two v1
 * constraints shape this module (logged in `CHARTS_FRICTION.md`, raised with the
 * pond agent):
 *   1. `fromColumns` accepts **time-key + numeric** columns only — the wire's
 *      `ticker`/key string columns are partition metadata, not plottable, so
 *      they're dropped here rather than fed in (they'd throw).
 *   2. `LiveSeries` has no columnar push in 0.41, so appends must be transposed
 *      to rows ({@link appendToRows}) before `pushMany`.
 *
 * Pure + platform-free (no transport knowledge). A backend-specific decode —
 * message framing, replace/merge reconciliation, a dataset catalog — belongs to
 * the consumer, not here.
 */

/** A cell in a columnar payload. Time cells are epoch ms (a `number`). */
export type PondValue = number | string | boolean | null;

/** One column's spec, as the wire's metadata message declares it. */
export interface WireColumnSpec {
  name: string;
  kind: 'time' | 'number' | 'string';
  /** `false` ⇒ values may be null. */
  required: boolean;
}

/** A columnar snapshot (`Replace` frame body, decoded). Column-major:
 *  `columns[colName][i]` is row `i`; the `time` column is epoch ms. */
export interface PondSnapshot {
  name: string;
  count: number;
  schema: WireColumnSpec[];
  columns: Record<string, PondValue[]>;
}

/** A columnar append (`Merge` frame body) — a snapshot minus `schema` (the
 *  consumer already has it from this series' snapshot). Rows are new since the
 *  last frame. */
export interface PondAppend {
  name: string;
  count: number;
  columns: Record<string, PondValue[]>;
}

// `fromColumns` is generic over a statically-known schema tuple; our schema is
// wire-driven (runtime), so we build a plain array and hand it to the same
// parameter shape — pond validates kind + aligned length at construction.
type FromColumnsInput = Parameters<typeof TimeSeries.fromColumns>[0];

/** The time-key + numeric columns, time first — the projection pond can ingest.
 *  Throws if there's no time column (every dataset leads with one). */
function plottableColumns(schema: WireColumnSpec[]): WireColumnSpec[] {
  const time = schema.find((c) => c.kind === 'time');
  if (!time) throw new Error('columnar payload has no time column');
  return [time, ...schema.filter((c) => c.kind === 'number')];
}

/** Validate every declared column is present (if required) and aligned to
 *  `count` — the doc's "validate count vs columns" guard. */
function assertAligned(
  name: string,
  count: number,
  columns: Record<string, PondValue[]>,
  schema: WireColumnSpec[],
): void {
  for (const c of schema) {
    const col = columns[c.name];
    if (col === undefined) {
      if (c.required) {
        throw new Error(`columnar payload "${name}": missing required column "${c.name}"`);
      }
      continue;
    }
    if (col.length !== count) {
      throw new Error(
        `columnar payload "${name}": column "${c.name}" has ${col.length} values, expected count ${count}`,
      );
    }
  }
}

/**
 * Adapt a decoded {@link PondSnapshot} into a pond `TimeSeries`. Drops string
 * columns (partition metadata), coerces gaps to null, and `sort: true` since
 * wire rows aren't guaranteed ascending.
 */
export function snapshotToTimeSeries(snap: PondSnapshot) {
  assertAligned(snap.name, snap.count, snap.columns, snap.schema);
  const cols = plottableColumns(snap.schema);
  // Wire-driven schema → pond's static tuple type: a runtime array can't satisfy
  // the `[FirstColumn, ...]` tuple statically, so bridge through `unknown`. pond
  // validates kind + aligned length at construction (and columnar.test covers it).
  const schema = cols.map((c) => ({
    name: c.name,
    kind: c.kind,
  })) as unknown as FromColumnsInput['schema'];
  const columns: Record<string, (number | null)[]> = {};
  for (const c of cols) {
    columns[c.name] = (snap.columns[c.name] ?? []).map((v) => (typeof v === 'number' ? v : null));
  }
  return TimeSeries.fromColumns({ name: snap.name, schema, columns, sort: true });
}

/**
 * Transpose a columnar {@link PondAppend} into row tuples in the numeric-schema's
 * column order (time first) — the shape `LiveSeries.pushMany` wants, since pond
 * 0.41 has no columnar append. `schema` is the one from this series' snapshot.
 * Missing/non-numeric cells become `NaN` (pond treats non-finite as a gap).
 */
export function appendToRows(append: PondAppend, schema: WireColumnSpec[]): number[][] {
  const cols = plottableColumns(schema);
  const rows: number[][] = [];
  for (let i = 0; i < append.count; i++) {
    rows.push(
      cols.map((c) => {
        const v = append.columns[c.name]?.[i];
        return typeof v === 'number' ? v : NaN;
      }),
    );
  }
  return rows;
}
