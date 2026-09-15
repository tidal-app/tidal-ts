import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { configAxisId, seriesDrawn, type SeriesConfig } from '@tidal-ts/chart';
import { deriveId, isPairOp, type DeriveSpec } from '@tidal-ts/core';
import {
  activeSlot,
  canonRows,
  axisMoveAllowed,
  respecAllowed,
  studyChainTail,
  terminalMachine,
  type MetricEntry,
  type PresetStorage,
  type RowState,
  type TerminalPreset,
  studyOfferable,
} from './terminalMachine.js';

// Ids are the ENGINE's (`specId`, via deriveId) — computed, never hand-written,
// so a format change in @pond-ts/process can't silently diverge these tests
// from the machine. Composition NESTS: a study of a study embeds its parent's
// spec (the machine's studySpec does the same).
const RV_SPEC: DeriveSpec = { op: 'realizedVol', inputs: ['ccVar'] };
const RV = deriveId(RV_SPEC);
const SMA20: DeriveSpec = { op: 'sma', inputs: ['iv21'], params: { period: 20 } };
const SMA50: DeriveSpec = { op: 'sma', inputs: ['iv21'], params: { period: 50 } };
const emaOf = (inner: DeriveSpec, period: number): DeriveSpec => ({
  op: 'ema',
  inputs: [inner],
  params: { period },
});
const RATIO_63_21: DeriveSpec = { op: 'ratio', inputs: ['iv63', 'iv21'] };
const RATIO_21_CMP: DeriveSpec = { op: 'ratio', inputs: ['iv21', 'cmp_iv21'] };

const CATALOG: MetricEntry[] = [
  {
    id: 'iv21',
    label: 'ATM Vol 21D',
    color: 'blue',
    unit: '%',
    source: 'vol',
    style: 'line',
    axis: 'L',
  },
  {
    id: 'iv63',
    label: 'ATM Vol 63D',
    color: 'teal',
    unit: '%',
    source: 'vol',
    style: 'line',
    axis: 'L',
  },
  {
    id: 'iv42',
    label: 'ATM Vol 42D',
    color: 'pink',
    unit: '%',
    source: 'vol',
    style: 'line',
    axis: 'L',
  },
  {
    id: 'price',
    label: 'Price',
    color: 'orange',
    unit: '$',
    source: 'price',
    style: 'line',
    axis: 'R',
    column: 'close',
  },
  {
    // A `variance`-unit vol metric — a different unit from the `%` vols, so a
    // travelling set of {variance source, % study} needs two sides.
    id: 'ccVar',
    label: 'Close-to-Close Variance',
    color: 'green',
    unit: 'variance',
    source: 'vol',
    style: 'line',
    axis: 'R',
  },
  {
    // A `count`-unit metric on the price feed — lets a test fill a row's second
    // side so no axis is free for an incoming `%` series.
    id: 'volume',
    label: 'Volume',
    color: 'teal',
    unit: 'count',
    source: 'price',
    style: 'bar',
    axis: 'L',
    column: 'volume',
  },
  {
    // A derived catalog metric (the realized-vol line): its column is induced from
    // `derive`, not read raw — the spec must reach the live config.
    id: RV,
    label: 'Realized Vol (cc)',
    color: 'rose',
    unit: '%',
    source: 'vol',
    style: 'line',
    axis: 'L',
    column: RV,
    derive: RV_SPEC,
  },
];

/** A seed config named by its COLUMN. Its identity is minted here in a shape the
 *  machine never produces (`seed:iv21` vs `s-3`), which is the point: a test
 *  passes `idOf(column)` when it means identity, so anything that quietly used a
 *  column as an id — or the reverse — fails instead of coincidentally working. */
const cfg = (column: string, over: Partial<SeriesConfig> = {}): SeriesConfig => ({
  id: `seed:${column}`,
  column,
  label: column,
  color: 'blue',
  axis: 'L',
  style: 'line',
  visible: true,
  value: null,
  unit: '%',
  source: 'vol',
  ...over,
});

const initialRows = (): RowState[] => [
  { id: 'top', height: 0, configs: [cfg('iv21')] },
  {
    id: 'bottom',
    height: 150,
    configs: [cfg('price', { unit: '$', axis: 'R', source: 'price', column: 'close' })],
  },
];

function fakeStorage() {
  const saved: (TerminalPreset | null)[][] = [];
  const storage: PresetStorage = {
    loadPresets: () => Array.from({ length: 5 }, () => null),
    savePresets: (p) => saved.push(p),
    loadActive: () => null,
    saveActive: () => {},
  };
  return { storage, saved };
}

/** The colour keys a host hands out — the machine has no palette of its own
 *  (a host's chart resolves whatever keys it chooses; this is what Tidal's does). */
const PALETTE = ['blue', 'amber', 'teal', 'pink', 'green', 'purple', 'orange', 'rose'] as const;

function start(rows: RowState[] = initialRows(), palette: readonly string[] = PALETTE) {
  const { storage, saved } = fakeStorage();
  const actor = createActor(terminalMachine, {
    input: { initialRows: rows, catalog: CATALOG, storage, palette },
  });
  actor.start();
  const ctx = () => actor.getSnapshot().context;
  // What is ON the chart, in draw order — the COLUMNS, since that is what a
  // config computes and what these assertions are about. Identity is minted and
  // opaque (`s-3`), so a test that needs to send an event or check a pointer
  // goes through `idOf`.
  const cols = () => ctx().rows.flatMap((r) => r.configs.map((c) => c.column));
  const idOf = (column: string) =>
    ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.column === column)?.id ?? `no-config-for:${column}`;
  /** How the PICKER actually names a pair leg (mirrors `pairMetrics` in
   *  TimeSeriesTerminal): a seated DERIVED series by its config id, and a raw metric by
   *  its CATALOG id — raw legs need not be seated at all, so the menu lists the
   *  catalog entry whether or not a config is showing it. The machine is
   *  responsible for resolving that catalog id back to the seat (`legSeat`). */
  const leg = (column: string) => {
    const seated = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.column === column);
    return seated?.derive ? seated.id : column;
  };
  return { actor, saved, ctx, cols, idOf, leg };
}

/** The seated config computing `column` — the assertion workhorse. Columns name
 *  what a series COMPUTES, which is what these tests are about; identity is
 *  minted and deliberately unreadable. */
const find = (ctx: () => { rows: RowState[] }, column: string) =>
  ctx()
    .rows.flatMap((r) => r.configs)
    .find((c) => c.column === column)!;

describe('terminalMachine', () => {
  it('adds a compatible series to its source row, expanding it', () => {
    const { actor, cols, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    // Front→back list ⇒ a fresh add leads its row (visible, not buried).
    expect(cols()).toEqual(['iv63', 'iv21', 'close']);
    expect(ctx().expanded).toBe(idOf('iv63')); // …its controls open for tuning
    expect(ctx().selected).toBeNull(); // …but the app selection is untouched
  });

  it('adds a metric that is ALREADY on the chart, as a second series', () => {
    // This asserted the opposite until 2026-08-25 — "no-op (guard blocks it)" —
    // on the reasoning that two configs reading one column are one line drawn
    // twice. A series now carries an editable censor and an appendable study
    // chain, so a second copy is the first move of a comparison (censored vs
    // uncensored, raw vs its own average) rather than a redundant line.
    const { actor, cols, ctx } = start();
    actor.send({ type: 'series.add', catalogId: 'iv21' }); // already present
    expect(cols()).toEqual(['iv21', 'iv21', 'close']);
    // Distinct IDENTITIES, which is what everything downstream keys on — the
    // column was never the identity.
    const vol = ctx().rows[0]!.configs;
    expect(new Set(vol.map((c) => c.id)).size).toBe(vol.length);
    // ...and distinct COLOURS, or the copy lands invisibly under the original.
    expect(vol[0]!.color).not.toBe(vol[1]!.color);
  });

  it('removes the row when its last metric is removed (keeping ≥1)', () => {
    const { actor, ctx, idOf } = start();
    // The top (vol) row holds only iv21; removing it drops the whole row.
    actor.send({ type: 'series.remove', id: idOf('iv21') });
    expect(ctx().rows.map((r) => r.id)).toEqual(['bottom']);
    // The last row is never removed, even when emptied.
    actor.send({ type: 'series.remove', id: idOf('close') });
    expect(ctx().rows.map((r) => r.id)).toEqual(['bottom']);
    expect(ctx().rows[0]!.configs).toHaveLength(0);
  });

  it('removes a series and clears a selection that pointed at it', () => {
    const { actor, cols, ctx, idOf } = start();
    actor.send({ type: 'select', id: idOf('close') }); // price row survives its removal? no — select price
    actor.send({ type: 'series.remove', id: idOf('iv21') });
    expect(cols()).toEqual(['close']);
    expect(ctx().selected).toBe(idOf('close')); // untouched — a different series was removed
    actor.send({ type: 'series.remove', id: idOf('close') });
    expect(ctx().selected).toBeNull(); // now the selected series is gone
  });

  it('expansion overrides but never replaces the app selection; collapse restores it', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'select', id: idOf('iv21') }); // app selection (legend)
    actor.send({ type: 'expand', id: idOf('close') }); // control-panel row opens
    expect(ctx().selected).toBe(idOf('iv21')); // app selection survives the expansion
    expect(ctx().expanded).toBe(idOf('close'));
    actor.send({ type: 'expand', id: null }); // collapse
    expect(ctx().expanded).toBeNull();
    expect(ctx().selected).toBe(idOf('iv21')); // emphasis falls back to it
    actor.send({ type: 'expand', id: idOf('close') });
    actor.send({ type: 'controls.close' }); // closing the panel drops the expansion
    expect(ctx().expanded).toBeNull();
    expect(ctx().selected).toBe(idOf('iv21'));
  });

  it('patches a series config (INK only — arrangement fields are type-excluded)', () => {
    const { actor, ctx, idOf } = start();
    actor.send({
      type: 'series.patch',
      id: idOf('iv21'),
      patch: { color: 'green', style: 'area' },
    });
    const c = ctx().rows[0]!.configs[0]!;
    expect(c.color).toBe('green');
    expect(c.style).toBe('area');
    // `axis`/`axisGroup` are NOT patchable: they name the axis a series sits on,
    // whose ids key `axisRanges`, so they move only through `axis.swapSide` /
    // `axis.toggleLink`, which keep the pins coherent. The compiler enforces
    // it — `patch: { axis: 'R' }` does not typecheck (PR #136 review, MEDIUM).
    expect(c.axis).toBe('L');
  });

  it('toggles visibility and drops a selection when the selected series is hidden', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'select', id: idOf('iv21') });
    actor.send({ type: 'series.toggleVisible', id: idOf('iv21') }); // hide the selected
    expect(ctx().rows[0]!.configs[0]!.visible).toBe(false);
    expect(ctx().selected).toBeNull();
  });

  it('opens and closes the controls popover', () => {
    const { actor, ctx } = start();
    actor.send({ type: 'controls.open' });
    expect(ctx().controlsOpen).toBe(true);
    actor.send({ type: 'controls.close' });
    expect(ctx().controlsOpen).toBe(false);
  });

  it('saves a preset (persisted) and derives it active; selecting one applies its rows', () => {
    const { actor, saved, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    actor.send({ type: 'preset.save', slot: 0 });
    expect(saved.at(-1)?.[0]).toBeTruthy(); // persisted via storage
    expect(activeSlot(ctx().presets, ctx().rows)).toBe(0); // live === slot 0

    actor.send({ type: 'series.remove', id: idOf('iv63') }); // diverge → custom
    expect(activeSlot(ctx().presets, ctx().rows)).toBeNull();

    actor.send({ type: 'preset.select', slot: 0 }); // re-apply
    expect(ctx().rows.flatMap((r) => r.configs.map((c) => c.column))).toEqual([
      'iv63',
      'iv21',
      'close',
    ]);
    expect(activeSlot(ctx().presets, ctx().rows)).toBe(0);
  });

  it('commits row heights on drag-end', () => {
    const { actor, ctx } = start();
    actor.send({ type: 'layout.setRowHeights', heights: { bottom: 220 } });
    expect(ctx().rows.find((r) => r.id === 'bottom')?.height).toBe(220);
    expect(ctx().rows.find((r) => r.id === 'top')?.height).toBe(0); // untouched
  });

  it('adds and removes rows (never below one) with non-colliding ids', () => {
    const { actor, ctx } = start();
    actor.send({ type: 'row.add' });
    expect(ctx().rows).toHaveLength(3);
    // A fresh row is a FIXED strip (height > 0), not a second flex/remainder row —
    // so exactly one row (the seed's top) flexes and a seam drag stays local.
    expect(ctx().rows.at(-1)!.height).toBeGreaterThan(0);
    expect(ctx().rows.filter((r) => r.height === 0)).toHaveLength(1);
    actor.send({ type: 'row.remove', id: 'bottom' });
    expect(ctx().rows.map((r) => r.id)).toEqual(['top', 'row-2']);
    // The counter is monotonic — a second add can't reuse `row-2` after a remove.
    actor.send({ type: 'row.add' });
    expect(ctx().rows.map((r) => r.id)).toEqual(['top', 'row-2', 'row-3']);
  });

  it('mints a fresh config id per add — never reused, never a column', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    const first = idOf('iv63');
    expect(first).not.toBe('iv63'); // identity is NOT the catalog id / column
    actor.send({ type: 'series.remove', id: first });
    actor.send({ type: 'series.add', catalogId: 'iv63' }); // same metric again
    expect(idOf('iv63')).not.toBe(first); // monotonic, like the row counter
    const ids = ctx().rows.flatMap((r) => r.configs.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('re-seeds the id counter above an applied preset (no collision with its configs)', () => {
    // A STORED preset was minted in an earlier session, so its ids can sit well
    // above this actor's counter (seeded from two rows here). Applying it must
    // push the counter past them, or the next add hands out an id the applied
    // preset already occupies and two configs share one identity.
    const stored: TerminalPreset = {
      rows: [
        { id: 'top', height: 0, configs: [{ ...cfg('iv21'), id: 's-9' }] },
        { id: 'bottom', height: 150, configs: [] },
      ],
    };
    const storage: PresetStorage = {
      loadPresets: () => [stored, null, null, null, null],
      savePresets: () => {},
      loadActive: () => null,
      saveActive: () => {},
    };
    const actor = createActor(terminalMachine, {
      input: { initialRows: initialRows(), catalog: CATALOG, storage },
    });
    actor.start();
    const ctx = () => actor.getSnapshot().context;
    actor.send({ type: 'preset.select', slot: 0 });
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    const ids = ctx().rows.flatMap((r) => r.configs.map((c) => c.id));
    expect(ids).toContain('s-9');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('caps rows at MAX_ROWS (3) — a fourth add is a no-op', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'row.add' }); // 2 → 3
    expect(ctx().rows).toHaveLength(3);
    actor.send({ type: 'row.add' }); // blocked by canAddRow
    expect(ctx().rows).toHaveLength(3);
  });

  it('clears a selection that pointed into a removed row (but spares others)', () => {
    const a = start();
    a.actor.send({ type: 'select', id: a.idOf('close') }); // price lives in the bottom row
    a.actor.send({ type: 'row.remove', id: 'bottom' });
    expect(a.ctx().selected).toBeNull(); // its series is gone for good

    const b = start();
    const iv21 = b.idOf('iv21'); // top row — untouched by the remove
    b.actor.send({ type: 'select', id: iv21 });
    b.actor.send({ type: 'row.remove', id: 'bottom' });
    expect(b.ctx().selected).toBe(iv21);
  });

  it('adds a study of a series (layered on its row, expanded) and forbids the dup', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const studyId = deriveId(SMA20);
    // A study reads OVER its source ⇒ directly in front of it in the list.
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual([studyId, 'iv21']);
    const study = ctx().rows[0]!.configs.find((c) => c.column === studyId)!;
    expect(study.derive).toEqual(SMA20);
    expect(study.unit).toBe('%'); // inherits the target's unit + axis
    expect(study.column).toBe(studyId); // the column IS the derived output…
    expect(study.id).not.toBe(studyId); // …and the identity is minted, not the spec
    expect(ctx().expanded).toBe(study.id); // opens its controls for tuning
    // The same spec again is a no-op — one column, one config.
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    expect(ctx().rows[0]!.configs).toHaveLength(2);
  });

  it('changes a study period in place — the COLUMN moves, the identity does not', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const oldCol = deriveId(SMA20);
    const id = idOf(oldCol); // the identity, captured BEFORE the edit
    actor.send({ type: 'series.patch', id, patch: { color: 'green' } });
    actor.send({ type: 'select', id }); // app-select it as well as expanded
    expect(ctx().expanded).toBe(id);

    actor.send({ type: 'series.setStudyParam', id, name: 'period', value: 50 });
    const newCol = deriveId(SMA50);
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual([newCol, 'iv21']);
    const study = ctx().rows[0]!.configs.find((c) => c.derive)!;
    expect(study.derive!.params?.period).toBe(50);
    expect(study.column).toBe(newCol); // the column re-encodes the new spec…
    expect(study.id).toBe(id); // …while the identity stands still (the split)
    expect(study.color).toBe('green'); // user override survives the re-spec
    expect(study.label).toBe('iv21 · SMA(50)'); // base (row config's label) + new op·period
    // Both pointers hold WITHOUT any re-pointing: they name an identity that
    // never moved. Before the split this needed `repointAfterRespec` to chase
    // the new spec id, and anything else keyed to the config (colour, axis
    // membership, range pins) simply lost its entry.
    expect(ctx().expanded).toBe(id);
    expect(ctx().selected).toBe(id);
  });

  it('re-specs a nested study without losing its parent segment from the label', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const a = deriveId(SMA20);
    actor.send({ type: 'series.addStudy', targetId: idOf(a), op: 'ema', period: 20 });
    const b = deriveId(emaOf(SMA20, 20));
    expect(ctx().rows[0]!.configs.find((c) => c.column === b)!.label).toBe(
      'iv21 · SMA(20) · EMA(20)',
    );
    // Re-period the OUTER study — its label keeps the inner `· SMA(20)` segment
    // (the re-spec swaps only its own trailing op·period, not the whole lineage).
    actor.send({ type: 'series.setStudyParam', id: idOf(b), name: 'period', value: 50 });
    const study = ctx().rows[0]!.configs.find((c) => c.column === deriveId(emaOf(SMA20, 50)))!;
    expect(study.label).toBe('iv21 · SMA(20) · EMA(50)');
  });

  it('re-specs a MULTI-PARAM study without dropping the param it did not touch', () => {
    // The single-param version of this test passes whatever `respecPeriod` does
    // to the label, because `OP(period)` and `studyTag` agree when there is only
    // one param. A band is where they diverge: the label says
    // `BOLLINGER(20, 2)`, so a suffix built by hand off `params.period` reads
    // `BOLLINGER(20)`, matches nothing, and the fallback collapses the parent
    // segment AND drops `stdDev` — the exact failure `studyTag` exists to stop,
    // reappearing on the user's next edit.
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 10 });
    const sma = deriveId({ op: 'sma', inputs: ['iv21'], params: { period: 10 } });
    actor.send({ type: 'series.addStudy', targetId: idOf(sma), op: 'bollinger', period: 20 });
    const band = {
      op: 'bollinger' as const,
      inputs: [{ op: 'sma' as const, inputs: ['iv21'], params: { period: 10 } }],
      params: { period: 20, stdDev: 2 },
    };
    expect(ctx().rows[0]!.configs.find((c) => c.column === deriveId(band))!.label).toBe(
      'iv21 · SMA(10) · BOLLINGER(20, 2)',
    );

    actor.send({
      type: 'series.setStudyParam',
      id: idOf(deriveId(band)),
      name: 'period',
      value: 30,
    });
    const tuned = { ...band, params: { period: 30, stdDev: 2 } };
    const study = ctx().rows[0]!.configs.find((c) => c.column === deriveId(tuned))!;
    // Both params survive, and so does the parent pipeline segment.
    expect(study.label).toBe('iv21 · SMA(10) · BOLLINGER(30, 2)');
  });

  it('does not re-period a pointwise derived metric (no period to change)', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: RV });
    // The realized-vol line's derive has empty params — the guard must reject a
    // period change (it isn't a windowed study), leaving its id untouched.
    actor.send({ type: 'series.setStudyParam', id: idOf(RV), name: 'period', value: 50 });
    expect(
      ctx()
        .rows.flatMap((r) => r.configs)
        .some((c) => c.column === RV),
    ).toBe(true);
  });

  it('round-trips a derived catalog metric through preset save + re-apply', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: RV });
    actor.send({ type: 'preset.save', slot: 0 });
    actor.send({ type: 'series.remove', id: idOf(RV) }); // diverge → custom
    expect(activeSlot(ctx().presets, ctx().rows)).toBeNull();
    actor.send({ type: 'preset.select', slot: 0 }); // re-apply
    const rv = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.column === RV);
    expect(rv?.derive).toEqual(RV_SPEC);
    expect(activeSlot(ctx().presets, ctx().rows)).toBe(0); // identity restored
  });

  it('rejects a period change that is invalid, unchanged, or collides with a study', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const id20 = deriveId(SMA20);
    for (const bad of [1, 2.5, 20])
      actor.send({ type: 'series.setStudyParam', id: idOf(id20), name: 'period', value: bad });
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual([id20, 'iv21']); // untouched

    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 50 });
    const id50 = deriveId(SMA50);
    actor.send({ type: 'series.setStudyParam', id: idOf(id50), name: 'period', value: 20 }); // would collide with id20
    expect(ctx().rows[0]!.configs.some((c) => c.column === id50)).toBe(true); // rejected, unchanged
  });

  it("PROPAGATES a period change to the studies built on it (they don't strand)", () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const a = deriveId(SMA20);
    actor.send({ type: 'series.addStudy', targetId: idOf(a), op: 'ema', period: 20 });
    // Each study inserts in front of its target ⇒ the chain stacks outermost-first.
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual([
      deriveId(emaOf(SMA20, 20)),
      a,
      'iv21',
    ]);
    const [emaId, smaId] = ctx().rows[0]!.configs.map((c) => c.id);

    // The EMA nests a COPY of the SMA's spec, so re-speccing the SMA moves the
    // column the EMA is built on. It used to be deleted for that; now its spec
    // is rewritten to nest the new one and it follows the edit.
    actor.send({ type: 'series.setStudyParam', id: idOf(a), name: 'period', value: 50 });
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual([
      deriveId(emaOf(SMA50, 20)),
      deriveId(SMA50),
      'iv21',
    ]);
    // Same configs throughout — nothing was removed and nothing was re-minted,
    // so every override, pin and pointer on them still applies.
    expect(ctx().rows[0]!.configs.map((c) => c.id)).toEqual([emaId, smaId, idOf('iv21')]);
    // The EDITED study's own label is re-read; a DEPENDENT's is not, and goes
    // stale. Patching that text is not recoverable — a source's label is
    // routinely a substring of a sibling's, so the swap lands on the wrong
    // segment (PR #140 review, HIGH). Rebuilding one from its spec is
    // TDL-LINEAGE. Pinned so the day labels become structural, this flips.
    expect(ctx().rows[0]!.configs[1]!.label).toBe('iv21 · SMA(50)');
    expect(ctx().rows[0]!.configs[0]!.label).toBe('iv21 · SMA(20) · EMA(20)');
  });

  it('refuses a period change whose propagation would collide with a seated study', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 50 });
    actor.send({ type: 'series.addStudy', targetId: idOf(deriveId(SMA20)), op: 'ema', period: 20 });
    actor.send({ type: 'series.addStudy', targetId: idOf(deriveId(SMA50)), op: 'ema', period: 20 });
    const before = ctx().rows[0]!.configs.map((c) => c.column);
    // Pushing SMA(20) to 50 would make BOTH chains compute the same two things.
    // One column, one config — so the whole edit is refused rather than half
    // applied or silently deduped.
    const target = idOf(deriveId(SMA20));
    actor.send({ type: 'series.setStudyParam', id: target, name: 'period', value: 50 });
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual(before);
    // …and the PANEL can see that in advance, so it disables the chip rather
    // than swallowing the click. The refusal is about the DEPENDENT's rewrite:
    // the target's own new column is free (PR #140 review, MEDIUM).
    const scope = ctx();
    expect(respecAllowed(scope, target, 'period', 50)).toBe(false);
    expect(respecAllowed(scope, target, 'period', 100)).toBe(true); // nothing computes that yet
    expect(respecAllowed(scope, target, 'period', 20)).toBe(false); // unchanged
    expect(respecAllowed(scope, target, 'period', 1)).toBe(false); // below the bar-count floor
    expect(respecAllowed(scope, idOf('iv21'), 'period', 50)).toBe(false); // not a windowed study
  });

  it("guards a FRACTIONAL param on its own declared bounds, not on period's", () => {
    // Every existing guard assertion uses `period`, so none of them would notice
    // a rule that only holds for integers. `stdDev` is `num`, legal 0.1–10, and
    // the old check (`Number.isInteger(period) && >= 2`) would have refused all
    // of it (PR #181 review, MEDIUM: verify covered none of the new behaviour).
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'bollinger', period: 20 });
    const band = { op: 'bollinger' as const, inputs: ['iv21'], params: { period: 20, stdDev: 2 } };
    const target = idOf(deriveId(band));
    const scope = ctx();

    expect(respecAllowed(scope, target, 'stdDev', 2.5)).toBe(true); // fractional + legal
    expect(respecAllowed(scope, target, 'stdDev', 2)).toBe(false); // unchanged
    expect(respecAllowed(scope, target, 'stdDev', 0)).toBe(false); // below min
    expect(respecAllowed(scope, target, 'stdDev', 99)).toBe(false); // above max
    expect(respecAllowed(scope, target, 'stdDev', Number.NaN)).toBe(false);
    // A param the op does not DECLARE is not a narrow edit — it is a spec the
    // registry rejects, and must be refused before it can mint an id.
    expect(respecAllowed(scope, target, 'nonesuch', 3)).toBe(false);
    expect(respecAllowed(scope, target, 'stdDev', 2.5)).toBe(true);

    // …and committing it moves the identity and keeps the other param.
    actor.send({ type: 'series.setStudyParam', id: target, name: 'stdDev', value: 2.5 });
    const tuned = deriveId({ ...band, params: { period: 20, stdDev: 2.5 } });
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toContain(tuned);
  });

  it('carries a derived catalog metric spec onto its live config (the realized-vol line)', () => {
    const { actor, ctx } = start();
    actor.send({ type: 'series.add', catalogId: RV });
    const rv = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.column === RV);
    expect(rv?.derive).toEqual(RV_SPEC);
    expect(rv?.column).toBe(RV); // reads its own induced column
  });

  it('cascade-removes dependent studies when their source study is removed (no strand)', () => {
    const { actor, ctx, idOf } = start();
    // A nested strand: SMA of iv21 (A), then EMA of A (B) — B is reachable because
    // A expands + shows its own +Study affordance.
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const a = deriveId(SMA20);
    actor.send({ type: 'series.addStudy', targetId: idOf(a), op: 'ema', period: 20 });
    const b = deriveId(emaOf(SMA20, 20));
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual([b, a, 'iv21']);
    expect(ctx().expanded).toBe(idOf(b));
    // Removing A must take B with it — B's source column vanishes with A, so B would
    // otherwise linger invisible + unremovable, pinning the terminal to "custom".
    actor.send({ type: 'series.remove', id: idOf(a) });
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual(['iv21']);
    expect(ctx().expanded).toBeNull(); // the phantom expansion is cleared too
  });

  it('keeps a study of a raw column when that raw series is removed (the column persists)', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const a = deriveId(SMA20);
    // iv21 is a raw data column — removing its *config* doesn't drop the column, so
    // sma(iv21) still resolves + draws. Only a study of a *study* cascades.
    actor.send({ type: 'series.remove', id: idOf('iv21') });
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual([a]);
  });

  it('tracks split-color fields in preset identity (a rise-color patch reads custom)', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'preset.save', slot: 0 });
    expect(activeSlot(ctx().presets, ctx().rows)).toBe(0);
    // Patching a split-coloring field diverges from the saved preset — canonRows
    // must see colorMode / riseColor / fallColor.
    actor.send({ type: 'series.patch', id: idOf('close'), patch: { colorMode: 'split' } });
    expect(activeSlot(ctx().presets, ctx().rows)).toBeNull();
    actor.send({ type: 'preset.select', slot: 0 }); // re-apply restores identity
    expect(activeSlot(ctx().presets, ctx().rows)).toBe(0);
    actor.send({ type: 'series.patch', id: idOf('close'), patch: { riseColor: 'teal' } });
    expect(activeSlot(ctx().presets, ctx().rows)).toBeNull();
  });

  it('orders a series within its row (front/up/down/back), clamped at the ends', () => {
    // Three metrics in the vol row: iv21, iv63, then the realized-vol line.
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    actor.send({ type: 'series.add', catalogId: RV });
    const rv = RV; // the realized-vol COLUMN — `idOf(rv)` is its identity
    const top = () => ctx().rows[0]!.configs.map((c) => c.column);
    // Adds prepend, so the most recent leads (front→back list).
    expect(top()).toEqual([rv, 'iv63', 'iv21']);

    // index 0 paints on top; `back` sends it under everything.
    actor.send({ type: 'series.order', id: idOf(rv), to: 'back' });
    expect(top()).toEqual(['iv63', 'iv21', rv]);
    actor.send({ type: 'series.order', id: idOf(rv), to: 'up' });
    expect(top()).toEqual(['iv63', rv, 'iv21']);
    actor.send({ type: 'series.order', id: idOf(rv), to: 'down' });
    expect(top()).toEqual(['iv63', 'iv21', rv]);
    actor.send({ type: 'series.order', id: idOf(rv), to: 'front' });
    expect(top()).toEqual([rv, 'iv63', 'iv21']);
    // Clamped, not wrapped: stepping past an end is a no-op.
    actor.send({ type: 'series.order', id: idOf(rv), to: 'up' });
    expect(top()).toEqual([rv, 'iv63', 'iv21']);
    actor.send({ type: 'series.order', id: idOf('iv21'), to: 'down' });
    expect(top()).toEqual([rv, 'iv63', 'iv21']);
  });

  it('reindexes to an absolute slot (the drag drop) and clamps out-of-range', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    const top = () => ctx().rows[0]!.configs.map((c) => c.column);
    actor.send({ type: 'series.reindex', id: idOf('iv63'), index: 0 });
    expect(top()).toEqual(['iv63', 'iv21']);
    actor.send({ type: 'series.reindex', id: idOf('iv63'), index: 99 }); // clamped to last
    expect(top()).toEqual(['iv21', 'iv63']);
  });

  it('order changes preset identity (draw order is part of the saved view)', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    actor.send({ type: 'preset.save', slot: 0 });
    expect(activeSlot(ctx().presets, ctx().rows)).toBe(0);
    actor.send({ type: 'series.order', id: idOf('iv63'), to: 'back' });
    expect(activeSlot(ctx().presets, ctx().rows)).toBeNull(); // reads custom
    actor.send({ type: 'preset.select', slot: 0 });
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual(['iv63', 'iv21']);
  });

  it('moves a series to another row, onto a compatible axis, at the front', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.moveToRow', id: idOf('iv21'), rowId: 'bottom' });
    // The vol row emptied ⇒ pruned (no empty rows); iv21 leads the bottom row.
    expect(ctx().rows.map((r) => r.id)).toEqual(['bottom']);
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual(['iv21', 'close']);
    // Price holds `$` on R, so the `%` vol series takes the free L side.
    expect(ctx().rows[0]!.configs.find((c) => c.column === 'iv21')!.axis).toBe('L');
  });

  it('rejects a cross-row move the target row has no axis for', () => {
    const { actor, ctx, idOf } = start();
    // Fill the bottom row's other side with a second unit so nothing is free:
    // price ($ on R) + volume (count on L) leaves no side for a `%` series.
    actor.send({ type: 'series.add', catalogId: 'volume', rowId: 'bottom' });
    actor.send({ type: 'series.moveToRow', id: idOf('iv21'), rowId: 'bottom' });
    expect(
      ctx()
        .rows.find((r) => r.id === 'top')
        ?.configs.map((c) => c.column),
    ).toEqual(['iv21']);
  });

  it('leaves an independently-added derived catalog metric behind on a move', () => {
    // `realizedVol(ccVar)` reads ccVar's COLUMN but was added on its own — moving
    // ccVar must not drag it to another row (it did, which also demanded a second
    // axis the target lacked and stranded the row; PR #119 review). Only studies
    // travel.
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'ccVar' });
    actor.send({ type: 'series.add', catalogId: RV });
    actor.send({ type: 'series.moveToRow', id: idOf('ccVar'), rowId: 'bottom' });
    const top = ctx().rows.find((r) => r.id === 'top')!;
    const bottom = ctx().rows.find((r) => r.id === 'bottom')!;
    expect(bottom.configs.map((c) => c.column)).toContain('ccVar');
    expect(top.configs.map((c) => c.column)).toContain(RV); // stayed
    // …and the target row kept one unit per side (variance L, price $ R).
    expect(bottom.configs.find((c) => c.column === 'ccVar')!.axis).toBe('L');
    expect(bottom.configs.find((c) => c.column === 'close')!.axis).toBe('R');
  });

  it('seats each traveller on its own compatible side (folding members as it goes)', () => {
    // A `%` series + its `%` study both move onto a row holding only `$` on R:
    // both fit on L (same unit shares a side), and neither collides with price.
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    actor.send({ type: 'series.moveToRow', id: idOf('iv21'), rowId: 'bottom' });
    const row = ctx().rows.find((r) => r.id === 'bottom')!;
    const axisOf = (column: string) => row.configs.find((c) => c.column === column)!.axis;
    expect(axisOf('iv21')).toBe('L');
    expect(axisOf(deriveId(SMA20))).toBe('L');
    expect(axisOf('close')).toBe('R');
  });

  it('adds a metric at the FRONT and a study in front of its source', () => {
    // Front→back list: a fresh add must be visible, not buried at the back.
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual(['iv63', 'iv21']);
    // A study reads OVER its source ⇒ it lands directly in front of it.
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual(['iv63', deriveId(SMA20), 'iv21']);
  });

  it('carries a study along when its source series moves rows', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const study = deriveId(SMA20);
    actor.send({ type: 'series.moveToRow', id: idOf('iv21'), rowId: 'bottom' });
    const bottom = ctx().rows.find((r) => r.id === 'bottom')!;
    // Both travelled — a study must never strand on a row without its source.
    expect(bottom.configs.map((c) => c.column)).toEqual([study, 'iv21', 'close']);
  });

  it('adds a series into a specific row when given a rowId (the per-row [+] Metric)', () => {
    const { actor, ctx } = start();
    // A bare add routes iv63 to its source (vol) row — the top. With an explicit
    // rowId it lands in that row instead (its `%` takes the bottom row's free L
    // axis, beside price on R).
    actor.send({ type: 'series.add', catalogId: 'iv63', rowId: 'bottom' });
    expect(
      ctx()
        .rows.find((r) => r.id === 'bottom')
        ?.configs.map((c) => c.column),
    ).toEqual(['iv63', 'close']);
    expect(
      ctx()
        .rows.find((r) => r.id === 'top')
        ?.configs.map((c) => c.column),
    ).toEqual(['iv21']);
  });
});

describe('series.addPair (TDL-PAIR)', () => {
  it("resolves a leg named by CATALOG id to the config seating it, in that config's row", () => {
    // The picker names a raw leg by its catalog id, which before the identity
    // split happened to equal the seated config's id. Matching only on `c.id`
    // afterwards found no seat, so every raw-leg spread fell through to
    // `rowForSource` — the FIRST row carrying that source (PR #139 review,
    // HIGH). Two vol rows make the difference visible.
    const { actor, ctx } = start([
      { id: 'top', height: 0, configs: [cfg('iv21')] },
      { id: 'middle', height: 150, configs: [cfg('iv63')] },
    ]);
    actor.send({
      type: 'series.addPair',
      a: { metricId: 'iv63' }, // the catalog id, exactly as the picker sends it
      b: { metricId: 'iv21' },
      op: 'ratio',
    });
    const spread = deriveId(RATIO_63_21);
    // In front of leg A, on leg A's OWN row — not at the front of `top`.
    expect(ctx().rows[1]!.configs.map((c) => c.column)).toEqual([spread, 'iv63']);
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toEqual(['iv21']);
    // …and the leg's label comes from the SEAT (the fixture names it by column),
    // not from the catalog entry it was picked from.
    expect(ctx().rows[1]!.configs[0]!.label).toBe('iv63 / iv21');
  });

  it('inserts the spread in front of leg A, unitless, expanded for tuning', () => {
    const { actor, cols, ctx, idOf, leg } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' }); // second % leg
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv21') },
      op: 'ratio',
    });

    const id = deriveId(RATIO_63_21);
    // In front of leg A — the spread is the signal and reads over its legs.
    expect(cols()).toEqual([id, 'iv63', 'iv21', 'close']);
    const spread = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.column === id)!;
    expect(spread.unit).toBe(''); // a ratio is unitless ⇒ its own scale
    expect(spread.derive).toEqual(RATIO_63_21);
    // Labels come from the LEG CONFIGS (the seed fixture labels iv21 by id).
    expect(spread.label).toBe('ATM Vol 63D / iv21');
    expect(ctx().expanded).toBe(idOf(id));

    // A diff of like units keeps the unit (still reads in %).
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv21') },
      op: 'diff',
    });
    const diff = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.column === deriveId({ op: 'diff', inputs: ['iv63', 'iv21'] }))!;
    expect(diff.unit).toBe('%');
  });

  it('guards: legs must exist, differ, share a source; no duplicate spec', () => {
    const { actor, cols, leg } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    const before = cols();

    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv63') },
      op: 'ratio',
    }); // same leg
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('nope') },
      op: 'ratio',
    }); // missing leg
    // Cross-source: iv63 reads `vol`, price reads `price` — the fold runs per
    // series, so the pair can't be computed (needs the join step; Tidal's pairs plan).
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('price') },
      op: 'ratio',
    });
    expect(cols()).toEqual(before);

    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv21') },
      op: 'ratio',
    });
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv21') },
      op: 'ratio',
    }); // duplicate
    expect(cols().filter((i) => i === deriveId(RATIO_63_21))).toHaveLength(1);
  });
});

describe('series.addPair with a compare-bound B leg (TDL-PAIR stage 1)', () => {
  it('allows the same metric across entities, prefixes source2, labels the role', () => {
    const { actor, cols, ctx, leg } = start();
    // Same leg twice, same entity: still refused…
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21') },
      b: { metricId: leg('iv21') },
      op: 'ratio',
    });
    expect(cols()).toEqual(['iv21', 'close']);
    // …but across entities it is the canonical case (iv21 vs compare's iv21).
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21') },
      b: { metricId: leg('iv21'), entity: 'compare' },
      op: 'ratio',
    });

    const id = deriveId(RATIO_21_CMP);
    expect(cols()).toEqual([id, 'iv21', 'close']);
    const spread = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.column === id)!;
    expect(spread.derive).toEqual(RATIO_21_CMP);
    expect(spread.label).toBe('iv21 / iv21 (cmp)');

    // The role-bound spec is one identity — a duplicate is refused like any other.
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21') },
      b: { metricId: leg('iv21'), entity: 'compare' },
      op: 'ratio',
    });
    expect(cols().filter((i) => i === id)).toHaveLength(1);
  });
});

describe('series.addPair with unseated catalog legs', () => {
  it('builds a spread from two metrics that are not on the chart', () => {
    const { actor, cols, leg } = start();
    // iv63 is in the CATALOG but not seated; iv21 is seated. Neither needs to
    // be: the source series carries every raw catalog column.
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv21') },
      op: 'ratio',
    });
    // The spread lands at the front of leg A's SOURCE row; the legs are NOT
    // auto-added.
    expect(cols()).toEqual([deriveId(RATIO_63_21), 'iv21', 'close']);
  });

  it('refuses an unseated DERIVED catalog leg (its column is config-borne)', () => {
    const { actor, cols, leg } = start([
      { id: 'top', height: 0, configs: [] },
      { id: 'bottom', height: 150, configs: [] },
    ]);
    // No configs at all: raw catalog legs still resolve…
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv21') },
      op: 'diff',
    });
    expect(cols()).toContain(deriveId({ op: 'diff', inputs: ['iv63', 'iv21'] }));
    // …but an id that is neither seated nor a raw catalog entry does not.
    const before = cols();
    actor.send({
      type: 'series.addPair',
      a: { metricId: deriveId(SMA20) },
      b: { metricId: leg('iv21') },
      op: 'ratio',
    });
    expect(cols()).toEqual(before); // the guard refused it — nothing added
  });
});

describe('series.addPair — the two-sided grammar (per-leg bindings + studies)', () => {
  it('builds a spread whose leg carries a per-leg study WITHOUT seating it', () => {
    const { actor, cols, ctx, leg } = start();
    // iv21 / SMA(20) of iv21 — the mean-reversion read; the SMA is NOT a
    // seated series, it nests inside the pair spec.
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21') },
      b: { metricId: leg('iv21'), study: { op: 'sma', period: 20 } },
      op: 'ratio',
    });
    const spreadId = deriveId({ op: 'ratio', inputs: ['iv21', SMA20] });
    expect(cols()).toContain(spreadId);
    expect(cols()).not.toContain(deriveId(SMA20)); // the study is nested, not seated
    const spread = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.column === spreadId)!;
    // The seed fixture labels iv21 by id (resolveLeg prefers the SEATED config).
    expect(spread.label).toBe('iv21 / iv21 · SMA(20)');
    // Ratio of like units is unitless — its own scale.
    expect(spread.unit).toBe('');
  });

  it('binds side A to the compare role (MSFT iv21 / AAPL iv21)', () => {
    const { actor, cols, leg } = start();
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21'), entity: 'compare' },
      b: { metricId: leg('iv21') },
      op: 'ratio',
    });
    const spreadId = deriveId({ op: 'ratio', inputs: ['cmp_iv21', 'iv21'] });
    expect(cols()).toContain(spreadId);
  });

  it('a compare-bound STUDIED leg rewrites the study leaf under the role', () => {
    const { actor, cols, leg } = start();
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21') },
      b: { metricId: leg('iv21'), entity: 'compare', study: { op: 'sma', period: 20 } },
      op: 'diff',
    });
    // The study computes OVER the compare columns: sma(cmp_iv21).
    const cmpSma: DeriveSpec = { op: 'sma', inputs: ['cmp_iv21'], params: { period: 20 } };
    expect(cols()).toContain(deriveId({ op: 'diff', inputs: ['iv21', cmpSma] }));
  });

  it('seats the spread on the NAMED row — the per-row +Pair beats leg A', () => {
    // A pair belongs to a row like any other series (Peter, 2026-08-17), so the
    // row the user pointed at wins over the default "in front of leg A", which
    // is only a guess.
    const { actor, ctx, leg } = start();
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21') }, // seated on TOP
      b: { metricId: leg('iv63') },
      op: 'ratio',
      rowId: 'bottom',
    });
    const spread = deriveId({ op: 'ratio', inputs: ['iv21', 'iv63'] });
    expect(ctx().rows.find((r) => r.id === 'bottom')!.configs[0]!.column).toBe(spread);
    expect(
      ctx()
        .rows.find((r) => r.id === 'top')!
        .configs.some((c) => c.column === spread),
    ).toBe(false);
  });

  it('refuses a named row that does not exist, without burning an id', () => {
    // The guard, the rows assigner and the id counter all read `pairSeats`, so
    // they cannot disagree about whether a config was created.
    const { actor, ctx, cols, leg } = start();
    const before = { cols: cols(), seq: ctx().cfgSeq };
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21') },
      b: { metricId: leg('iv63') },
      op: 'ratio',
      rowId: 'nope',
    });
    expect(cols()).toEqual(before.cols);
    expect(ctx().cfgSeq).toBe(before.seq);
  });

  it('refuses identical bound legs, whatever the spelling', () => {
    const { actor, cols, leg } = start();
    const before = cols();
    // Same metric, same role, same study — a constant.
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21'), study: { op: 'sma', period: 20 } },
      b: { metricId: leg('iv21'), study: { op: 'sma', period: 20 } },
      op: 'ratio',
    });
    expect(cols()).toEqual(before);
    // But the same metric under DIFFERENT studies differs after binding.
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21'), study: { op: 'sma', period: 20 } },
      b: { metricId: leg('iv21'), study: { op: 'sma', period: 50 } },
      op: 'ratio',
    });
    expect(cols()).toContain(deriveId({ op: 'ratio', inputs: [SMA20, SMA50] }));
  });

  it('compare-rebinding an already-compare-reading leg is idempotent (no cmp_cmp_)', () => {
    const { actor, cols, leg } = start();
    // Seat a compare-bound spread, then use IT as a compare-bound leg: the
    // rebind must not double-prefix its leaves.
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21') },
      b: { metricId: leg('iv21'), entity: 'compare' },
      op: 'ratio',
    });
    const seated = deriveId(RATIO_21_CMP);
    expect(cols()).toContain(seated);
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21') },
      b: { metricId: leg(seated), entity: 'compare' },
      op: 'diff',
    });
    // The nested leg's leaves read cmp_iv21 (once) — never cmp_cmp_iv21: the
    // iv21 leaf gains the prefix; the cmp_iv21 leaf keeps it.
    const expected = deriveId({
      op: 'diff',
      inputs: ['iv21', { op: 'ratio', inputs: ['cmp_iv21', 'cmp_iv21'] }],
    });
    expect(cols()).toContain(expected);
    expect(cols().some((i) => i.includes('cmp_cmp_'))).toBe(false);
  });

  it('refuses an out-of-range per-leg study period without killing the actor', () => {
    const { actor, cols, leg } = start();
    const before = cols();
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21') },
      b: { metricId: leg('iv21'), study: { op: 'sma', period: 10000 } },
      op: 'ratio',
    });
    expect(cols()).toEqual(before);
    actor.send({ type: 'series.add', catalogId: 'iv63' }); // still alive
    expect(cols()).toContain('iv63');
  });
});

describe('an UNJOINED pair — the leg group', () => {
  const all = (ctx: () => { rows: RowState[] }) => ctx().rows.flatMap((r) => r.configs);

  it('seats two LEGS and no spread', () => {
    const { actor, ctx, leg } = start();
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv42') },
      op: 'none',
    });
    const members = all(ctx).filter((c) => c.group);
    expect(members.map((m) => m.column).sort()).toEqual(['iv42', 'iv63']);
    // No transform, so no spread column anywhere — that is the whole point.
    expect(all(ctx).some((c) => c.derive && isPairOp(c.derive.op))).toBe(false);
    // Both legs share one group and are named A / B.
    expect(new Set(members.map((m) => m.group!.id)).size).toBe(1);
    expect(members.map((m) => m.group!.side).sort()).toEqual(['A', 'B']);
    // Two fresh lines are never one colour.
    expect(members[0]!.color).not.toBe(members[1]!.color);
  });

  it('ADOPTS a leg already on the chart rather than drawing it twice', () => {
    // iv21 is seeded, so the pair takes THAT series as its leg — one column,
    // one config. Without adoption this add is impossible, which is the common
    // case (pairing a metric that is also on the chart).
    const { actor, ctx, idOf, leg } = start();
    const seated = idOf('iv21');
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv21') },
      op: 'none',
    });
    expect(all(ctx).filter((c) => c.column === 'iv21')).toHaveLength(1);
    expect(all(ctx).find((c) => c.id === seated)!.group).toBeDefined();
  });

  it('the pair EYE hides both legs, and each keeps its own state', () => {
    const { actor, ctx, leg } = start();
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv42') },
      op: 'none',
    });
    const gid = all(ctx).find((c) => c.group)!.group!.id;
    const legB = all(ctx).find((c) => c.group?.side === 'B')!;
    // Turn ONE leg off first, so we can prove it survives the pair's eye.
    actor.send({ type: 'series.toggleVisible', id: legB.id });

    actor.send({ type: 'group.toggleVisible', groupId: gid });
    const hidden = all(ctx).filter((c) => c.group);
    expect(hidden.every((c) => c.group!.hidden)).toBe(true);
    expect(hidden.every((c) => !seriesDrawn(c))).toBe(true);
    // …their OWN eyes are untouched.
    expect(hidden.find((c) => c.group!.side === 'A')!.visible).toBe(true);
    expect(hidden.find((c) => c.group!.side === 'B')!.visible).toBe(false);

    actor.send({ type: 'group.toggleVisible', groupId: gid });
    const shown = all(ctx).filter((c) => c.group);
    // Unhiding restores what each leg WAS — it does not switch both on.
    expect(seriesDrawn(shown.find((c) => c.group!.side === 'A')!)).toBe(true);
    expect(seriesDrawn(shown.find((c) => c.group!.side === 'B')!)).toBe(false);
  });

  it('Remove pair clears BOTH pointers, like a single remove does', () => {
    const { actor, ctx, leg } = start();
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv42') },
      op: 'none',
    });
    const gid = all(ctx).find((c) => c.group)!.group!.id;
    const legA = all(ctx).find((c) => c.group?.side === 'A')!;
    actor.send({ type: 'select', id: legA.id });
    actor.send({ type: 'expand', id: legA.id });
    expect(ctx().selected).toBe(legA.id);
    expect(ctx().expanded).toBe(legA.id);

    // `removeSeries` states the invariant — neither pointer may name a removed
    // series — and `removeGroup` used to honour neither, so `emphasis`
    // (`expanded ?? selected`) went on naming a config that no longer existed
    // and masked the live selection (PR #149 review, LOW).
    actor.send({ type: 'group.remove', groupId: gid });
    expect(ctx().selected).toBeNull();
    expect(ctx().expanded).toBeNull();
  });

  it('Remove pair takes both legs, cascading exactly as a single remove does', () => {
    const { actor, ctx, leg } = start();
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv42') },
      op: 'none',
    });
    const gid = all(ctx).find((c) => c.group)!.group!.id;
    const legA = all(ctx).find((c) => c.group?.side === 'A')!;
    actor.send({ type: 'series.addStudy', targetId: legA.id, op: 'sma', period: 20 });
    expect(all(ctx)).toHaveLength(5); // iv21, close, legA, legB, the study

    actor.send({ type: 'group.remove', groupId: gid });
    // Both legs go. The study of leg A does NOT: its source is a RAW feed
    // column, which still folds — the same rule `series.remove` follows on a
    // plain metric, so "Remove pair" is not a special kind of delete. It
    // becomes a standalone study, which is what it now is.
    expect(all(ctx).filter((c) => c.group)).toHaveLength(0);
    expect(
      all(ctx)
        .map((c) => c.column)
        .sort(),
    ).toEqual(['close', 'iv21', deriveId({ op: 'sma', inputs: ['iv63'], params: { period: 20 } })]);
  });

  it('a study takes its metric’s COLOUR, so it reads as the same series', () => {
    const { actor, ctx, idOf } = start();
    const target = all(ctx).find((c) => c.column === 'iv21')!;
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    expect(all(ctx).find((c) => c.column === deriveId(SMA20))!.color).toBe(target.color);
  });
});

describe('guard totality — review regressions (PR #130)', () => {
  it('a spread travels with EITHER leg on a cross-row move (inputNames walks both)', () => {
    // Deliberate behavior (noted unpinned in the #130 review): the travel set
    // follows every input edge, so moving leg A takes the spread along.
    const { actor, ctx, idOf, leg } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv21') },
      op: 'ratio',
    });
    // An EMPTY target row: the spread's unitless axis has a free side there.
    // (Onto the price row the whole move is refused — placeOnRow is
    // all-or-nothing and '' can't share the \$ side; that guard is pinned
    // elsewhere.)
    actor.send({ type: 'row.add' });
    const newRow = ctx().rows.at(-1)!.id;
    actor.send({ type: 'series.moveToRow', id: idOf('iv63'), rowId: newRow });
    const target = ctx().rows.find((r) => r.id === newRow)!;
    expect(target.configs.map((c) => c.column)).toContain(deriveId(RATIO_63_21));
    expect(target.configs.map((c) => c.column)).toContain('iv63');
  });

  it('rejects an out-of-range period without killing the actor', () => {
    const { actor, ctx, cols, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const before = cols();
    // Above the registry max (PERIOD_BOUNDS.max = 5000): deriveId THROWS on
    // this spec, so the guard must refuse it before naming — a guard that
    // throws errors the whole actor and every later event drops.
    actor.send({ type: 'series.setStudyParam', id: deriveId(SMA20), name: 'period', value: 10000 });
    expect(cols()).toEqual(before); // rejected, unchanged
    // The actor is still alive: a normal event still lands.
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    expect(cols()).toContain('iv63');
    expect(ctx().rows.length).toBeGreaterThan(0);
  });

  it('rejects an invalid addStudy period (host-driven, no UI gate) and stays alive', () => {
    const { actor, cols, idOf } = start();
    const before = cols();
    for (const period of [1, 2.5, NaN, 10000])
      actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period });
    expect(cols()).toEqual(before);
    actor.send({ type: 'series.add', catalogId: 'iv63' }); // still alive
    expect(cols()).toContain('iv63');
  });
});

describe('series.addPair — review regressions (PR #128)', () => {
  it('arrives UNLINKED (own axis) and never poisons a side another unit holds', () => {
    // Bottom row seeds price ($ on R). A price/volume ratio is unitless ('') —
    // seating it on a shared axis beside `$` would mis-scale it against the
    // price axis and poison the side for every future add. It arrives on its
    // OWN right-side axis instead (the axis panel's "spreads arrive unlinked"),
    // binding no unit at all.
    const { actor, ctx, leg } = start();
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('price') },
      b: { metricId: leg('volume') },
      op: 'ratio',
    });
    const bottom = ctx().rows.find((r) => r.id === 'bottom')!;
    const spread = bottom.configs.find(
      (c) => c.column === deriveId({ op: 'ratio', inputs: ['close', 'volume'] }),
    )!;
    expect(spread.axisGroup).toBeDefined();
    expect(spread.axis).toBe('R');
    // The $ binding is untouched: the SHARED R axis still holds exactly one unit.
    const rUnits = new Set(
      bottom.configs.filter((c) => c.axis === 'R' && !c.axisGroup).map((c) => c.unit ?? ''),
    );
    expect(rUnits).toEqual(new Set(['$']));
  });

  it('cascade-removes a spread when its B-leg study is removed', () => {
    const { actor, cols, idOf, leg } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const smaId = deriveId(SMA20);
    // The pair NESTS its derived B leg, so the spread's id embeds the spec.
    const spreadId = deriveId({ op: 'ratio', inputs: ['iv21', SMA20] });
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21') },
      b: { metricId: leg(smaId) },
      op: 'ratio',
    });
    expect(cols()).toContain(spreadId);
    // Removing the study must take the spread with it — its B column vanishes,
    // so the spread would otherwise strand invisible + unremovable.
    actor.send({ type: 'series.remove', id: idOf(smaId) });
    expect(cols()).not.toContain(spreadId);
    expect(cols()).not.toContain(smaId);
  });

  it('PROPAGATES a period change into the spread whose B leg it is', () => {
    const { actor, cols, ctx, idOf, leg } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const smaId = deriveId(SMA20);
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv21') },
      b: { metricId: leg(smaId) },
      op: 'ratio',
    });
    const spreadId = deriveId({ op: 'ratio', inputs: ['iv21', SMA20] });
    const spread = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.column === spreadId)!;

    actor.send({ type: 'series.setStudyParam', id: idOf(smaId), name: 'period', value: 50 });
    // The spread's B leg follows its study: same spread (same id, so its purple,
    // its own axis and any pin stand), now reading the re-spec'd leg. It used to
    // be deleted out from under the user for this (PR #128 regression test —
    // the strand it guarded against is now repaired instead of removed).
    expect(cols()).toContain(deriveId(SMA50));
    expect(cols()).not.toContain(spreadId);
    const after = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.id === spread.id)!;
    expect(after.column).toBe(deriveId({ op: 'ratio', inputs: ['iv21', SMA50] }));
    expect(after.axisGroup).toBeDefined();
  });
});

describe('axis membership — link/unlink (the axis panel)', () => {
  it('unlinks a shared member to its own axis; the panel toggle re-links it', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' }); // iv21 + iv63 share top:L
    actor.send({ type: 'axis.toggleLink', id: idOf('iv63') });
    expect(find(ctx, 'iv63').axisGroup).toBeDefined();
    expect(find(ctx, 'iv21').axisGroup).toBeUndefined(); // untouched
    actor.send({ type: 'axis.toggleLink', id: idOf('iv63') }); // BLINK → re-link
    expect(find(ctx, 'iv63').axisGroup).toBeUndefined();
  });

  it('unlinks a LONE shared member — the escape route off a stranded side', () => {
    // Visually a no-op (it is already the only member), but semantically the
    // difference between a shared scale and an own one: an own axis binds no
    // unit, so it can always ⇄. Refusing this stranded a lone series whose far
    // side was occupied — both controls disabled, no way out (PR #136 review,
    // HIGH).
    const { actor, ctx, idOf } = start(); // iv21 alone on top:L
    actor.send({ type: 'axis.toggleLink', id: idOf('iv21') });
    expect(find(ctx, 'iv21').axisGroup).toBeDefined();
  });

  it('has no dead end: a lone series on an occupied-far-side row can still cross', () => {
    // The reviewer's exact trap: ⇄ the vol axis right, then add a second %
    // metric — it seats alone on the now-free left, with the far side holding
    // a shared axis. Unlink → ⇄ → link must reunite the two % scales.
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'axis.swapSide', memberId: idOf('iv21') }); // top:R holds iv21
    actor.send({ type: 'series.add', catalogId: 'iv63' }); // iv63 seats alone on top:L
    expect(find(ctx, 'iv63').axis).toBe('L');
    actor.send({ type: 'axis.toggleLink', id: idOf('iv63') }); // own axis ⇒ mobile
    actor.send({ type: 'axis.swapSide', memberId: idOf('iv63') }); // own axes always swap
    expect(find(ctx, 'iv63').axis).toBe('R');
    actor.send({ type: 'axis.toggleLink', id: idOf('iv63') }); // join iv21's scale
    expect(find(ctx, 'iv63').axisGroup).toBeUndefined();
    expect(find(ctx, 'iv21').axisGroup).toBeUndefined();
    // Both % series share one axis again — the arrangement is reachable.
    expect(find(ctx, 'iv63').axis).toBe('R');
  });

  it("merges two lone axes from either BROKEN chain (the sketch's split state)", () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    actor.send({ type: 'axis.toggleLink', id: idOf('iv63') }); // split: iv21 lone-shared, iv63 own
    // Clicking the LINKED one unlinks it (the icon means what it says), so the
    // side now holds two lone axes and no shared scale…
    actor.send({ type: 'axis.toggleLink', id: idOf('iv21') });
    expect(find(ctx, 'iv21').axisGroup).toBeDefined();
    expect(find(ctx, 'iv63').axisGroup).toBeDefined();
    // …and clicking either broken chain merges the same-unit ones into one.
    actor.send({ type: 'axis.toggleLink', id: idOf('iv63') });
    expect(find(ctx, 'iv63').axisGroup).toBeUndefined();
    expect(find(ctx, 'iv21').axisGroup).toBeUndefined();
  });

  it('gates the re-link: nothing to join on a free side, unit mismatch on a bound one', () => {
    const { actor, ctx, idOf, leg } = start();
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv21') },
      op: 'ratio',
    });
    const spreadId = deriveId(RATIO_63_21);
    const spread = find(ctx, spreadId);
    expect(spread.axisGroup).toBeDefined(); // arrives unlinked…
    expect(spread.axis).toBe('R'); // …on the right side of leg A's row
    // top:R is FREE — joining needs something to join, so the toggle refuses
    // (a lone series can never bind a free side; unlink/re-link stays symmetric).
    actor.send({ type: 'axis.toggleLink', id: idOf(spreadId) });
    expect(find(ctx, spreadId).axisGroup).toBeDefined();
    // And once a % series binds R, the join is refused on unit grounds too.
    actor.send({ type: 'axis.swapSide', memberId: idOf('iv21') });
    actor.send({ type: 'axis.toggleLink', id: idOf(spreadId) });
    expect(find(ctx, spreadId).axisGroup).toBeDefined(); // still unlinked
  });

  it('one click joins two lone same-unit spreads onto one scale', () => {
    const { actor, ctx, idOf, leg } = start();
    // Two RATIOS (both unitless) — not a ratio and a log-ratio, which read in
    // different units (`''` vs `'log'`, per the registry) and so are correctly
    // refused a shared scale.
    for (const [a, b] of [
      ['iv63', 'iv21'],
      ['iv21', 'iv63'],
    ] as const)
      actor.send({
        type: 'series.addPair',
        a: { metricId: leg(a) },
        b: { metricId: leg(b) },
        op: 'ratio',
      });
    const ratioId = deriveId(RATIO_63_21);
    const invId = deriveId({ op: 'ratio', inputs: ['iv21', 'iv63'] });
    expect(find(ctx, ratioId).axisGroup).toBeDefined();
    expect(find(ctx, invId).axisGroup).toBeDefined();
    // Both are lone unitless axes on top:R — either broken chain joins them.
    actor.send({ type: 'axis.toggleLink', id: idOf(ratioId) });
    expect(find(ctx, ratioId).axisGroup).toBeUndefined();
    expect(find(ctx, invId).axisGroup).toBeUndefined();
  });

  it('a log-ratio reads in `log`, so it cannot share a unitless spread’s scale', () => {
    // The registry declares each op's output unit and `specUnit` is the one
    // reader, so the add path and the lens can never disagree about this.
    const { actor, ctx, idOf, leg } = start();
    for (const op of ['ratio', 'logRatio'] as const)
      actor.send({
        type: 'series.addPair',
        a: { metricId: leg('iv63') },
        b: { metricId: leg('iv21') },
        op,
      });
    const ratioId = deriveId(RATIO_63_21);
    const logId = deriveId({ op: 'logRatio', inputs: ['iv63', 'iv21'] });
    expect(find(ctx, ratioId).unit).toBe('');
    expect(find(ctx, logId).unit).toBe('log');
    actor.send({ type: 'axis.toggleLink', id: idOf(ratioId) });
    expect(find(ctx, ratioId).axisGroup).toBeDefined(); // nothing same-unit to join
  });

  it('an unlinked spread can be added even when both sides are unit-bound', () => {
    // Both bottom sides bound to different units — the pre-panel guard refused
    // this add outright; unlinked, it just works.
    const { actor, cols, leg } = start();
    actor.send({ type: 'series.add', catalogId: 'volume' }); // count on bottom:L
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('price') },
      b: { metricId: leg('volume') },
      op: 'logRatio',
    });
    expect(cols()).toContain(deriveId({ op: 'logRatio', inputs: ['close', 'volume'] }));
  });

  it('moves an unlinked spread to a row whose sides could not seat its unit', () => {
    const { actor, ctx, idOf, leg } = start();
    actor.send({ type: 'series.add', catalogId: 'volume' }); // bottom: count(L) + $(R)
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv21') },
      op: 'ratio',
    });
    const spreadId = deriveId(RATIO_63_21);
    actor.send({ type: 'series.moveToRow', id: idOf(spreadId), rowId: 'bottom' });
    const bottom = ctx().rows.find((r) => r.id === 'bottom')!;
    expect(bottom.configs.map((c) => c.column)).toContain(spreadId);
    expect(bottom.configs.find((c) => c.column === spreadId)!.axisGroup).toBeDefined();
  });
});

describe('axis membership is a KEY, so members can share a non-shared axis', () => {
  const find = (ctx: () => { rows: RowState[] }, column: string) =>
    ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.column === column)!;

  it('two unlinked series can be dragged onto ONE axis', () => {
    // The thing a boolean `ownAxis` could not express: unlink both and they got
    // a private axis each, with no way to put them together (Peter, 2026-08-18).
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    actor.send({ type: 'axis.toggleLink', id: idOf('iv21') });
    actor.send({ type: 'axis.toggleLink', id: idOf('iv63') });
    const a = find(ctx, 'iv21');
    const b = find(ctx, 'iv63');
    expect(a.axisGroup).toBeDefined();
    expect(b.axisGroup).toBeDefined();
    expect(a.axisGroup).not.toBe(b.axisGroup); // two axes

    actor.send({ type: 'axis.moveTo', id: b.id, axisGroup: a.axisGroup });
    expect(find(ctx, 'iv63').axisGroup).toBe(a.axisGroup); // …now one
    // …and the axis they share is the one A already had, so A's range pin
    // (keyed by axis id) is untouched.
    expect(configAxisId('top', find(ctx, 'iv63'))).toBe(configAxisId('top', find(ctx, 'iv21')));
  });

  it('dragging to the shared axis is the same as re-linking', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    actor.send({ type: 'axis.toggleLink', id: idOf('iv63') });
    expect(find(ctx, 'iv63').axisGroup).toBeDefined();
    actor.send({ type: 'axis.moveTo', id: idOf('iv63'), axisGroup: undefined });
    expect(find(ctx, 'iv63').axisGroup).toBeUndefined();
  });

  it('refuses a destination reading a different unit — one axis, one scale', () => {
    // Built by hand: the add path's own unit gate keeps two units off one side,
    // so this is the guard's job to refuse if state ever gets there anyway.
    const pct = cfg('iv21', { axis: 'L', unit: '%' });
    const usd = cfg('close', { axis: 'L', unit: '$', axisGroup: 'own' });
    expect(axisMoveAllowed([pct, usd], pct.id, 'own')).toBe(false);
    // …and the same unit is fine.
    const pct2 = cfg('iv63', { axis: 'L', unit: '%', axisGroup: 'own' });
    expect(axisMoveAllowed([pct, pct2], pct.id, 'own')).toBe(true);
  });

  it("a drop onto this side's shared axis ignores the OTHER side's members", () => {
    // What this replaces: the destination was drawn from the whole row, and
    // `undefined` is not a key — BOTH sides' shared members carry it. So one
    // series on the far side refused every drop onto this side's shared axis,
    // while the chain toggle allowed the identical move. An axis id is
    // side-qualified, so the far side is a different axis and none of its
    // members belong to this decision (PR #149 review, MEDIUM).
    const mover = cfg('iv21', { axis: 'L', unit: '%', axisGroup: 'own' });
    const home = cfg('iv63', { axis: 'L', unit: '%' });
    const far = cfg('ccVar', { axis: 'R', unit: 'variance' });
    expect(axisMoveAllowed([mover, home, far], mover.id, undefined)).toBe(true);
  });

  it('still refuses a destination on this side carrying another unit', () => {
    const mover = cfg('iv21', { axis: 'L', unit: '%', axisGroup: 'own' });
    const home = cfg('volume', { axis: 'L', unit: 'count' });
    expect(axisMoveAllowed([mover, home], mover.id, undefined)).toBe(false);
  });

  it('a move maintains the range invariant at BOTH ends', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' }); // iv21 + iv63 share top:L
    const iv = idOf('iv21');
    // Unlink iv21 to its own axis and pin that axis.
    actor.send({ type: 'axis.toggleLink', id: iv });
    const own = `top:L:${iv}`;
    actor.send({ type: 'axis.setRange', axisId: own, min: 0, max: 60, unit: '%' });
    expect(ctx().axisRanges[own]).toMatchObject({ mode: 'manual', min: 0, max: 60 });

    // Move it onto a NEW key. It was alone, so its own id is vacated and the
    // pin travels with it — the axis is the same axis under a new id.
    actor.send({ type: 'axis.moveTo', id: iv, axisGroup: 'pair' });
    expect(ctx().axisRanges[own]).toBeUndefined();
    expect(ctx().axisRanges[`top:L:pair`]).toMatchObject({ mode: 'manual', min: 0, max: 60 });

    // Move it onto the SHARED axis, which already holds iv63. An arriving
    // member joins an existing axis; it does not carry its scale onto it.
    actor.send({ type: 'axis.moveTo', id: iv, axisGroup: undefined });
    expect(ctx().axisRanges['top:L:pair']).toBeUndefined();
    expect(ctx().axisRanges['top:L']).toBeUndefined(); // shared was never pinned
  });

  it('an empty destination is always fine, and moving nowhere is a no-op', () => {
    const { actor, ctx, idOf } = start();
    const iv = idOf('iv21');
    expect(axisMoveAllowed(ctx().rows[0]!.configs, iv, undefined)).toBe(false); // already shared
    expect(axisMoveAllowed(ctx().rows[0]!.configs, iv, 'brand-new')).toBe(true);
    actor.send({ type: 'axis.moveTo', id: iv, axisGroup: 'brand-new' });
    expect(find(ctx, 'iv21').axisGroup).toBe('brand-new');
  });
});

describe('row layout keeps exactly one remainder row', () => {
  /** The row that absorbs slack. The renderer resolves `height: 0` as "take what
   *  is left", and the splitter reads the same flag to decide which side of a
   *  seam is elastic — so if these two ever disagree, a drag budgets against a
   *  row the resolver is ignoring and the seam sticks. */
  const remainders = (rows: readonly RowState[]) => rows.filter((r) => r.height === 0).length;

  it("survives Peter's sequence: remove the top row, add one, and the seam still moves", () => {
    const { actor, ctx } = start();
    // The seed: the vol row absorbs slack, the price row is fixed.
    expect(remainders(ctx().rows)).toBe(1);
    expect(ctx().rows[0]!.height).toBe(0);

    // Remove the remainder row itself. The survivor has to take over, or the
    // stack has nothing elastic in it.
    actor.send({ type: 'row.remove', id: ctx().rows[0]!.id });
    expect(ctx().rows).toHaveLength(1);
    expect(remainders(ctx().rows)).toBe(1);

    // Adding a row adds a FIXED one — which is right, a new row wants a definite
    // size — and must not cost the stack its remainder.
    actor.send({ type: 'row.add' });
    expect(ctx().rows).toHaveLength(2);
    expect(remainders(ctx().rows)).toBe(1);
    // This was the bug: two fixed rows, and the renderer silently treating the
    // LAST as elastic while the splitter believed neither was. The seam then
    // refused to travel more than NEW_ROW_HEIGHT − MIN_FIXED.
    expect(ctx().rows.map((r) => r.height === 0)).toEqual([true, false]);
  });

  it('a height commit cannot write the remainder away', () => {
    const { actor, ctx } = start();
    const ids = ctx().rows.map((r) => r.id);
    // A drag commits a full map; one that gives every row a fixed height would
    // strand the stack with nothing to absorb slack.
    actor.send({
      type: 'layout.setRowHeights',
      heights: { [ids[0]!]: 200, [ids[1]!]: 150 },
    });
    expect(remainders(ctx().rows)).toBe(1);
  });

  it('a preset saved without a remainder row is healed on apply', () => {
    // The pre-invariant shape: every row fixed. `setRowHeights` heals that now,
    // so it cannot be reached through an event — seed the actor with it instead,
    // which is also how a blob saved before the invariant existed arrives.
    const legacy: RowState[] = initialRows().map((r) => ({ ...r, height: 150 }));
    expect(remainders(legacy)).toBe(0);
    const { actor, ctx } = start(legacy);
    // Healed at BOOT, not merely on the next edit: the host seeds these rows,
    // and on a reload re-seeds them from the stored active preset.
    expect(remainders(ctx().rows)).toBe(1);

    // …and a preset saved from an already-healed stack round-trips.
    actor.send({ type: 'preset.save', slot: 0 });
    actor.send({ type: 'preset.select', slot: 0 });
    expect(remainders(ctx().rows)).toBe(1);
  });
});

describe('canonRows is mint-independent', () => {
  it('hashes the axis-membership SHAPE, not the minted keys', () => {
    // A preset is a LOOK. `axisGroup` and `group.id` are both minted config
    // ids, so hashing them made a hand-rebuilt copy of a saved chart read as
    // "custom" purely because its configs were minted later — the exact trap
    // excluding `c.id` exists to avoid (PR #149 review, LOW).
    const mk = (mint: string) => [
      {
        id: 'top',
        height: 0,
        configs: [
          cfg('iv21', { id: `${mint}-1`, axisGroup: `${mint}-1` }),
          cfg('iv63', { id: `${mint}-2`, axisGroup: `${mint}-1` }),
          cfg('iv42', { id: `${mint}-3` }),
        ],
      },
    ];
    expect(canonRows(mk('s'))).toBe(canonRows(mk('t')));
  });

  it('still separates charts whose membership genuinely differs', () => {
    const shared = [{ id: 'top', height: 0, configs: [cfg('iv21'), cfg('iv63')] }];
    const split = [
      {
        id: 'top',
        height: 0,
        configs: [cfg('iv21', { axisGroup: 'a' }), cfg('iv63', { axisGroup: 'b' })],
      },
    ];
    expect(canonRows(shared)).not.toBe(canonRows(split));
  });
});

describe('axis side swap (the panel ⇄)', () => {
  it('moves a whole SHARED axis to the free side — every member travels', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' }); // iv21 + iv63 share top:L
    actor.send({ type: 'axis.swapSide', memberId: idOf('iv21') });
    expect(find(ctx, 'iv21').axis).toBe('R');
    expect(find(ctx, 'iv63').axis).toBe('R'); // the axis moved, not one series
  });

  it('refuses a shared-axis swap when the far side already has a shared axis', () => {
    // bottom holds price ($, R) — moving a shared L axis there would merge two
    // scales of different units into one, which is a LINK, not a move.
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'volume' }); // count on bottom:L
    actor.send({ type: 'axis.swapSide', memberId: idOf('volume') });
    expect(find(ctx, 'volume').axis).toBe('L'); // unchanged
    expect(find(ctx, 'close').axis).toBe('R');
  });

  it('always allows an UNLINKED axis to swap — it binds no unit', () => {
    const { actor, ctx, idOf, leg } = start();
    actor.send({ type: 'series.add', catalogId: 'volume' }); // both bottom sides bound
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('price') },
      b: { metricId: leg('volume') },
      op: 'ratio',
    });
    const spreadId = deriveId({ op: 'ratio', inputs: ['close', 'volume'] });
    expect(find(ctx, spreadId).axis).toBe('R'); // arrives unlinked on the right
    actor.send({ type: 'axis.swapSide', memberId: idOf(spreadId) });
    expect(find(ctx, spreadId).axis).toBe('L');
    expect(find(ctx, spreadId).axisGroup).toBeDefined(); // still its own scale
    // …and the bound sides are untouched by its passage.
    expect(find(ctx, 'volume').axis).toBe('L');
    expect(find(ctx, 'close').axis).toBe('R');
  });

  it('carries the manual pin with the axis (the id re-keys on the side change)', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'axis.setRange', axisId: 'top:L', min: 10, max: 40, unit: '%' });
    actor.send({ type: 'axis.swapSide', memberId: idOf('iv21') });
    // A pin belongs to the SCALE, not the gutter it occupied.
    expect(ctx().axisRanges['top:L']).toBeUndefined();
    expect(ctx().axisRanges['top:R']).toEqual({ mode: 'manual', min: 10, max: 40, unit: '%' });
  });

  it('an UNPINNED axis clears the destination — it never inherits a stale pin', () => {
    const { actor, ctx, idOf } = start();
    // A same-unit pin is left behind at top:R by a scale that has since gone
    // (entries are deliberately never pruned — normally inert).
    actor.send({ type: 'axis.setRange', axisId: 'top:R', min: 0, max: 99, unit: '%' });
    actor.send({ type: 'axis.swapSide', memberId: idOf('iv21') }); // the L axis arrives, unpinned
    // Without the destination clear it would silently adopt [0, 99] and the
    // chart would re-scale with the lock reading open (PR #135 review).
    expect(ctx().axisRanges['top:R']).toBeUndefined();
    expect(ctx().axisRanges['top:L']).toBeUndefined();
  });
});

describe('axis ranges — AUTO | manual with memory', () => {
  it('pins a manual range (unit-stamped), flips back to auto keeping the memory, re-manuals', () => {
    const { actor, ctx } = start();
    actor.send({ type: 'axis.setRange', axisId: 'top:L', min: 10, max: 40, unit: '%' });
    // The pin carries the unit it was set FOR — the render side treats a
    // unit-mismatched entry as absent (a shared axis id can be re-bound).
    expect(ctx().axisRanges['top:L']).toEqual({ mode: 'manual', min: 10, max: 40, unit: '%' });
    actor.send({ type: 'axis.setAuto', axisId: 'top:L' });
    // Auto with values = the preserved manual memory ("Auto fit was …").
    expect(ctx().axisRanges['top:L']).toEqual({ mode: 'auto', min: 10, max: 40, unit: '%' });
    actor.send({ type: 'axis.setRange', axisId: 'top:L', min: 10, max: 40, unit: '%' });
    expect(ctx().axisRanges['top:L']!.mode).toBe('manual');
  });

  it("a study's own-axis pin survives a period edit (the identity split's payoff)", () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const id = idOf(deriveId(SMA20));
    actor.send({ type: 'axis.toggleLink', id }); // onto its own axis…
    const ownAxis = `top:L:${id}`;
    actor.send({ type: 'axis.setRange', axisId: ownAxis, min: 0, max: 60, unit: '%' });

    actor.send({ type: 'series.setStudyParam', id, name: 'period', value: 50 });
    // The axis id embeds the CONFIG id, which the edit didn't touch — so the
    // scale the user locked is still the scale the re-spec'd study draws on.
    // When the id was the spec, this pin was orphaned by every period change.
    expect(ctx().axisRanges[ownAxis]).toEqual({ mode: 'manual', min: 0, max: 60, unit: '%' });
    expect(ctx().rows[0]!.configs.find((c) => c.id === id)!.axisGroup).toBeDefined();
  });

  it('refuses a degenerate or non-finite range (and setAuto on an untouched axis no-ops)', () => {
    const { actor, ctx } = start();
    actor.send({ type: 'axis.setRange', axisId: 'top:L', min: 40, max: 10, unit: '%' });
    actor.send({ type: 'axis.setRange', axisId: 'top:L', min: 5, max: 5, unit: '%' });
    actor.send({ type: 'axis.setRange', axisId: 'top:L', min: NaN, max: 10, unit: '%' });
    actor.send({ type: 'axis.setRange', axisId: 'top:L', min: 0, max: Infinity, unit: '%' });
    actor.send({ type: 'axis.setAuto', axisId: 'top:L' });
    expect(ctx().axisRanges['top:L']).toBeUndefined();
    // The actor survived all of it.
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    expect(ctx().rows[0]!.configs.map((c) => c.column)).toContain('iv63');
  });

  it('applying a preset resets the ranges (composition restores, arrangement clears)', () => {
    const { actor, ctx } = start();
    actor.send({ type: 'preset.save', slot: 0 });
    actor.send({ type: 'axis.setRange', axisId: 'top:L', min: 10, max: 40, unit: '%' });
    actor.send({ type: 'preset.select', slot: 0 });
    expect(ctx().axisRanges).toEqual({});
  });

  it('membership is preset identity: an unlinked member reads as a different state', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' });
    actor.send({ type: 'preset.save', slot: 0 });
    expect(activeSlot(ctx().presets, ctx().rows)).toBe(0);
    actor.send({ type: 'axis.toggleLink', id: idOf('iv63') });
    expect(activeSlot(ctx().presets, ctx().rows)).toBeNull(); // custom now
    // Re-linking DROPS `axisGroup` — which must read IDENTICAL to the saved
    // (fieldless) state, or a round-trip could never light its slot again.
    actor.send({ type: 'axis.toggleLink', id: idOf('iv63') });
    expect(activeSlot(ctx().presets, ctx().rows)).toBe(0);
  });
});

describe('studies are a pipeline', () => {
  it('studyChainTail walks to the END of the chain, so + Study appends', () => {
    const { actor, ctx, idOf } = start();
    const root = idOf('iv21');
    const all = () => ctx().rows.flatMap((r) => r.configs);
    // Nothing layered on it yet — the root IS the tail.
    expect(studyChainTail(all(), root)).toBe(root);

    actor.send({ type: 'series.addStudy', targetId: root, op: 'sma', period: 20 });
    const sma = idOf(deriveId(SMA20));
    expect(studyChainTail(all(), root)).toBe(sma);

    // Appending targets the tail — which is how the panel avoids branching.
    actor.send({
      type: 'series.addStudy',
      targetId: studyChainTail(all(), root),
      op: 'ema',
      period: 20,
    });
    const ema = idOf(deriveId(emaOf(SMA20, 20)));
    expect(studyChainTail(all(), root)).toBe(ema);
    // …and the chain really is a chain: the EMA reads the SMA, not iv21.
    expect(all().find((c) => c.id === ema)!.derive).toEqual(emaOf(SMA20, 20));
  });

  it('a whole CHAIN travels as one block when the row is reordered', () => {
    // rowBlocks keyed on the immediate parent, so a 2-deep study headed its own
    // block appended last — one "move lower" on the metric sent the EMA behind
    // the SMA it derives from (PR #143 review, MEDIUM).
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: 'iv63' }); // something to move past
    const root = idOf('iv21');
    actor.send({ type: 'series.addStudy', targetId: root, op: 'sma', period: 20 });
    const all = () => ctx().rows.flatMap((r) => r.configs);
    actor.send({
      type: 'series.addStudy',
      targetId: studyChainTail(all(), root),
      op: 'ema',
      period: 20,
    });
    const chain = [deriveId(emaOf(SMA20, 20)), deriveId(SMA20), 'iv21'];
    const top = () => ctx().rows[0]!.configs.map((c) => c.column);
    expect(top()).toEqual(['iv63', ...chain]);

    // Step the OTHER metric down one. The chain must travel as one block and
    // stay contiguous. Keyed on the immediate parent, the 2-deep EMA was its
    // own block appended LAST, so this single step stranded it at the back of
    // the row — behind the SMA it derives from.
    actor.send({ type: 'series.order', id: idOf('iv63'), to: 'down' });
    expect(top()).toEqual([...chain, 'iv63']);
  });

  // The three axis-option writers each rebuild the axis's entry, so each one can
  // silently DROP a field it does not know about. They had no coverage, which is
  // how two of them shipped with an "is this empty?" test that had fallen behind
  // the type — the review that found it is the reason these exist.
  describe("the axis option writers keep each other's state", () => {
    it('clearing the locks keeps precision and scale', () => {
      const { actor, ctx } = start();
      actor.send({
        type: 'axis.setFormat',
        axisId: 'top:L',
        precision: 3,
        scaleType: 'log',
        unit: '%',
      });
      // A membership change re-seeds the derived bar lock — here, to none.
      actor.send({ type: 'axis.setLocks', axisId: 'top:L', unit: '%' });
      expect(ctx().axisRanges['top:L']?.precision).toBe(3);
      expect(ctx().axisRanges['top:L']?.scaleType).toBe('log');
    });

    it('turning centre-zero back off keeps precision and scale', () => {
      const { actor, ctx } = start();
      actor.send({
        type: 'axis.setFormat',
        axisId: 'top:L',
        precision: 2,
        scaleType: 'log',
        unit: '%',
      });
      actor.send({
        type: 'axis.setAutoOpts',
        axisId: 'top:L',
        autoBasis: 'viewport',
        centerZero: true,
        unit: '%',
      });
      actor.send({
        type: 'axis.setAutoOpts',
        axisId: 'top:L',
        autoBasis: 'viewport',
        centerZero: false,
        unit: '%',
      });
      expect(ctx().axisRanges['top:L']?.precision).toBe(2);
      expect(ctx().axisRanges['top:L']?.scaleType).toBe('log');
    });

    it('setting a lock keeps the fit options', () => {
      const { actor, ctx } = start();
      actor.send({
        type: 'axis.setAutoOpts',
        axisId: 'top:L',
        autoBasis: 'metric',
        centerZero: true,
        unit: '%',
      });
      actor.send({ type: 'axis.setLocks', axisId: 'top:L', lockMin: 0, unit: '%' });
      expect(ctx().axisRanges['top:L']?.autoBasis).toBe('metric');
      expect(ctx().axisRanges['top:L']?.centerZero).toBe(true);
      expect(ctx().axisRanges['top:L']?.lockMin).toBe(0);
    });

    it('a pin carries the locks forward — the bug that let a gesture erase the floor', () => {
      const { actor, ctx } = start();
      actor.send({ type: 'axis.setLocks', axisId: 'top:L', lockMin: 0, unit: '%' });
      // What a gutter gesture writes.
      actor.send({ type: 'axis.setRange', axisId: 'top:L', min: 0, max: 176.6, unit: '%' });
      expect(ctx().axisRanges['top:L']?.lockMin).toBe(0);
    });

    it('drops an entry only once it truly says nothing', () => {
      const { actor, ctx } = start();
      actor.send({
        type: 'axis.setFormat',
        axisId: 'top:L',
        precision: 1,
        scaleType: 'linear',
        unit: '%',
      });
      expect(ctx().axisRanges['top:L']).toBeDefined();
      actor.send({ type: 'axis.setFormat', axisId: 'top:L', scaleType: 'linear', unit: '%' });
      expect(ctx().axisRanges['top:L']).toBeUndefined();
    });

    it('refuses a log scale beside a zero bound, whatever asks for it', () => {
      const { actor, ctx } = start();
      actor.send({ type: 'axis.setLocks', axisId: 'top:L', lockMin: 0, unit: '%' });
      actor.send({ type: 'axis.setFormat', axisId: 'top:L', scaleType: 'log', unit: '%' });
      // log(0) is undefined; the machine holds the line independently of the UI.
      expect(ctx().axisRanges['top:L']?.scaleType).toBeUndefined();
    });

    it('refuses log beside a bound locked BELOW zero, on the same rule the panel greys', () => {
      // The guard used to test `=== 0` here and in `logAllowed`, so a
      // hand-locked negative floor slipped through both (PR #173 review, LOW).
      const { actor, ctx } = start();
      actor.send({ type: 'axis.setLocks', axisId: 'top:L', lockMin: -5, unit: '%' });
      actor.send({ type: 'axis.setFormat', axisId: 'top:L', scaleType: 'log', unit: '%' });
      expect(ctx().axisRanges['top:L']?.scaleType).toBeUndefined();
    });

    it('refuses a precision that is not one of the offered 0–4', () => {
      // `NaN` used to pass the clamp untouched and reach
      // `Intl.NumberFormat({ maximumFractionDigits: NaN })`, which throws.
      const { actor, ctx } = start();
      for (const precision of [Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
        actor.send({
          type: 'axis.setFormat',
          axisId: 'top:L',
          precision,
          scaleType: 'linear',
          unit: '%',
        });
        expect(ctx().axisRanges['top:L']?.precision).toBeUndefined();
      }
    });

    it('clamps an out-of-range integer precision into 0–4 rather than dropping it', () => {
      const { actor, ctx } = start();
      actor.send({
        type: 'axis.setFormat',
        axisId: 'top:L',
        precision: 9,
        scaleType: 'linear',
        unit: '%',
      });
      expect(ctx().axisRanges['top:L']?.precision).toBe(4);
      actor.send({
        type: 'axis.setFormat',
        axisId: 'top:L',
        precision: -2,
        scaleType: 'linear',
        unit: '%',
      });
      expect(ctx().axisRanges['top:L']?.precision).toBe(0);
    });
  });
});

/**
 * "Pair all visible" — the bar's one batch action. It raises N `series.addPair`
 * events rather than reimplementing the seating, so what is worth pinning here
 * is the SELECTION (which configs it decides are comparable) and the fact that
 * the batch is safe to press twice.
 */
describe('series.compareAll ("Pair all visible")', () => {
  const all = (ctx: () => { rows: RowState[] }) => ctx().rows.flatMap((r) => r.configs);

  it('pairs every visible plain metric with its own compare twin, in its own row', () => {
    const { actor, ctx } = start([
      { id: 'top', height: 0, configs: [cfg('iv21'), cfg('iv63')] },
      {
        id: 'bottom',
        height: 150,
        configs: [cfg('price', { unit: '$', axis: 'R', source: 'price', column: 'close' })],
      },
    ]);
    actor.send({ type: 'series.compareAll' });

    // Three metrics in, three PAIRS out — six legs, and no spread anywhere: the
    // action joins nothing, it only sets each metric beside its comparison.
    const members = all(ctx).filter((c) => c.group);
    expect(members.map((m) => m.column).sort()).toEqual([
      'close',
      'cmp_close',
      'cmp_iv21',
      'cmp_iv63',
      'iv21',
      'iv63',
    ]);
    expect(all(ctx).some((c) => c.derive && isPairOp(c.derive.op))).toBe(false);
    // One group per metric — never one group of six.
    expect(new Set(members.map((m) => m.group!.id)).size).toBe(3);
    // Each pair stays on the row its metric already sat on (`rowId` is passed),
    // so pairing everything never reshuffles the stack.
    expect(ctx().rows[0]!.configs.filter((c) => c.group)).toHaveLength(4);
    expect(ctx().rows[1]!.configs.filter((c) => c.group)).toHaveLength(2);
  });

  it('skips the three kinds it cannot pair, and mints nothing for them', () => {
    const { actor, ctx } = start([
      {
        id: 'top',
        height: 0,
        configs: [
          cfg('iv21'), // eligible
          cfg('iv42', { visible: false }), // hidden — "all VISIBLE"
          cfg('cmp_iv63'), // already reads the comparison
        ],
      },
      { id: 'bottom', height: 150, configs: [] },
    ]);
    actor.send({ type: 'series.compareAll' });

    expect(
      all(ctx)
        .filter((c) => c.group)
        .map((c) => c.column)
        .sort(),
    ).toEqual(['cmp_iv21', 'iv21']);
    // The skipped two are untouched, and neither grew a twin — a cmp_cmp_ column
    // is the failure this guard exists to prevent.
    expect(all(ctx).find((c) => c.column === 'iv42')!.group).toBeUndefined();
    expect(all(ctx).find((c) => c.column === 'cmp_iv63')!.group).toBeUndefined();
    expect(all(ctx).some((c) => c.column === 'cmp_iv42')).toBe(false);
    expect(all(ctx).some((c) => c.column === 'cmp_cmp_iv63')).toBe(false);
  });

  it('is idempotent — every metric is a LEG afterwards, so a second press is a no-op', () => {
    const { actor, ctx } = start();
    actor.send({ type: 'series.compareAll' });
    const after = all(ctx)
      .map((c) => c.column)
      .sort();
    expect(after).toEqual(['close', 'cmp_close', 'cmp_iv21', 'iv21']);

    actor.send({ type: 'series.compareAll' });
    // `comparableMetric` rejects a config that already carries a group, which is
    // what makes the button safe to lean on rather than a doubling machine.
    expect(
      all(ctx)
        .map((c) => c.column)
        .sort(),
    ).toEqual(after);
  });
});

/**
 * Pond's rule, shipped with the catalog's `unit` field: only an `'inherit'` op
 * may draw on its source's axis. These pin the consequence, because it is
 * invisible in a unit test and glaring on a render — an RSI that shares the vol
 * axis stretches it from ~20 to 100 and flattens every series under it.
 */
describe("a study's axis follows its UNIT, not its source", () => {
  it("keeps an inherit-unit study on its source's axis, in its source's unit", () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const sma = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.derive?.op === 'sma')!;
    const source = find(ctx, 'iv21');
    // An SMA of a vol IS a vol — same scale, same unit, no unlink.
    expect(sma.axisGroup).toBeUndefined();
    expect(sma.axis).toBe(source.axis);
    expect(sma.unit).toBe(source.unit);
    expect(configAxisId('top', sma)).toBe(configAxisId('top', source));
  });

  it('UNLINKS a study that reads in its own units, and takes its own unit', () => {
    const { actor, ctx, idOf } = start();
    // `rsi` is `unit: 'percent'` in the catalog — bounded 0..100, which is five
    // times a vol reading. It must not land on the vol axis.
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'rsi', period: 20 });
    const rsi = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.derive?.op === 'rsi')!;
    const source = find(ctx, 'iv21');
    expect(rsi.axisGroup).toBe(rsi.id); // its own scale, keyed by its own identity
    expect(configAxisId('top', rsi)).not.toBe(configAxisId('top', source));
    // …and it stays in the same ROW: own scale, not own pane (TDL-OSCROW).
    expect(ctx().rows[0]!.configs.some((c) => c.id === rsi.id)).toBe(true);
  });

  it("unlinks a DELTA study too, though it formats in its source's unit", () => {
    const { actor, ctx, idOf } = start();
    // `rollingStdev` is `unit: 'delta'`: a σ of a vol reads in vol units, so it
    // FORMATS like one — but its magnitude is nothing like the level, so it
    // still needs its own scale. The two questions are separate and this is the
    // case that proves it.
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'rollingStdev', period: 20 });
    const sd = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.derive?.op === 'rollingStdev')!;
    expect(sd.axisGroup).toBe(sd.id);
    expect(sd.unit).toBe(find(ctx, 'iv21').unit); // formats as a vol
  });
});

describe('a multi-output study cannot be a study target', () => {
  it('refuses a study OF a MACD — its column names none of its own columns', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('close'), op: 'macd', period: 20 });
    const macd = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.derive?.op === 'macd')!;
    expect(macd.style).toBe('lines');

    // The spec would be well-formed and `deriveId` would name it happily — the
    // failure is that the fold produces nothing, so without this guard the
    // panel gains a config that computes silence. Found on a running render.
    const before = ctx().rows.flatMap((r) => r.configs).length;
    actor.send({ type: 'series.addStudy', targetId: macd.id, op: 'sma', period: 20 });
    expect(ctx().rows.flatMap((r) => r.configs)).toHaveLength(before);
  });

  it('refuses a multi-output study as a pair LEG', () => {
    // Same prefix problem as a study target: the spread would read a column
    // that does not exist. `+Compare` was offered on a MACD and meant nothing.
    const { actor, ctx, idOf, leg } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('close'), op: 'macd', period: 20 });
    const macd = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.derive?.op === 'macd')!;
    const before = ctx().rows.flatMap((r) => r.configs).length;
    actor.send({
      type: 'series.addPair',
      a: { metricId: macd.id },
      b: { metricId: leg('iv21') },
      op: 'ratio',
    });
    expect(ctx().rows.flatMap((r) => r.configs)).toHaveLength(before);
  });

  it('"Pair all visible" SKIPS a multi-output study rather than raising a refused add', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('close'), op: 'macd', period: 20 });
    actor.send({ type: 'series.compareAll' });
    const macd = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.derive?.op === 'macd')!;
    // Not a leg, and no `cmp_` twin was minted for it…
    expect(macd.group).toBeUndefined();
    expect(
      ctx()
        .rows.flatMap((r) => r.configs)
        .some((c) => c.column.includes('cmp_') && c.derive?.op === 'macd'),
    ).toBe(false);
    // …while the ordinary metrics around it did pair.
    expect(
      ctx()
        .rows.flatMap((r) => r.configs)
        .filter((c) => c.group).length,
    ).toBeGreaterThan(0);
  });

  it('still allows a study of a BAND-shaped study, which reads one column', () => {
    // A band is multi-output too, but `opIsMulti` excludes it — `bandColumns`
    // resolves its three columns and the fold has a centre line to read.
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const sma = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.derive?.op === 'sma')!;
    const before = ctx().rows.flatMap((r) => r.configs).length;
    actor.send({ type: 'series.addStudy', targetId: sma.id, op: 'ema', period: 10 });
    expect(ctx().rows.flatMap((r) => r.configs).length).toBe(before + 1);
  });
});

describe('hiding a metric hides what is built on it', () => {
  it('cascades the eye to its studies, and to studies of those studies', () => {
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const sma = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.derive?.op === 'sma')!;
    actor.send({ type: 'series.addStudy', targetId: sma.id, op: 'ema', period: 10 });
    const at = (col: string) =>
      ctx()
        .rows.flatMap((r) => r.configs)
        .find((c) => c.column === col)!;
    const smaCol = sma.column;
    const emaCol = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.derive?.op === 'ema')!.column;

    actor.send({ type: 'series.toggleVisible', id: idOf('iv21') });
    // A `Price · SMA` left drawing over a hidden Price read as the eye not
    // working. The whole pipeline follows, transitively.
    expect(at('iv21').visible).toBe(false);
    expect(at(smaCol).visible).toBe(false);
    expect(at(emaCol).visible).toBe(false);
  });

  it('lets a study be clicked back on UNDER a hidden metric', () => {
    // The point of writing the studies' `visible` rather than gating on the
    // parent: the parent's state is a default, not a veto (Peter, 2026-09-12).
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const smaId = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.derive?.op === 'sma')!.id;

    actor.send({ type: 'series.toggleVisible', id: idOf('iv21') });
    actor.send({ type: 'series.toggleVisible', id: smaId });
    const flat = () => ctx().rows.flatMap((r) => r.configs);
    expect(flat().find((c) => c.id === idOf('iv21'))!.visible).toBe(false); // still ghosted
    expect(flat().find((c) => c.id === smaId)!.visible).toBe(true); // …and drawing
  });

  it('clears a SELECTED or EXPANDED study when its parent is hidden (re-cut review, M1)', () => {
    // The pointers used to clear on `event.id` alone: hide the parent and its
    // study stayed selected + expanded with no chip to un-select it from.
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'sma', period: 20 });
    const smaId = ctx()
      .rows.flatMap((r) => r.configs)
      .find((c) => c.derive?.op === 'sma')!.id;
    actor.send({ type: 'select', id: smaId });
    actor.send({ type: 'expand', id: smaId });
    expect(ctx().selected).toBe(smaId);
    expect(ctx().expanded).toBe(smaId);

    actor.send({ type: 'series.toggleVisible', id: idOf('iv21') });
    expect(ctx().selected).toBeNull();
    expect(ctx().expanded).toBeNull();

    // Showing the parent again never clears — and never re-selects.
    actor.send({ type: 'select', id: smaId });
    actor.send({ type: 'series.toggleVisible', id: idOf('iv21') });
    expect(ctx().selected).toBe(smaId);
  });

  it('leaves a derived CATALOG metric alone — it is not built on the metric', () => {
    // The realized-vol line reads `ccVar` and is added independently; dragging
    // it along was already the wrong call for a move, and it is wrong here too.
    const { actor, ctx, idOf } = start();
    actor.send({ type: 'series.add', catalogId: RV });
    actor.send({ type: 'series.toggleVisible', id: idOf('iv21') });
    expect(
      ctx()
        .rows.flatMap((r) => r.configs)
        .find((c) => c.column === RV)!.visible,
    ).toBe(true);
  });

  it("a LEG's eye still leaves its partner alone", () => {
    // The one place the cascade must NOT follow: legs are peers, and the pair's
    // own eye is the control that hides both. Sharing the travel set here made
    // one leg's eye hide the other.
    const { actor, ctx, leg } = start();
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv42') },
      op: 'none',
    });
    const members = ctx()
      .rows.flatMap((r) => r.configs)
      .filter((c) => c.group);
    const b = members.find((m) => m.group!.side === 'B')!;
    actor.send({ type: 'series.toggleVisible', id: b.id });
    const after = ctx()
      .rows.flatMap((r) => r.configs)
      .filter((c) => c.group);
    expect(after.find((m) => m.group!.side === 'B')!.visible).toBe(false);
    expect(after.find((m) => m.group!.side === 'A')!.visible).toBe(true);
  });
});

describe('a study needing bar columns is refused on a source without them (re-cut review, M2)', () => {
  it('refuses `atr` on the vol series, and accepts it on price', () => {
    // The menu already hid such ops; the picker stays open across picks and a
    // preset can replay an add, so the GUARD is where the refusal must live —
    // else the config seats, the fold skips it, and it computes silence.
    const { actor, cols, idOf } = start();
    const before = cols();
    actor.send({ type: 'series.addStudy', targetId: idOf('iv21'), op: 'atr', period: 14 });
    expect(cols()).toEqual(before);
    expect(studyOfferable('vol', 'atr')).toBe(false);
    expect(studyOfferable('price', 'atr')).toBe(true);
    actor.send({ type: 'series.addStudy', targetId: idOf('close'), op: 'atr', period: 14 });
    expect(cols().length).toBe(before.length + 1);
  });
});

describe("the palette is the host's (TerminalInput.palette)", () => {
  it('hands a second copy of a metric the first key its row is not using', () => {
    // The fixture's iv21 is 'blue'; the host's palette does not contain blue, so
    // the first FREE key is the palette's first — the copy never shares an ink.
    const { actor, ctx } = start(initialRows(), ['red', 'green']);
    actor.send({ type: 'series.add', catalogId: 'iv21' });
    const vol = ctx().rows[0]!.configs;
    expect(vol.map((c) => c.color).sort()).toEqual(['blue', 'red']);
  });

  it("with no palette, a SPLIT pair's legs keep the pair's colour on the split path too", () => {
    // The same default on the other path that hands out colours: splitting a
    // joined pair into a leg group. With nothing to draw from, leg B keeps the
    // pair's ink rather than a colour the machine invented.
    const { actor, ctx, leg } = start(initialRows(), []);
    actor.send({
      type: 'series.addPair',
      a: { metricId: leg('iv63') },
      b: { metricId: leg('iv42') },
      op: 'none',
    });
    const members = ctx()
      .rows.flatMap((r) => r.configs)
      .filter((c) => c.group);
    expect(members).toHaveLength(2);
    expect(new Set(members.map((m) => m.color)).size).toBe(1);
  });

  it("with no palette, a copy keeps the original's colour rather than inventing one", () => {
    // The documented default: a host that supplies no palette gets no colour the
    // machine made up — the chart draws exactly what it was given.
    const { actor, ctx } = start(initialRows(), []);
    actor.send({ type: 'series.add', catalogId: 'iv21' });
    const vol = ctx().rows[0]!.configs;
    expect(vol).toHaveLength(2);
    expect(vol.map((c) => c.color)).toEqual(['blue', 'blue']);
  });
});
