import { assign, enqueueActions, setup } from 'xstate';
import {
  COMPARE_PREFIX,
  hasPairOp,
  usesCompare,
  deriveId,
  opParams,
  opInputs,
  opNeedsColumns,
  opIsBand,
  opIsMulti,
  TARGET_ROLES,
  opSharesSourceAxis,
  studyTag,
  inputNames,
  isPairOp,
  isValidSpec,
  partStudyLabel,
  readPairParts,
  specUnit,
  substituteInput,
  type DeriveInput,
  type DeriveOp,
  type DeriveSpec,
  type PairOp,
  type PairPart,
} from '@tidal-ts/core';

/**
 * The bar columns each data SOURCE carries — the one fact that decides whether a
 * multi-column study is offerable on a series. Only the price series has bars;
 * 54 of the adopted studies read high/low/close/volume, and on a vol series
 * those columns name nothing. Held here, in the config-only machine, because
 * it is a fact about the vocabulary (what a source key means), not about data —
 * and because the menu AND the guard must agree, so there is exactly one copy.
 */
export const SOURCE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  price: ['open', 'high', 'low', 'close', 'volume'],
};

/** Whether `op` can run on `source` — every bar column it needs is carried.
 *  The menu filters on it; `canAddStudy` refuses on it. */
export function studyOfferable(source: string | undefined, op: DeriveOp): boolean {
  const have = new Set(SOURCE_COLUMNS[source ?? ''] ?? []);
  return opNeedsColumns(op).every((c) => have.has(c));
}

/** Whether toggling `toggledId`'s eye is about to HIDE the series `pointer`
 *  names — itself, or a study the cascade carries. Showing never clears. */
function hidesPointer(
  context: TerminalContext,
  toggledId: string,
  pointer: string | null,
): boolean {
  if (pointer === null) return false;
  const target = flatConfigs(context.rows).find((c) => c.id === toggledId);
  if (!target?.visible) return false; // hidden → about to show
  const row = context.rows.find((r) => r.configs.some((c) => c.id === toggledId));
  const cascade = row
    ? studiesOn(row.configs, toggledId, isCatalogColumn(context))
    : new Set<string>([toggledId]);
  return cascade.has(pointer);
}
import { axisRangeIsEmpty, logAllowed, type PairLensOp, type SeriesGroup } from '@tidal-ts/chart';
import {
  configAxisId,
  seriesAxisId,
  sharedAxisId,
  type AxisRange,
  type SeriesAxis,
  type SeriesConfig,
} from '@tidal-ts/chart';
import { axisForAdd, canAddUnit, type AxisMember } from './axisPolicy.js';

/**
 * The terminal machine (XState migration, slice 2 — see Tidal's state-architecture note).
 * The **headless product**: it owns the control-panel *configuration* — rows of
 * series, the current selection, the controls-popover flag, and the preset slots
 * — and **never touches data**. Its event union is the host-control API; its
 * snapshot (via the module's selector hooks) is the read API. This is the
 * extraction candidate, so it imports only `@tidal-ts/chart` types + its own
 * `axisPolicy` — never the socket / auth / data layers, never app config
 * directly (the series catalog arrives as `input`).
 *
 * Born **row-general** (Wave A of the indicator design, folded in here): the
 * two fixed panels become `rows: RowState[]`, seeded with today's two. A config
 * names its data `source` by key; rows are viewports. Data-filtering (dropping a
 * series the current feed lacks) stays render-side — the machine holds every
 * configured series regardless of what data is loaded.
 */

/** A viewport row: its committed height + the series configured in it. */
export interface RowState {
  id: string;
  /** Committed px height (updated on splitter drag-end); 0 ⇒ take the remainder. */
  height: number;
  configs: SeriesConfig[];
}

/** A saved control preset — the rows only (never the ticker/range, which live in
 *  the host). Migrated from the old `{ volCfg, priceCfg }` shape by the storage
 *  adapter. */
export interface TerminalPreset {
  rows: RowState[];
}

/** The minimal catalog-entry shape the machine needs (host-supplied as `input`;
 *  `seriesCatalog`'s entries satisfy it structurally). Keeps the module free of
 *  an app-config import for extraction. */
export interface MetricEntry {
  id: string;
  label: string;
  color: string;
  unit: string;
  /** Data-source key a config from this entry reads (`'vol'` / `'price'` today). */
  source: string;
  style: SeriesConfig['style'];
  axis: SeriesAxis;
  column?: string;
  /** Tenor-bearing metric metadata (the ATM vols): family name + tenor, carried
   *  onto the config so the controls read it as name + params. */
  family?: string;
  tenor?: number;
  /** Which censor variant this column is, for metrics that take that parameter —
   *  carried onto the config so the controls can show and edit it. */
  censor?: string;
  /** A **derived** metric (e.g. the realized-vol line): its column is induced from
   *  this spec by `applyDerived`, not read from the feed. Absent ⇒ raw. */
  derive?: DeriveSpec;
}

/** Injectable persistence for the preset slots (default: the app's localStorage
 *  keys). A host brings its own storage, or none. */
export interface PresetStorage {
  loadPresets(): (TerminalPreset | null)[];
  savePresets(presets: (TerminalPreset | null)[]): void;
  /** The persisted active-slot pointer — only used to seed `initialRows`. */
  loadActive(): number | null;
  saveActive(index: number | null): void;
}

export const PRESET_SLOTS = 5;

/** Max viewport rows (the control-panel spec: 1–3, capped at 3 for now). */
export const MAX_ROWS = 3;

/** Committed height (px) a freshly added row gets — a **fixed** strip, not a flex
 *  remainder row (`height: 0`). Exactly one remainder row is kept (the seed's
 *  top/vol panel, which absorbs slack); a second would make dragging any seam
 *  redistribute space to the far panel too, not just its two neighbours. */
const NEW_ROW_HEIGHT = 150;

/**
 * Guarantee EXACTLY-ONE remainder row (`height: 0`) — the row that absorbs slack.
 *
 * The layout has always assumed one; nothing enforced it. `removeRow` could drop
 * the only remainder row, and `addRow` always adds a FIXED row, so
 * remove-the-top-row-then-add-a-row left a stack with none. The renderer's
 * resolver silently promotes the LAST row in that case, while the splitter reads
 * `height === 0` to decide which side of a seam is elastic — so the two
 * disagreed about which row was flexible, and a drag budgeted against a row the
 * resolver was ignoring. Symptom: the seam refused to travel more than
 * `NEW_ROW_HEIGHT − MIN_FIXED` (60px) before it stopped moving.
 *
 * The FIRST row is promoted, matching the seed (the vol panel absorbs slack) and
 * keeping "the big chart is on top" true after any sequence of adds and removes.
 * Applied wherever the row LIST changes shape — add, remove, and preset apply,
 * since a preset saved before this existed can carry a stack with no remainder.
 */
function withRemainder(rows: readonly RowState[]): RowState[] {
  if (rows.length === 0 || rows.some((r) => r.height === 0)) return rows as RowState[];
  return rows.map((r, i) => (i === 0 ? { ...r, height: 0 } : r));
}

/**
 * Config identity. A seated config's `id` is minted here and never derived from
 * what it computes: `s-3` keys selection, expansion, the chart theme, axis
 * membership and the user's overrides, and it survives every edit to the
 * config's spec. What the config *computes* lives in `column`
 * (`deriveId(derive)`), which is recomputed on each edit.
 *
 * The prefix is deliberately un-column-like. Nothing may parse an id, and an id
 * used as a column name resolves to nothing — loudly — rather than reading some
 * other series' data (see {@link SeriesConfig}).
 */
const CONFIG_ID_PREFIX = 's-';
export const mintId = (seq: number): string => `${CONFIG_ID_PREFIX}${seq}`;

/** Generated ROW ids share the same monotonic-counter rule (`row-2`). */
const ROW_ID_PREFIX = 'row-';
const mintRowId = (seq: number): string => `${ROW_ID_PREFIX}${seq}`;

/**
 * One past the highest `<prefix><n>` id in `ids` — where a monotonic counter has
 * to restart so it can't re-issue an id that arrived **pre-minted**: a persisted
 * preset was minted in an earlier session and can carry ids well above a fresh
 * actor's counter.
 *
 * Strict digits, capped: `Number('')` is 0 and `Number('1e21')` is enormous, and
 * neither is an id we minted — accepting them would move the counter on
 * something arbitrary, in the second case far enough that `mintId` starts
 * returning the same string every time.
 */
function seqAfter(ids: Iterable<string>, prefix: string): number {
  const re = new RegExp(`^${prefix}(\\d{1,9})$`);
  let max = -1;
  for (const id of ids) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

const configIds = (rows: readonly RowState[]): string[] => flatConfigs(rows).map((c) => c.id);
const cfgSeqAfter = (rows: readonly RowState[]): number =>
  seqAfter(configIds(rows), CONFIG_ID_PREFIX);
const rowSeqAfter = (rows: readonly RowState[]): number =>
  seqAfter(
    rows.map((r) => r.id),
    ROW_ID_PREFIX,
  );

interface TerminalContext {
  /** The host's colour keys for new series, in hand-out order. */
  palette: readonly string[];
  rows: RowState[];
  /** Per-axis range state, keyed by axis id (`configAxisId` — `rowId:side` for a
   *  shared axis, `rowId:side:configId` for an unlinked series' own axis). No
   *  entry ⇒ an untouched auto axis; `mode:'auto'` WITH values is the preserved
   *  manual memory. Entries are never pruned (a stale id simply never renders,
   *  and an unlink/re-add that resurrects the id gets its manual range back) —
   *  except on `preset.select`, which resets the lot: an applied preset must
   *  restore a known look, and a leftover manual range under different rows
   *  reads as a broken chart with no visible cause. */
  axisRanges: Record<string, AxisRange>;
  /** Monotonic counter for generated row ids — never reset on remove, so an
   *  `add → remove → add` sequence can't reuse an id (`row-2` twice). */
  rowSeq: number;
  /** Monotonic counter for minted CONFIG ids (see {@link mintId}). Same rule as
   *  `rowSeq`, plus one more: applying a preset re-seeds it above the ids that
   *  preset restored. */
  cfgSeq: number;
  /** The **app** selection — the series emphasised on the chart from a legend
   *  click. Persists under a control-panel expansion + closing the panel. */
  selected: string | null;
  /** The **control-panel** expansion — the row whose controls are open. While set
   *  it overrides `selected` for chart emphasis (but doesn't replace it); cleared
   *  on collapse or closing the panel, so emphasis falls back to `selected`. */
  expanded: string | null;
  controlsOpen: boolean;
  presets: (TerminalPreset | null)[];
  catalog: readonly MetricEntry[];
  storage: PresetStorage;
}

/** Public command surface — the host-control API + the reference SeriesControls'
 *  event union (the pre-paid bus contract). */
export type TerminalEvent =
  | { type: 'series.add'; catalogId: string; rowId?: string }
  | { type: 'series.addStudy'; targetId: string; op: DeriveOp; period: number }
  /** Add an A-vs-B spread. `rowId` names the row to seat it on — the per-row
   *  `+Pair` affordance, and an EXPLICIT choice, so it wins over the default
   *  (in front of leg A, which is only a guess about where you want it). */
  | { type: 'series.addPair'; a: PairLegInput; b: PairLegInput; op: PairLensOp; rowId?: string }
  /** Pair EVERY visible plain metric against the comparison symbol, in one
   *  gesture — the bar's bulk compare. Deliberately an ACTION and not a mode:
   *  it writes ordinary pairs and then has nothing left to remember, so there is
   *  no state to flip back and no ownership to track (Peter, 2026-08-25). */
  | { type: 'series.compareAll' }
  /** Retune ONE declared param of a study. `name` because a study is tuned by
   *  whatever its op declares — a band carries `period` AND `stdDev` — so the
   *  event names the knob rather than assuming there is only one. */
  | { type: 'series.setStudyParam'; id: string; name: string; value: number }
  /** Draw-order (z) within the series' own row. The row's config list is
   *  **front→back** — index 0 paints on top (the render reverses for
   *  `<Layers>`), so `up` moves toward the front. */
  | { type: 'series.order'; id: string; to: 'front' | 'up' | 'down' | 'back' }
  /** Reposition a series **to a target index** in its row (the drag gesture). */
  | { type: 'series.reindex'; id: string; index: number }
  /** Move a series to another row (keeping its relative front position). */
  | { type: 'series.moveToRow'; id: string; rowId: string }
  | { type: 'series.remove'; id: string }
  /** Patch a series' INK (colour, style, width, window, visibility …). The
   *  arrangement fields are excluded by type: `axis`/`axisGroup` name the axis a
   *  series sits on, whose ids key `axisRanges`, so they move only through
   *  `axis.swapSide` / `axis.toggleLink`, which keep the pins coherent. */
  | { type: 'series.patch'; id: string; patch: Partial<Omit<SeriesConfig, 'axis' | 'axisGroup'>> }
  | { type: 'series.toggleVisible'; id: string }
  /** The PAIR's own eye — hides both legs at once. Each leg keeps its own
   *  `visible`, so unhiding the pair restores what each leg was rather than
   *  switching everything on (Peter, 2026-08-18). */
  | { type: 'group.toggleVisible'; groupId: string }
  /** Remove a whole pair — both legs and anything layered on them. */
  | { type: 'group.remove'; groupId: string }
  | { type: 'select'; id: string | null }
  | { type: 'expand'; id: string | null }
  | { type: 'controls.open' }
  | { type: 'controls.close' }
  | { type: 'preset.select'; slot: number }
  | { type: 'preset.save'; slot: number }
  | { type: 'layout.setRowHeights'; heights: Record<string, number> }
  | { type: 'row.add' }
  | { type: 'row.remove'; id: string }
  /** Toggle a series' axis membership (the panel's chain icon): unlink to its
   *  own axis, or re-link into its side's shared axis (unit-gated). See
   *  {@link linkToggleAllowed} for the exact semantics, merge rule included. */
  | { type: 'axis.toggleLink'; id: string }
  /** Pin an axis to `[min, max]` (implies MANUAL). The host seeds the values —
   *  from the preserved memory when it exists, else the current auto fit —
   *  and names the `unit` the axis reads in, so the pin suspends if the axis
   *  is later re-bound to a different unit (see `AxisRange.unit`). */
  | { type: 'axis.setRange'; axisId: string; min: number; max: number; unit: string }
  /** Back to AUTO, keeping the manual values as memory (the preserved triple). */
  | { type: 'axis.setAuto'; axisId: string }
  /** REPLACE this axis's hard bound locks. Both fields are the new truth, so an
   *  omitted one CLEARS that lock — which is what lets the derived bar default
   *  (`barZeroLock`) be re-seeded wholesale when an axis's membership changes.
   *  `unit` stamps a freshly created entry, exactly as `axis.setRange` does. */
  | { type: 'axis.setLocks'; axisId: string; lockMin?: number; lockMax?: number; unit: string }
  /** The AUTO-mode options: what the fit is taken over, and whether it is
   *  mirrored about zero. Both are sent every time (the panel knows the current
   *  pair), so there is no clearing ambiguity. */
  | {
      type: 'axis.setAutoOpts';
      axisId: string;
      autoBasis: 'metric' | 'viewport';
      centerZero: boolean;
      unit: string;
    }
  /** The axis's FORMAT and SCALE. Both sent every time, as for setAutoOpts.
   *  `scaleType: 'log'` is refused while a bound is locked at 0 — the guard is
   *  `logAllowed`, and the panel disables the choice rather than relying on it. */
  | {
      type: 'axis.setFormat';
      axisId: string;
      precision?: number;
      scaleType: 'linear' | 'log';
      unit: string;
    }
  /** Move a whole AXIS to the other side of its row (the panel's ⇄): every
   *  member travels together, so the axis keeps its identity as a scale and
   *  only its gutter moves. `memberId` names any member — the axis is "the
   *  one that config sits on" (own axis, or the side's shared axis). */
  | { type: 'axis.swapSide'; memberId: string }
  /** Move one member onto another axis on its side — the panel's DRAG.
   *  `axisGroup` names the destination: a group key, or undefined for the
   *  side's shared axis (which is the same thing the chain does). */
  | { type: 'axis.moveTo'; id: string; axisGroup?: string };

export interface TerminalInput {
  initialRows: RowState[];
  catalog: readonly MetricEntry[];
  storage: PresetStorage;
  /** The colour keys the host hands a new series, in order — see
   *  `TerminalProviderProps.palette`. Default: none (a leg keeps its pair's). */
  palette?: readonly string[];
}

// --- pure helpers (shared with selectors; exported for tests) ----------------

const flatConfigs = (rows: readonly RowState[]): SeriesConfig[] => rows.flatMap((r) => r.configs);

/** `rootId` plus every **study** that (transitively) derives from it — so removing
 *  a series cascades to its dependent studies. Only follows STUDY sources: a
 *  study's output column is folded per-config and vanishes when the study is
 *  removed (its dependents would strand invisible + unremovable), whereas a raw
 *  data column persists, so a study of a raw column keeps resolving after that
 *  raw series is removed. */
function derivedClosure(configs: readonly SeriesConfig[], rootId: string): Set<string> {
  const doomed = new Set([rootId]);
  // Edges resolve by COLUMN (what a spec input names); the set itself holds
  // IDS, because that is what callers filter configs and re-point pointers by.
  const byColumn = new Map(configs.map((c) => [c.column, c]));
  for (let grew = true; grew;) {
    grew = false;
    for (const c of configs) {
      if (doomed.has(c.id) || !c.derive) continue;
      // EVERY input is an edge — a pair's B leg is as load-bearing as its A leg
      // (PR #128 review, HIGH). An input names a raw feed column or a nested
      // spec, and either way the config that produces it carries that name as
      // its `column`.
      const srcs = inputNames(c.derive).map((n) => byColumn.get(n));
      if (srcs.some((src) => src?.derive && doomed.has(src.id))) {
        doomed.add(c.id); // derives from a doomed study ⇒ its source column will vanish
        grew = true;
      }
    }
  }
  return doomed;
}

/**
 * `rootId` plus the **studies layered on it** within this row — the travel set for
 * a cross-row move. `addStudy` co-locates a study with its target, so moving the
 * target takes its studies along rather than leaving `Price · SMA(20)` behind.
 *
 * Only **studies** travel, never a derived **catalog** metric (`isCatalogId`): a
 * study exists solely as a layer on the series it was added to, whereas the
 * realized-vol line is added independently and merely happens to read `ccVar`'s
 * column — dragging it along when the user moved ccVar was a surprise, and since
 * their units differ it could demand two axes the target row didn't have (PR #119
 * review). Every study inherits its target's unit, so a travel set is single-unit
 * by construction.
 *
 * Distinct from {@link derivedClosure} (removal), which follows only study→study
 * edges because a raw data column outlives the config that displayed it.
 */
/**
 * `rootId` plus the **studies built on it** — the set an eye cascades over.
 *
 * Deliberately NOT {@link layeredOn}, which is the travel set and also carries a
 * leg's GROUP SIBLINGS, because a pair must move whole. Visibility is the one
 * case where that rule inverts: a pair's own eye hides both legs
 * (`group.toggleVisible`), but a LEG's eye must leave its partner alone — each
 * leg keeps its own state, which is the point of the pair eye being a separate
 * control. Sharing `layeredOn` here made one leg's eye hide the other.
 *
 * A study is subordinate to what it is built on; a leg is a peer of its partner.
 * Same graph, opposite rule, so they get their own walks.
 */
/** Whether a study already has a study built on it — the no-branching test.
 *  Edges resolve by COLUMN, which is what a spec input names. */
function hasStudyChild(configs: readonly SeriesConfig[], target: SeriesConfig): boolean {
  return configs.some(
    (c) => c.id !== target.id && c.derive && inputNames(c.derive).includes(target.column),
  );
}

function studiesOn(
  configs: readonly SeriesConfig[],
  rootId: string,
  isCatalogColumn: (column: string) => boolean,
): Set<string> {
  const set = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of configs) {
      if (set.has(c.id) || !c.derive || isCatalogColumn(c.column)) continue;
      if (configs.some((p) => set.has(p.id) && inputNames(c.derive!).includes(p.column))) {
        set.add(c.id);
        grew = true;
      }
    }
  }
  return set;
}

function layeredOn(
  configs: readonly SeriesConfig[],
  rootId: string,
  isCatalogColumn: (column: string) => boolean,
): Set<string> {
  const set = new Set([rootId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of configs) {
      if (set.has(c.id)) continue;
      // A LEG GROUP travels whole: the panel renders it per row, so a group
      // with a leg in each row would draw as two one-legged pairs that nothing
      // can re-join (PR #144 review, MEDIUM).
      const sibling =
        !!c.group && configs.some((p) => set.has(p.id) && p.group?.id === c.group!.id);
      if (sibling) {
        set.add(c.id);
        grew = true;
        continue;
      }
      if (!c.derive || isCatalogColumn(c.column)) continue;
      // A study names its sources by COLUMN — never by the id of the config
      // that happens to display them.
      if (configs.some((p) => set.has(p.id) && inputNames(c.derive!).includes(p.column))) {
        set.add(c.id);
        grew = true;
      }
    }
  }
  return set;
}

/**
 * Place a whole travelling set onto a target row's axes, or `null` if ANY of them
 * can't go. Members are folded **incrementally** — each mover is placed against
 * the target's configs *plus the movers already placed* — so a `%` study
 * following a `variance` source can't silently land on the same side as its
 * source and strand the row with two units on one axis (originally: both L/R
 * chips then read disabled and the row was unrecoverable through the UI —
 * PR #119 review; the chip is gone, but a mixed-unit shared axis is still a
 * state nothing should be able to create). All-or-nothing, so the guard and
 * the action can never disagree.
 */
function placeOnRow(
  target: readonly SeriesConfig[],
  movers: readonly SeriesConfig[],
): SeriesConfig[] | null {
  const seated: AxisMember[] = members(target);
  const placed: SeriesConfig[] = [];
  for (const c of movers) {
    // An UNLINKED mover brings its own axis: it keeps its side, binds no unit,
    // and can never fail to seat (the whole point of "arrives unlinked").
    if (c.axisGroup) {
      placed.push({ ...c });
      continue;
    }
    const axis = axisForAdd(seated, c.unit ?? '', c.axis);
    if (!axis) return null;
    seated.push({ unit: c.unit ?? '', axis });
    placed.push({ ...c, axis });
  }
  return placed;
}

/**
 * The row's configs as **blocks** — each root with the studies layered on it,
 * studies FIRST (a study paints over its source, and index 0 is the top).
 *
 * Draw order is a sequence of blocks, not of loose configs, because that is
 * what the control tree shows: a study is a child of the metric it derives
 * from, so moving the metric must carry its studies. Before this, ordering
 * stepped the flat list — and since a study sits directly in front of its
 * target, "move higher" on a metric that owned one swapped it with its own
 * hidden study: nothing moved on screen, and the study silently fell behind
 * its source on the canvas (PR #137 review, HIGH).
 *
 * A study whose target is elsewhere (another row, or removed) heads its own
 * block, so every config appears exactly once.
 */
export function rowBlocks(configs: readonly SeriesConfig[]): SeriesConfig[][] {
  const parentOf = new Map<string, string>();
  for (const c of configs) {
    // Only a tunable STUDY attaches to a parent; a derived catalog metric and a
    // pair stand alone (the same rule `layeredOn` travels by). Asked of the
    // registry — a period-shaped test was the same question only while every
    // tunable op had one param called `period` (PR #181 review, MEDIUM).
    if (!c.derive || opParams(c.derive.op).length === 0) continue;
    const names = inputNames(c.derive);
    const parent = configs.find((x) => x.id !== c.id && names.includes(x.column));
    if (parent) parentOf.set(c.id, parent.id);
  }
  // A block is keyed by the chain's ROOT, not the immediate parent: studies are
  // a PIPELINE (metric → first → second → …), so the whole chain travels as one
  // block. Keying on the parent put a 2-deep study in a block of its own,
  // appended last — so one "Move lower" on the metric sent the EMA from the
  // front of the row to the back, behind the SMA it derives from (PR #143
  // review, MEDIUM; the panel-side half of this was fixed in #137).
  const rootOf = (id: string): string => {
    const seen = new Set<string>([id]);
    let cur = id;
    for (;;) {
      const parent = parentOf.get(cur);
      // No parent, or a cycle from corrupt persisted state: stop where we are.
      if (parent == null || seen.has(parent)) return cur;
      seen.add(parent);
      cur = parent;
    }
  };
  // ONE pass in list order, so a block's members keep the positions they
  // already had — grouping must not silently reorder the row. (Placing roots
  // first and unshifting children onto them reverses a 2-deep chain.) A chain
  // whose root isn't in this row has no parent HERE, so it heads its own block
  // and is never dropped.
  const at = new Map<string, number>();
  const out: SeriesConfig[][] = [];
  for (const c of configs) {
    const root = rootOf(c.id);
    let bi = at.get(root);
    if (bi == null) {
      bi = out.length;
      at.set(root, bi);
      out.push([]);
    }
    out[bi]!.push(c);
  }
  return out;
}

/**
 * The END of `rootId`'s study chain — what `+ Study` extends.
 *
 * Studies are a pipeline the panel renders as a flat list, so adding one must
 * APPEND (read the current output) rather than branch off the root. The host
 * resolves the tail at PICK time rather than at open time: the study picker
 * stays open across picks, and a target captured when it opened is stale the
 * moment the first study lands — which silently built a branch the panel then
 * printed as a pipeline (PR #143 review, HIGH).
 *
 * Follows the same edge the panel groups by: a study's spec input names its
 * target's column. Returns `rootId` itself when nothing is layered on it.
 */
export function studyChainTail(configs: readonly SeriesConfig[], rootId: string): string {
  const seen = new Set<string>([rootId]);
  let cur = configs.find((c) => c.id === rootId);
  if (!cur) return rootId;
  for (;;) {
    const next = configs.find(
      (c) =>
        c.id !== cur!.id &&
        !seen.has(c.id) &&
        !!c.derive &&
        opParams(c.derive.op).length > 0 &&
        inputNames(c.derive).includes(cur!.column),
    );
    if (!next) return cur.id;
    seen.add(next.id);
    cur = next;
  }
}

/** Move `from` to `to` in a copy of `list` (a splice-move, not a swap — so the
 *  items in between shift by one, which is what a layers list does). */
function reindex<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, item!);
  return out;
}

/** The target index for an `order` step within a row of `n` items. Clamped, so
 *  an already-front item's `up` is a no-op rather than a wrap. */
function orderTarget(i: number, n: number, to: 'front' | 'up' | 'down' | 'back'): number {
  if (to === 'front') return 0;
  if (to === 'back') return n - 1;
  return to === 'up' ? Math.max(0, i - 1) : Math.min(n - 1, i + 1);
}

/** The row a config with `source` belongs to: the one already holding that
 *  source, else an **empty** row (a viewport with no series is a natural home —
 *  this is what returns a re-added vol series to the emptied vol row instead of
 *  dumping it in the price row), else the last row. Wave A keeps the two-row
 *  shape, so a vol metric lands in the vol row and a price metric in the price. */
function rowForSource(rows: readonly RowState[], source: string): RowState | undefined {
  return (
    rows.find((r) => r.configs.some((c) => c.source === source)) ??
    rows.find((r) => r.configs.length === 0) ??
    rows.at(-1)
  );
}

/** The data column a catalog entry reads. Unlike a seated config, a catalog
 *  entry IS its computation — so its id doubles as its column name when it
 *  doesn't name one (`iv21`), and a derived entry names its folded output. */
export const entryColumn = (e: Pick<MetricEntry, 'id' | 'column'>): string => e.column ?? e.id;

/** A config from a catalog entry — present + visible, on its preferred axis.
 *  `id` is the freshly minted identity; the catalog id survives as the
 *  `column`, which is what the entry actually contributed. */
function toConfig(e: MetricEntry, id: string, axis: SeriesAxis = e.axis): SeriesConfig {
  return {
    id,
    label: e.label,
    color: e.color,
    axis,
    style: e.style,
    visible: true,
    column: entryColumn(e),
    source: e.source,
    value: null,
    unit: e.unit,
    family: e.family,
    tenor: e.tenor,
    censor: e.censor,
    derive: e.derive,
  };
}

/** The spec a study of `target` at `(op, period)` induces — reads the target's
 *  DATA column, or **nests** the target's own spec when the target is derived
 *  (the engine reads a string input as a raw column, so composition nests;
 *  content-addressing makes the seated copy and the nested copy one node). */
const studySpec = (target: SeriesConfig, op: DeriveOp, period: number): DeriveSpec => {
  // Params come from the REGISTRY, not from a list here: an op is tuned by
  // exactly what it declares, so a two-param study (a band's `period` +
  // `stdDev`) is complete on arrival without this function knowing it exists.
  // `period` is the one the picker sends; every other param seeds from its
  // declared default and is tuned afterwards in the controls.
  //
  // Stamping a param onto an op that declares none mints a spec the registry
  // rejects, and the guard then refuses the add with no feedback (PR #137
  // review, MEDIUM) — which is why this is a filter over declared params and
  // not a spread of whatever the caller had.
  const declared = opParams(op);
  const params: Record<string, number> = {};
  for (const p of declared) params[p.name] = p.name === 'period' ? period : p.default;
  // Inputs are bound POSITIONALLY against the op's declared roles. The single
  // `column` role takes the target — which is what makes composition nest (an
  // SMA of an SMA embeds its parent's spec). Every other role names a bar
  // column and binds to its own declared default, because a multi-input study
  // is a study of a SERIES rather than of a column: an ATR reads high, low and
  // close directly, and its target only decides which row it lands in.
  //
  // A consequence worth knowing: two ATR(14)s added from different targets on
  // the same source resolve to the SAME spec, so the engine folds one column
  // and `deriveId` dedupes them. That is correct — ATR(14) of the bars is one
  // series — and it is why the picker has to refuse the op where its columns
  // are absent (`opNeedsColumns`) rather than let the fold skip it silently.
  const self = target.derive ?? target.column;
  const inputs = opInputs(op).map((r) =>
    // A target role takes the target; a bar role takes its own column. No
    // default and not a target role should be unreachable (a benchmark role is
    // refused at adoption), so fall back to the target rather than emit an
    // `undefined` input that throws inside `specId`.
    TARGET_ROLES.has(r.role) ? self : (r.default ?? self),
  );
  return {
    op,
    ...(declared.length > 0 ? { params } : {}),
    inputs: inputs.length > 0 ? inputs : [target.derive ?? target.column],
  };
};

/** A study `SeriesConfig` layered on a target — same source, and the same axis
 *  and unit WHEN the op reads in its source's units; its
 *  column is induced by `applyDerived` from the spec, so `column ===
 *  deriveId(spec)` while `id` is minted. It reads as **its source** (name + the
 *  source's params) with the op·period appended — e.g. `Price · SMA · 20`,
 *  `ATM Vol · 21D · SMA · 20` — so the lineage is legible. Warm default colour so
 *  it reads over its source; the user recolours. */
function studyConfig(target: SeriesConfig, op: DeriveOp, period: number, id: string): SeriesConfig {
  const derive = studySpec(target, op, period);
  // Only an `inherit` op may share its source's scale (pond's rule, shipped
  // with the catalog's `unit`). An RSI is bounded 0..100 and a vol reading is
  // ~20, so sharing stretches the axis five times and squashes the very series
  // the study was added to explain — which is exactly what it did on a running
  // render before this. A study that reads in its own units gets its own axis
  // group, keyed by its own id, and its own unit for the labels.
  const shares = opSharesSourceAxis(op);
  const own = specUnit(derive, (col) => (col === target.column ? (target.unit ?? '') : ''));
  return {
    id,
    ...(shares ? {} : { axisGroup: id }),
    label: `${target.label} · ${studyTag(derive)}`, // legend chip
    family: target.family ?? target.label, // main line = the source's name
    tenor: target.tenor, // carry the source's tenor into the params sub-line
    // A study is the same reading, smoothed — so it takes its metric's COLOUR
    // and is told apart by its STYLE (weight/dash from `settings.derived`).
    // A fixed amber made every study on the chart one colour, which said
    // nothing about which metric it belonged to (Peter, 2026-08-18).
    color: target.color,
    axis: target.axis,
    // A multi-output op can only draw as a multi-output style: its `column` is
    // a spec id naming SEVERAL columns, so every single-column style would read
    // nothing and draw an empty layer. A band is the Middle/Upper/Lower wash;
    // anything else is N lines off one spec, one per declared output.
    style: opIsBand(op) ? 'band' : opIsMulti(op) ? 'lines' : 'line',
    visible: true,
    source: target.source,
    column: deriveId(derive),
    value: null,
    unit: shares ? target.unit : own,
    derive,
  };
}

/** Legend label per pair op — the spread reads as its construction. */
const PAIR_LABEL: Record<PairOp, (a: string, b: string) => string> = {
  diff: (a, b) => `${a} \u2212 ${b}`,
  ratio: (a, b) => `${a} / ${b}`,
  logRatio: (a, b) => `log(${a} / ${b})`,
};

/** A pair leg, resolved: what the spec needs of it, however it was named. */
interface PairLeg {
  label: string;
  unit: string;
  column: string;
  source: string;
  /** The leg's own spec when it is derived — nested into the pair spec, so a
   *  spread of a study carries its leg's derivation with it. */
  spec?: DeriveSpec;
}

/**
 * The seated config a leg names — **the one lookup for "is this leg on the
 * chart"**, because the picker names a leg two different ways: a seated derived
 * series by its config id, and a raw metric by its CATALOG id (a raw leg needn't
 * be seated at all, so the catalog entry is what the menu lists).
 *
 * A catalog id therefore has to resolve to the seat when one exists. Before the
 * identity split that was automatic — a seated raw config's id WAS the catalog
 * id — and matching only on `c.id` afterwards silently stopped finding those
 * seats, which sent every raw-leg spread to `rowForSource`'s row instead of in
 * front of its leg A (PR #139 review, HIGH).
 */
function legSeat(context: TerminalContext, metricId: string): SeriesConfig | undefined {
  const all = flatConfigs(context.rows);
  const byId = all.find((c) => c.id === metricId);
  if (byId) return byId;
  const entry = context.catalog.find((e) => e.id === metricId);
  return entry ? all.find((c) => c.column === entryColumn(entry)) : undefined;
}

/**
 * Resolve a pair-leg id: a SEATED config first (so studies and spreads
 * compose, and so a seated metric contributes its own label + overrides), else
 * a CATALOG metric — a leg does not need to be on the chart, because every raw
 * catalog column is already carried by its source series (Peter's call,
 * 2026-08-16). An unseated DERIVED catalog metric is refused: its column exists
 * only once its spec is folded, and specs are config-borne.
 */
const resolveLeg = (context: TerminalContext, id: string): PairLeg | null => {
  const cfg = legSeat(context, id);
  if (cfg)
    return {
      label: cfg.label,
      unit: cfg.unit ?? '',
      column: cfg.column,
      source: cfg.source ?? '',
      spec: cfg.derive,
    };
  const entry = context.catalog.find((e) => e.id === id);
  if (entry && !entry.derive)
    return {
      label: entry.label,
      unit: entry.unit,
      column: entryColumn(entry),
      source: entry.source,
    };
  return null;
};

/** Rebind an input to the **compare role**: the prefix lands on the raw-column
 *  LEAVES (a nested spec keeps its shape but reads `cmp_` columns), so a
 *  derived compare-bound leg folds against the joined series like any other —
 *  the role is column-addressed all the way down. */
const underCompare = (input: string | DeriveSpec): string | DeriveSpec =>
  typeof input === 'string'
    ? // IDEMPOTENT at the leaf: in a two-entity world "the compare of a
      // compare-reading leg" is the compare — double-prefixing minted a
      // `cmp_cmp_*` column no join ever carries (PR #131 review).
      input.startsWith(COMPARE_PREFIX)
      ? input
      : `${COMPARE_PREFIX}${input}`
    : { ...input, inputs: input.inputs.map(underCompare) };

/** One side of a pair as the PICKER states it (the two-sided grammar, TDL-PAIR
 *  stage 2): a metric, the workspace ROLE the leg reads — `'primary'` (default)
 *  or `'compare'`, re-resolving when the ticker bar changes, which is what
 *  makes a preset safe — and an optional per-leg study that smooths the leg
 *  WITHOUT seating it (a nested graph input; the engine dedupes it against a
 *  seated copy by content-addressing). A PINNED symbol (a fixed ticker) is the
 *  deferred third binding — it needs per-leg fetches (stage 2 of the picker).
 */
export interface PairLegInput {
  metricId: string;
  entity?: 'primary' | 'compare';
  study?: { op: 'sma' | 'ema'; period: number };
}

/** "Is this column a catalog metric's?" — {@link layeredOn}'s test for the
 *  derived metrics that stand alone instead of travelling with a source. A
 *  seated config's id no longer says where it came from, so catalog-ness is
 *  read off what it computes. */
const isCatalogColumn = (context: TerminalContext) => {
  const cols = new Set(context.catalog.map(entryColumn));
  return (column: string) => cols.has(column);
};

/**
 * What the pure edit-permission helpers need to answer a question: the seated
 * rows and the catalog (which declares each metric's unit). `TerminalContext`
 * satisfies it structurally, so a **guard passes `context` itself** and the
 * host passes its own two — one shape, no chance of the panel's disabled state
 * and the guard disagreeing because they were handed different inputs.
 */
export interface EditScope {
  rows: readonly RowState[];
  /** Only what naming + units need, so the HOST's own catalog type satisfies it
   *  too — these helpers are called from the panel as well as the guards. */
  catalog: readonly Pick<MetricEntry, 'id' | 'label' | 'unit' | 'column'>[];
  /** The host's colour keys for a new series, in hand-out order (a split leg
   *  takes the first its row is not using). Optional: a host that edits without
   *  a palette lets a new leg keep its pair's colour. */
  palette?: readonly string[];
}

/**
 * What unit a RAW column reads in — {@link specUnit}'s leaf resolver, so a
 * spec's unit can be recomputed from its structure alone.
 *
 * The catalog is the authority (it declares each metric's unit); seated configs
 * fill in anything folded rather than fed. A `cmp_`-prefixed leaf is the same
 * metric read for the comparison symbol, so it falls back to the bare column
 * rather than reading unitless.
 */
export const columnUnits = (
  catalog: EditScope['catalog'],
  configs: readonly SeriesConfig[] = [],
) => {
  const units = new Map<string, string>();
  for (const c of configs) units.set(c.column, c.unit ?? '');
  for (const e of catalog) units.set(entryColumn(e), e.unit);
  return (column: string): string =>
    units.get(column) ??
    (column.startsWith(COMPARE_PREFIX)
      ? (units.get(column.slice(COMPARE_PREFIX.length)) ?? '')
      : '');
};

const unitOfColumn = (scope: EditScope) => columnUnits(scope.catalog, flatConfigs(scope.rows));

/** A resolved+bound leg: the graph input the pair spec takes, and the
 *  decorated label the spread reads by. Order matters: the study wraps the
 *  metric, then the compare rebind rewrites the LEAVES — so a compare-bound
 *  studied leg computes the study over the compare columns. */
const boundLeg = (leg: PairLeg, input: PairLegInput): { graph: DeriveInput; label: string } => {
  let graph: DeriveInput = leg.spec ?? leg.column;
  let label = leg.label;
  if (input.study) {
    graph = { op: input.study.op, params: { period: input.study.period }, inputs: [graph] };
    label = `${label} · ${input.study.op.toUpperCase()}(${input.study.period})`;
  }
  if (input.entity === 'compare') {
    graph = underCompare(graph);
    // Role-bound legs print the ROLE, never a ticker — a ticker in a chip is
    // reserved for a PINNED leg (the binding-legibility rule, Tidal's pairs plan).
    label = `${label} (cmp)`;
  }
  return { graph, label };
};

/** The spec a pair induces — a two-input node whose legs are bound graph
 *  inputs (raw columns, nested leg specs, per-leg studies, compare rebinds). */
const pairSpec = (a: PairLeg, aIn: PairLegInput, b: PairLeg, bIn: PairLegInput, op: PairOp) => {
  const spec: DeriveSpec = { op, inputs: [boundLeg(a, aIn).graph, boundLeg(b, bIn).graph] };
  return spec;
};

/** A pair `SeriesConfig` — the A-vs-B spread (TDL-PAIR). The derived line is
 *  the signal (George's gauge feedback: the diff/ratio is more stable than
 *  either leg), so it inserts IN FRONT of leg A on A's row. **A spread arrives
 *  UNLINKED** (its own `axisGroup`, on the right side): its regime differs by
 *  construction (oscillates about 0 or 1), so it starts on its own scale and
 *  binds no side's unit — one re-link click away from sharing if wanted (the
 *  axis panel). Unit rules still matter for that re-link: a diff of like units
 *  reads in that unit; a ratio/log-ratio is unitless. Purple default so a
 *  spread reads distinctly from studies (amber); the user recolours. */
/** The spread's colour when the host supplies no palette — a plain CSS colour
 *  (a soft violet) any `resolveColor` passes through unchanged. */
export const DEFAULT_SPREAD_COLOR = '#8b7cf6';

function pairConfig(
  a: PairLeg,
  aIn: PairLegInput,
  b: PairLeg,
  bIn: PairLegInput,
  op: PairOp,
  id: string,
  unitOf: (column: string) => string,
  /** The host's colour keys, and the colours already drawn — the spread takes
   *  the first key not in use, else the palette's first, else
   *  {@link DEFAULT_SPREAD_COLOR}: a config needs SOME colour, and a host that
   *  supplies no palette gets a plain CSS one its resolver passes through. */
  palette: readonly string[] = [],
  taken: readonly string[] = [],
): SeriesConfig {
  const la = boundLeg(a, aIn);
  const lb = boundLeg(b, bIn);
  const derive: DeriveSpec = { op, inputs: [la.graph, lb.graph] };
  return {
    id,
    label: PAIR_LABEL[op](la.label, lb.label),
    color: palette.find((k) => !taken.includes(k)) ?? palette[0] ?? DEFAULT_SPREAD_COLOR,
    axis: 'R',
    axisGroup: id, // its own scale — the key IS its id, so the axis id is stable
    style: 'line',
    visible: true,
    source: a.source,
    column: deriveId(derive),
    value: null,
    // From the registry's declared output unit, so the lens and the add path
    // can never disagree about what a spread reads in (`specUnit`): a like-unit
    // diff keeps the unit, a ratio is unitless, a log-ratio reads `log`.
    unit: specUnit(derive, unitOf),
    derive,
  };
}

/**
 * A pair PART's display name, rebuilt from the spec — the same construction
 * `boundLeg` writes, read back the other way: the metric's catalog name, its
 * studies in application order, and `(cmp)` for a compare-bound leg (never a
 * ticker; a ticker in a label is reserved for a pinned leg — the
 * binding-legibility rule in Tidal's pairs plan).
 */
function partLabel(scope: EditScope, part: PairPart): string {
  const studied = part.studies.reduce(
    (acc, st) => `${acc} · ${partStudyLabel(st)}`,
    columnLabel(scope, part.base),
  );
  return part.entity === 'compare' ? `${studied} (cmp)` : studied;
}

/** The display name of a column — its catalog entry's, else a seated config's,
 *  else the raw column. Exported because the PANEL names pair parts too (it
 *  renders each leg as its own row), and two spellings of "what is this column
 *  called" would drift. */
export function columnLabel(scope: EditScope, column: string): string {
  return (
    scope.catalog.find((e) => entryColumn(e) === column)?.label ??
    flatConfigs(scope.rows).find((c) => c.column === column)?.label ??
    column
  );
}

/**
 * The label a pair reads by, **rebuilt from its spec** rather than patched.
 *
 * This is the scoped answer to the label problem propagation ran into: a
 * composed label can't be edited textually (a leg's label is routinely a
 * substring of its sibling's — PR #140 review), but it CAN be regenerated,
 * because the spec says exactly what the pair is. Returns undefined when the
 * spec doesn't decompose into two named parts (a spread of spreads), in which
 * case the caller keeps the existing label rather than inventing one. The
 * general version of this is `TDL-LINEAGE`.
 */
function pairLabel(scope: EditScope, spec: DeriveSpec): string | undefined {
  const parts = readPairParts(spec);
  if (!parts || !isPairOp(spec.op)) return undefined;
  return PAIR_LABEL[spec.op](partLabel(scope, parts[0]), partLabel(scope, parts[1]));
}

/**
 * An `addPair` whose fn() is `Unjoined` — the pair is a LEG GROUP from the
 * start, so no spread is ever seated and immediately taken apart.
 *
 * Composed from the same `planSplit` the fn() lens runs, against the pair
 * config the join path WOULD have built: one description of "what are this
 * pair's legs, and which of them already exist", not two.
 */
function planAddGroup(
  context: TerminalContext,
  event: Extract<TerminalEvent, { type: 'series.addPair' }>,
  row: RowState,
): SplitPlan | null {
  const a = resolveLeg(context, event.a.metricId);
  const b = resolveLeg(context, event.b.metricId);
  if (!a || !b) return null;
  // `planSplit` is written against a join, so an unjoined pair still needs one
  // to build its plan with. It is scaffolding, not memory: f() is fixed at
  // creation, and nothing reads this back or restores it.
  const join: PairOp = event.op === 'none' ? 'diff' : event.op;
  const pair = pairConfig(
    a,
    event.a,
    b,
    event.b,
    join,
    mintId(context.cfgSeq),
    unitOfColumn(context),
    context.palette,
    row.configs.map((c) => c.color),
  );
  return planSplit(context, pair, row.configs, context.cfgSeq + 1, true);
}

/** Whether an `addPair` will actually seat a config — the same early returns the
 *  `rows` assigner makes. Its sibling assigners (`expanded`, `cfgSeq`) must
 *  agree with it about whether an id was consumed, or the counter drifts and
 *  the expansion points at a config that was never created. */
/** The row an `addPair` lands on — a named one, else leg A's, else A's source
 *  row. ONE chooser, read by the guard and every assigner, so they cannot
 *  disagree about whether (and where) a pair was created. */
function pairRow(
  context: TerminalContext,
  event: Extract<TerminalEvent, { type: 'series.addPair' }>,
): RowState | undefined {
  const a = resolveLeg(context, event.a.metricId);
  if (!a || !resolveLeg(context, event.b.metricId)) return undefined;
  if (event.rowId) return context.rows.find((r) => r.id === event.rowId);
  const seat = legSeat(context, event.a.metricId);
  return (
    (seat && context.rows.find((r) => r.configs.some((c) => c.id === seat.id))) ??
    rowForSource(context.rows, a.source)
  );
}

function pairSeats(
  context: TerminalContext,
  event: Extract<TerminalEvent, { type: 'series.addPair' }>,
): boolean {
  return !!pairRow(context, event);
}

/** The column a study takes if one of its params changes — its spec re-encoded.
 *  The identity does NOT change with it; this guards column collisions only. */
const restudyColumn = (study: SeriesConfig, name: string, value: number): string =>
  deriveId({ ...study.derive!, params: { ...study.derive!.params, [name]: value } });

/**
 * Whether a study's param `name` can move to `value` — shared by the guard and
 * the host, so a refused edit renders **disabled** instead of dead-clicking (the
 * same contract as `linkToggleAllowed` / `swapAllowed`).
 *
 * It has to run the whole propagation, because an edit is refusable for a
 * reason that isn't visible on the study itself: re-speccing it rewrites
 * everything built on it, and one of THOSE can land on a column another config
 * already holds — two lines computing the same thing. Before this was exported,
 * such an edit simply did nothing when clicked, with no way to find out why
 * (PR #140 review, MEDIUM).
 */
export function respecAllowed(scope: EditScope, id: string, name: string, value: number): boolean {
  const configs = flatConfigs(scope.rows);
  const target = configs.find((c) => c.id === id);
  if (!target?.derive) return false;
  // The op must actually DECLARE this param — a `stdDev` sent to an `sma` is
  // not a narrow edit, it is a spec the registry rejects.
  if (!opParams(target.derive.op).some((p) => p.name === name)) return false;
  // Bounds and integer-ness come from the REGISTRY, via the spec it would mint,
  // rather than from a `period`-shaped test here. A band's `stdDev` is
  // fractional and legal; the old `Number.isInteger` would have refused every
  // value of it.
  const candidate: DeriveSpec = {
    ...target.derive,
    params: { ...target.derive.params, [name]: value },
  };
  if (!isValidSpec(candidate)) return false;
  if (restudyColumn(target, name, value) === target.column) return false;
  const next = propagateRespec(configs, id, respecParam(target, name, value), unitOfColumn(scope));
  // A period can't change a unit by itself — but the apply path RECOMPUTES
  // units structurally, so a config whose stored unit had drifted from its spec
  // (a preset written before an op's declared unit changed) moves on the first
  // edit that touches it. Same coherence gate as the lens, or the two paths
  // could disagree about the very thing they now both write (PR #141 review).
  return next !== null && unitsStayCoherent(scope.rows, next);
}

// --- fn() = None: the LEG GROUP ----------------------------------------------
// With no transform a pair has no single line and therefore no single ink, so
// it stops being one config and becomes TWO — each an ordinary series with its
// own colour, axis, eye and study pipeline, tied together by `SeriesGroup`.
// Splitting and re-joining are one edit read in two directions.

/** A leg's graph input as a seated config would carry it: a raw column has no
 *  spec, a derived leg carries its own. */
const legParts = (leg: DeriveInput): Pick<SeriesConfig, 'column' | 'derive'> =>
  typeof leg === 'string' ? { column: leg } : { column: deriveId(leg), derive: leg };

/** The colour leg B takes when a pair splits — the first palette key neither
 *  leg A nor anything else in the row is already using, so two fresh lines are
 *  never the same colour. Falls back to leg A's if the palette is exhausted. */
function freeColor(
  row: readonly SeriesConfig[],
  taken: string,
  palette: readonly string[],
): string {
  const used = new Set([taken, ...row.map((c) => c.color)]);
  return palette.find((k) => !used.has(k)) ?? taken;
}

/**
 * What splitting a pair into a leg group actually does — computed once so the
 * `rows` assigner, the `cfgSeq` counter and the guard all read the same plan.
 *
 * A leg whose column is ALREADY on the chart is **adopted** rather than
 * duplicated (one column, one config): splitting `iv63 − iv21` while `iv21` is
 * seated in its own right makes that series leg B. Everything else is created,
 * and leg A reuses the pair's own id when it can — so the thing you were
 * looking at stays the thing you are looking at, ink, axis and pins included.
 */
interface SplitPlan {
  /** Configs to seat (ids already assigned). */
  create: SeriesConfig[];
  /** Existing configs to tag into the group, by id. */
  adopt: { id: string; group: SeriesGroup }[];
  /** Ids consumed from the counter. */
  mints: number;
}

function planSplit(
  scope: EditScope,
  pair: SeriesConfig,
  row: readonly SeriesConfig[],
  nextSeq: number,
  /** ADD path: the pair isn't seated yet, so there is no identity to strand
   *  and "both legs already drawn" is a fine outcome — it just groups them. */
  adding = false,
): SplitPlan | null {
  const spec = pair.derive;
  if (!spec || !isPairOp(spec.op)) return null;
  const parts = readPairParts(spec);
  const inputs = spec.inputs ?? [];
  if (!parts || inputs.length !== 2) return null;
  // A study built ON the spread has nowhere to point once the spread stops
  // being a single line, so splitting would strand it — configured, computing a
  // column nothing folds. Refuse rather than delete the user's work silently
  // (PR #144 review, MEDIUM).
  if (derivedClosure(flatConfigs(scope.rows), pair.id).size > 1) return null;
  const legCols = inputs.map((i) => legParts(i).column);
  // Two legs computing the same thing is a constant, not a pair — and would be
  // one config either way. (`canAddPair` refuses to build one; a persisted
  // preset could still carry it.)
  if (legCols[0] === legCols[1]) return null;

  const configs = flatConfigs(scope.rows);
  const unitOf = unitOfColumn(scope);
  const plan: SplitPlan = { create: [], adopt: [], mints: 0 };
  let seq = nextSeq;
  let pairIdFree = true;
  let refuse = false;

  inputs.forEach((input, i) => {
    const side: 'A' | 'B' = i === 0 ? 'A' : 'B';
    const { column, derive } = legParts(input);
    // Adoption looks only in the pair's OWN row: a group whose legs sit in two
    // rows has no single Pair node to render (the panel is per-row), so it
    // would draw as two one-legged pairs.
    const seated = row.find((c) => c.id !== pair.id && c.column === column);
    if (seated) {
      // …and never STEAL a leg from another pair. Two pairs sharing a leg
      // column would leave the first group with one member, which nothing can
      // re-join and nothing can un-group (PR #144 review, HIGH).
      if (seated.group) refuse = true;
      else plan.adopt.push({ id: seated.id, group: { id: pair.id, side } });
      return;
    }
    // The column is free in this row but taken in ANOTHER — creating here would
    // put two configs on one column, which every dependency walk resolves by.
    if (configs.some((c) => c.id !== pair.id && c.column === column)) refuse = true;
    const id = pairIdFree ? ((pairIdFree = false), pair.id) : mintId(seq++);
    if (id !== pair.id) plan.mints += 1;
    const unit = typeof input === 'string' ? unitOf(input) : specUnit(input, unitOf);
    // A spread arrives UNLINKED because it oscillates; its LEGS do not — they
    // are the raw metrics, and the whole point of drawing both is comparing
    // them, which needs ONE scale. So a created leg is placed like any new
    // metric (`axisForAdd`), and only falls back to its own axis when no side
    // can take its unit. Inheriting the pair's own axis put the two legs of an
    // AAPL/MSFT price compare on two separately-fitted axes — two lines you
    // cannot read against each other, which is the one thing they are for.
    const side2 = axisForAdd(members(row), unit, pair.axis);
    plan.create.push({
      ...pair,
      id,
      column,
      derive,
      axis: side2 ?? pair.axis,
      axisGroup: side2 == null ? id : undefined,
      color: id === pair.id ? pair.color : freeColor(row, pair.color, scope.palette ?? []),
      label: partLabel(scope, parts[i]!),
      unit,
      value: null,
      group: { id: pair.id, side },
    });
  });
  // Both legs adopted ⇒ the pair's own config has nothing left to be, and
  // dropping it would take its identity with it. Refuse: there is nothing to
  // split that isn't already drawn.
  return refuse || (!adding && plan.create.length === 0) ? null : plan;
}

/** A pointer (selection / expansion) after a re-join: a config the merge
 *  ABSORBS is gone, so anything aimed at it must land on the pair it became
 *  rather than dangle. */
/** Every config a `group.remove` takes: both legs and everything layered on
 *  them — the same cascade a single remove does, run over the pair. */
function groupDoomed(rows: readonly RowState[], groupId: string): Set<string> {
  const all = flatConfigs(rows);
  const doomed = new Set<string>();
  for (const m of groupMembers(all, groupId))
    for (const id of derivedClosure(all, m.id)) doomed.add(id);
  return doomed;
}

export const groupMembers = (configs: readonly SeriesConfig[], groupId: string): SeriesConfig[] =>
  configs
    .filter((c) => c.group?.id === groupId)
    .sort((a, b) => (a.group!.side === b.group!.side ? 0 : a.group!.side === 'A' ? -1 : 1));

/**
 * Re-join a leg group into one pair — fn() leaving `None`.
 *
 * Each leg contributes the output of its own PIPELINE, not its metric: a study
 * seated on a leg while the pair was split folds INTO the join, which is what
 * "each part is a pipeline, the combined parts are then a final pipeline" means.
 * Those study configs are absorbed (they become nested spec, exactly as a
 * per-leg study from the picker always has been) — the computation is preserved
 * exactly; what it loses is the study's own row and ink.
 *
 * The joined pair keeps **leg A's identity**, so a split/join round-trip returns
 * the ink and axis you started with.
 */

/**
 * Whether a side's SHARED axis would be left holding two different units — the
 * axis policy, re-checked after an edit that moves units.
 *
 * A lens change is the first edit that can do this: `diff` of two `%` legs
 * reads `%`, its ratio reads unitless, and a study of that spread inherits
 * whatever it now is. Only a side we would BREAK counts — a side already
 * holding mixed units (an old preset, say) is not made worse by this edit, and
 * refusing there would strand the user with no way to change the lens at all.
 */
function unitsStayCoherent(rows: readonly RowState[], next: Map<string, Respec>): boolean {
  const unitsOn = (configs: readonly SeriesConfig[], side: SeriesAxis, after: boolean) =>
    new Set(
      configs
        .filter((c) => !c.axisGroup && c.axis === side)
        .map((c) => (after ? (next.get(c.id)?.unit ?? c.unit ?? '') : (c.unit ?? ''))),
    );
  for (const row of rows) {
    for (const side of ['L', 'R'] as const) {
      if (unitsOn(row.configs, side, true).size > 1 && unitsOn(row.configs, side, false).size <= 1)
        return false;
    }
  }
  return true;
}

/** Re-spec a study to a new period **in place**. The period is baked into the
 *  spec, so the COLUMN moves — the identity stands still, which is what keeps
 *  the user's colour, axis, pins, selection and expansion across the edit. */
function respecParam(study: SeriesConfig, name: string, value: number): SeriesConfig {
  const prev = study.derive!;
  const derive: DeriveSpec = { ...prev, params: { ...prev.params, [name]: value } };
  // Swap only the study's OWN trailing ` · OP(params)` on its current label, so a
  // nested study keeps its parent's segment (which `studyConfig` folded into
  // `target.label`) rather than collapsing to the root identity.
  //
  // BOTH halves go through `studyTag`, which is what `studyConfig` wrote the
  // label with. Built by hand off `params.period` the suffix read
  // `BOLLINGER(20)` where the label says `BOLLINGER(20, 2)` — so it matched
  // nothing, `base` fell back to the root identity, and a param edit both
  // dropped `stdDev` and collapsed the parent's pipeline segment. The existing
  // nested-label test never caught it because every op it uses has one param.
  const suffix = ` · ${studyTag(prev)}`;
  const base = study.label.endsWith(suffix)
    ? study.label.slice(0, -suffix.length)
    : (study.family ?? study.label);
  return {
    ...study,
    column: deriveId(derive),
    derive,
    label: `${base} · ${studyTag(derive)}`,
  };
}

/**
 * **Edit propagation** — re-spec `rootId` and carry everything built on it.
 *
 * A dependent names its source by column (a raw string, or a nested copy of the
 * source's spec — composition nests). Re-speccing the source moves that column,
 * so before stable identity the only honest option was to *cascade the
 * dependents away*: change an SMA's period and the EMA laid on it silently
 * vanished, as did any spread using it as a leg. Now the whole subtree can be
 * rewritten in place, which is what the control tree looks like it does and
 * what a pair's leg edits will need (Tidal's pairs plan).
 *
 * Returns the new `{derive, column, label}` per changed config — the root
 * included — or **null if the result would be incoherent**: two configs on one
 * column (the one-column-one-config invariant every dependency walk relies on),
 * a spec the registry rejects, or a rewrite that didn't settle. Guards call this
 * and refuse; the action applies exactly what the guard proved.
 *
 * **A dependent's LABEL is not rewritten** — only the root's own is (it knows
 * its own edit). A label is composed once at creation from its source's label
 * (`studyConfig`, `PAIR_LABEL`), and patching that text back out is not
 * recoverable: a source's label is routinely a substring of a sibling's, so the
 * swap lands on the wrong segment — a spread reading `A · SMA(20) / A · SMA(50)`
 * with its own legs' chips saying otherwise, and with a compare-bound leg the
 * text moved on the leg that did NOT change (PR #140 review, HIGH). So a
 * dependent's label can go stale after an edit, which is honest about what a
 * label currently is: a snapshot. Rebuilding one from its spec is `TDL-LINEAGE`,
 * and the Pair node needs it anyway (a pair's label composes from its legs).
 */
type Respec = { derive: DeriveSpec; column: string; unit: string; label?: string };

function propagateRespec(
  configs: readonly SeriesConfig[],
  rootId: string,
  root: Pick<SeriesConfig, 'derive' | 'label'>,
  unitOf: (column: string) => string,
): Map<string, Respec> | null {
  const rootCfg = configs.find((c) => c.id === rootId);
  if (!rootCfg?.derive || !root.derive) return null;
  if (!isValidSpec(root.derive)) return null;
  const next = new Map<string, Respec>([
    [
      rootId,
      {
        derive: root.derive,
        column: deriveId(root.derive),
        unit: specUnit(root.derive, unitOf),
        label: root.label,
      },
    ],
  ]);
  // Fixpoint: each pass re-points every config at whatever has moved so far. A
  // config can depend on more than one changed source (a pair whose legs both
  // moved), so this can't be a single walk. It settles because a substitution
  // replaces a name with a dependent's CURRENT spec — which may itself still be
  // intermediate, but each pass heals one more level and no name comes back
  // once every level has.
  let settled = false;
  // `substituteInput` walks persisted spec shapes, and a pathological one
  // (`inputs: [null]`, the case `applyDerivedReport` already belts) throws. This
  // runs inside a GUARD, where a throw kills the actor — so it is total, like
  // every other naming call on this path (PR #130 review).
  try {
    for (let pass = 0; pass <= configs.length && !settled; pass++) {
      settled = true;
      for (const c of configs) {
        if (!c.derive) continue;
        const before = next.get(c.id)?.derive ?? c.derive;
        let spec = before;
        for (const dep of configs) {
          const moved = dep.id === c.id ? undefined : next.get(dep.id);
          if (!moved || moved.column === dep.column) continue;
          spec = substituteInput(spec, dep.column, moved.derive);
        }
        if (spec === before) continue;
        if (!isValidSpec(spec)) return null;
        // The UNIT travels with the spec: a lens change can turn a `%` spread
        // unitless, and a study of that spread reads in whatever its source
        // now does. Recomputed structurally (`specUnit`), never inherited from
        // the stale config, so it is right at any depth.
        next.set(c.id, { derive: spec, column: deriveId(spec), unit: specUnit(spec, unitOf) });
        settled = false;
      }
    }
  } catch {
    return null;
  }
  // Out of passes with rewrites still landing: the result would be a graph part
  // way through an edit. Refuse rather than apply it.
  if (!settled) return null;
  // One column, one config — including against the configs that did NOT move.
  const columns = configs.map((c) => next.get(c.id)?.column ?? c.column);
  if (new Set(columns).size !== columns.length) return null;
  return next;
}

/**
 * Run a re-spec and write it into the rows — the one apply path, shared by
 * every edit that rewrites a spec in place (a study's period, a pair's lens).
 *
 * Returns the rows UNCHANGED when the propagation refuses, so an action can
 * never half-apply what its guard proved coherent. Only the fields the edit
 * actually moves are written: nothing here touches `axis`/`axisGroup`/colour, and
 * an absent label is not spread (only the root carries one — see
 * {@link propagateRespec} — and `label: undefined` would blank a chip).
 */
function applyRespec(
  context: TerminalContext,
  rootId: string,
  root: Pick<SeriesConfig, 'derive' | 'label'>,
): RowState[] {
  const rows = context.rows;
  const next = propagateRespec(flatConfigs(rows), rootId, root, unitOfColumn(context));
  if (!next) return rows;
  return rows.map((r) => ({
    ...r,
    configs: r.configs.map((c) => {
      const re = next.get(c.id);
      return re
        ? {
            ...c,
            derive: re.derive,
            column: re.column,
            unit: re.unit,
            ...(re.label ? { label: re.label } : {}),
          }
        : c;
    }),
  }));
}

/** The SHARED-axis members of a row — the unit gate's input. An unlinked
 *  (non-shared) config scales on its own axis and binds no side, so it is
 *  invisible to axis compatibility (it still costs gutter width, which is the
 *  panel's pressure to re-link, not a hard gate). */
const members = (configs: readonly SeriesConfig[]): AxisMember[] =>
  configs.filter((c) => !c.axisGroup).map((c) => ({ unit: c.unit ?? '', axis: c.axis }));

/**
 * Whether `id` can move onto the axis keyed by `axisGroup` (undefined = the
 * side's shared axis) — the panel's drag, gated exactly like every other
 * membership change.
 *
 * A destination that already carries series must read in the SAME unit: an
 * axis is one scale, and two units on one scale is the thing the whole axis
 * policy exists to prevent. An EMPTY destination (or one holding only the
 * mover) is always fine — that is just the mover keeping its own scale.
 */
export function axisMoveAllowed(
  configs: readonly SeriesConfig[],
  id: string,
  axisGroup?: string,
): boolean {
  const c = configs.find((x) => x.id === id);
  if (!c) return false;
  if ((c.axisGroup ?? undefined) === (axisGroup ?? undefined)) return false; // already there
  // The destination is drawn from the MOVER'S SIDE only. An axis id is
  // side-qualified (`row:side` / `row:side:group`), so the same key on the other
  // side is a different axis and none of its members belong to this decision.
  // Testing them was worse than redundant for the SHARED destination, where the
  // key is `undefined`: both sides' shared members carry it, so one series on
  // the far side refused every drop onto this side's shared axis — while the
  // chain toggle allowed the identical move (PR #149 review, MEDIUM).
  const into = configs.filter(
    (x) => x.id !== id && x.axis === c.axis && (x.axisGroup ?? undefined) === axisGroup,
  );
  const unit = c.unit ?? '';
  return into.every((x) => (x.unit ?? '') === unit);
}

/**
 * Whether the panel's chain toggle can act on `id` — shared by the guard and the
 * host (the panel renders a refused toggle disabled). The semantics follow the
 * icon exactly:
 *
 * - **On the side's shared axis** (LINKED, with or without company): unlink to
 *   an own axis — **always allowed**. Alone on the shared axis this is a
 *   visual no-op, but it is not a semantic one: an own axis binds no unit, so
 *   it can always ⇄ to the other side, and a later same-unit arrival joins the
 *   *shared* axis rather than silently merging with it. Refusing it here
 *   stranded a lone member whose far side was occupied — both controls
 *   disabled, no way out but delete-and-re-add (PR #136 review, HIGH).
 * - **On an own axis** (BLINK): JOIN — allowed only when a same-unit companion
 *   exists on the side, and no different-unit series holds the side's shared
 *   axis (the axis policy, applied at link time). Joining needs something to
 *   join, so a lone series can never bind a FREE side by toggling and a spread
 *   can't accidentally claim a side's unit.
 */
export function linkToggleAllowed(configs: readonly SeriesConfig[], id: string): boolean {
  const c = configs.find((x) => x.id === id);
  if (!c) return false;
  if (!c.axisGroup) return true; // LINKED → unlink, company or not
  const side = configs.filter((x) => x.id !== id && x.axis === c.axis);
  const unit = c.unit ?? '';
  const shared = side.filter((x) => !x.axisGroup);
  if (shared.some((x) => (x.unit ?? '') !== unit)) return false; // side bound elsewhere
  return side.some((x) => (x.unit ?? '') === unit); // something to join
}

/**
 * Point axis id `to` at whatever `from` held, and vacate `from`. With no
 * `from`, the destination is a **newly formed** axis and must start clean.
 *
 * The invariant every axis operation preserves: **an id's range entry
 * describes the axis occupying that id now, or there is no entry.** Entries
 * are otherwise never pruned (a stale id is inert), but membership and side
 * changes make stale ids live again — so an arriving axis with no pin must
 * CLEAR its destination rather than inherit whatever scale used to sit there
 * (PR #133/#135 reviews).
 */
function moveRange(
  ranges: Record<string, AxisRange>,
  to: string,
  from?: string,
): Record<string, AxisRange> {
  const next = { ...ranges };
  const entry = from ? next[from] : undefined;
  if (from) delete next[from];
  if (entry) next[to] = entry;
  else delete next[to];
  return next;
}

/** The configs sharing ONE axis with `id`: just itself when it is unlinked,
 *  else every shared-axis config on its side. The unit of travel for a
 *  side swap — an axis moves as a scale, not as loose series. */
function axisMembers(configs: readonly SeriesConfig[], id: string): SeriesConfig[] {
  const c = configs.find((x) => x.id === id);
  if (!c) return [];
  return c.axisGroup
    ? configs.filter((x) => x.axisGroup === c.axisGroup && x.axis === c.axis)
    : configs.filter((x) => !x.axisGroup && x.axis === c.axis);
}

/**
 * Whether the panel's ⇄ can move `id`'s axis to the other side — shared by the
 * guard and the host (a refused swap renders disabled).
 *
 * An UNLINKED axis may always swap: it binds no unit, so it just changes which
 * gutter it occupies. A SHARED axis may swap only when the other side has **no
 * shared axis** — otherwise the move would silently merge two scales (possibly
 * of different units) into one, which is a link operation, and linking has its
 * own control. Own axes already on the far side never block: they are separate
 * gutters.
 */
export function swapAllowed(configs: readonly SeriesConfig[], id: string): boolean {
  const c = configs.find((x) => x.id === id);
  if (!c) return false;
  if (c.axisGroup) return true;
  const other: SeriesAxis = c.axis === 'R' ? 'L' : 'R';
  return !configs.some((x) => !x.axisGroup && x.axis === other);
}

/** Apply the chain toggle to a row's configs (see {@link linkToggleAllowed} —
 *  the guard has already vetted it). */
function toggleLink(configs: readonly SeriesConfig[], id: string): SeriesConfig[] {
  const c = configs.find((x) => x.id === id);
  if (!c) return [...configs];
  // UNLINK — the LINKED icon always means "leave the shared scale".
  if (!c.axisGroup) return configs.map((x) => (x.id === id ? { ...x, axisGroup: id } : x));
  // JOIN. With a shared scale present, the clicked series joins it alone
  // (other own axes were unlinked deliberately — they stay). With none, every
  // same-unit lone axis on the side merges into one (the sketch's
  // two-lone-axes state: clicking a broken chain re-joins them).
  const side = configs.filter((x) => x.id !== id && x.axis === c.axis);
  const unit = c.unit ?? '';
  if (side.some((x) => !x.axisGroup))
    return configs.map((x) => (x.id === id ? { ...x, axisGroup: undefined } : x));
  return configs.map((x) =>
    x.axis === c.axis && (x.unit ?? '') === unit && (x.id === id || x.axisGroup)
      ? { ...x, axisGroup: undefined }
      : x,
  );
}

/**
 * Value-free projection of the rows for deep comparison (live `value` excluded —
 * it's data, so a ticking quote must not make an applied preset read "custom").
 *
 * **The config `id` is excluded on purpose**, even though it is now persisted:
 * a preset is a *look*, and identity is per-instance bookkeeping. `column`
 * carries everything the id used to contribute here (it is the computation),
 * so this comparison means exactly what it meant before the identity split —
 * whereas folding in a minted counter would make a hand-rebuilt copy of a saved
 * preset read as "custom" purely because its configs were minted later.
 */
/**
 * Whether a seated config is a plain metric that could be paired against the
 * comparison — the bulk gesture's target test. Mirrors the panel's per-row
 * `canCompare` MINUS the "is there a comparison at all" check, which is
 * workspace state the terminal cannot see: the caller offers the action only
 * when a comparison is named.
 *
 * Excluded: a hidden series (the gesture says *visible*), a leg already in a
 * group, a spread, and anything already reading the comparison — each of those
 * states its symbols already.
 */
function comparableMetric(c: SeriesConfig): boolean {
  if (!c.visible || c.group) return false;
  if (c.derive ? hasPairOp(c.derive) || usesCompare(c.derive) : false) return false;
  // A multi-output study cannot be a leg (see `canAddPair`), so "Pair all
  // visible" must not try — it would raise an `addPair` the guard then refuses,
  // which reads as the button silently skipping things.
  if (c.derive && opIsMulti(c.derive.op)) return false;
  return !c.column.startsWith(COMPARE_PREFIX);
}

export function canonRows(rows: readonly RowState[]): string {
  return JSON.stringify(
    rows.map((r) => {
      // Axis membership is preset identity — but `axisGroup` is a MINTED config
      // id, and hashing it would make a hand-rebuilt copy of a saved preset read
      // as "custom" purely because its configs were minted later: exactly the
      // trap the `id` exclusion above exists to avoid. So hash the SHAPE. Each
      // distinct non-shared axis becomes its position in the row, and the shared
      // axis stays `null`, so "these two share a scale, that one is alone"
      // compares equal across mints (PR #149 review, LOW).
      // Both keys below are MINTED ids, so both get slotted, not hashed.
      const slotter = () => {
        const keys: string[] = [];
        return (g?: string): number | null => {
          if (!g) return null;
          const i = keys.indexOf(g);
          return i >= 0 ? i : keys.push(g) - 1;
        };
      };
      const axisSlot = slotter();
      const groupSlot = slotter();
      return [
        r.id,
        r.configs.map((c) => [
          c.column,
          c.label,
          c.color,
          c.axis,
          axisSlot(c.axisGroup),
          c.style,
          c.window ?? null,
          c.candleVariant ?? null,
          c.candleColorBy ?? null,
          c.visible,
          c.source ?? null,
          c.unit ?? null,
          c.lineWidth ?? null,
          c.colorMode ?? null,
          c.riseColor ?? null,
          c.fallColor ?? null,
          // A leg group is composition, not decoration: two legs with no join are
          // a different preset from the same two joined, or from two unrelated
          // metrics that happen to be seated together.
          c.group ? [groupSlot(c.group.id), c.group.side, c.group.hidden ?? false] : null,
        ]),
      ];
    }),
  );
}

/** The active slot: first saved preset whose rows deep-equal the live rows, else
 *  null (custom). The single derivation behind the filled circle + the seed. */
export function activeSlot(
  presets: readonly (TerminalPreset | null)[],
  rows: readonly RowState[],
): number | null {
  const live = canonRows(rows);
  const i = presets.findIndex((p) => p != null && canonRows(p.rows) === live);
  return i === -1 ? null : i;
}

const cloneRows = (rows: readonly RowState[]): RowState[] =>
  rows.map((r) => ({ ...r, configs: r.configs.map((c) => ({ ...c, value: null })) }));

// --- the machine -------------------------------------------------------------

export const terminalMachine = setup({
  types: {
    context: {} as TerminalContext,
    events: {} as TerminalEvent,
    input: {} as TerminalInput,
  },
  guards: {
    // A series may be added only if its unit fits a free or matching axis in its
    // target row (the two-axis policy). That is now the ONLY gate.
    //
    // **The add-once rule was dropped on 2026-08-25** (Peter). It refused a second
    // config reading a column already on the chart, reasoning that "two configs
    // reading one column are the same line twice" — true while a seated series had
    // nothing you could change about it. It no longer is: a series carries editable
    // params (the censor) and an appendable study chain, so a second copy of ATM
    // Vol 21D is the *starting point* for the comparison you actually want —
    // censored against uncensored, raw against its own moving average. The rule was
    // forbidding the reason to do it.
    //
    // Nothing downstream assumed uniqueness: a config's `id` is minted and opaque,
    // and the render, axis policy and study chain all key on it rather than on the
    // column (`entryColumn` exists precisely because a seated config's id does not
    // say what it reads).
    canAdd: ({ context, event }) => {
      if (event.type !== 'series.add') return false;
      const entry = context.catalog.find((e) => e.id === event.catalogId);
      if (!entry) return false;
      // A row's own `[+] Metric` targets that row (`rowId`); the bare add routes
      // by source (its row, else an empty row, else the last).
      const row = event.rowId
        ? context.rows.find((r) => r.id === event.rowId)
        : rowForSource(context.rows, entry.source);
      return !!row && canAddUnit(members(row.configs), entry.unit);
    },
    // Row cap (the control-panel spec: 1–3). The UI also gates on "current bottom has
    // content"; this is the hard invariant.
    canAddRow: ({ context }) => context.rows.length < MAX_ROWS,
    // A study may be added if its target exists and the exact spec isn't already
    // on the chart. One column, one config: a duplicate spec would fold to the
    // same column, drawing one line twice and making the dependency walks
    // (which resolve edges by column) ambiguous about which config owns it.
    canAddStudy: ({ context, event }) => {
      if (event.type !== 'series.addStudy') return false;
      const target = flatConfigs(context.rows).find((c) => c.id === event.targetId);
      if (!target) return false;
      // The op's bar columns must exist on the target's SOURCE. An ATR on a vol
      // series names `high`/`low`/`close` that the series does not carry: the
      // spec is well-formed, the engine rejects it at compile, the fold skips
      // it, and the config sits in the panel computing silence. The menu hides
      // such ops (`studyOfferable`), but the picker stays open across picks and
      // a preset can replay an add, so the machine is where the refusal has to
      // live — the same move `b544480` made for multi-output targets.
      if (!studyOfferable(target.source, event.op)) return false;
      // A MULTI-OUTPUT study cannot be a study target. Its `column` is a spec id
      // naming several columns and none of its own, so `sma(macd(...))` would
      // read a column that does not exist: the spec is well-formed, `deriveId`
      // names it happily, and the fold quietly produces nothing — a config
      // sitting in the panel computing silence, which is the worst failure
      // shape. Which output such a study should read is a real question the
      // engine has no way to answer (a MACD's line? its histogram?), so refuse
      // rather than guess. The `Add ▸ Study` menu hides on these too; this is
      // the guard that covers the picker, which stays open across picks and
      // appends to the chain TAIL.
      if (target.derive && opIsMulti(target.derive.op)) return false;
      // A study takes at most ONE study of its own: a metric may carry several
      // study CHAINS, but a chain never branches (Peter, 2026-09-12). The panel
      // reads a chain top-down as a pipeline, and a branch has no reading in
      // that grammar — two studies of one study are two pipelines claiming the
      // same middle. Adding from the metric starts a new chain instead, which is
      // what the metric's own study button does.
      if (target.derive && hasStudyChild(flatConfigs(context.rows), target)) return false;
      // Gate BEFORE naming: `deriveId` throws on a spec the registry rejects
      // (out-of-range period, malformed nested input), and a guard that throws
      // errors the whole actor (PR #130 review, HIGH). The machine is
      // host-driven — this guard IS the validation.
      const spec = studySpec(target, event.op, event.period);
      if (!isValidSpec(spec)) return false;
      const column = deriveId(spec);
      return !flatConfigs(context.rows).some((c) => c.column === column);
    },
    // A pair may be added if both legs exist, differ, and read the SAME data
    // source — the derive fold runs per series, so both columns must live on
    // one series (cross-source/cross-entity pairs need the join step; see
    // Tidal's pairs plan). The spread arrives UNLINKED (its own axis), so there is
    // no unit gate — only a target row must exist and the exact spec must not
    // already be on the chart.
    canAddPair: ({ context, event }) => {
      if (event.type !== 'series.addPair') return false;
      const a = resolveLeg(context, event.a.metricId);
      const b = resolveLeg(context, event.b.metricId);
      if (!a || !b) return false;
      if (a.source !== b.source) return false;
      // A MULTI-OUTPUT study cannot be a pair LEG either, and for the same
      // reason it cannot be a study target: its column is a spec id naming none
      // of its own columns, so the spread would read nothing. Refusing here is
      // what takes `+Compare` off a MACD — the verb was offered and meant
      // nothing, which is worse than it being absent.
      if ((a.spec && opIsMulti(a.spec.op)) || (b.spec && opIsMulti(b.spec.op))) return false;
      // A leg's nested spec can arrive from persisted state, and a study's
      // period from the picker — gate before naming (throwing guard = dead
      // actor; PR #130 review).
      // Name the legs with SOME join — an unjoined pair still has to have two
      // distinct, valid legs, and `pairSpec` is where that is decided.
      const spec = pairSpec(a, event.a, b, event.b, event.op === 'none' ? 'diff' : event.op);
      if (!isValidSpec(spec)) return false;
      // IDENTICAL bound inputs are a constant (ratio 1 / diff 0) — meaningless
      // whatever the bindings, and two legs drawing one line if unjoined. The
      // same metric ACROSS roles (or under different studies) differs after
      // binding, so George's canonical case passes.
      const name = (i: DeriveInput) => (typeof i === 'string' ? i : deriveId(i));
      if (name(spec.inputs[0]!) === name(spec.inputs[1]!)) return false;
      // UNJOINED: no spread is ever seated, so the test is whether the two legs
      // can be — `planAddGroup` answers that (a leg already in another group
      // refuses, one already drawn is adopted).
      if (event.op === 'none') {
        const row = pairRow(context, event);
        return !!(row && planAddGroup(context, event, row));
      }
      if (flatConfigs(context.rows).some((c) => c.column === deriveId(spec))) return false;
      // …and a row to land on. Delegated to `pairSeats` — which the sibling
      // assigners already use — so the guard, the rows assigner and the id
      // counter cannot disagree about where a spread goes (a named row, else
      // leg A's, else A's source row).
      return pairSeats(context, event);
    },
    // A study's period may change if the target is a study, the period is a
    // valid bar count (≥2), it actually changes, and the whole PROPAGATED
    // rewrite is coherent — the target's dependents move with it, so the guard
    // has to vet the subtree, not just the target's own column.
    // Delegated to the shared pure helper so the panel's disabled state and the
    // guard can never disagree. `respecAllowed` is total — it validates every
    // rewritten spec and returns false rather than throwing — which also covers
    // the actor-killing hazard `canAddStudy` guards (a throwing guard kills the
    // actor, and the `>= 2` pre-check does not cover the registry's max).
    canSetStudyParam: ({ context, event }) =>
      event.type === 'series.setStudyParam' &&
      respecAllowed(context, event.id, event.name, event.value),
    // The chain toggle — delegated to the shared pure helper so the panel's
    // disabled state and the guard can never disagree.
    canToggleLink: ({ context, event }) => {
      if (event.type !== 'axis.toggleLink') return false;
      const row = context.rows.find((r) => r.configs.some((c) => c.id === event.id));
      return !!row && linkToggleAllowed(row.configs, event.id);
    },
    // The ⇄ — delegated to the shared pure helper, like the chain.
    canMoveAxis: ({ context, event }) => {
      if (event.type !== 'axis.moveTo') return false;
      const row = context.rows.find((r) => r.configs.some((c) => c.id === event.id));
      return !!row && axisMoveAllowed(row.configs, event.id, event.axisGroup);
    },
    canSwapSide: ({ context, event }) => {
      if (event.type !== 'axis.swapSide') return false;
      const row = context.rows.find((r) => r.configs.some((c) => c.id === event.memberId));
      return !!row && swapAllowed(row.configs, event.memberId);
    },
    // A manual range must be a real, ordered interval (the panel's fields can
    // transiently hold anything).
    canSetAxisRange: ({ event }) =>
      event.type === 'axis.setRange' &&
      Number.isFinite(event.min) &&
      Number.isFinite(event.max) &&
      event.min < event.max,
    // A cross-row move needs the target row to exist, to not already be the
    // series' row, and to have axes for EVERY travelling config (the series plus
    // any studies layered on it — each may carry a different unit). Same policy as
    // Add, folded across the set by `placeOnRow`.
    canMoveToRow: ({ context, event }) => {
      if (event.type !== 'series.moveToRow') return false;
      const from = context.rows.find((r) => r.configs.some((c) => c.id === event.id));
      const to = context.rows.find((r) => r.id === event.rowId);
      if (!from || !to || from.id === to.id) return false;
      const travelling = layeredOn(from.configs, event.id, isCatalogColumn(context));
      const movers = from.configs.filter((c) => travelling.has(c.id));
      return placeOnRow(to.configs, movers) !== null;
    },
  },
  actions: {
    addStudy: assign({
      rows: ({ context, event }) => {
        if (event.type !== 'series.addStudy') return context.rows;
        const target = flatConfigs(context.rows).find((c) => c.id === event.targetId);
        if (!target) return context.rows;
        // Every assigner in this `assign` sees the SAME pre-update context, so
        // the id minted here and the one `expanded`/`cfgSeq` compute below all
        // agree without threading a value between them.
        const cfg = studyConfig(target, event.op, event.period, mintId(context.cfgSeq));
        // Overlay on the target's row (own-row oscillators are a later step),
        // inserted directly IN FRONT of its target — the list is front→back, so
        // that's the target's own index. A study must read over its source (see
        // `studyConfig`); appending would bury it at the very back.
        return context.rows.map((r) => {
          const at = r.configs.findIndex((c) => c.id === target.id);
          return at < 0 ? r : { ...r, configs: reindex([...r.configs, cfg], r.configs.length, at) };
        });
      },
      // Expand the new study so its controls (period, colour) open for tuning.
      expanded: ({ context, event }) => {
        if (event.type !== 'series.addStudy') return context.expanded;
        const target = flatConfigs(context.rows).find((c) => c.id === event.targetId);
        return target ? mintId(context.cfgSeq) : context.expanded;
      },
      cfgSeq: ({ context, event }) => {
        if (event.type !== 'series.addStudy') return context.cfgSeq;
        return flatConfigs(context.rows).some((c) => c.id === event.targetId)
          ? context.cfgSeq + 1
          : context.cfgSeq;
      },
    }),
    addPair: assign({
      rows: ({ context, event }) => {
        if (event.type !== 'series.addPair') return context.rows;
        const a = resolveLeg(context, event.a.metricId);
        const b = resolveLeg(context, event.b.metricId);
        if (!a || !b) return context.rows;
        // A named row is the user pointing at one (the per-row `+Pair`), so it
        // beats the leg-A default outright — including its "in front of leg A"
        // placement, which is a guess about where the spread belongs.
        const asked = event.rowId ? context.rows.find((r) => r.id === event.rowId) : undefined;
        // A named row that doesn't exist is a REFUSAL, not a reason to fall
        // back to leg A's row — `pairSeats` says so, and the two must agree
        // even where the guard makes it unreachable (PR #142 review, LOW).
        if (event.rowId && !asked) return context.rows;
        const seat = asked ? undefined : legSeat(context, event.a.metricId);
        const seatedAt = seat && context.rows.find((r) => r.configs.some((c) => c.id === seat.id));
        const row = asked ?? seatedAt ?? rowForSource(context.rows, a.source);
        if (!row) return context.rows;

        // UNJOINED: seat the two LEGS, never a spread. `Unjoined` is a
        // first-class fn() choice (Peter, 2026-08-18), so two lines under one
        // pair no longer means adding a transform you did not want and taking
        // it straight off again.
        if (event.op === 'none') {
          const plan = planAddGroup(context, event, row);
          if (!plan) return context.rows;
          const tag = new Map(plan.adopt.map((x) => [x.id, x.group]));
          return context.rows.map((r) => ({
            ...r,
            configs: (r.id === row.id ? [...plan.create, ...r.configs] : r.configs).map((c) => {
              const group = tag.get(c.id);
              return group ? { ...c, group } : c;
            }),
          }));
        }
        // No axis seating: the spread arrives UNLINKED on its own right-side
        // axis (pairConfig), binding no unit — the old `axisForAdd` dance (and
        // its guard/action-agreement hazard, PR #128) retires with it.
        const cfg = pairConfig(
          a,
          event.a,
          b,
          event.b,
          event.op as PairOp, // 'none' returned above
          mintId(context.cfgSeq),
          unitOfColumn(context),
          context.palette,
          flatConfigs(context.rows).map((c) => c.color),
        );
        // In front of leg A when it is seated — the spread is the signal and
        // must read over its legs (a study's insertion rule). An UNSEATED leg
        // adds nothing: the spread lands alone at the front of A's source row.
        if (seatedAt) {
          return context.rows.map((r) => {
            const at = r.configs.findIndex((c) => c.id === seat!.id);
            return at < 0
              ? r
              : { ...r, configs: reindex([...r.configs, cfg], r.configs.length, at) };
          });
        }
        return context.rows.map((r) =>
          r.id === row.id ? { ...r, configs: [cfg, ...r.configs] } : r,
        );
      },
      // Expand the new node so its controls open for tuning — the spread, or
      // (unjoined) whichever leg took the group's first minted id. Nothing to
      // expand when BOTH legs were adopted: no config was created.
      expanded: ({ context, event }) => {
        if (event.type !== 'series.addPair' || !pairSeats(context, event)) return context.expanded;
        if (event.op !== 'none') return mintId(context.cfgSeq);
        const row = pairRow(context, event)!;
        return planAddGroup(context, event, row)?.create[0]?.id ?? context.expanded;
      },
      // A joined add consumes one id. An UNJOINED one consumes the group's key
      // plus whatever legs it had to create.
      cfgSeq: ({ context, event }) => {
        if (event.type !== 'series.addPair' || !pairSeats(context, event)) return context.cfgSeq;
        if (event.op !== 'none') return context.cfgSeq + 1;
        const row = pairRow(context, event)!;
        return context.cfgSeq + 1 + (planAddGroup(context, event, row)?.mints ?? 0);
      },
    }),
    // A period change re-specs the study AND everything built on it — the guard
    // has already proved the whole rewrite is coherent. Nothing is removed and
    // no pointer moves: every config keeps its identity, so selection,
    // expansion, ink, axis membership and range pins all survive (they used to
    // be destroyed, and the dependents deleted outright).
    setStudyParam: assign({
      rows: ({ context, event }) => {
        if (event.type !== 'series.setStudyParam') return context.rows;
        const target = flatConfigs(context.rows).find((c) => c.id === event.id);
        if (!target?.derive) return context.rows;
        return applyRespec(context, event.id, respecParam(target, event.name, event.value));
      },
    }),
    addSeries: assign({
      rows: ({ context, event }) => {
        if (event.type !== 'series.add') return context.rows;
        const entry = context.catalog.find((e) => e.id === event.catalogId);
        const row = event.rowId
          ? context.rows.find((r) => r.id === event.rowId)
          : rowForSource(context.rows, entry?.source ?? '');
        if (!entry || !row) return context.rows;
        const axis = axisForAdd(members(row.configs), entry.unit, entry.axis) ?? entry.axis;
        const cfg = toConfig(entry, mintId(context.cfgSeq), axis);
        // A metric may now be added twice (see `canAdd`), and the second copy
        // would otherwise arrive in the first's colour — two identical lines,
        // identically labelled, exactly on top of each other, which reads as a
        // no-op rather than as the thing you just asked for. Take a free palette
        // key instead, the same rule a splitting pair's leg B follows.
        if (row.configs.some((c) => c.color === cfg.color)) {
          cfg.color = freeColor(row.configs, cfg.color, context.palette);
        }
        // PREPEND: the list is front→back, so a freshly added metric lands on top
        // where the user can see what they just asked for (appending would bury it
        // behind everything already on the row).
        return context.rows.map((r) =>
          r.id === row.id ? { ...r, configs: [cfg, ...r.configs] } : r,
        );
      },
      // Expand the freshly added series so its controls open for immediate
      // tuning — at its MINTED id, not the catalog id it was added from. This is
      // a control-panel expansion, not the app selection: the emphasised series
      // survives the add.
      expanded: ({ context, event }) =>
        event.type === 'series.add' ? mintId(context.cfgSeq) : null,
      cfgSeq: ({ context, event }) =>
        event.type === 'series.add' ? context.cfgSeq + 1 : context.cfgSeq,
    }),
    toggleGroupVisible: assign({
      rows: ({ context, event }) => {
        if (event.type !== 'group.toggleVisible') return context.rows;
        const members = groupMembers(flatConfigs(context.rows), event.groupId);
        const hidden = !members.some((m) => m.group?.hidden);
        return context.rows.map((r) => ({
          ...r,
          configs: r.configs.map((c) =>
            c.group?.id === event.groupId ? { ...c, group: { ...c.group, hidden } } : c,
          ),
        }));
      },
    }),
    removeGroup: assign({
      rows: ({ context, event }) => {
        if (event.type !== 'group.remove') return context.rows;
        const doomed = groupDoomed(context.rows, event.groupId);
        const mapped = context.rows.map((r) => ({
          ...r,
          configs: r.configs.filter((c) => !doomed.has(c.id)),
        }));
        return mapped.some((r) => r.configs.length === 0) && mapped.length > 1
          ? mapped.filter((r) => r.configs.length > 0)
          : mapped;
      },
      // The same invariant `removeSeries` states: neither pointer may point at a
      // removed series. Sibling assigners read the PRE-update context, so both
      // recompute the doomed set rather than reading the new rows (PR #149
      // review, LOW).
      selected: ({ context, event }) =>
        event.type === 'group.remove' &&
        context.selected != null &&
        groupDoomed(context.rows, event.groupId).has(context.selected)
          ? null
          : context.selected,
      expanded: ({ context, event }) =>
        event.type === 'group.remove' &&
        context.expanded != null &&
        groupDoomed(context.rows, event.groupId).has(context.expanded)
          ? null
          : context.expanded,
    }),
    moveAxis: assign({
      rows: ({ context, event }) => {
        if (event.type !== 'axis.moveTo') return context.rows;
        return context.rows.map((r) => ({
          ...r,
          configs: r.configs.map((c) =>
            c.id === event.id ? { ...c, axisGroup: event.axisGroup } : c,
          ),
        }));
      },
      /**
       * `moveRange`'s invariant, which every other axis op honours: an id's
       * range entry describes the axis occupying that id NOW, or there is no
       * entry. This one moves a MEMBER between axes rather than moving an axis,
       * so it is the two ends that matter, not a single hand-off:
       *
       * - the source id is cleaned only if the mover was its LAST member;
       * - an arriving member joins an EXISTING axis untouched — that axis's pin
       *   is still true of it;
       * - forming a NEW axis carries the mover's own pin when it vacated one,
       *   and otherwise starts CLEAN, because a stale id going live must never
       *   inherit whatever scale used to sit there (PR #133/#135 reviews).
       */
      axisRanges: ({ context, event }) => {
        if (event.type !== 'axis.moveTo') return context.axisRanges;
        const row = context.rows.find((r) => r.configs.some((x) => x.id === event.id));
        const c = row?.configs.find((x) => x.id === event.id);
        if (!row || !c) return context.axisRanges;
        const from = configAxisId(row.id, c);
        const to = configAxisId(row.id, { axis: c.axis, axisGroup: event.axisGroup });
        if (from === to) return context.axisRanges;
        const others = row.configs.filter((x) => x.id !== c.id);
        const sourceKeeps = others.some((x) => configAxisId(row.id, x) === from);
        const destHas = others.some((x) => configAxisId(row.id, x) === to);
        const next = { ...context.axisRanges };
        if (!sourceKeeps) delete next[from];
        if (!destHas) {
          const carried = sourceKeeps ? undefined : context.axisRanges[from];
          if (carried) next[to] = carried;
          else delete next[to];
        }
        return next;
      },
    }),
    removeSeries: assign({
      rows: ({ context, event }) => {
        if (event.type !== 'series.remove') return context.rows;
        // Cascade to dependent studies so a nested study can't strand invisible +
        // unremovable when its source study is removed.
        const doomed = derivedClosure(flatConfigs(context.rows), event.id);
        // Removing one leg of a group leaves the other standing ALONE, which is
        // no longer a pair — it becomes an ordinary metric rather than a
        // one-legged group nothing can re-join.
        const orphaned = new Set(
          flatConfigs(context.rows)
            .filter((c) => c.group && doomed.has(c.id))
            .map((c) => c.group!.id),
        );
        const mapped = context.rows.map((r) => ({
          ...r,
          configs: r.configs
            .filter((c) => !doomed.has(c.id))
            .map((c) => (c.group && orphaned.has(c.group.id) ? { ...c, group: undefined } : c)),
        }));
        // Removing a row's last metric removes the row (the control-panel spec: no empty
        // rows) — keep at least one.
        const host = context.rows.find((r) => r.configs.some((c) => c.id === event.id));
        const hostNow = host && mapped.find((r) => r.id === host.id);
        return hostNow && hostNow.configs.length === 0 && mapped.length > 1
          ? mapped.filter((r) => r.id !== host!.id)
          : mapped;
      },
      // Neither pointer may point at a removed series (or a cascaded dependent).
      selected: ({ context, event }) =>
        event.type === 'series.remove' &&
        context.selected != null &&
        derivedClosure(flatConfigs(context.rows), event.id).has(context.selected)
          ? null
          : context.selected,
      expanded: ({ context, event }) =>
        event.type === 'series.remove' &&
        context.expanded != null &&
        derivedClosure(flatConfigs(context.rows), event.id).has(context.expanded)
          ? null
          : context.expanded,
    }),
    // Draw order within a row: `order` steps (front/up/down/back) and `reindex`
    // (a drag's absolute drop). Both splice-move within the series' own row; the
    // list is front→back, so index 0 is topmost on the canvas.
    orderSeries: assign({
      rows: ({ context, event }) => {
        if (event.type !== 'series.order' && event.type !== 'series.reindex') return context.rows;
        return context.rows.map((r) => {
          if (!r.configs.some((c) => c.id === event.id)) return r;
          // Order is over BLOCKS (a metric with its studies) — the unit the
          // control tree shows and the user therefore aims at. `index` on a
          // reindex is a block index for the same reason: the panel lists
          // roots, so the slot the user dropped on IS the block.
          const blocks = rowBlocks(r.configs);
          const i = blocks.findIndex((b) => b.some((c) => c.id === event.id));
          if (i < 0) return r;
          const to =
            event.type === 'series.order'
              ? orderTarget(i, blocks.length, event.to)
              : Math.max(0, Math.min(event.index, blocks.length - 1));
          return to === i ? r : { ...r, configs: reindex(blocks, i, to).flat() };
        });
      },
    }),
    // Cross-row move: the series leaves its row (pruned if that empties it, as
    // with remove) and lands at the FRONT of the target row, on an axis its unit
    // can take there (the guard already proved one exists). Studies layered on it
    // travel with it, so a study can't strand on a row without its source.
    moveSeriesToRow: assign({
      rows: ({ context, event }) => {
        if (event.type !== 'series.moveToRow') return context.rows;
        const from = context.rows.find((r) => r.configs.some((c) => c.id === event.id));
        const to = context.rows.find((r) => r.id === event.rowId);
        if (!from || !to || from.id === to.id) return context.rows;
        const travelling = layeredOn(from.configs, event.id, isCatalogColumn(context));
        const moving = from.configs.filter((c) => travelling.has(c.id));
        const movingIds = new Set(moving.map((c) => c.id));
        // All-or-nothing placement (the guard already proved it fits; bail rather
        // than half-move if it somehow doesn't).
        const placed = placeOnRow(to.configs, moving);
        if (!placed) return context.rows;
        const mapped = context.rows.map((r) => {
          if (r.id === from.id)
            return { ...r, configs: r.configs.filter((c) => !movingIds.has(c.id)) };
          if (r.id === to.id) return { ...r, configs: [...placed, ...r.configs] };
          return r;
        });
        // An emptied source row goes away (the control-panel spec: no empty rows) —
        // keep at least one.
        const emptied = mapped.find((r) => r.id === from.id && r.configs.length === 0);
        return emptied && mapped.length > 1 ? mapped.filter((r) => r.id !== from.id) : mapped;
      },
    }),
    patchSeries: assign({
      rows: ({ context, event }) =>
        event.type === 'series.patch'
          ? context.rows.map((r) => ({
              ...r,
              configs: r.configs.map((c) => (c.id === event.id ? { ...c, ...event.patch } : c)),
            }))
          : context.rows,
    }),
    toggleVisible: assign({
      rows: ({ context, event }) => {
        if (event.type !== 'series.toggleVisible') return context.rows;
        const target = flatConfigs(context.rows).find((c) => c.id === event.id);
        if (!target) return context.rows;
        const next = !target.visible;
        // Hiding a metric hides what is BUILT ON it (Peter, 2026-09-12): a
        // `Price · MACD` left drawing over a hidden Price read as the eye not
        // working. `layeredOn` is the same set a cross-row move carries, which
        // is the right one — studies only, never a derived catalog metric that
        // merely happens to read the same column.
        //
        // It WRITES each study's `visible` rather than gating on the parent,
        // and that is the difference that matters: a gate would make the
        // parent's state final, where the point is that you can then click a
        // study back on underneath a hidden parent. The cost is that showing a
        // parent also shows a study you had hidden individually — the opposite
        // trade from the pair eye, which keeps each leg's own state behind a
        // separate `group.hidden` flag. A pair's legs are peers; a study is
        // subordinate, so following its parent is the better default.
        const row = context.rows.find((r) => r.configs.some((c) => c.id === event.id));
        const cascade = row
          ? studiesOn(row.configs, event.id, isCatalogColumn(context))
          : new Set<string>();
        return context.rows.map((r) => ({
          ...r,
          configs: r.configs.map((c) => (cascade.has(c.id) ? { ...c, visible: next } : c)),
        }));
      },
      // A hidden series can't stay emphasised/expanded — its legend chip is gone,
      // so nothing could re-select it and the chart would strand others dimmed.
      // The SAME cascade as `rows`: hiding a metric hides its studies, and a
      // study that was the selected/expanded one goes with it (#182 re-cut
      // review, M1 — the pointers used to clear on `event.id` alone, leaving a
      // hidden study selected and expanded in the panel).
      selected: ({ context, event }) =>
        event.type === 'series.toggleVisible' && hidesPointer(context, event.id, context.selected)
          ? null
          : context.selected,
      expanded: ({ context, event }) =>
        event.type === 'series.toggleVisible' && hidesPointer(context, event.id, context.expanded)
          ? null
          : context.expanded,
    }),
    setSelected: assign({
      selected: ({ event }) => (event.type === 'select' ? event.id : null),
    }),
    setExpanded: assign({
      expanded: ({ event }) => (event.type === 'expand' ? event.id : null),
    }),
    openControls: assign({ controlsOpen: true }),
    // Closing the panel drops the expansion (emphasis falls back to the app
    // selection) and prunes any empty row left by a "+ Add row" — keep ≥1.
    closeControls: assign({
      controlsOpen: false,
      expanded: null,
      rows: ({ context }) => {
        const nonEmpty = context.rows.filter((r) => r.configs.length > 0);
        return nonEmpty.length ? nonEmpty : context.rows.slice(0, 1);
      },
    }),
    applyPreset: assign({
      rows: ({ context, event }) => {
        if (event.type !== 'preset.select') return context.rows;
        const p = context.presets[event.slot];
        // A preset saved before the invariant existed can carry a stack with no
        // remainder row, which would reproduce the stuck-seam bug on apply.
        return p ? withRemainder(cloneRows(p.rows)) : context.rows;
      },
      // The applied rows are a fresh config — neither pointer necessarily survives.
      selected: null,
      expanded: null,
      // A preset restores MINTED ids, so BOTH counters must move above them or
      // the next add would hand out an id the applied preset already occupies —
      // two configs (or two rows) sharing one identity. The row counter has the
      // same hole and it predates the config one (PR #139 review, MEDIUM):
      // duplicate row ids collide in `setRowHeights`, in `configAxisId`, and in
      // every find-by-rowId.
      cfgSeq: ({ context, event }) => {
        const p = event.type === 'preset.select' ? context.presets[event.slot] : null;
        return p ? Math.max(context.cfgSeq, cfgSeqAfter(p.rows)) : context.cfgSeq;
      },
      rowSeq: ({ context, event }) => {
        const p = event.type === 'preset.select' ? context.presets[event.slot] : null;
        return p ? Math.max(context.rowSeq, rowSeqAfter(p.rows)) : context.rowSeq;
      },
      // Presets are COMPOSITION; per-axis ranges are ARRANGEMENT and aren't
      // saved in them (yet — TDL-VIEWS serializes both). Reset rather than
      // leak: a manual range pinned under different rows reads as a broken
      // chart with no visible cause. Membership (`axisGroup`) DOES restore — it
      // lives on the configs.
      axisRanges: ({ context, event }) =>
        event.type === 'preset.select' && context.presets[event.slot] ? {} : context.axisRanges,
    }),
    savePreset: assign({
      presets: ({ context, event }) => {
        if (event.type !== 'preset.save') return context.presets;
        const next = context.presets.slice();
        next[event.slot] = { rows: cloneRows(context.rows) };
        context.storage.savePresets(next);
        return next;
      },
    }),
    setRowHeights: assign({
      rows: ({ context, event }) =>
        event.type === 'layout.setRowHeights'
          ? // `withRemainder` because a commit is a full height map: a drag that
            // gave every row a fixed height would strand the stack with nothing
            // to absorb slack, which is the state the seam gets stuck in.
            withRemainder(
              context.rows.map((r) => ({ ...r, height: event.heights[r.id] ?? r.height })),
            )
          : context.rows,
    }),
    addRow: assign({
      rows: ({ context }) =>
        withRemainder([
          ...context.rows,
          { id: mintRowId(context.rowSeq), height: NEW_ROW_HEIGHT, configs: [] },
        ]),
      rowSeq: ({ context }) => context.rowSeq + 1,
    }),
    toggleAxisLink: assign({
      rows: ({ context, event }) =>
        event.type === 'axis.toggleLink'
          ? context.rows.map((r) =>
              r.configs.some((c) => c.id === event.id)
                ? { ...r, configs: toggleLink(r.configs, event.id) }
                : r,
            )
          : context.rows,
      // Membership changes which axis ids EXIST, so the pins follow (see
      // `moveRange`'s invariant).
      axisRanges: ({ context, event }) => {
        if (event.type !== 'axis.toggleLink') return context.axisRanges;
        const row = context.rows.find((r) => r.configs.some((c) => c.id === event.id));
        const c = row?.configs.find((x) => x.id === event.id);
        if (!row || !c) return context.axisRanges;
        const sharedId = sharedAxisId(row.id, c.axis);
        const ownId = seriesAxisId(row.id, c.axis, c.id);
        const sideShared = row.configs.filter(
          (x) => x.id !== c.id && !x.axisGroup && x.axis === c.axis,
        );
        if (!c.axisGroup) {
          // UNLINK. Alone, the shared axis CEASES — same single-member scale,
          // new id, so its pin travels. With company it persists and keeps
          // its pin, while the fresh own axis starts clean.
          return moveRange(context.axisRanges, ownId, sideShared.length ? undefined : sharedId);
        }
        // JOIN. This own axis ceases; its pin does not follow — it is joining
        // a scale that owns its own range.
        const next = { ...context.axisRanges };
        delete next[ownId];
        if (sideShared.length === 0) {
          // A MERGE forms a new shared scale here out of the same-unit lone
          // axes: every one of them ceases, and the destination starts clean.
          for (const x of row.configs)
            if (x.axisGroup && x.axis === c.axis && (x.unit ?? '') === (c.unit ?? ''))
              delete next[seriesAxisId(row.id, x.axis, x.id)];
          delete next[sharedId];
        }
        return next;
      },
    }),
    // ⇄: the whole axis changes side — every member flips together, so the
    // scale keeps its membership and only its gutter moves.
    swapAxisSide: assign({
      rows: ({ context, event }) => {
        if (event.type !== 'axis.swapSide') return context.rows;
        const row = context.rows.find((r) => r.configs.some((c) => c.id === event.memberId));
        if (!row) return context.rows;
        const moving = new Set(axisMembers(row.configs, event.memberId).map((c) => c.id));
        return context.rows.map((r) =>
          r.id !== row.id
            ? r
            : {
                ...r,
                configs: r.configs.map((c) =>
                  moving.has(c.id) ? { ...c, axis: c.axis === 'R' ? 'L' : ('R' as SeriesAxis) } : c,
                ),
              },
        );
      },
      // The axis id embeds the side, so a swap RE-KEYS the range state — a
      // pin belongs to the scale, not to the gutter it happens to occupy.
      axisRanges: ({ context, event }) => {
        if (event.type !== 'axis.swapSide') return context.axisRanges;
        const row = context.rows.find((r) => r.configs.some((c) => c.id === event.memberId));
        const member = row?.configs.find((c) => c.id === event.memberId);
        if (!row || !member) return context.axisRanges;
        const from = configAxisId(row.id, member);
        const to = configAxisId(row.id, { ...member, axis: member.axis === 'R' ? 'L' : 'R' });
        // BOTH ends move, always — see `moveRange`'s invariant (an arriving
        // axis with no pin CLEARS its destination rather than inheriting a
        // stale one; PR #135 review, MEDIUM).
        return moveRange(context.axisRanges, to, from);
      },
    }),
    setAxisRange: assign({
      axisRanges: ({ context, event }) =>
        event.type === 'axis.setRange'
          ? {
              ...context.axisRanges,
              [event.axisId]: {
                // CARRY THE LOCKS. A pin sets the manual range; it does not
                // repeal the axis's hard limits. Rebuilding the entry from
                // scratch here silently dropped a bar's zero floor on the first
                // gesture, so the floor held for exactly one wheel notch and
                // drifted from then on.
                ...context.axisRanges[event.axisId],
                mode: 'manual' as const,
                min: event.min,
                max: event.max,
                unit: event.unit,
              },
            }
          : context.axisRanges,
    }),
    // Hard bound locks. Replacement semantics (see the event): the pair given
    // IS the axis's locks afterwards. Returns the SAME map when nothing changed,
    // because the host re-seeds these from a membership signature and an
    // identity change there would loop the memoized chart.
    setAxisLocks: assign({
      axisRanges: ({ context, event }) => {
        if (event.type !== 'axis.setLocks') return context.axisRanges;
        const cur = context.axisRanges[event.axisId];
        if (cur?.lockMin === event.lockMin && cur?.lockMax === event.lockMax)
          return context.axisRanges;
        const next: AxisRange = {
          mode: cur?.mode ?? 'auto',
          min: cur?.min,
          max: cur?.max,
          unit: cur?.unit ?? event.unit,
          lockMin: event.lockMin,
          lockMax: event.lockMax,
          autoBasis: cur?.autoBasis,
          centerZero: cur?.centerZero,
          precision: cur?.precision,
          scaleType: cur?.scaleType,
        };
        // An entry holding neither a lock nor a pin nor a memory says nothing —
        // drop it rather than accumulate empties keyed by every axis ever seen.
        if (axisRangeIsEmpty(next)) {
          if (!cur) return context.axisRanges;
          const { [event.axisId]: _drop, ...rest } = context.axisRanges;
          return rest;
        }
        return { ...context.axisRanges, [event.axisId]: next };
      },
    }),
    setAxisAutoOpts: assign({
      axisRanges: ({ context, event }) => {
        if (event.type !== 'axis.setAutoOpts') return context.axisRanges;
        const cur = context.axisRanges[event.axisId];
        // Store only what differs from the defaults, so an untouched axis keeps
        // no entry at all and a preset round-trips to the same shape.
        const autoBasis = event.autoBasis === 'metric' ? ('metric' as const) : undefined;
        const centerZero = event.centerZero ? true : undefined;
        if (cur?.autoBasis === autoBasis && cur?.centerZero === centerZero)
          return context.axisRanges;
        const next: AxisRange = {
          mode: cur?.mode ?? 'auto',
          min: cur?.min,
          max: cur?.max,
          unit: cur?.unit ?? event.unit,
          lockMin: cur?.lockMin,
          lockMax: cur?.lockMax,
          autoBasis,
          centerZero,
          precision: cur?.precision,
          scaleType: cur?.scaleType,
        };
        if (axisRangeIsEmpty(next)) {
          if (!cur) return context.axisRanges;
          const { [event.axisId]: _drop, ...rest } = context.axisRanges;
          return rest;
        }
        return { ...context.axisRanges, [event.axisId]: next };
      },
    }),
    setAxisFormat: assign({
      axisRanges: ({ context, event }) => {
        if (event.type !== 'axis.setFormat') return context.axisRanges;
        const cur = context.axisRanges[event.axisId];
        // Clamp to the offered 0–4, and refuse anything that is not one of them:
        // `NaN` used to pass the clamp untouched and reach
        // `Intl.NumberFormat({ maximumFractionDigits: NaN })`, which throws (PR
        // #173 review).
        const precision =
          event.precision === undefined || !Number.isInteger(event.precision)
            ? undefined
            : Math.max(0, Math.min(4, event.precision));
        const scaleType = event.scaleType === 'log' ? ('log' as const) : undefined;
        // Belt and braces behind the panel's own guard, using the SAME rule the
        // panel greys the control with — a log axis cannot reach zero, so never
        // store the pair even if something asks for it.
        const scale = logAllowed(cur)[0] ? scaleType : undefined;
        if (cur?.precision === precision && cur?.scaleType === scale) return context.axisRanges;
        const next: AxisRange = {
          mode: cur?.mode ?? 'auto',
          min: cur?.min,
          max: cur?.max,
          unit: cur?.unit ?? event.unit,
          lockMin: cur?.lockMin,
          lockMax: cur?.lockMax,
          autoBasis: cur?.autoBasis,
          centerZero: cur?.centerZero,
          precision,
          scaleType: scale,
        };
        if (axisRangeIsEmpty(next)) {
          if (!cur) return context.axisRanges;
          const { [event.axisId]: _drop, ...rest } = context.axisRanges;
          return rest;
        }
        return { ...context.axisRanges, [event.axisId]: next };
      },
    }),
    // Back to auto KEEPS the values (the preserved-manual memory) — a later
    // re-manual restores them. A never-touched axis has no entry to flip.
    setAxisAuto: assign({
      axisRanges: ({ context, event }) => {
        if (event.type !== 'axis.setAuto') return context.axisRanges;
        const cur = context.axisRanges[event.axisId];
        if (!cur || cur.mode === 'auto') return context.axisRanges;
        return { ...context.axisRanges, [event.axisId]: { ...cur, mode: 'auto' as const } };
      },
    }),
    removeRow: assign({
      rows: ({ context, event }) =>
        event.type === 'row.remove' && context.rows.length > 1
          ? // Removing the remainder row would leave the stack with none, so the
            // first survivor takes over as the one that absorbs slack.
            withRemainder(context.rows.filter((r) => r.id !== event.id))
          : context.rows,
      // Removing a row drops its series for good, so a pointer into it can't return
      // (unlike a ticker switch) — clear both (mirrors removeSeries).
      selected: ({ context, event }) => {
        if (event.type !== 'row.remove' || context.rows.length <= 1) return context.selected;
        const row = context.rows.find((r) => r.id === event.id);
        return row?.configs.some((c) => c.id === context.selected) ? null : context.selected;
      },
      expanded: ({ context, event }) => {
        if (event.type !== 'row.remove' || context.rows.length <= 1) return context.expanded;
        const row = context.rows.find((r) => r.id === event.id);
        return row?.configs.some((c) => c.id === context.expanded) ? null : context.expanded;
      },
    }),
  },
}).createMachine({
  id: 'terminal',
  context: ({ input }) => ({
    // Seeded rows go through the invariant too. The host builds them (and on a
    // reload re-seeds from the stored ACTIVE preset), so a blob written before
    // `withRemainder` existed — or any future host that forgets — would boot
    // straight into the stuck-seam state rather than being healed on first edit.
    rows: withRemainder(input.initialRows),
    palette: input.palette ?? [],
    axisRanges: {},
    rowSeq: input.initialRows.length,
    cfgSeq: cfgSeqAfter(input.initialRows),
    selected: null,
    expanded: null,
    controlsOpen: false,
    presets: input.storage.loadPresets(),
    catalog: input.catalog,
    storage: input.storage,
  }),
  on: {
    'series.add': { guard: 'canAdd', actions: 'addSeries' },
    'series.addStudy': { guard: 'canAddStudy', actions: 'addStudy' },
    'series.addPair': { guard: 'canAddPair', actions: 'addPair' },
    'series.compareAll': {
      actions: enqueueActions(({ context, enqueue }) => {
        // Targets are read from the context as it stands NOW, before any add
        // lands — "pair all visible" means the metrics visible when you asked.
        for (const row of context.rows) {
          for (const c of row.configs) {
            if (!comparableMetric(c)) continue;
            enqueue.raise({
              type: 'series.addPair',
              a: { metricId: c.id, entity: 'primary' },
              b: { metricId: c.id, entity: 'compare' },
              op: 'none',
              rowId: row.id,
            });
          }
        }
      }),
    },
    'series.setStudyParam': { guard: 'canSetStudyParam', actions: 'setStudyParam' },
    'series.order': { actions: 'orderSeries' },
    'series.reindex': { actions: 'orderSeries' },
    'series.moveToRow': { guard: 'canMoveToRow', actions: 'moveSeriesToRow' },
    'series.remove': { actions: 'removeSeries' },
    'series.patch': { actions: 'patchSeries' },
    'series.toggleVisible': { actions: 'toggleVisible' },
    'group.toggleVisible': { actions: 'toggleGroupVisible' },
    'group.remove': { actions: 'removeGroup' },
    select: { actions: 'setSelected' },
    expand: { actions: 'setExpanded' },
    'controls.open': { actions: 'openControls' },
    'controls.close': { actions: 'closeControls' },
    'preset.select': { actions: 'applyPreset' },
    'preset.save': { actions: 'savePreset' },
    'layout.setRowHeights': { actions: 'setRowHeights' },
    'row.add': { guard: 'canAddRow', actions: 'addRow' },
    'row.remove': { actions: 'removeRow' },
    'axis.toggleLink': { guard: 'canToggleLink', actions: 'toggleAxisLink' },
    'axis.swapSide': { guard: 'canSwapSide', actions: 'swapAxisSide' },
    'axis.moveTo': { guard: 'canMoveAxis', actions: 'moveAxis' },
    'axis.setLocks': { actions: 'setAxisLocks' },
    'axis.setAutoOpts': { actions: 'setAxisAutoOpts' },
    'axis.setFormat': { actions: 'setAxisFormat' },
    'axis.setRange': { guard: 'canSetAxisRange', actions: 'setAxisRange' },
    'axis.setAuto': { actions: 'setAxisAuto' },
  },
});
