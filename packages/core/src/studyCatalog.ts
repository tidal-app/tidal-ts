import { STUDIES } from '@pond-ts/financial/catalog';
import { int, num, type Def, type OpContext, type OpResult } from '@pond-ts/process';
import type { Column, SeriesSchema, TimeSeries } from 'pond-ts';

/**
 * The corpus's **runtime study catalog**, mapped onto Tidal's op registry.
 *
 * `STUDIES` (`@pond-ts/financial/catalog`, shipped in 0.67.0 — F-charts-25,
 * asked for and delivered) is one `StudyDescriptor` per study: input roles,
 * params with bounds and `suggest`, output suffixes with units, and `run`. All
 * of that is exactly what a `@pond-ts/process` registry wants, so the adoption
 * is a MAP rather than a transcription — which was the whole point of the ask.
 *
 * Everything downstream of the registry already generates itself from it: the
 * study picker (`studyCatalog()`), the param controls (`opParams`), the labels
 * (`studyTag`), band detection (`opIsBand`). So a study reaching `TIDAL_OPS`
 * reaches the product. That is the leverage, and it is also the hazard — which
 * is why {@link adoptable} is narrow and says why for each exclusion.
 *
 * Plan of record: `docs/plans/TDL_STUDIES_PLAN.md` (TDL-STUDYCAT).
 */

/**
 * The output suffixes a `band` config reads, in the order a band op returns
 * them (the engine pairs them positionally, so the two lists are one list).
 *
 * Lives HERE rather than in `derive.ts` because the adoption filter and the
 * band style have to agree about what a band is, and the only way to agree is
 * to read one list. `derive.ts` re-exports it under the same name.
 */
export const BAND_OUTPUTS = ['Middle', 'Upper', 'Lower'] as const;

/** A descriptor as the catalog declares it — structurally, so this module does
 *  not depend on the catalog's exported type names. */
type Descriptor = (typeof STUDIES)[number];

type CatalogParam = {
  kind: string;
  default?: number | string;
  example?: number;
  min?: number;
  max?: number;
  suggest?: readonly [number, number];
};

/** The schema-erased series the corpus reads and writes (as in derive.ts). */
type DerivedSeries = TimeSeries<SeriesSchema>;

/**
 * A private column name for the corpus call. We hand the study a name we chose,
 * read the columns straight back out, and let the ENGINE name the real ones off
 * the spec id — so no mapping layer sits between the corpus's naming and ours.
 */
const OUT = '__tdlStudy';

/**
 * The bar columns Tidal can bind a study's input roles to.
 *
 * The price series carries open/high/low/close/volume (`fixture.ts`'s schema,
 * and the columnar adapter's); the vol series carries `VOL_SCHEMA` and has no
 * bars at all. So a study reading `high`/`low` is offerable on a PRICE series
 * and nowhere else — {@link studyNeedsColumns} is what lets the picker ask.
 */
const BAR_COLUMNS: ReadonlySet<string> = new Set(['open', 'high', 'low', 'close', 'volume']);

/**
 * The raw bar columns a study needs beyond its target's own column.
 *
 * Empty for a single-`column` study, which reads whatever it is a study OF —
 * that is what makes an SMA of an SMA compose. A multi-input study is not "of a
 * column" but "of a SERIES": an ATR reads high, low and close directly, so its
 * inputs are the roles' own defaults and its target only decides which row it
 * lands in.
 */
export function studyNeedsColumns(d: Descriptor): string[] {
  return d.inputs.filter((i) => i.role !== 'column').map((i) => i.default as string);
}

/** True if every input role can be bound: the single `column` role to the
 *  target, and every other role to a bar column we actually carry. */
const bindable = (d: Descriptor): boolean =>
  d.inputs.every(
    (i) => i.role === 'column' || (typeof i.default === 'string' && BAR_COLUMNS.has(i.default)),
  );

/** True if every declared param is numeric. */
const numericParams = (d: Descriptor): boolean =>
  Object.values((d.params ?? {}) as Record<string, CatalogParam>).every(
    (p) => p.kind === 'integer' || p.kind === 'number',
  );

/**
 * The corpus's unit vocabulary, in Tidal's display terms.
 *
 * Pond declares a closed vocabulary of 8; Tidal's `axisFormat` speaks `'$'` /
 * `'%'` / `'variance'` / `'count'` / unitless. Translating HERE keeps one
 * vocabulary inside the registry, so `specUnit` and every axis label go on
 * working unchanged — folding pond's words in raw would have left the registry
 * bilingual, with `'percent'` reaching a formatter that only knows `'%'`.
 *
 * `delta` maps to `'inherit'` on purpose: a difference genuinely IS in its
 * source's units (a momentum of a price is a price move), so it should FORMAT
 * like its source. It must not SHARE its source's axis, though, which is a
 * different question — see {@link sharesSourceAxis}.
 */
const DISPLAY_UNIT: Readonly<Record<string, string>> = {
  inherit: 'inherit',
  delta: 'inherit',
  percent: '%',
  ratio: '',
  volume: 'count',
  bars: 'count',
  index: '',
  signal: '',
};

/**
 * Whether a study may draw on its source's axis — pond's rule, and the reason
 * the `unit` field was worth asking for: **only `'inherit'` may share.**
 *
 * Read off the CATALOG's unit rather than the registry's, because the registry
 * holds the translated display unit and `delta` deliberately translates to
 * `'inherit'` there. An RSI on the vol axis is the failure this prevents: it is
 * bounded 0..100 against a vol reading ~20, so sharing stretches the axis five
 * times and squashes the series the study was meant to explain.
 */
export const sharesSourceAxis = (d: Descriptor): boolean =>
  d.outputs.every((o) => o.unit === 'inherit');

/**
 * The suffix the PRIMARY output is declared under when the catalog leaves it
 * empty.
 *
 * `@pond-ts/financial`'s catalog and `@pond-ts/process`'s registry disagree
 * here, and the registry is the stricter of the two: 12 studies declare an
 * unnamed primary beside a named secondary (`trix` is `['', 'Signal']`), and
 * `define` refuses that outright — _"every output needs a suffix — '' would
 * collide with the spec id"_. It is right to refuse: with two outputs, one of
 * them cannot also BE the id.
 *
 * So the registry sees `Value`/`Signal` where the catalog said `''`/`Signal`.
 * The lists are deliberately different and must not be conflated:
 * {@link catalogRun} reads the CORPUS by the catalog's own suffix, while the
 * engine names OUR column off the registry's. Logged as F-charts-27.
 */
const PRIMARY_SUFFIX = 'Value';

/** The suffixes to DECLARE for a descriptor — the catalog's, except that a
 *  multi-output op's empty primary is named (see {@link PRIMARY_SUFFIX}). */
function declaredSuffixes(d: Descriptor): string[] {
  const ids = d.outputs.map((o) => o.id);
  if (ids.length < 2) return ids;
  return ids.map((id) => (id === '' ? PRIMARY_SUFFIX : id));
}

/**
 * The per-output MARK, where the catalog cannot say — the render overlay.
 *
 * `unit` answers axis membership completely, and `outputs` answers how many
 * columns there are, but nothing in the descriptor says how any one of them
 * should be DRAWN. A MACD is `Line` / `Signal` / `Hist`, all three `delta`: the
 * catalog's answer is complete and still insufficient, because two of them are
 * lines and the third is a histogram. That is F-charts-26's headline case and
 * this map is the workaround it asks to delete.
 *
 * Hand-declared and keyed by (op, suffix) rather than inferred from the name.
 * `Hist` occurs exactly ONCE in the whole 109-study corpus, so a `/hist/i` rule
 * would be a special case wearing a rule's clothes — it would fire on this one
 * study and silently miss any future histogram named anything else. A band
 * could be a rule because `Upper`/`Lower` recurs nine times; this cannot.
 */
const OUTPUT_MARKS: Readonly<Record<string, Readonly<Record<string, 'bar'>>>> = {
  // The histogram is the MACD line minus its signal, so it crosses zero exactly
  // where the two lines cross — which is the reading most people take off a
  // MACD, and it is unavailable when the difference is drawn as a third line.
  macd: { Hist: 'bar' },
};

/** How one declared output should be drawn. `'line'` unless the overlay says
 *  otherwise — see {@link OUTPUT_MARKS}. */
export function outputMark(op: string, suffix: string): 'line' | 'bar' {
  return OUTPUT_MARKS[op]?.[suffix] ?? 'line';
}

/** The output suffixes, which is also the order {@link catalogRun} returns them
 *  in — the engine pairs them positionally. */
const suffixes = (d: Descriptor): string[] => d.outputs.map((o) => o.id);

/**
 * True if the outputs are a band **Tidal's `band` style can actually read**.
 *
 * Keyed on the output IDS, not on `family`: `family: 'bands'` is a MENU
 * grouping, and reading it as a render instruction gets two cases wrong in
 * opposite directions — `bollingerBandwidth` and `bollingerPercentB` are
 * `'bands'` and are single-output oscillators, while `ichimoku`'s cloud is
 * `'trend'`. Declaration order does not matter: `donchian` declares
 * Upper/Lower/Middle where the rest declare Middle/Upper/Lower. SIX studies
 * match — not the eight in `family: 'bands'`, for the reason below.
 *
 * The test is the EXACT {@link BAND_OUTPUTS} set, not "has an Upper and a
 * Lower", because `bandColumns` reads all three suffixes off the spec id and a
 * missing one names a column that does not exist. Two shapes in the corpus
 * would otherwise qualify and then fail to draw:
 *
 * - `rainbowOscillator` declares `['', 'Upper', 'Lower']` — its main output IS
 *   the id, so there is no `…Middle`. It is excluded today only by its enum
 *   param, which means TDL-STUDYENUM would have made it adoptable and
 *   `opIsBand` would have rendered it as a band with an empty wash.
 * - `atrBands` and `primeNumberBands` declare `['Upper', 'Lower']` with no
 *   centre at all. A two-output band is a real mark Tidal cannot draw yet.
 *
 * Both are TDL-STUDYDRAW's problem, and both should be excluded by the RULE
 * rather than by a filter clause that happens to catch them.
 *
 * F-charts-26 asks for this to be declared rather than inferred.
 */
export const isBandShape = (d: Descriptor): boolean => {
  const ids = suffixes(d);
  return ids.length === BAND_OUTPUTS.length && BAND_OUTPUTS.every((b) => ids.includes(b));
};

/** Ops Tidal declares BY HAND, which the loop must not redeclare.
 *
 *  `sma`/`ema`/`bollinger` are kept hand-written on purpose: they carry exact
 *  `lookback` declarations (`period - 1`, and `4 * period` for the IIR — a claim
 *  about acceptable error that only the op can make) which the catalog does not
 *  carry, plus hand-written labels. Regenerating them would TRADE those away
 *  for uniformity. `realizedVol` is ours and not in the corpus at all
 *  (F-charts-11); the pair ops are two-input. */
const HAND_DECLARED = new Set([
  'sma',
  'ema',
  'bollinger',
  'realizedVol',
  'diff',
  'ratio',
  'logRatio',
]);

/**
 * Whether a descriptor can be adopted as-is, today.
 *
 * Deliberately narrow. Each clause is a seam Tidal has not built yet, and the
 * roadmap task that builds it — a study that reaches the registry reaches the
 * picker, so "offered but wrong" is worse than "not offered".
 */
export function adoptable(d: Descriptor): boolean {
  // Already ours, with something better than the generated version.
  if (HAND_DECLARED.has(d.name)) return false;
  // Every input role must bind: the `column` role to the target, the rest to a
  // bar column we carry. That admits the 54 studies reading high/low/close/
  // volume off a bar series (TDL-STUDYINPUT) and still refuses the 4 wanting a
  // benchmark SERIES, whose role carries no default at all — a second subject,
  // which is the compare seam's job (TDL-STUDYBENCH).
  if (!bindable(d)) return false;
  // Numeric params only. 18 studies declare an enum (mostly one shared `maType`
  // vocabulary); `@pond-ts/process` has `EnumParam`, so the REGISTRY would take
  // them — it is `ParamControl` that is numeric-only. TDL-STUDYENUM.
  if (!numericParams(d)) return false;
  // Multi-output is in: a band draws as a wash (`style: 'band'`), and anything
  // else draws as N lines off one spec (`style: 'lines'`), one per declared
  // output. What is still missing is a per-output MARK — a MACD's histogram
  // draws as a line here, which is legible but not the conventional
  // presentation, and `ichimoku`'s cloud wants a fill between two of its five.
  // Those are the named exceptions in TDL-STUDYDRAW, not a reason to withhold
  // the studies.
  // A `signal` output is STATE, not a series: a direction flag, a cross event,
  // an impulse. Drawing one as a line is meaningless — it belongs beside its
  // sibling as a colour driver, or alone as a marker, and Tidal has neither
  // channel for a study yet. `elderImpulse` is the one that reaches here (the
  // other five carry an enum or a second column and are already out).
  // TDL-STUDYDRAW.
  if (d.outputs.some((o) => o.unit === 'signal')) return false;
  // An `anchor` is CONTEXT, not a control: `sessionVwap` needs the series
  // tagged with session ids and `anchoredVwap` needs an anchor time, neither of
  // which Tidal supplies to the fold — so both compute nothing at all rather
  // than computing something wrong. Pond flagged this in the reply that shipped
  // the catalog, and the fold test caught it independently (2 of 58 producing
  // no column), which is the useful kind of agreement. TDL-STUDYANCHOR.
  if (d.anchor != null) return false;
  return true;
}

/** The studies adopted into the registry, in catalog order. */
export const ADOPTED_STUDIES: readonly Descriptor[] = STUDIES.filter(adoptable);

/**
 * Names of **adopted** studies that must not share their source's axis, so a
 * consumer can ask without holding the catalog.
 *
 * Built from {@link ADOPTED_STUDIES}, not from the whole corpus: a hand-declared
 * op must answer from the REGISTRY, which is Tidal's own declaration and
 * outranks the catalog for a name Tidal owns. Scoping it here is what keeps
 * that precedence right — over the whole corpus, a future hand-declared op
 * sharing a catalog study's name would silently take the catalog's answer.
 */
export const OWN_AXIS_STUDIES: ReadonlySet<string> = new Set(
  ADOPTED_STUDIES.filter((d) => !sharesSourceAxis(d)).map((d) => d.name),
);

/** Map one catalog param onto the registry's param vocabulary.
 *
 *  `example` means "no default, here is a sensible value" — the catalog uses it
 *  for the 16 required params. The registry needs a concrete default to fill, so
 *  the example becomes it; that is the only place this mapping invents anything,
 *  and inventing the corpus's own suggestion is the safe version. */
/* KNOWN GAP: `optional` and `requires` are dropped. Exactly one study in the
 * corpus uses them (`balanceOfPower`: an optional `period`, and a `maType` that
 * `requires` it), and it carries an enum so it is not adoptable anyway. The
 * registry has no vocabulary for a conditional param, so this is a silent drop
 * that becomes a real one the day TDL-STUDYENUM lands — noted here rather than
 * discovered there. */
function mapParam(p: CatalogParam) {
  const fallback = typeof p.default === 'number' ? p.default : p.example;
  const spec = {
    default: fallback ?? 0,
    ...(p.min === undefined ? {} : { min: p.min }),
    ...(p.max === undefined ? {} : { max: p.max }),
    ...(p.suggest === undefined ? {} : { suggest: p.suggest }),
  };
  return p.kind === 'integer' ? int(spec) : num(spec);
}

/**
 * A generic `run` for any single-column study.
 *
 * Replaces the per-op adapters (`corpusStudy`, `bollingerRun`), which were each
 * hardwired to one param name, one input and one output shape. This one reads
 * the shape off the descriptor: the declared params go through as options, the
 * single input binds by its declared role, and `naming.kind` decides whether
 * the corpus is asked for one named column or a prefixed family.
 */
export function catalogRun(d: Descriptor): (ctx: OpContext) => OpResult {
  // The CATALOG's suffixes, not the declared ones: this reads columns back out
  // of the corpus, which names them the way the catalog says. The engine then
  // names our columns off `declaredSuffixes`. Positional, so the two lists line
  // up index by index and never need to match by string.
  const ids = suffixes(d);
  // EVERY role, not just the first: a multi-input study reads high, low and
  // close, and binding only `inputs[0]` handed the corpus `high: undefined`,
  // which fails inside the study rather than at our seam.
  const roles = d.inputs.map((i) => i.role);
  const wide = d.naming.kind === 'prefix';
  const study = d.run as (s: unknown, o: Record<string, unknown>) => unknown;
  return (ctx: OpContext): OpResult => {
    // No missing-column pre-check: the engine rejects an unknown raw input at
    // COMPILE, so a gone-column spec never reaches here (pond#666 → #667).
    const bound: Record<string, unknown> = { ...ctx.params };
    for (const role of roles) bound[role] = ctx.inputs[role];
    const out = study(ctx.series, {
      ...bound,
      ...(wide ? { prefix: OUT } : { output: OUT }),
    }) as DerivedSeries;
    const read = out as unknown as { column(n: string): Column | undefined };
    if (!wide) {
      const col = read.column(OUT);
      if (!col) throw new Error(`${ctx.id}: ${d.name} produced no column`);
      return col;
    }
    // Positional, matching the declared `outputs` order.
    return ids.map((id) => {
      const col = read.column(`${OUT}${id}`);
      if (!col) throw new Error(`${ctx.id}: ${d.name} produced no ${id || 'value'} column`);
      return col;
    });
  };
}

/**
 * One catalog descriptor as a registry definition.
 *
 * `lookback` is deliberately OMITTED. The catalog does not carry it, it is
 * per-study knowledge (`sma` is `period - 1`; an IIR has no exact finite answer
 * and the multiplier is a claim about acceptable error), and the registry
 * documents omitted as **unknown, not zero** — `requiredHistory` reports the
 * gap rather than handing back a number a caller would slice against. So
 * omitting costs us the history-slicing win on these studies and cannot make a
 * warm-up hole read as data. Inventing a multiplier for 26 studies would be the
 * opposite trade. Asked for in F-charts-26.
 */
export function catalogOp(d: Descriptor): Def {
  const params = Object.fromEntries(
    Object.entries((d.params ?? {}) as Record<string, CatalogParam>).map(([k, p]) => [
      k,
      mapParam(p),
    ]),
  );
  return {
    name: d.name,
    family: d.family,
    summary: d.summary,
    params,
    inputs: d.inputs.map((i) => ({ role: i.role })),
    // DECLARED suffixes, which differ from the catalog's for the 12 studies with
    // an unnamed primary — `catalogRun` still reads the corpus by the catalog's.
    outputs: declaredSuffixes(d).map((id, i) => ({
      id,
      unit: DISPLAY_UNIT[d.outputs[i]!.unit] ?? '',
    })),
    run: catalogRun(d),
  } as unknown as Def;
}
