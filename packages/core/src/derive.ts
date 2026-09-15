import type { Column, SeriesSchema, TimeSeries } from 'pond-ts';
import {
  ADOPTED_STUDIES,
  BAND_OUTPUTS,
  catalogOp,
  OWN_AXIS_STUDIES,
  studyNeedsColumns,
} from './studyCatalog.js';
import { bollinger, ema, sma } from '@pond-ts/financial';
import {
  bind,
  columnsOf,
  createRegistry,
  int,
  num,
  run,
  specId,
  explain,
  type OpContext,
  type OpResult,
  type Units,
} from '@pond-ts/process';

/**
 * The **derive seam** — a `SeriesConfig` that *induces* its column instead of
 * only referencing one (a study: `sma(20)` of `iv21`; a spread: `iv21 / hv21`).
 * Since TDL-PROCESS the engine underneath is **`@pond-ts/process`** (the
 * processing graph Tidal's RFC pond#543 argued for): Tidal declares its op
 * vocabulary in a process `Registry`, a spec is a process plan node, the id is
 * the engine's content-addressed `specId`, and the fold is `bind` + `run`.
 * This module remains the thin, pure seam Tidal renders against — React-free,
 * extraction-ready — but it now *configures* an engine rather than being one.
 *
 * Design of record: `docs/notes/indicator-integration-2026-07.md`; the
 * adoption program: `docs/plans/TDL_PAIRS_PLAN.md`. Consumer positions filed
 * on pond#543 (2026-08-16).
 */

/** The schema-erased series the fold reads/writes (like aggregate.ts): an op
 *  appends a numeric column, callers work in the base schema + name their
 *  column. */
type DerivedSeries = TimeSeries<SeriesSchema>;

/** Derive operators Tidal registers. `sma`/`ema` are windowed trend studies
 *  (bound to `@pond-ts/financial`, param `period`); `realizedVol` is a
 *  pointwise domain transform (√(var·252)) the corpus doesn't carry
 *  (F-charts-11). `diff`/`ratio`/`logRatio` are the **pair** ops (TDL-PAIR):
 *  pointwise two-input transforms — the A-vs-B spread family, where the
 *  derived line is the signal and the legs are context. */
export type TidalOp = 'sma' | 'ema' | 'bollinger' | 'realizedVol' | 'diff' | 'ratio' | 'logRatio';

/**
 * An op name the registry knows.
 *
 * A literal union until TDL-STUDYCAT: the corpus's names arrive as DATA from
 * `@pond-ts/financial/catalog`, so the set is no longer knowable at compile
 * time and pinning it would mean transcribing 109 names — the exact thing
 * F-charts-25 existed to stop. {@link TidalOp} keeps the hand-declared names
 * available where a caller genuinely means one of those (the pair ops), and
 * the registry remains the runtime authority: `specId` throws on an unknown op,
 * so a bad name fails loudly at the seam rather than silently downstream.
 */
export type DeriveOp = TidalOp | (string & {});

/**
 * Column prefix for the **compare role's** columns when the host joins the
 * comparison ticker's series onto the primary (role-bound pair legs,
 * TDL-PAIR stage 1): `cmp_iv21` is "the compare ticker's iv21". A ROLE, not
 * an identity — the column keeps its name when the compare ticker changes,
 * so a spread's id (and the user's overrides on it) survive the swap. This
 * is the consumer-side stand-in for per-input source qualification
 * (PND-PROCJOIN — position 5 on pond#543).
 */
export const COMPARE_PREFIX = 'cmp_';

/** The two-input (pair) subset of {@link DeriveOp}. */
export type PairOp = 'diff' | 'ratio' | 'logRatio';

/** True if `op` takes a second input. */
export const isPairOp = (op: DeriveOp): op is PairOp =>
  op === 'diff' || op === 'ratio' || op === 'logRatio';

/** An input of a spec: a raw source column name, or a **nested spec** (the
 *  engine's own recursion — an id string naming another spec is NOT an input;
 *  the engine reads a string input as a raw column, so composition nests). */
export type DeriveInput = string | DeriveSpec;

/** A derive spec — structurally a `@pond-ts/process` plan `Spec`, narrowed to
 *  Tidal's op vocabulary. Content-addressed by the engine: params are
 *  defaulted + key-sorted inside `specId`, so an omitted param and its
 *  explicit default are one identity. Absent on a `SeriesConfig` ⇒ a raw
 *  data column. */
export interface DeriveSpec {
  op: DeriveOp;
  params?: Readonly<Record<string, number>>;
  inputs: readonly DeriveInput[];
}

/** The default bar-count period a study uses when none is given. */
export const DEFAULT_PERIOD = 20;

/** The slice of pond's public column API we read: a length + a per-cell read that
 *  yields `undefined` for a gap. (Structural, so an erased-schema series can be
 *  read without fighting the schema-narrowed `column()` signature.) */
export interface NumericColumnReader {
  readonly length: number;
  read(i: number): number | undefined;
}

/**
 * A numeric column off a series by name, or `undefined` if it has none —
 * pond's **columnar** read path (`series.column(name)`), which walks the packed
 * typed array instead of materializing an object per bar. Prefer this to
 * `toObjects()` for any per-bar fold (pond 0.52 made the same change inside its
 * own study kernels; the guidance is "columns, not events").
 */
export function readNumericColumn(
  series: DerivedSeries,
  name: string,
): NumericColumnReader | undefined {
  // `column()` is schema-narrowed; Tidal renders in the erased schema, so reach it
  // structurally (same trust boundary as the study-op casts below).
  const s = series as unknown as { column(n: string): NumericColumnReader | undefined };
  return s.column(name);
}

/** Trading days per year — the standard annualization for a daily variance. */
const ANNUALIZATION_DAYS = 252;

/** A corpus study (`sma`/`ema`) as a process op body: run the financial study
 *  over the op's (already-widened) series, then hand back the one column it
 *  wrote. Cast through `never`: Tidal computes in the erased schema, the
 *  corpus is column-name-typed over a concrete one. */
function corpusStudy(fn: typeof sma) {
  return (ctx: OpContext): OpResult => {
    // No missing-column pre-check: since 0.62.0 the engine rejects an unknown
    // raw input at COMPILE (`UnknownColumnError`, whole spec closure, re-run
    // on the warm path too), so a gone-column spec skips before this op ever
    // runs — the workaround this check was (pond#666 → #667) retired with the
    // bump.
    const out = fn(ctx.series as never, {
      period: ctx.params.period as number,
      column: ctx.inputs.input as never,
      output: '__study',
    }) as unknown as DerivedSeries;
    const col = (out as unknown as { column(n: string): Column | undefined }).column('__study');
    if (!col) throw new Error(`${ctx.id}: corpus study produced no column`);
    return col;
  };
}

/** The output suffixes a band declares, in declaration order — also the order
 *  {@link bollingerRun} returns its columns in. Defined in `studyCatalog.ts`
 *  (the lower layer) so the adoption filter and the band style read ONE list;
 *  re-exported here because this is where consumers already import it from. */
export { BAND_OUTPUTS };

/** A private prefix for the corpus call: we read the three columns straight
 *  back out and hand them to the engine, which names the real ones from the
 *  spec id. Anything unlikely to collide with a feed column will do. */
const BB_PREFIX = '__bb';

/** **Bollinger Bands** — the corpus's `bollinger` (one rolling avg+stdev pass),
 *  surfaced as a THREE-output op. The engine names the columns `${id}Middle` /
 *  `Upper` / `Lower` from the suffixes declared below, which is the corpus's own
 *  `prefix` convention, so no mapping layer sits between them.
 *
 *  Returned in {@link BAND_OUTPUTS} order — positional, per `OpResult`. */
function bollingerRun(ctx: OpContext): OpResult {
  const out = bollinger(ctx.series as never, {
    period: ctx.params.period as number,
    stdDev: ctx.params.stdDev as number,
    column: ctx.inputs.input as never,
    prefix: BB_PREFIX,
  }) as unknown as DerivedSeries;
  const read = out as unknown as { column(n: string): Column | undefined };
  return BAND_OUTPUTS.map((suffix) => {
    const col = read.column(`${BB_PREFIX}${suffix}`);
    if (!col) throw new Error(`${ctx.id}: bollinger produced no ${suffix} column`);
    return col;
  });
}

/** Annualized realized volatility from a **daily variance** column: √(var·252),
 *  scaled to a percent. Pointwise (no window); a non-finite or negative input
 *  reads as a gap, and the RESULT is guarded finite too (a huge-but-finite
 *  variance can overflow — that cell becomes a gap, not a dropped column). */
function realizedVolRun(ctx: OpContext): OpResult {
  const col = readNumericColumn(ctx.series, ctx.inputs.input!);
  if (!col) throw new Error(`realizedVol: no such column "${ctx.inputs.input}"`);
  const values = new Array<number | undefined>(col.length);
  for (let i = 0; i < col.length; i += 1) {
    const v = col.read(i);
    if (v == null || !Number.isFinite(v) || v < 0) continue; // gap / negative → gap
    const rv = Math.sqrt(v * ANNUALIZATION_DAYS) * 100;
    if (Number.isFinite(rv)) values[i] = rv;
  }
  return values;
}

/** A pointwise pair transform: `output[i] = a[i] op b[i]`. Gap rules per op —
 *  a gap in either leg is a gap; `ratio` gaps on a zero denominator; `logRatio`
 *  gaps unless both legs are positive. Result guarded finite, like
 *  `realizedVol`. */
const pairRun =
  (op: PairOp) =>
  (ctx: OpContext): OpResult => {
    const colA = readNumericColumn(ctx.series, ctx.inputs.a!);
    const colB = readNumericColumn(ctx.series, ctx.inputs.b!);
    if (!colA || !colB)
      throw new Error(`${op}: missing column "${!colA ? ctx.inputs.a : ctx.inputs.b}"`);
    const n = Math.min(colA.length, colB.length);
    const values = new Array<number | undefined>(colA.length);
    for (let i = 0; i < n; i += 1) {
      const va = colA.read(i);
      const vb = colB.read(i);
      if (va == null || vb == null || !Number.isFinite(va) || !Number.isFinite(vb)) continue;
      let v: number;
      if (op === 'diff') v = va - vb;
      else if (op === 'ratio') {
        if (vb === 0) continue;
        v = va / vb;
      } else {
        if (va <= 0 || vb <= 0) continue;
        v = Math.log(va / vb);
      }
      if (Number.isFinite(v)) values[i] = v;
    }
    return values;
  };

/** The study period's legal range — the SINGLE source both the registry param
 *  and every gate (machine guards, the UI period input) read, so no caller can
 *  mint a spec the registry will reject (`specId` THROWS on out-of-range
 *  params — an ungated value killed the terminal actor; PR #130 review). */
export const PERIOD_BOUNDS = { min: 2, max: 5000 } as const;

/** The study period param, shared by the windowed ops. `suggest` is the
 *  picker's useful range. */
const PERIOD = int({ default: DEFAULT_PERIOD, ...PERIOD_BOUNDS, suggest: [5, 200] });

/** Band half-width in standard deviations. `num`, not `int` — 2.5 is an
 *  ordinary choice, and the corpus takes a float. `0` would collapse the bands
 *  onto the middle, so the legal floor is above it; the useful range is the
 *  1–3 every chartist actually picks. */
const STD_DEV = num({ default: 2, min: 0.1, max: 10, suggest: [1, 3] });

/**
 * Tidal's op vocabulary as a **process registry** — the single declaration the
 * engine validates against, `specId` names from, `explain` derives lineage
 * from, and (TDL-STUDYMENU) a picker will be generated from. Locally defined
 * ops are citizens, per the RFC; the pair ops are the multi-input workload
 * posted as position 5 on pond#543.
 *
 * Unit notes: `ratio` is unitless (`''`), `logRatio` is `'log'`. `diff`
 * declares `'inherit'`, which reads input 0 unconditionally — WRONG when the
 * legs' units differ, which is exactly the `'inheritCommon'` ask in position 2
 * on pond#543. Until that lands the graph's unit answer for an unlike-unit
 * diff is untrusted: the CONFIG layer computes the displayed unit itself
 * (`pairConfig`: a like-unit diff keeps the unit, anything else reads `''`).
 */
// `folds: false`: the standard folds (last/extremes/percentileRank/shape) stay
// out until Tidal consumes facts (TDL-GAUGE) — the registry IS the future study
// menu (`byFamily()`), and it should list exactly what the product exposes.
const HAND_OPS = createRegistry({ folds: false })
  .define({
    name: 'sma',
    family: 'trend',
    summary: 'Simple moving average',
    params: { period: PERIOD },
    inputs: [{ role: 'input' }],
    outputs: [{ id: '', unit: 'inherit' }],
    lookback: (p) => (p.period as number) - 1,
    label: (p, inputs) => `SMA(${p.period}) of ${inputs}`,
    run: corpusStudy(sma),
  })
  .define({
    name: 'ema',
    family: 'trend',
    summary: 'Exponential moving average',
    params: { period: PERIOD },
    inputs: [{ role: 'input' }],
    outputs: [{ id: '', unit: 'inherit' }],
    // An IIR has no exact finite warm-up; 4·period is the standard engineering
    // answer (and the multiplier is OUR claim about acceptable error).
    lookback: (p) => 4 * (p.period as number),
    label: (p, inputs) => `EMA(${p.period}) of ${inputs}`,
    run: corpusStudy(ema),
  })
  .define({
    name: 'bollinger',
    family: 'trend',
    summary: 'Bollinger Bands — an SMA with bands at ±k standard deviations',
    params: { period: PERIOD, stdDev: STD_DEV },
    inputs: [{ role: 'input' }],
    // THREE outputs, one spec. The suffixes name the columns off the spec id,
    // so the band moves, hides, recolours and deletes as a unit — which is what
    // it is. `inherit` throughout: a band is in its input's unit.
    outputs: BAND_OUTPUTS.map((id) => ({ id, unit: 'inherit' as const })),
    // Same finite window as SMA — the middle band IS an SMA, and the stdev is
    // taken over the same bars.
    lookback: (p) => (p.period as number) - 1,
    label: (p, inputs) => `BB(${p.period}, ${p.stdDev}) of ${inputs}`,
    run: bollingerRun,
  })
  .define({
    name: 'realizedVol',
    family: 'volatility',
    summary: 'Annualized realized vol from a daily variance: √(var·252), in percent',
    params: {},
    inputs: [{ role: 'input' }],
    outputs: [{ id: '', unit: '%' }],
    lookback: () => 0,
    label: (_p, inputs) => `Realized vol of ${inputs}`,
    run: realizedVolRun,
  })
  .define({
    name: 'diff',
    family: 'pair',
    summary: 'A − B, pointwise',
    params: {},
    inputs: [{ role: 'a' }, { role: 'b' }],
    outputs: [{ id: '', unit: 'inherit' }],
    lookback: () => 0,
    label: (_p, inputs) => `Spread of ${inputs}`,
    run: pairRun('diff'),
  })
  .define({
    name: 'ratio',
    family: 'pair',
    summary: 'A / B, pointwise (gaps on a zero denominator)',
    params: {},
    inputs: [{ role: 'a' }, { role: 'b' }],
    outputs: [{ id: '', unit: '' }],
    lookback: () => 0,
    label: (_p, inputs) => `Ratio of ${inputs}`,
    run: pairRun('ratio'),
  })
  .define({
    name: 'logRatio',
    family: 'pair',
    summary: 'log(A / B), pointwise (gaps unless both legs are positive)',
    params: {},
    inputs: [{ role: 'a' }, { role: 'b' }],
    outputs: [{ id: '', unit: 'log' }],
    lookback: () => 0,
    label: (_p, inputs) => `Log ratio of ${inputs}`,
    run: pairRun('logRatio'),
  });

/** The registry's type tracks its defs, which is what gives `define` its
 *  compile-time checking — but the corpus arrives as DATA, so the folded-in
 *  studies cannot appear in that type. The cast is the honest statement of
 *  that boundary: below it the registry is the runtime authority (`specId`
 *  throws on an unknown op), and above it only the hand-declared names are
 *  known statically. See {@link DeriveOp}. */
type OpRegistry = typeof HAND_OPS;

/**
 * Tidal's op vocabulary: the hand-declared ops above, then **the corpus**,
 * folded in from `@pond-ts/financial`'s runtime catalog rather than transcribed
 * (F-charts-25, asked for and delivered).
 *
 * `ADOPTED_STUDIES` is narrow on purpose. A study that reaches this registry
 * reaches the picker, the param controls, the labels and band detection — all
 * of which generate themselves from here — so the filter is the only gate, and
 * `adoptable` says why for each exclusion. TDL-STUDYCAT.
 */
export const TIDAL_OPS: OpRegistry = ADOPTED_STUDIES.reduce<OpRegistry>(
  (reg, d) => reg.define(catalogOp(d)) as unknown as OpRegistry,
  HAND_OPS,
);

/** The prefix the engine puts on the id of a spec that FAILS validation
 *  (`specId` under `validate: false`, 0.62.0) — a valid spec's id is
 *  byte-identical to the strict form, so nothing persisted moves. Treat ids as
 *  opaque otherwise; this prefix is the one sanctioned peek (the cheap
 *  "compilable?" test, and 4b's broken-chip discriminator). */
const BROKEN_ID_PREFIX = 'p1?:';

/** True if an id names a spec the registry REJECTS (bad params, wrong shape —
 *  a persisted-garbage spec). Such a spec can never fold, anywhere — distinct
 *  from a valid spec whose column merely isn't in the current feed. */
export const isBrokenId = (id: string): boolean => id.startsWith(BROKEN_ID_PREFIX);

/**
 * Deterministic id / output-column name for a spec — the engine's
 * content-addressed `specId` (`p1:op(inputs;params)`: versioned, params
 * defaulted + key-sorted, separators escaped, nested inputs inlined by their
 * own id). It doubles as the chart theme id, tracker label key, and selection
 * id (every role `SeriesConfig.id` plays), and it is a stable **persisted**
 * key: a preset spec and a freshly composed one land on the same identity by
 * construction.
 *
 * TOTAL since 0.62.0 (`validate: false`): a spec the registry rejects gets a
 * distinct `p1?:`-prefixed id (type-preserving param encoding) instead of a
 * throw — a broken persisted spec can no longer name (and key onto) the
 * working node, and naming never kills a caller (the old guard-totality
 * hazard). Validity itself is {@link isValidSpec}.
 */
export function deriveId(spec: DeriveSpec): string {
  return specId(TIDAL_OPS, spec, { validate: false });
}

/** Human lineage for a spec, derived from the registry (`explain`) — never
 *  hand-built, so `ema(sma(x))` keeps its inner study. The `TDL-LINEAGE`
 *  sub-line reads this. */
export function deriveLineage(spec: DeriveSpec): string {
  return explain(TIDAL_OPS, spec);
}

/** The **column names** a spec's top-level inputs resolve to: a string input
 *  is a raw column, a nested spec's column is its id. The machine's dependency
 *  walks (removal closure, travel sets) match configs against these. */
export function inputNames(spec: DeriveSpec): string[] {
  // `?? []`: persisted state is untyped at this boundary — an old-shape spec
  // (pre-`inputs`) must degrade to "no edges", never a TypeError mid-render.
  return (spec.inputs ?? []).map((i) => (typeof i === 'string' ? i : deriveId(i)));
}

/**
 * Rewrite every reference to the column `from`, at any depth, to `to` — the
 * substitution behind **edit propagation**: when a config's spec changes, the
 * column it publishes moves, and everything built on it must be re-pointed at
 * the new computation rather than left naming a column that no longer folds.
 *
 * Both ways a spec can name another are handled: a raw string input, and a
 * NESTED spec (composition nests, so a seated dependent carries a copy of its
 * source's spec — matched by its id, which is that source's column).
 *
 * Returns the SAME object when nothing matched, so callers can use identity as
 * a cheap "did this change" test.
 */
export function substituteInput(spec: DeriveSpec, from: string, to: DeriveInput): DeriveSpec {
  let changed = false;
  const inputs = (spec.inputs ?? []).map((i) => {
    if (typeof i === 'string') {
      if (i !== from) return i;
      changed = true;
      return to;
    }
    if (deriveId(i) === from) {
      changed = true;
      return to;
    }
    const sub = substituteInput(i, from, to);
    if (sub !== i) changed = true;
    return sub;
  });
  return changed ? { ...spec, inputs } : spec;
}

/**
 * True if the registry accepts this spec — the op exists, the shape is sound,
 * and every param is in range. Since 0.62.0 this reads the lenient id's
 * `p1?:` marker ({@link deriveId} is total), so it can never throw — but the
 * machine's guards still gate on it before ACTING: an invalid spec must be
 * refused, not seated (the try/catch stays as a belt for pathological
 * persisted shapes the totality claim was never made about).
 */
export function isValidSpec(spec: DeriveSpec): boolean {
  try {
    return !isBrokenId(deriveId(spec));
  } catch {
    return false;
  }
}

/**
 * True if the value is a readable spec node — an object naming an op.
 *
 * **Every reader below is TOTAL over persisted state**, and this is how. A spec
 * arrives from localStorage with no shape validation (`storedConfig` spreads it
 * straight through), so `inputs: [null]`, a missing `inputs`, and a non-object
 * where a node should be are all reachable. These readers run inside XState
 * GUARDS, where a throw kills the whole terminal actor — the hazard
 * `propagateRespec` belts with a try/catch (PR #130 review, and again in #141
 * for the readers that run *before* it).
 */
function isSpecLike(i: unknown): i is DeriveSpec {
  return typeof i === 'object' && i !== null && typeof (i as DeriveSpec).op === 'string';
}

/**
 * True if a spec is, or is built on, a **pair** — the test for "this series
 * states its own symbols".
 *
 * A pair names a symbol per leg, so the blanket compare counterpart (a dashed
 * second copy of every series on the comparison symbol) is meaningless for it:
 * `A − B` on the primary does not imply you wanted `A − B` on the comparison —
 * that is a different pair, and the grammar says to ask for it as one. Recursive
 * because a STUDY of a spread inherits the same argument (Peter, 2026-08-18).
 */
export function hasPairOp(spec: DeriveSpec): boolean {
  if (!isSpecLike(spec)) return false;
  return (
    isPairOp(spec.op) ||
    (spec.inputs ?? []).some((i) => typeof i !== 'string' && hasPairOp(i as DeriveSpec))
  );
}

/** True if any input (recursively) reads a compare-role column — the host
 *  must join the comparison series on before folding such a spec. */
export function usesCompare(spec: DeriveSpec): boolean {
  if (!isSpecLike(spec)) return false;
  return (spec.inputs ?? []).some((i) =>
    typeof i === 'string' ? i.startsWith(COMPARE_PREFIX) : usesCompare(i as DeriveSpec),
  );
}

// --- Reading a spec back as a TREE --------------------------------------------
// Composition writes a spec; the control panel has to read one back. A pair's
// parts are not seated configs — they exist only as structure inside the pair's
// own spec — so the Pair node's sub-rows are projected from the spec rather than
// looked up (TDL_PAIRS_PLAN, "the control panel expresses the tree").

/** One study wrapping a part, as read off the spec. */
export interface PartStudy {
  op: DeriveOp;
  params?: Readonly<Record<string, number>>;
}

/**
 * One leg of a pair, read back OUT of the pair's spec — the Metric/Part node.
 *
 * A leg is written by `boundLeg` as: the metric, wrapped in an optional study,
 * with a compare rebind pushed down to the LEAVES. Reading it back inverts
 * exactly that, which is why `entity` is decided at the leaf and not at the top.
 */
export interface PairPart {
  /** The metric this leg reads, compare prefix INTACT — the spec node to keep
   *  when rebuilding the leg (a raw column, or a derived metric's own spec). */
  metric: DeriveInput;
  /** {@link metric}'s published column with the compare prefix stripped: the
   *  name to look up for a display label, which is role-independent. */
  base: string;
  /** Which symbol the leg reads — `compare` when its leaves are prefixed. */
  entity: 'primary' | 'compare';
  /** The studies wrapping the metric, **innermost first** (application order). */
  studies: readonly PartStudy[];
}

/** Strip the compare rebind from an input's leaves — the inverse of the host's
 *  `underCompare`, used to name a leg independently of the role it reads. */
function unCompare(input: DeriveInput): DeriveInput {
  if (typeof input === 'string')
    return input.startsWith(COMPARE_PREFIX) ? input.slice(COMPARE_PREFIX.length) : input;
  if (!isSpecLike(input)) return input; // pathological persisted node — leave it
  return { ...input, inputs: (input.inputs ?? []).map(unCompare) };
}

/**
 * Decompose one pair leg into metric + binding + study chain, or **null** when
 * the leg isn't that shape — a leg can be any graph input, including a nested
 * PAIR (a spread of spreads is legal: `resolveLeg` accepts a seated spread).
 * Such a leg has no single metric to name, so the panel degrades to rendering
 * it flat rather than inventing a decomposition.
 *
 * "Study" here means a WINDOWED op ({@link opHasPeriod}) — the same
 * discriminator the config layer uses (`isStudySeries`). A single-input op with
 * no period (`realizedVol`) is a derived METRIC and terminates the walk, so
 * `RV · SMA(20)` reads as one metric with one study rather than two studies.
 */
export function readPart(input: DeriveInput): PairPart | null {
  const studies: PartStudy[] = [];
  let cur = input;
  while (isSpecLike(cur) && opHasPeriod(cur.op)) {
    const inputs = cur.inputs ?? [];
    if (inputs.length !== 1) return null; // windowed but multi-input: not a chain
    studies.unshift({ op: cur.op, params: cur.params });
    cur = inputs[0]!;
  }
  // Anything that isn't a plain column or a single-input metric node has no
  // name to give: a nested pair, the wrong arity, or a pathological persisted
  // node (`null`). Refuse rather than guess — or throw.
  if (typeof cur !== 'string') {
    if (!isSpecLike(cur) || isPairOp(cur.op) || (cur.inputs ?? []).length !== 1) return null;
  }
  const bare = unCompare(cur);
  const compare = typeof cur === 'string' ? cur !== bare : usesCompare(cur);
  return {
    metric: cur,
    base: typeof bare === 'string' ? bare : deriveId(bare),
    entity: compare ? 'compare' : 'primary',
    studies,
  };
}

/**
 * How a part's study prints — `SMA(20)`.
 *
 * An OMITTED period is the default, not an absent one: `deriveId` defaults and
 * key-sorts params, so `sma(x)` and `sma(x;period=20)` are one identity. Printed
 * naively that spec read `SMA(undefined)` (PR #141 review, LOW). One helper so
 * the pair's label and the panel's part row can't spell it differently.
 */
export const partStudyLabel = (st: PartStudy): string =>
  // `studyTag`, which reads the op's DECLARED params in order and defaults each
  // — so a band leg reads `BOLLINGER(20, 2)`. Hand-built off `params.period` it
  // read `BOLLINGER(20)`, and two bands differing only in `stdDev` produced
  // identical leg rows (PR #181 review, HIGH).
  studyTag({ op: st.op, inputs: [], params: st.params });

/** A pair spec's two legs as parts, or **null** if this isn't a pair op or
 *  either leg doesn't decompose. Pairs are strictly binary, so anything else
 *  is a shape we didn't write. */
export function readPairParts(spec: DeriveSpec): readonly [PairPart, PairPart] | null {
  if (!isSpecLike(spec) || !isPairOp(spec.op)) return null;
  const inputs = spec.inputs ?? [];
  if (inputs.length !== 2) return null;
  const a = readPart(inputs[0]!);
  const b = readPart(inputs[1]!);
  return a && b ? [a, b] : null;
}

/**
 * The unit a spec's output reads in, from the registry's own declaration —
 * `unitOf` resolves a RAW column's unit (the host's catalog).
 *
 * `'inherit'` is resolved as **inheritCommon**: the shared unit of the inputs,
 * else unitless. That distinction only bites on a pair — `diff` declares
 * `inherit` and the engine reads input 0 unconditionally, which is wrong for
 * unlike legs (`%` − `$` is not `%`). Computing it here is the local stand-in
 * for the `inheritCommon` ask on pond#543 position 2; when the engine gains it
 * this collapses to reading the graph's answer.
 */
export function specUnit(spec: DeriveSpec, unitOf: (column: string) => string): string {
  if (!isSpecLike(spec)) return ''; // total over persisted garbage — see isSpecLike
  const declared = TIDAL_OPS.describe().find((d) => d.name === spec.op)?.outputs?.[0]?.unit;
  if (declared == null) return '';
  if (declared !== 'inherit') return declared;
  const units = (spec.inputs ?? []).map((i) =>
    typeof i === 'string' ? unitOf(i) : specUnit(i, unitOf),
  );
  const first = units[0];
  return first != null && units.every((u) => u === first) ? first : '';
}

/** One spec the fold could not compute, keyed by the spec's own id (a broken
 *  spec's id carries the `p1?:` prefix — see {@link isBrokenId}). `code` is
 *  the engine's per-class literal (`'UnknownColumnError'` = the column isn't
 *  in this feed, could fold elsewhere → a dimmed-removable chip;
 *  `'ParamError'` = the spec itself is garbage → a broken chip); ABSENT code
 *  means the throw came from op code, not the plan layer. Compare the string
 *  literal, never `err.name` — bundlers rename classes. */
export interface DeriveSkip {
  id: string;
  code?: string;
  reason: string;
}

/**
 * Fold a set of derive specs onto a series, appending each spec's output
 * column (`deriveId(spec)`) and REPORTING what didn't fold — `bind` + `run`
 * over {@link TIDAL_OPS} with `onError: 'skip'`: a spec that can't resolve
 * (unknown column, bad params — a preset can reference a column that no
 * longer exists) is skipped rather than thrown, its dependents skip with it,
 * and each lands in `skipped` exactly once (the engine reports a failing spec
 * per pass — plan + selector — so entries dedupe on the spec's id). Since
 * 0.62.0 nothing is pre-filtered: broken specs flow through and report, which
 * is what the chip UI reads (TDL_PAIRS_PLAN, the ghost-spread debt).
 * Duplicate specs in the set are one node by content-addressing. Pure +
 * deterministic (memo-friendly).
 *
 * Deliberately a **cold bind per fold** for now — same cost shape as the local
 * fold it replaced, kept simple while semantics settle. The warm long-lived
 * graph (a `Host` keyed by source, `setSourceFrom` on live appends, ranged
 * recompute) is the follow-up where the engine's caching starts paying.
 */
export function applyDerivedReport(
  series: DerivedSeries,
  specs: readonly DeriveSpec[],
  units?: Units,
): { series: DerivedSeries; skipped: DeriveSkip[] } {
  if (specs.length === 0) return { series, skipped: [] };
  // NOT idempotent over an already-folded series: an output column that
  // already exists collides at assembly, that spec skips, and any spec
  // NESTING it skips with it (pinned by test). No render path refolds today
  // (sources are raw/joined); the warm-Host stage binds raw sources only,
  // which retires the hazard. Fold RAW series.
  const graph = bind(series, { registry: TIDAL_OPS, units });
  const result = run(graph, {
    plan: [...specs],
    select: specs.map((s) => ({ on: s })),
    onError: 'skip',
  });
  const skipped = new Map<string, DeriveSkip>();
  for (const s of result.skipped) {
    // The plan pass echoes `spec`; the selector pass carries it as the
    // select's `on`. Either names the same node — the id dedupes the pair.
    const spec = (s.spec ?? (s.select as { on?: unknown } | undefined)?.on) as
      DeriveSpec | undefined;
    if (!spec) continue;
    // BELT: even lenient `specId` still TypeErrors on pathological persisted
    // shapes (`params: null`, `inputs: [null]`) that the ENGINE itself
    // survives under skip — naming the report entry must not out-crash the
    // fold it reports on (PR #133 review, MEDIUM). Such a shape gets a
    // synthetic broken-prefixed key; identical echoes still dedupe. (Known
    // upstream wrinkle, reported: the PLAN pass normalizes `params: null` to
    // `{}` in its echo, so that shape's entry can key onto the DEFAULTED
    // spec's valid id — inert until chip states consume `skipped`.)
    let id: string;
    try {
      id = deriveId(spec);
    } catch {
      id = `${BROKEN_ID_PREFIX}${JSON.stringify(spec) ?? 'unnameable'}`;
    }
    if (!skipped.has(id)) skipped.set(id, { id, code: s.code, reason: s.reason });
  }
  return { series: result.series ?? series, skipped: [...skipped.values()] };
}

/** {@link applyDerivedReport} without the report — the fold most render paths
 *  want (the chart's column-absence handling is the render half of the skip
 *  contract). */
export function applyDerived(
  series: DerivedSeries,
  specs: readonly DeriveSpec[],
  units?: Units,
): DerivedSeries {
  return applyDerivedReport(series, specs, units).series;
}

/** One op the study menu can offer, straight from the registry — so a new op
 *  appears in the picker by being defined, never by being listed twice. */
export interface StudyOption {
  op: DeriveOp;
  /** Display name (`SMA`, `Realized vol`). */
  label: string;
  /** The registry's one-line summary — the picker's muted description. */
  summary: string;
  family: string;
}

/** Whether an op declares a `period` param — i.e. whether it is WINDOWED, and
 *  so whether a study of it should carry one. Stamping `{period}` onto an op
 *  that declares no params mints a spec the registry rejects, and the machine's
 *  guard then refuses the add with no feedback (PR #137 review, MEDIUM). */
export function opHasPeriod(op: DeriveOp): boolean {
  return TIDAL_OPS.describe().some((d) => d.name === op && 'period' in d.params);
}

/** One tunable param of an op, as the registry declares it — the study controls
 *  are generated from these rather than from a hardcoded list, so a new op with
 *  a second param gets a control by being defined. */
export interface OpParam {
  name: string;
  /** `'integer'` steps whole; `'number'` accepts fractions (a band's `stdDev`). */
  kind: 'number' | 'integer';
  default: number;
  /** Legal bounds — outside them the registry REJECTS the spec. */
  min?: number;
  max?: number;
  /** The useful range a control should be drawn on, when narrower than legal. */
  suggest?: readonly [number, number];
}

/**
 * An op's numeric params, in declaration order.
 *
 * The registry is the single source of truth for what a study can be tuned by
 * — `sma` has one param, a band has two — so anything that offers those knobs
 * reads them from here. Non-numeric params (none today) are skipped rather
 * than coerced.
 */
export function opParams(op: DeriveOp): OpParam[] {
  const def = TIDAL_OPS.describe().find((d) => d.name === op);
  if (!def) return [];
  const out: OpParam[] = [];
  for (const [name, p] of Object.entries(def.params)) {
    if (p.kind !== 'number' && p.kind !== 'integer') continue;
    out.push({
      name,
      kind: p.kind,
      default: p.default,
      ...(p.min === undefined ? {} : { min: p.min }),
      ...(p.max === undefined ? {} : { max: p.max }),
      ...(p.suggest === undefined ? {} : { suggest: p.suggest }),
    });
  }
  return out;
}

/**
 * How a study names itself — the op, then the params it was actually tuned
 * with, in the registry's declared order: `SMA(20)`, `BOLLINGER(20, 2)`.
 *
 * Read off the spec against the registry rather than off a known field, so a
 * study with a second param cannot lose half its name to a reader that only
 * knew about `period`.
 */
export function studyTag(spec: DeriveSpec): string {
  const vals = opParams(spec.op).map((p) => spec.params?.[p.name] ?? p.default);
  return vals.length === 0 ? spec.op.toUpperCase() : `${spec.op.toUpperCase()}(${vals.join(', ')})`;
}

/**
 * Whether a study of this op may draw on its SOURCE's axis.
 *
 * Pond's rule, shipped with the catalog's `unit` field: only `'inherit'` may
 * share. A study that reads in its own units needs its own scale, or it
 * stretches the axis it landed on — an RSI (0..100) beside a vol reading (~20)
 * is the case that made this visible.
 *
 * The hand-declared ops answer from the registry (`sma`/`ema`/`bollinger` are
 * `inherit` and do share); the corpus answers from the catalog, because the
 * registry holds a TRANSLATED unit in which `delta` reads as `inherit` — it
 * formats like its source but must not sit on its axis.
 */
export function opSharesSourceAxis(op: DeriveOp): boolean {
  if (OWN_AXIS_STUDIES.has(op)) return false;
  const def = TIDAL_OPS.describe().find((d) => d.name === op);
  return (def?.outputs ?? []).every((o) => o.unit === 'inherit');
}

/**
 * An op's declared input ROLES, in declaration order — what a spec's `inputs`
 * array must line up with positionally.
 *
 * `[{ role: 'column' }]` for a study of one column, which is what composes (an
 * SMA of an SMA nests). A multi-input study names bar columns instead
 * (`high`/`low`/`close`), because it is a study of a SERIES rather than of a
 * column, and its `default` is the column to bind.
 */
export function opInputs(op: DeriveOp): { role: string; default?: string }[] {
  // From the CATALOG, not the registry: `@pond-ts/process`'s `InputDef` is
  // `{ role, unit? }` and has nowhere to carry a default, so `catalogOp` cannot
  // round-trip one. Reading the registry back gave every role
  // `default: undefined`, which bound an ATR's `high` to nothing and threw
  // inside `specId` — caught by the fold test, which is exactly what it is for.
  const d = ADOPTED_STUDIES.find((x) => x.name === op);
  if (d) {
    return d.inputs.map((i) => ({
      role: i.role,
      ...(typeof i.default === 'string' ? { default: i.default } : {}),
    }));
  }
  const def = TIDAL_OPS.describe().find((x) => x.name === op);
  return (def?.inputs ?? []).map((i) => ({ role: i.role }));
}

/**
 * Input roles that bind to the study's TARGET rather than to a bar column.
 *
 * Two spellings for one idea: the corpus calls it `column` and Tidal's
 * hand-declared ops call it `input`. Everything else names the bar column it
 * wants (`high`, `low`, `close`, `volume`), and a multi-input study has no
 * target role at all — an ATR is of a SERIES, not of a column.
 */
export const TARGET_ROLES: ReadonlySet<string> = new Set(['column', 'input']);

/**
 * The raw bar columns a study of this op needs beyond its target's own column
 * — empty for a single-column study.
 *
 * The picker asks this to decide whether an op is offerable on a given series:
 * only the PRICE series carries bars, so an ATR is offerable there and not on a
 * vol series, where `high` names nothing and the fold would skip the spec.
 */
export function opNeedsColumns(op: DeriveOp): string[] {
  const d = ADOPTED_STUDIES.find((x) => x.name === op);
  if (d) return studyNeedsColumns(d);
  // Hand-declared ops: their roles are `input`/`a`/`b`, bound by the caller.
  return [];
}

/**
 * An op's declared output SUFFIXES, in declaration order — the engine names one
 * column per entry off the spec id, and a runner returns them in this order.
 *
 * `['']` for a single-output op, whose column IS the id. More than one entry
 * makes the config's `column` a PREFIX rather than a readable column, which is
 * the thing every data scanner has to go through `configColumns` for.
 */
export function opOutputs(op: DeriveOp): string[] {
  const def = TIDAL_OPS.describe().find((d) => d.name === op);
  // `suffix` on the way OUT, `id` on the way in: `define`'s `OutputDef` calls it
  // `id` and `describe`'s descriptor renames it `suffix`. Nothing read the field
  // until now — `specUnit` reads `unit` and `opIsBand` read `length` — so the
  // divergence surfaced here first.
  if (!def) return [''];
  return def.outputs.map((o) => o.suffix);
}

/**
 * Whether an op's outputs are a BAND — the exact `Middle`/`Upper`/`Lower`
 * triple, in any order.
 *
 * This was "more than one output", which was true only while a band was the
 * only wide mark Tidal could draw. It is not any more: a MACD is three outputs
 * and no band, and `bandColumns` would have looked for a `…Middle` column that
 * does not exist. The shape is the test, and it agrees with the adoption
 * filter's by reading the same {@link BAND_OUTPUTS} list.
 */
export function opIsBand(op: DeriveOp): boolean {
  const ids = opOutputs(op);
  return ids.length === BAND_OUTPUTS.length && BAND_OUTPUTS.every((b) => ids.includes(b));
}

/** Whether an op produces SEVERAL columns that are not a band — drawn as N
 *  lines off one spec (`style: 'lines'`), one per declared output. */
export function opIsMulti(op: DeriveOp): boolean {
  return opOutputs(op).length > 1 && !opIsBand(op);
}

/** `sma` → `SMA`; `realizedVol` → `Realized vol`. Acronym-ish short names go
 *  upper, longer camelCase names read as a sentence. */
function opLabel(name: string): string {
  if (name.length <= 4 && name === name.toLowerCase()) return name.toUpperCase();
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The ops offerable as a **study** of one series: every single-input,
 * column-producing op in {@link TIDAL_OPS}. Generated from the registry's own
 * descriptors (`describe()`), which is the point of declaring a vocabulary —
 * the picker's names, groups and descriptions cannot drift from what the
 * engine will actually run (`TDL-STUDYMENU`).
 *
 * Pair ops are excluded by arity (they take two inputs and are built through
 * the pair picker instead). NOTE: the registry cannot yet declare what UNIT an
 * input expects, so a domain transform like `realizedVol` (which wants a
 * variance) is offered on any series — see the unit-expectation ask logged in
 * CHARTS_FRICTION.
 */
export function studyCatalog(): StudyOption[] {
  return (
    TIDAL_OPS.describe()
      // Arity used to be the discriminator ("one input ⇒ a study"), which stopped
      // working the moment a study could read high/low/close. The PAIR ops are
      // what this excludes, and they are excluded by being pair ops — they take
      // two SUBJECTS and are built through the pair picker, where a multi-input
      // study takes one subject and several of its columns.
      .filter((d) => d.kind === 'op' && !isPairOp(d.name))
      .map((d) => ({
        op: d.name as DeriveOp,
        label: opLabel(d.name),
        summary: d.summary,
        family: d.family,
      }))
  );
}
