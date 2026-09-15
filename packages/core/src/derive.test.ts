import { describe, expect, it } from 'vitest';
import { TimeSeries } from 'pond-ts';
import {
  applyDerived,
  applyDerivedReport,
  deriveId,
  deriveLineage,
  inputNames,
  substituteInput,
  isBrokenId,
  isValidSpec,
  hasPairOp,
  readPairParts,
  readPart,
  specUnit,
  usesCompare,
  type DeriveSpec,
} from './derive.js';

const SCHEMA = [
  { name: 'time', kind: 'time' },
  { name: 'x', kind: 'number' },
] as const;

const series = (xs: number[]) =>
  TimeSeries.fromColumns({
    name: 't',
    schema: SCHEMA,
    columns: { time: xs.map((_, i) => i * 86_400_000), x: xs },
    sort: true,
  }) as unknown as TimeSeries<typeof SCHEMA>;

describe('deriveId', () => {
  it('is the engine specId: versioned, deterministic, param-order-canonical', () => {
    // ONE format literal, pinned deliberately: the id is a persisted key
    // (presets), so a format change must fail a test, not slip through.
    expect(deriveId({ op: 'sma', inputs: ['iv21'], params: { period: 20 } })).toBe(
      'p1:sma(iv21;period=20)',
    );
    // Param order must not change the id.
    const a = deriveId({ op: 'ema', inputs: ['x'], params: { period: 10 } });
    const b = deriveId({ op: 'ema', params: { period: 10 }, inputs: ['x'] });
    expect(a).toBe(b);
  });

  it('collides an omitted param with its explicit default (one identity)', () => {
    // A preset that stored the default explicitly and a fresh spec that omitted
    // it must land on the same column/cache entry — the engine guarantees this.
    expect(deriveId({ op: 'sma', inputs: ['x'] })).toBe(
      deriveId({ op: 'sma', inputs: ['x'], params: { period: 20 } }),
    );
  });
});

describe('applyDerived', () => {
  it('appends an SMA column of the trailing mean (period-1 warmup)', () => {
    const spec: DeriveSpec = { op: 'sma', inputs: ['x'], params: { period: 3 } };
    const out = applyDerived(series([1, 2, 3, 4, 5]), [spec]);
    const objs = out.toObjects() as Record<string, number | null>[];
    const col = deriveId(spec);
    expect(objs[0]![col] ?? null).toBeNull(); // warmup
    expect(objs[1]![col] ?? null).toBeNull();
    expect(objs[2]![col]).toBeCloseTo(2); // (1+2+3)/3
    expect(objs[3]![col]).toBeCloseTo(3); // (2+3+4)/3
    expect(objs[4]![col]).toBeCloseTo(4); // (3+4+5)/3
  });

  it('folds a Bollinger band as THREE columns named off the one spec id', () => {
    // The multi-output case. The engine names each column by the spec id plus
    // the output's declared suffix, so the band IS one spec — it moves, hides
    // and deletes as a unit, and nothing has to map an id to a column set.
    const spec: DeriveSpec = { op: 'bollinger', inputs: ['x'], params: { period: 3, stdDev: 2 } };
    const id = deriveId(spec);
    expect(id).toBe('p1:bollinger(x;period=3,stdDev=2)');
    const objs = applyDerived(series([1, 2, 3, 4, 5, 6]), [spec]).toObjects() as Record<
      string,
      number | null
    >[];
    // period-1 warmup on all three.
    expect(objs[1]![`${id}Middle`] ?? null).toBeNull();
    expect(objs[1]![`${id}Upper`] ?? null).toBeNull();
    // mean(1,2,3) = 2, POPULATION sd = √(2/3) — the corpus's choice, pinned
    // here because sample-vs-population is the classic silent disagreement
    // between two Bollinger implementations.
    const sd = Math.sqrt(2 / 3);
    expect(objs[2]![`${id}Middle`]).toBeCloseTo(2, 10);
    expect(objs[2]![`${id}Upper`]).toBeCloseTo(2 + 2 * sd, 10);
    expect(objs[2]![`${id}Lower`]).toBeCloseTo(2 - 2 * sd, 10);
  });

  it("a band's stdDev is part of its identity, and widens it", () => {
    // `num`, not `int`: 2.5 is an ordinary choice and must round-trip through
    // the content-addressed id intact.
    const two: DeriveSpec = { op: 'bollinger', inputs: ['x'], params: { period: 3, stdDev: 2 } };
    const wide: DeriveSpec = { ...two, params: { period: 3, stdDev: 2.5 } };
    expect(deriveId(wide)).toBe('p1:bollinger(x;period=3,stdDev=2.5)');
    expect(deriveId(wide)).not.toBe(deriveId(two));
    const objs = applyDerived(series([1, 2, 3, 4, 5, 6]), [two, wide]).toObjects() as Record<
      string,
      number
    >[];
    expect(objs[2]![`${deriveId(wide)}Upper`]).toBeGreaterThan(objs[2]![`${deriveId(two)}Upper`]!);
  });

  it('a FLAT window draws the DEGENERATE band — all three edges on one value', () => {
    // σ = 0, so the band has zero width rather than no value: `upper = lower =
    // middle`. This asserted the opposite until 0.67.0, where F-charts-24 landed
    // the fix we asked for ([PND-BBFLAT]) — the old behaviour blanked both edges
    // around an unbroken centre line, so a band over a stale stretch broke into
    // segments. `undefined` now means warm-up and nothing else, which is what
    // makes "outside the band" testable as `Upper > Lower` rather than as a hole.
    const spec: DeriveSpec = { op: 'bollinger', inputs: ['x'], params: { period: 3, stdDev: 2 } };
    const id = deriveId(spec);
    const objs = applyDerived(series([5, 5, 5, 5]), [spec]).toObjects() as Record<
      string,
      number | null
    >[];
    expect(objs[3]![`${id}Middle`]).toBeCloseTo(5, 10);
    expect(objs[3]![`${id}Upper`]).toBeCloseTo(5, 10);
    expect(objs[3]![`${id}Lower`]).toBeCloseTo(5, 10);
    // Warm-up is still a hole, and that is now the ONLY hole.
    expect(objs[1]![`${id}Upper`] ?? null).toBeNull();
  });

  it('names a band in its lineage with both params', () => {
    expect(
      deriveLineage({ op: 'bollinger', inputs: ['iv21'], params: { period: 20, stdDev: 2 } }),
    ).toBe('BB(20, 2) of iv21');
  });

  it('skips a spec whose source column is absent — no throw, no ghost column', () => {
    const s = series([1, 2, 3]);
    const spec: DeriveSpec = { op: 'sma', inputs: ['nope'], params: { period: 2 } };
    const out = applyDerived(s, [spec]);
    expect(out.schema.length).toBe(s.schema.length); // nothing appended
  });

  it('composes by NESTING — an SMA of an SMA is one spec containing the other', () => {
    // The engine reads a string input as a raw column, so composition nests;
    // the seated copy of `base` and the nested copy are one node by
    // content-addressing (both columns appear, base's exactly once).
    const base: DeriveSpec = { op: 'sma', inputs: ['x'], params: { period: 2 } };
    const chained: DeriveSpec = { op: 'sma', inputs: [base], params: { period: 2 } };
    const out = applyDerived(series([1, 2, 3, 4, 5, 6]), [chained, base]);
    expect(out.schema.filter((c) => c.name === deriveId(base)).length).toBe(1);
    expect(out.schema.some((c) => c.name === deriveId(chained))).toBe(true);
    // And the values are right: sma2(sma2(x)) at i=2 is mean(1.5, 2.5) = 2.
    const objs = out.toObjects() as Record<string, number | null>[];
    expect(objs[2]![deriveId(chained)]).toBeCloseTo(2);
  });

  it('appends an annualized realized-vol column from a variance source: √(var·252)·100', () => {
    const spec: DeriveSpec = { op: 'realizedVol', inputs: ['x'] };
    // A daily variance of 3.0e-4 → √(3.0e-4·252)·100 ≈ 27.5% (matches AAPL live).
    const out = applyDerived(series([3e-4, 1e-4, 0]), [spec]);
    const objs = out.toObjects() as Record<string, number | null>[];
    const col = deriveId(spec);
    expect(objs[0]![col]).toBeCloseTo(Math.sqrt(3e-4 * 252) * 100, 6);
    expect(objs[1]![col]).toBeCloseTo(Math.sqrt(1e-4 * 252) * 100, 6);
    expect(objs[2]![col]).toBeCloseTo(0); // √0 = 0
  });

  it('reads a negative or non-finite variance as a gap (keeps the column NaN-free)', () => {
    const spec: DeriveSpec = { op: 'realizedVol', inputs: ['x'] };
    const out = applyDerived(series([-1, 4e-4]), [spec]);
    const objs = out.toObjects() as Record<string, number | null>[];
    const col = deriveId(spec);
    expect(objs[0]![col] ?? null).toBeNull(); // negative variance → gap, not NaN
    expect(objs[1]![col]).toBeCloseTo(Math.sqrt(4e-4 * 252) * 100, 6);
  });

  it('skips a spec with an invalid period rather than throwing (a bad persisted spec)', () => {
    // The registry validates params at compile (`min: 2`, integer); a preset
    // could carry a bad one. applyDerived must skip it, not blow up the render.
    // NOTE: `deriveId` itself validates (specId resolves params), so an invalid
    // spec can't even be NAMED — assert on schema growth instead. Filed as
    // friction: identity being coupled to validity means a consumer can't
    // label the bad spec it is skipping.
    const s = series([1, 2, 3]);
    for (const period of [0, -5, 2.5, NaN]) {
      const spec: DeriveSpec = { op: 'sma', inputs: ['x'], params: { period } };
      const out = applyDerived(s, [spec]);
      expect(out.schema.length).toBe(s.schema.length);
    }
  });

  it('skips a study whose nested source is invalid (cascade)', () => {
    // base has a bad period ⇒ its spec can't compile ⇒ the study nesting it
    // skips with it (no throw, no partial column).
    const s = series([1, 2, 3, 4]);
    const base: DeriveSpec = { op: 'sma', inputs: ['x'], params: { period: 0 } };
    const chained: DeriveSpec = { op: 'ema', inputs: [base], params: { period: 2 } };
    const out = applyDerived(s, [base, chained]);
    expect(out.schema.length).toBe(s.schema.length);
  });

  it('is a no-op for an empty spec set (same reference)', () => {
    const s = series([1, 2, 3]);
    expect(applyDerived(s, [])).toBe(s);
  });

  it('is total over broken specs — they flow through, skip, and REPORT (0.62)', () => {
    const s = series([1, 2, 3]);
    // An old-shape persisted spec (no `inputs`) and an out-of-range period both
    // degrade to a skip + report entry, never a throw mid-render — since 0.62
    // nothing is pre-filtered (broken ids are total, `p1?:`-prefixed).
    const oldShape = { op: 'sma', source: 'x', params: { period: 20 } } as unknown as DeriveSpec;
    const outOfRange: DeriveSpec = { op: 'sma', inputs: ['x'], params: { period: 9999999 } };
    const { series: out, skipped } = applyDerivedReport(s, [oldShape, outOfRange]);
    expect(out.schema.length).toBe(s.schema.length);
    expect(skipped).toHaveLength(2);
    // The rejected-params spec reports the plan layer's class literal; the
    // arity-broken one currently escapes as a codeless op-layer throw
    // (upstream nit, reported on the bump ping-back) — either way it lands.
    const codes = new Map(skipped.map((k) => [k.id, k.code]));
    expect(codes.get(deriveId(outOfRange))).toBe('ParamError');
  });

  it('survives pathological persisted shapes the ENGINE survives (report never out-crashes)', () => {
    const s = series([1, 2, 3]);
    // `params: null` / `inputs: [null]` slip the shallow preset gate and make
    // even lenient specId TypeError — the fold skips them, and the REPORT
    // loop must too (PR #133 review, MEDIUM).
    const nullParams = { op: 'sma', params: null, inputs: ['x'] } as unknown as DeriveSpec;
    const nullInput = { op: 'sma', params: { period: 2 }, inputs: [null] } as unknown as DeriveSpec;
    const ok: DeriveSpec = { op: 'sma', inputs: ['x'], params: { period: 2 } };
    const { series: out, skipped } = applyDerivedReport(s, [nullParams, nullInput, ok]);
    expect(out.schema.some((c) => c.name === deriveId(ok))).toBe(true); // the valid one folds
    expect(skipped.length).toBeGreaterThanOrEqual(2); // both broken shapes land, no throw
  });

  it('reports a gone column as UnknownColumnError, deduped across passes', () => {
    const s = series([1, 2, 3]);
    const gone: DeriveSpec = { op: 'sma', inputs: ['vanished'], params: { period: 2 } };
    const ok: DeriveSpec = { op: 'sma', inputs: ['x'], params: { period: 2 } };
    const { series: out, skipped } = applyDerivedReport(s, [gone, ok]);
    expect(out.schema.some((c) => c.name === deriveId(ok))).toBe(true); // others unaffected
    // The engine reports a selected failing spec once per pass (plan +
    // selector) — the report dedupes on the spec's id.
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ id: deriveId(gone), code: 'UnknownColumnError' });
  });

  it('is NOT idempotent — refolding an already-folded series loses nested dependents (pinned)', () => {
    // Documented hazard (PR #130 review): an output column that already exists
    // collides at assembly, that spec skips, and a spec NESTING it skips too.
    // Pinned so a behavior change here screams. Render paths fold RAW series
    // only; the warm-Host stage retires the hazard.
    const base: DeriveSpec = { op: 'sma', inputs: ['x'], params: { period: 2 } };
    const chained: DeriveSpec = { op: 'ema', inputs: [base], params: { period: 2 } };
    // Fold base alone, then EXTEND over the folded result: base's column already
    // exists (collides, skips) and chained NESTS base (its widen collides too),
    // so the extension silently computes nothing.
    const once = applyDerived(series([1, 2, 3, 4, 5, 6]), [base]);
    const twice = applyDerived(once, [base, chained]);
    expect(twice.schema.some((c) => c.name === deriveId(base))).toBe(true); // stale column stays
    expect(twice.schema.some((c) => c.name === deriveId(chained))).toBe(false); // dependent LOST
  });
});

describe('isValidSpec / broken ids (0.62 lenient naming)', () => {
  it('accepts what the registry validates; refuses what it rejects', () => {
    expect(isValidSpec({ op: 'sma', inputs: ['x'], params: { period: 20 } })).toBe(true);
    expect(isValidSpec({ op: 'sma', inputs: ['x'], params: { period: 0 } })).toBe(false); // below min
    expect(isValidSpec({ op: 'sma', inputs: ['x'], params: { period: 9999999 } })).toBe(false); // above max
    expect(isValidSpec({ op: 'nope', inputs: ['x'] } as unknown as DeriveSpec)).toBe(false); // unknown op
    // ENGINE SEMANTICS CHANGE at 0.62: input arity is NOT a specId validation
    // concern (0.61's throw on a no-inputs spec was an incidental TypeError,
    // not a designed check) — the spec names fine and SKIPS at fold instead
    // (pinned below). Reported upstream on the bump ping-back.
    expect(isValidSpec({ op: 'sma', params: { period: 20 } } as unknown as DeriveSpec)).toBe(true);
  });

  it('names a REJECTED spec with the opaque broken marker, never a throw', () => {
    // A valid spec's id is byte-identical to 0.61's strict form (nothing
    // persisted moves); a rejected one gets a DISTINCT id — a broken persisted
    // spec can no longer key onto the working node (the 0.62 fix). The exact
    // format is the engine's; the prefix is the one sanctioned peek.
    const broken: DeriveSpec = { op: 'sma', inputs: ['x'], params: { period: 9999999 } };
    expect(isBrokenId(deriveId(broken))).toBe(true);
    expect(isBrokenId(deriveId({ op: 'sma', inputs: ['x'], params: { period: 20 } }))).toBe(false);
    // Distinct identities: the broken id never collides with the valid one.
    expect(deriveId(broken)).not.toBe(deriveId({ ...broken, params: { period: 20 } }));
  });
});

// ---------------------------------------------------------------------------
// Pair ops (TDL-PAIR): two-input pointwise transforms

const PAIR_SCHEMA = [
  { name: 'time', kind: 'time' },
  { name: 'a', kind: 'number' },
  { name: 'b', kind: 'number' },
] as const;

const pairSeries = (as: (number | undefined)[], bs: (number | undefined)[]) =>
  TimeSeries.fromColumns({
    name: 'p',
    schema: PAIR_SCHEMA,
    columns: {
      time: as.map((_, i) => i * 86_400_000),
      a: as.map((v) => (v == null ? NaN : v)),
      b: bs.map((v) => (v == null ? NaN : v)),
    },
    sort: true,
  }) as unknown as TimeSeries<typeof PAIR_SCHEMA>;

describe('pair ops', () => {
  // The fold returns the erased-schema series; read rows structurally.
  const col = (out: unknown, spec: DeriveSpec) =>
    ((out as { toObjects(): unknown[] }).toObjects() as Record<string, number | null>[]).map(
      (r) => r[deriveId(spec)] ?? null,
    );

  it('encodes both inputs in the id, injectively', () => {
    // Leg order is a different computation.
    const ab = deriveId({ op: 'ratio', inputs: ['a', 'b'] });
    const ba = deriveId({ op: 'ratio', inputs: ['b', 'a'] });
    expect(ab).not.toBe(ba);
    // A pair of a raw leg and a NESTED derived leg embeds the leg's own id.
    const inner: DeriveSpec = { op: 'sma', inputs: ['a'], params: { period: 3 } };
    expect(deriveId({ op: 'diff', inputs: ['a', inner] })).toContain(deriveId(inner));
  });

  it('diff / ratio / logRatio compute pointwise', () => {
    const s = pairSeries([10, 20, 30], [5, 8, 10]);
    const diff: DeriveSpec = { op: 'diff', inputs: ['a', 'b'] };
    const ratio: DeriveSpec = { op: 'ratio', inputs: ['a', 'b'] };
    const logR: DeriveSpec = { op: 'logRatio', inputs: ['a', 'b'] };
    const out = applyDerived(s, [diff, ratio, logR]);
    expect(col(out, diff)).toEqual([5, 12, 20]);
    expect(col(out, ratio)).toEqual([2, 2.5, 3]);
    expect(col(out, logR)![1]).toBeCloseTo(Math.log(2.5), 12);
  });

  it('gaps: a gap in either leg, a zero denominator, a non-positive log leg', () => {
    const s = pairSeries([10, undefined, 30, -4], [0, 8, undefined, 2]);
    const ratio: DeriveSpec = { op: 'ratio', inputs: ['a', 'b'] };
    const logR: DeriveSpec = { op: 'logRatio', inputs: ['a', 'b'] };
    const out = applyDerived(s, [ratio, logR]);
    expect(col(out, ratio)).toEqual([null, null, null, -2]); // 0-denom, leg gaps, then -4/2
    expect(col(out, logR)).toEqual([null, null, null, null]); // log needs both > 0
  });

  it('folds a pair of a nested derived leg, and skips when a leg never resolves', () => {
    const sma3: DeriveSpec = { op: 'sma', inputs: ['a'], params: { period: 3 } };
    const pairOfDerived: DeriveSpec = { op: 'ratio', inputs: ['a', sma3] };
    const out = applyDerived(pairSeries([3, 6, 9], [1, 1, 1]), [pairOfDerived]);
    expect(col(out, pairOfDerived)![2]).toBeCloseTo(9 / 6); // a=9, sma3=(3+6+9)/3=6

    const orphan: DeriveSpec = { op: 'diff', inputs: ['a', 'nope'] };
    const skipped = applyDerived(pairSeries([1], [1]), [orphan]);
    expect(skipped.schema.some((c) => c.name === deriveId(orphan))).toBe(false);
  });
});

describe('spec introspection', () => {
  it('inputNames resolves a nested spec to its column (= its id)', () => {
    const inner: DeriveSpec = { op: 'sma', inputs: ['x'], params: { period: 5 } };
    expect(inputNames({ op: 'diff', inputs: ['x', inner] })).toEqual(['x', deriveId(inner)]);
  });

  it('usesCompare sees the compare role at any depth', () => {
    expect(usesCompare({ op: 'ratio', inputs: ['iv21', 'cmp_iv21'] })).toBe(true);
    const nested: DeriveSpec = { op: 'realizedVol', inputs: ['cmp_ccVar'] };
    expect(usesCompare({ op: 'ratio', inputs: ['iv21', nested] })).toBe(true);
    expect(usesCompare({ op: 'ratio', inputs: ['iv21', 'hv21'] })).toBe(false);
  });

  it('deriveLineage reads from the registry labels', () => {
    const spec: DeriveSpec = { op: 'sma', inputs: ['iv21'], params: { period: 20 } };
    expect(deriveLineage(spec)).toBe('SMA(20) of iv21');
  });
});

describe('substituteInput (edit propagation)', () => {
  const SMA20: DeriveSpec = { op: 'sma', inputs: ['iv21'], params: { period: 20 } };
  const SMA50: DeriveSpec = { op: 'sma', inputs: ['iv21'], params: { period: 50 } };

  it('rewrites a raw column input', () => {
    const spec: DeriveSpec = { op: 'ratio', inputs: ['iv21', 'hv21'] };
    expect(substituteInput(spec, 'hv21', 'hv63')).toEqual({
      op: 'ratio',
      inputs: ['iv21', 'hv63'],
    });
  });

  it('rewrites a NESTED spec matched by its id — the column it publishes', () => {
    // A dependent nests a copy of its source's spec, so re-speccing the source
    // has to match on that copy's id, not on a string.
    const spread: DeriveSpec = { op: 'ratio', inputs: ['iv21', SMA20] };
    expect(substituteInput(spread, deriveId(SMA20), SMA50)).toEqual({
      op: 'ratio',
      inputs: ['iv21', SMA50],
    });
  });

  it('reaches any depth', () => {
    const deep: DeriveSpec = { op: 'ema', inputs: [{ op: 'ratio', inputs: ['x', SMA20] }] };
    const out = substituteInput(deep, deriveId(SMA20), SMA50);
    expect(deriveId(out)).toBe(
      deriveId({ op: 'ema', inputs: [{ op: 'ratio', inputs: ['x', SMA50] }] }),
    );
  });

  it('returns the SAME object when nothing matched (the cheap change test)', () => {
    const spec: DeriveSpec = { op: 'ratio', inputs: ['iv21', SMA20] };
    expect(substituteInput(spec, 'nothing-here', 'x')).toBe(spec);
  });

  it('survives an old-shape spec with no inputs array', () => {
    const legacy = { op: 'sma', params: { period: 20 } } as unknown as DeriveSpec;
    expect(substituteInput(legacy, 'iv21', 'iv63')).toBe(legacy);
  });
});

describe('reading a spec back as a tree', () => {
  const SMA20: DeriveSpec = { op: 'sma', inputs: ['iv21'], params: { period: 20 } };
  const RV: DeriveSpec = { op: 'realizedVol', inputs: ['ccVar'] };

  it('reads a raw leg, a studied leg, and the study order', () => {
    expect(readPart('iv21')).toEqual({
      metric: 'iv21',
      base: 'iv21',
      entity: 'primary',
      studies: [],
    });
    // Innermost FIRST — application order, not spec-nesting order.
    const chained: DeriveSpec = { op: 'ema', inputs: [SMA20], params: { period: 30 } };
    expect(readPart(chained)?.studies.map((s) => s.op)).toEqual(['sma', 'ema']);
    expect(readPart(chained)?.base).toBe('iv21');
  });

  it('a windowless single-input op is the METRIC, not a study', () => {
    // `RV · SMA(20)` is one metric with one study — the same discriminator the
    // config layer uses (a study declares a period).
    const studied: DeriveSpec = { op: 'sma', inputs: [RV], params: { period: 20 } };
    const part = readPart(studied);
    expect(part?.studies.map((s) => s.op)).toEqual(['sma']);
    expect(part?.metric).toEqual(RV);
    expect(part?.base).toBe(deriveId(RV));
  });

  it('the compare role is read at the LEAF, through a study and a derived metric', () => {
    expect(readPart('cmp_iv21')).toMatchObject({ base: 'iv21', entity: 'compare' });
    const studiedCmp: DeriveSpec = { op: 'sma', inputs: ['cmp_iv21'], params: { period: 20 } };
    expect(readPart(studiedCmp)).toMatchObject({ base: 'iv21', entity: 'compare' });
    // A derived metric's base names the UNPREFIXED computation, so the label
    // lookup is role-independent (the binding chip carries the role instead).
    const cmpRv: DeriveSpec = { op: 'realizedVol', inputs: ['cmp_ccVar'] };
    expect(readPart(cmpRv)).toMatchObject({ base: deriveId(RV), entity: 'compare' });
  });

  it('refuses a leg with no single metric to name (a spread of spreads)', () => {
    const spread: DeriveSpec = { op: 'ratio', inputs: ['iv21', 'hv21'] };
    expect(readPart(spread)).toBeNull();
    // …and refusing one leg refuses the pair, so the panel degrades to flat.
    expect(readPairParts({ op: 'diff', inputs: ['iv21', spread] })).toBeNull();
  });

  it('readPairParts takes pair ops only, strictly binary', () => {
    const parts = readPairParts({ op: 'ratio', inputs: ['iv21', 'cmp_iv21'] });
    expect(parts?.map((p) => p.entity)).toEqual(['primary', 'compare']);
    expect(readPairParts(SMA20)).toBeNull();
    expect(readPairParts({ op: 'diff', inputs: ['iv21'] })).toBeNull();
  });
});

describe('specUnit', () => {
  const unitOf = (c: string) => (c === 'iv21' || c === 'hv21' ? '%' : c === 'close' ? '$' : '');

  it('reads the registry: declared units, and a study inherits its input', () => {
    expect(specUnit({ op: 'realizedVol', inputs: ['ccVar'] }, unitOf)).toBe('%');
    expect(specUnit({ op: 'ratio', inputs: ['iv21', 'hv21'] }, unitOf)).toBe('');
    expect(specUnit({ op: 'logRatio', inputs: ['iv21', 'hv21'] }, unitOf)).toBe('log');
    expect(specUnit({ op: 'sma', inputs: ['iv21'], params: { period: 20 } }, unitOf)).toBe('%');
  });

  it('inheritCommon: a diff keeps a SHARED leg unit and drops an unlike one', () => {
    // The engine reads input 0 unconditionally for `inherit`, which is wrong
    // here — `% − $` is not `%` (pond#543 position 2).
    expect(specUnit({ op: 'diff', inputs: ['iv21', 'hv21'] }, unitOf)).toBe('%');
    expect(specUnit({ op: 'diff', inputs: ['iv21', 'close'] }, unitOf)).toBe('');
  });

  it('resolves through nesting, so a studied leg still carries its unit', () => {
    const studied: DeriveSpec = { op: 'sma', inputs: ['iv21'], params: { period: 20 } };
    expect(specUnit({ op: 'diff', inputs: [studied, 'hv21'] }, unitOf)).toBe('%');
  });

  it('an unknown op reads unitless rather than throwing', () => {
    expect(specUnit({ op: 'nope' as DeriveSpec['op'], inputs: ['iv21'] }, unitOf)).toBe('');
  });
});

describe('the tree readers are TOTAL over persisted garbage', () => {
  // These run inside XState guards, where a throw kills the terminal actor —
  // and a spec reaches them straight off localStorage with no shape validation.
  // Same belt every other reader in this module carries (PR #141 review, HIGH).
  const GARBAGE: unknown[] = [
    { op: 'ratio', inputs: [null, 'iv21'] },
    { op: 'ratio', inputs: ['iv21', { op: 'sma', params: { period: 20 } }] }, // no inputs
    { op: 'ratio' }, // no inputs at all
    { op: 'diff', inputs: [{ nope: 1 }, 'iv21'] }, // a node naming no op
    { op: 'sma', inputs: [null], params: { period: 20 } },
    null,
    'iv21',
    42,
  ];

  it('readPart / readPairParts / specUnit / usesCompare never throw', () => {
    for (const g of GARBAGE) {
      expect(() => readPart(g as never)).not.toThrow();
      expect(() => readPairParts(g as never)).not.toThrow();
      expect(() => specUnit(g as never, () => '%')).not.toThrow();
      expect(() => usesCompare(g as never)).not.toThrow();
    }
  });

  it('a pathological leg refuses the whole pair rather than half-reading it', () => {
    expect(readPairParts({ op: 'ratio', inputs: [null, 'iv21'] } as never)).toBeNull();
    // …and an unreadable spec reads unitless, which is the safe answer: it
    // binds no axis unit rather than claiming one it cannot justify.
    expect(specUnit(null as never, () => '%')).toBe('');
  });
});

describe('hasPairOp — "this series states its own symbols"', () => {
  // The gate on the blanket compare counterpart: a pair names a symbol per leg,
  // so a dashed second copy on the comparison is a DIFFERENT pair, not the same
  // thing on another ticker (Peter, 2026-08-18).
  const DIFF: DeriveSpec = { op: 'diff', inputs: ['hEMove', 'iEMove'] };

  it('is true for a pair and for anything built ON one, at any depth', () => {
    expect(hasPairOp(DIFF)).toBe(true);
    const studied: DeriveSpec = { op: 'sma', inputs: [DIFF], params: { period: 20 } };
    expect(hasPairOp(studied)).toBe(true);
    expect(hasPairOp({ op: 'ema', inputs: [studied], params: { period: 10 } })).toBe(true);
    // …including a pair buried in ONE leg of another spec.
    expect(hasPairOp({ op: 'ratio', inputs: ['iv21', DIFF] })).toBe(true);
  });

  it('is false for a plain study chain, which still wants its counterpart', () => {
    const sma: DeriveSpec = { op: 'sma', inputs: ['iv21'], params: { period: 20 } };
    expect(hasPairOp(sma)).toBe(false);
    expect(hasPairOp({ op: 'ema', inputs: [sma], params: { period: 10 } })).toBe(false);
    expect(hasPairOp({ op: 'realizedVol', inputs: ['ccVar'] })).toBe(false);
  });

  it('is total over persisted garbage, like every other reader here', () => {
    for (const g of [null, 'iv21', 42, { op: 'diff' }, { op: 'sma', inputs: [null] }])
      expect(() => hasPairOp(g as never)).not.toThrow();
    expect(hasPairOp({ op: 'sma', inputs: [null] } as never)).toBe(false);
  });
});
