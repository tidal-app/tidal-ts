import { describe, expect, it } from 'vitest';
import { TimeSeries } from 'pond-ts';
import { STUDIES } from '@pond-ts/financial/catalog';
import { ADOPTED_STUDIES, adoptable, isBandShape, outputMark } from './studyCatalog.js';

/** The bar columns a non-`column` input role may bind to. */
const BARS = ['open', 'high', 'low', 'close', 'volume'];
import {
  applyDerived,
  deriveId,
  opParams,
  studyCatalog,
  studyTag,
  opInputs,
  opNeedsColumns,
  opOutputs,
  TARGET_ROLES,
  TIDAL_OPS,
  type DeriveSpec,
} from './derive.js';

// Bars, not just a value column: 54 adopted studies read high/low/close/volume
// off a bar series, so a single-column fixture could not fold them.
const SCHEMA = [
  { name: 'time', kind: 'time' },
  { name: 'x', kind: 'number' },
  { name: 'open', kind: 'number' },
  { name: 'high', kind: 'number' },
  { name: 'low', kind: 'number' },
  { name: 'close', kind: 'number' },
  { name: 'volume', kind: 'number' },
] as const;

/** A spec with its inputs bound the way `studySpec` binds them: the single
 *  `column` role to the target, every other role to its declared bar column. */
const specFor = (op: string, target = 'x'): DeriveSpec => ({
  op,
  inputs: opInputs(op).map((r) => (TARGET_ROLES.has(r.role) ? target : (r.default ?? target))),
});

/**
 * A rising series long enough to warm up anything in the adopted set.
 *
 * 1,200 rows, not a round 300: `specialK` sums ROC terms with periods out past
 * 700 bars, so it reads entirely empty on a short series. Which is the concrete
 * argument for F-charts-26's `lookback` ask — the catalog cannot tell a
 * consumer that, so nothing but running it reveals the requirement.
 */
const series = (n = 1_200) =>
  TimeSeries.fromColumns({
    name: 't',
    schema: SCHEMA,
    columns: (() => {
      // Not monotonic — several adopted studies divide by a rolling range or a
      // deviation, and a perfectly straight line makes those degenerate.
      const close = Array.from({ length: n }, (_, i) => 100 + i * 0.3 + Math.sin(i / 4) * 6);
      return {
        time: Array.from({ length: n }, (_, i) => i * 86_400_000),
        x: close,
        close,
        // A real bar: high above, low below, open between. A zero-range bar
        // makes every true-range study degenerate, so the spread is never 0.
        open: close.map((c, i) => c - Math.sin(i / 7) * 0.8),
        high: close.map((c, i) => c + 1.5 + Math.abs(Math.cos(i / 3)) * 1.2),
        low: close.map((c, i) => c - 1.5 - Math.abs(Math.sin(i / 5)) * 1.2),
        volume: Array.from(
          { length: n },
          (_, i) => 1_000_000 + Math.abs(Math.sin(i / 6)) * 500_000,
        ),
      };
    })(),
    sort: true,
  });

describe('studyCatalog — the corpus folded into the registry', () => {
  it('adopts a narrow set, and every exclusion has a named reason', () => {
    // The filter is the ONLY gate between the catalog and the product, so its
    // shape is worth pinning: a widening should be a deliberate edit here.
    expect(STUDIES.length).toBe(109);
    // The EXACT count, not a floor. A `> 20` bound is what let a stale "26"
    // (counted before `signal` outputs were excluded) reach the PR body and
    // both plan docs — the number is quoted in prose, so it has to be pinned
    // where prose can be checked against it.
    expect(ADOPTED_STUDIES.length).toBe(77);
    // THREE counts exist and only one is user-visible: 84 ops in the registry,
    // **81 in the picker** (the 3 pair ops are built through the pair picker),
    // 77 of those adopted from the catalog. Quoting the registry count at
    // someone reading a MENU is how "26" survived review, and then how "32"
    // reached Peter when he could only count 29 — pin what a person can count.
    expect(studyCatalog()).toHaveLength(81);
    expect(TIDAL_OPS.describe().filter((d) => d.kind === 'op')).toHaveLength(84);

    for (const d of STUDIES) {
      if (adoptable(d)) {
        // Every input role binds: the `column` role to the target, every other
        // to a bar column we carry. A benchmark role has no default — it is a
        // second SUBJECT, not a column — so it is refused here.
        for (const i of d.inputs) {
          if (i.role !== 'column') expect(BARS).toContain(i.default);
        }
        // Multi-output is in now: a band draws as a wash, anything else as N
        // lines off one spec. What it must NOT be is a signal or an anchor —
        // the two shapes that would draw nothing or draw nonsense.
        expect(d.outputs.every((o) => o.unit !== 'signal')).toBe(true);
        expect(d.anchor ?? null).toBeNull();
      }
    }
  });

  it('reads band-ness off the OUTPUT IDS, not off `family`', () => {
    // The two cases that prove `family` is a menu grouping: both are
    // `family: 'bands'` and neither is a band.
    for (const name of ['bollingerBandwidth', 'bollingerPercentB']) {
      const d = STUDIES.find((s) => s.name === name)!;
      expect(d.family).toBe('bands');
      expect(isBandShape(d)).toBe(false);
    }
    // …and the one whose declaration order differs from the rest.
    const donchian = STUDIES.find((s) => s.name === 'donchian')!;
    expect(donchian.outputs.map((o) => o.id)).toEqual(['Upper', 'Lower', 'Middle']);
    expect(isBandShape(donchian)).toBe(true);
  });

  it('refuses an ANCHORED study — it needs context Tidal does not supply', () => {
    // `anchor` is context, not a control. Both of these produce NO column
    // against an untagged series, so adopting them would put an op in the
    // picker that silently draws nothing. The fold test found these two
    // independently of pond's warning about them.
    for (const name of ['sessionVwap', 'anchoredVwap', 'pivotPoints']) {
      const d = STUDIES.find((s) => s.name === name)!;
      expect(d.anchor).toBeTruthy();
      expect(adoptable(d)).toBe(false);
    }
  });

  it('refuses a study whose output is a SIGNAL — state is not a line', () => {
    // `elderImpulse` is the one that would otherwise slip through: numeric
    // params, one column in, one output out — and that output is a -1/0/1
    // impulse, which as a line says nothing. The other five signal-carrying
    // studies are already excluded by an enum param or a second input column.
    const impulse = STUDIES.find((s) => s.name === 'elderImpulse')!;
    expect(impulse.outputs.map((o) => o.unit)).toEqual(['signal']);
    expect(adoptable(impulse)).toBe(false);
    expect(ADOPTED_STUDIES.some((d) => d.name === 'elderImpulse')).toBe(false);
  });

  it('never redeclares an op Tidal owns by hand', () => {
    // `sma`/`ema` keep their exact `lookback` (`period - 1`, `4 * period` for
    // the IIR) which the catalog cannot express; `realizedVol` is not in the
    // corpus at all.
    const adopted = new Set(ADOPTED_STUDIES.map((d) => d.name));
    for (const own of ['sma', 'ema', 'bollinger']) {
      expect(adopted.has(own)).toBe(false);
      expect(STUDIES.some((s) => s.name === own)).toBe(true); // it IS in the corpus
    }
  });

  it('every adopted study reaches the picker and declares its params there', () => {
    const offered = new Map(studyCatalog().map((o) => [o.op, o]));
    for (const d of ADOPTED_STUDIES) {
      const option = offered.get(d.name);
      expect(option, `${d.name} missing from the picker`).toBeDefined();
      expect(option!.summary).toBe(d.summary);
      expect(option!.family).toBe(d.family);
      // The controls are generated from the registry, so a declared numeric
      // param must arrive as a control — this is what makes a new study tunable
      // without anything listing its knobs by hand.
      expect(opParams(d.name).map((p) => p.name)).toEqual(Object.keys(d.params ?? {}));
    }
  });

  it('says which studies a source can carry, so the picker can gate on bars', () => {
    // Only the PRICE series has bars. A study reading high/low on a vol series
    // names columns that do not exist: the engine rejects the spec at compile
    // and the fold skips it, so the op would sit in the menu and draw silence.
    const BARS_HAVE = new Set(['open', 'high', 'low', 'close', 'volume']);
    const offerable = (have: Set<string>) =>
      studyCatalog().filter((o) => opNeedsColumns(o.op).every((c) => have.has(c)));

    const onPrice = offerable(BARS_HAVE);
    const onVol = offerable(new Set());
    expect(onPrice).toHaveLength(81); // everything
    // The vol row carries only the studies that read ONE column. It was 29
    // before multi-column binding — which is the number Peter counted in the
    // picker, and not a coincidence: the default view's top row is vol, so what
    // he was counting was never "all the studies" but "the studies a vol series
    // can carry". It is 36 now because multi-OUTPUT studies landed, several of
    // which read one column (`trix`, `macd`, `stochasticRsi`).
    expect(onVol).toHaveLength(36);

    // Concretely: an ATR is a study of BARS and must not be offered on a vol
    // series; an RSI is a study of one column and is offered on both.
    const names = (os: typeof onVol) => new Set(os.map((o) => o.op));
    expect(names(onPrice).has('atr')).toBe(true);
    expect(names(onVol).has('atr')).toBe(false);
    expect(names(onPrice).has('rsi')).toBe(true);
    expect(names(onVol).has('rsi')).toBe(true);

    // And the discriminator is the COLUMNS, not the input count.
    expect(opNeedsColumns('rsi')).toEqual([]);
    expect(opNeedsColumns('atr').sort()).toEqual(['close', 'high', 'low']);
  });

  it("marks a MACD's Hist as a BAR, and everything else as a line", () => {
    // The catalog's answer for a MACD is complete and still insufficient: all
    // three outputs are `delta`, so `unit` correctly says "own pane,
    // zero-centred" and says nothing about two of them being lines and the
    // third a histogram. That is F-charts-26's headline case.
    expect(outputMark('macd', 'Hist')).toBe('bar');
    expect(outputMark('macd', 'Line')).toBe('line');
    expect(outputMark('macd', 'Signal')).toBe('line');
    // Unknown ops and unknown suffixes fall through to a line rather than
    // throwing — a persisted config can name an op the corpus has dropped.
    expect(outputMark('rsi', '')).toBe('line');
    expect(outputMark('nosuchop', 'Hist')).toBe('line');
  });

  it('keys the mark overlay by (op, suffix), because `Hist` is not a rule', () => {
    // `Hist` occurs exactly ONCE in the corpus. A `/hist/i` rule would fire on
    // this one study and silently miss any future histogram named anything
    // else — a special case wearing a rule's clothes. `Upper`/`Lower` recurs
    // nine times and IS a rule (`isBandShape`); this is the contrast.
    const histOutputs = STUDIES.flatMap((d) =>
      d.outputs.filter((o) => /hist/i.test(o.id)).map((o) => `${d.name}.${o.id}`),
    );
    expect(histOutputs).toEqual(['macd.Hist']);
  });

  it('FOLDS — every adopted study computes a real column off a real series', () => {
    const s = series();
    const failed: string[] = [];
    for (const d of ADOPTED_STUDIES) {
      const spec = specFor(d.name);
      const out = applyDerived(s, [spec]);
      const id = deriveId(spec);
      // Off the REGISTRY's suffixes, not the catalog's. They differ for the 12
      // studies whose primary output is unnamed: the registry refuses an empty
      // suffix on a multi-output op, so `trix` is declared `Value`/`Signal`
      // where the catalog says `''`/`Signal` (F-charts-27). The registry's list
      // is the one the engine names columns with, and therefore the one the
      // render reads — so it is the one worth asserting.
      const cols = opOutputs(d.name).map((suffix) => `${id}${suffix}`);
      const names = out.schema.map((c: { name: string }) => c.name);
      for (const c of cols) if (!names.includes(c)) failed.push(`${d.name}: no ${c}`);
      // …and it must carry at least one finite value, not just exist.
      const objs = out.toObjects() as Record<string, number | null>[];
      const any = objs.some((o) => Number.isFinite(o[cols[0]!]));
      if (!any) failed.push(`${d.name}: ${cols[0]} is empty`);
    }
    expect(failed).toEqual([]);
  });

  it('names every adopted study with the params it was tuned with', () => {
    for (const d of ADOPTED_STUDIES) {
      const tag = studyTag(specFor(d.name));
      const declared = opParams(d.name);
      // Built from the declaration rather than counted off the string. Counting
      // commas passed VACUOUSLY for every single-param study — `'RSI(20)'`
      // splits into one piece and `opParams('rsi')` has one entry — so the
      // #181 guard it claimed to be only ever covered the multi-param few.
      const expected =
        declared.length === 0
          ? d.name.toUpperCase()
          : `${d.name.toUpperCase()}(${declared.map((p) => p.default).join(', ')})`;
      expect(tag).toBe(expected);
    }
  });

  it('the multi-param studies are the ones that make that test bite', () => {
    // The assertion above is only interesting where a study has more than one
    // param, and a corpus change that dropped them all to one would leave it
    // passing while testing nothing. Pinning the COUNT and the property rather
    // than 23 names, which would churn on every release for no signal.
    const multi = ADOPTED_STUDIES.filter((d) => opParams(d.name).length > 1);
    expect(multi.length).toBeGreaterThanOrEqual(20);
    for (const d of multi) expect(studyTag(specFor(d.name))).toContain(', ');
    // And the ones worth knowing are in it — a band, a MACD, an Ichimoku.
    const names = new Set(multi.map((d) => d.name));
    for (const n of ['bollingerPercentB', 'macd', 'ichimoku', 'stochastic']) {
      expect(names.has(n), n).toBe(true);
    }
  });

  it('refuses a band shape the `band` STYLE cannot read', () => {
    // `bandColumns` reads all three of BAND_OUTPUTS off the spec id, so a band
    // missing one names a column that does not exist and draws an empty wash.
    // `rainbowOscillator` is the live landmine: `['', 'Upper', 'Lower']`, so no
    // `…Middle`, and it is excluded today ONLY by its enum param — TDL-STUDYENUM
    // would have made it adoptable and `opIsBand` would have drawn it as a band.
    const rainbow = STUDIES.find((s) => s.name === 'rainbowOscillator')!;
    expect(rainbow.outputs.map((o) => o.id)).toEqual(['', 'Upper', 'Lower']);
    expect(isBandShape(rainbow)).toBe(false);
    // A two-output band has no centre at all — a real mark, not drawable yet.
    for (const name of ['atrBands', 'primeNumberBands']) {
      const d = STUDIES.find((s) => s.name === name)!;
      expect(d.outputs.map((o) => o.id)).toEqual(['Upper', 'Lower']);
      expect(isBandShape(d)).toBe(false);
    }
    // Exactly the SIX Tidal can draw, `donchian`'s reordering included. Not
    // eight: the `bands` family has eight members that are conceptually bands,
    // and two of them (above) declare no centre.
    expect(
      STUDIES.filter(isBandShape)
        .map((d) => d.name)
        .sort(),
    ).toEqual(['bollinger', 'donchian', 'envelope', 'highLowBands', 'keltner', 'starcBands']);
  });
});
