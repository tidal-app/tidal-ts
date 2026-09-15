import { useCallback, useEffect, type ReactNode } from 'react';
import { createActorContext } from '@xstate/react';
import type { InspectionEvent, Observer } from 'xstate';
import type { DeriveOp, PairOp } from '@tidal-ts/core';
import type { AxisRange, PairLensOp, SeriesConfig } from '@tidal-ts/chart';
import {
  activeSlot,
  terminalMachine,
  type MetricEntry,
  type PairLegInput,
  type PresetStorage,
  type RowState,
  type TerminalPreset,
} from './terminalMachine.js';

/**
 * Private actor context — never exported. Public API is the named hooks below
 * (the read-surface selectors + narrow command senders). The terminal module's
 * barrel re-exports these + the event union; the actor + machine stay private.
 */
const TerminalContext = createActorContext(terminalMachine);

export interface TerminalProviderProps {
  initialRows: RowState[];
  catalog: readonly MetricEntry[];
  storage: PresetStorage;
  /** The colour KEYS the host offers a new series, in the order to hand them
   *  out (a split pair's second leg takes the first one its row is not using).
   *  A host's own vocabulary — palette names its chart resolves, or CSS colours.
   *  Omit to let a new leg keep its pair's colour. */
  palette?: readonly string[];
  /** An XState inspector (`@statelyai/inspect`'s `inspect`, or any observer of
   *  inspection events). The host decides whether and when to attach one; the
   *  machine has no opinion and no build-time flag. */
  inspect?: Observer<InspectionEvent> | ((event: InspectionEvent) => void);
  children: ReactNode;
}

export function TerminalProvider({
  initialRows,
  catalog,
  storage,
  palette,
  inspect,
  children,
}: TerminalProviderProps) {
  return (
    <TerminalContext.Provider
      options={{
        input: { initialRows, catalog, storage, ...(palette ? { palette } : {}) },
        ...(inspect ? { inspect } : {}),
      }}
    >
      <PersistActive storage={storage} />
      {children}
    </TerminalContext.Provider>
  );
}

/** Persists the derived active-slot pointer so a fresh mount (a reload) can
 *  re-seed from the last applied preset (see `seedTerminalRows`). The machine
 *  owns preset *contents*; this is the only writer of the pointer. Renders
 *  nothing. */
function PersistActive({ storage }: { storage: PresetStorage }) {
  const active = useActiveSlot();
  useEffect(() => storage.saveActive(active), [active, storage]);
  return null;
}

// --- Read surface ----------------------------------------------------------

export function useRows(): RowState[] {
  return TerminalContext.useSelector((s) => s.context.rows);
}

export function useSelectedSeries(): string | null {
  return TerminalContext.useSelector((s) => s.context.selected);
}

/** The control-panel expansion (the row whose controls are open) — overrides the
 *  app selection for emphasis while set. Null when nothing is expanded. */
export function useExpandedSeries(): string | null {
  return TerminalContext.useSelector((s) => s.context.expanded);
}

export function useControlsOpen(): boolean {
  return TerminalContext.useSelector((s) => s.context.controlsOpen);
}

/** Which preset slots hold a saved preset (length === PRESET_SLOTS). */
export function usePresetSaved(): boolean[] {
  return TerminalContext.useSelector((s) => s.context.presets.map((p) => p != null));
}

/** The active slot — the saved slot whose rows deep-equal the live rows — or
 *  null (a custom state). Derived, not stored. */
export function useActiveSlot(): number | null {
  return TerminalContext.useSelector((s) => activeSlot(s.context.presets, s.context.rows));
}

/** Per-axis range state, keyed by axis id (`configAxisId`). No entry = an
 *  untouched auto axis; `mode:'auto'` with values = the preserved manual
 *  memory (see the machine's context doc). */
export function useAxisRanges(): Record<string, AxisRange> {
  return TerminalContext.useSelector((s) => s.context.axisRanges);
}

// --- Write surface (narrow commands) ---------------------------------------

export function useAddSeries(): (catalogId: string, rowId?: string) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (catalogId: string, rowId?: string) => ref.send({ type: 'series.add', catalogId, rowId }),
    [ref],
  );
}

/** Add a study (`sma`/`ema` …) of a target series, layered on its row. */
export function useAddStudy(): (targetId: string, op: DeriveOp, period: number) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (targetId: string, op: DeriveOp, period: number) =>
      ref.send({ type: 'series.addStudy', targetId, op, period }),
    [ref],
  );
}

/** Add a pair (A vs B spread — diff/ratio/logRatio) of two metrics, on `rowId`
 *  when given (the per-row `+Pair`), else in front of leg A. */
export function useAddPair(): (
  a: PairLegInput,
  b: PairLegInput,
  op: PairLensOp,
  rowId?: string,
) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (a: PairLegInput, b: PairLegInput, op: PairLensOp, rowId?: string) =>
      ref.send({ type: 'series.addPair', a, b, op, rowId }),
    [ref],
  );
}

/** The bar's bulk compare: pair every visible plain metric against the
 *  comparison, in one gesture. Offer it only when a comparison is named — the
 *  terminal machine cannot see whether one is. */
export function useCompareAll(): () => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(() => ref.send({ type: 'series.compareAll' }), [ref]);
}

export function useSetStudyParam(): (id: string, name: string, value: number) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (id: string, name: string, value: number) =>
      ref.send({ type: 'series.setStudyParam', id, name, value }),
    [ref],
  );
}

/** Step a series' draw order within its row (`front`/`up`/`down`/`back`; the
 *  list is front→back, so `up` moves toward the top of the canvas stack). */
export function useOrderSeries(): (id: string, to: 'front' | 'up' | 'down' | 'back') => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (id: string, to: 'front' | 'up' | 'down' | 'back') =>
      ref.send({ type: 'series.order', id, to }),
    [ref],
  );
}
/** Drop a series at an absolute index in its row (the drag gesture's commit). */
export function useReindexSeries(): (id: string, index: number) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (id: string, index: number) => ref.send({ type: 'series.reindex', id, index }),
    [ref],
  );
}
/** Move a series (with any studies layered on it) to another row. */
export function useMoveSeriesToRow(): (id: string, rowId: string) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (id: string, rowId: string) => ref.send({ type: 'series.moveToRow', id, rowId }),
    [ref],
  );
}

/** Move one member onto another axis on its side (the panel's drag). */
export function useMoveToAxis(): (id: string, axisGroup?: string) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (id: string, axisGroup?: string) => ref.send({ type: 'axis.moveTo', id, axisGroup }),
    [ref],
  );
}

export function useRemoveSeries(): (id: string) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback((id: string) => ref.send({ type: 'series.remove', id }), [ref]);
}

export function usePatchSeries(): (id: string, patch: Partial<SeriesConfig>) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (id: string, patch: Partial<SeriesConfig>) => ref.send({ type: 'series.patch', id, patch }),
    [ref],
  );
}

/** The PAIR's eye — hides both legs, each keeping its own state. */
export function useToggleGroupVisible(): (groupId: string) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (groupId: string) => ref.send({ type: 'group.toggleVisible', groupId }),
    [ref],
  );
}

/** Remove a whole pair — both legs and anything layered on them. */
export function useRemoveGroup(): (groupId: string) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback((groupId: string) => ref.send({ type: 'group.remove', groupId }), [ref]);
}

export function useToggleVisible(): (id: string) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback((id: string) => ref.send({ type: 'series.toggleVisible', id }), [ref]);
}

export function useSelectSeries(): (id: string | null) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback((id: string | null) => ref.send({ type: 'select', id }), [ref]);
}

/** Expand/collapse a control-panel row (null collapses). Distinct from `select`
 *  (the legend/app selection) — expansion is a temporary override. */
export function useExpandSeries(): (id: string | null) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback((id: string | null) => ref.send({ type: 'expand', id }), [ref]);
}

export function useSetControlsOpen(): (open: boolean) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (open: boolean) => ref.send({ type: open ? 'controls.open' : 'controls.close' }),
    [ref],
  );
}

export function useSelectPreset(): (slot: number) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback((slot: number) => ref.send({ type: 'preset.select', slot }), [ref]);
}

export function useSavePreset(): (slot: number) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback((slot: number) => ref.send({ type: 'preset.save', slot }), [ref]);
}

export function useSetRowHeights(): (heights: Record<string, number>) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (heights: Record<string, number>) => ref.send({ type: 'layout.setRowHeights', heights }),
    [ref],
  );
}

/** Toggle a series' axis membership — the panel's chain icon (unlink to its own
 *  axis / unit-gated re-link into the side's shared axis; `linkToggleAllowed`
 *  is the shared gate the panel disables refused toggles with). */
export function useToggleAxisLink(): (id: string) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback((id: string) => ref.send({ type: 'axis.toggleLink', id }), [ref]);
}

/** Pin an axis to `[min, max]` (implies MANUAL). The caller seeds the values —
 *  the preserved memory when it exists, else the current auto fit — and names
 *  the unit the axis reads in (the pin suspends on a unit re-bind). */
export function useSetAxisRange(): (
  axisId: string,
  min: number,
  max: number,
  unit: string,
) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (axisId: string, min: number, max: number, unit: string) =>
      ref.send({ type: 'axis.setRange', axisId, min, max, unit }),
    [ref],
  );
}

/** Move a whole axis (every member) to the other side of its row — the
 *  panel's ⇄. `swapAllowed` is the shared gate the panel disables with. */
export function useSwapAxisSide(): (memberId: string) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback((memberId: string) => ref.send({ type: 'axis.swapSide', memberId }), [ref]);
}

/** REPLACE an axis's hard bound locks (both fields are the new truth — an
 *  omitted one clears that lock). The host derives them; the machine stores. */
export function useSetAxisLocks(): (
  axisId: string,
  lockMin: number | undefined,
  lockMax: number | undefined,
  unit: string,
) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (axisId: string, lockMin: number | undefined, lockMax: number | undefined, unit: string) =>
      ref.send({ type: 'axis.setLocks', axisId, lockMin, lockMax, unit }),
    [ref],
  );
}

/** The AUTO-mode options for an axis: the fit's basis and centre-zero. */
export function useSetAxisAutoOpts(): (
  axisId: string,
  autoBasis: 'metric' | 'viewport',
  centerZero: boolean,
  unit: string,
) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (axisId: string, autoBasis: 'metric' | 'viewport', centerZero: boolean, unit: string) =>
      ref.send({ type: 'axis.setAutoOpts', axisId, autoBasis, centerZero, unit }),
    [ref],
  );
}

/** The axis's tick precision (0-4, or undefined for the unit's default) and
 *  scale type. */
export function useSetAxisFormat(): (
  axisId: string,
  precision: number | undefined,
  scaleType: 'linear' | 'log',
  unit: string,
) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(
    (axisId: string, precision: number | undefined, scaleType: 'linear' | 'log', unit: string) =>
      ref.send({ type: 'axis.setFormat', axisId, precision, scaleType, unit }),
    [ref],
  );
}

/** Flip an axis back to AUTO, keeping its manual values as memory. */
export function useSetAxisAuto(): (axisId: string) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback((axisId: string) => ref.send({ type: 'axis.setAuto', axisId }), [ref]);
}

/** Append an empty row (capped at `MAX_ROWS` by the machine's `canAddRow`). */
export function useAddRow(): () => void {
  const ref = TerminalContext.useActorRef();
  return useCallback(() => ref.send({ type: 'row.add' }), [ref]);
}

/** Remove a row by id (the machine keeps at least one). */
export function useRemoveRow(): (id: string) => void {
  const ref = TerminalContext.useActorRef();
  return useCallback((id: string) => ref.send({ type: 'row.remove', id }), [ref]);
}

/**
 * The 1–5 preset hotkey — opt-in (a library must not grab the host's keyboard
 * uninvited; the host mounts this). Ignored while a form control is focused, and
 * it never `preventDefault`s (digits carry no default outside a field).
 */
export function useTerminalHotkeys(): void {
  const ref = TerminalContext.useActorRef();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= 5) ref.send({ type: 'preset.select', slot: n - 1 });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ref]);
}

export type { RowState, TerminalPreset, MetricEntry, PresetStorage };
