import type { CursorSnap } from '@pond-ts/charts';

/** What the crosshair is snapped to, resolved to **a series this chart drew**.
 *
 *  Everything `CursorSnap` carries, plus the answer the host actually asked
 *  for: which config the reticle is on. */
export interface SeriesSnap extends CursorSnap {
  /** The config `id`. What a host keys emphasis on. */
  readonly id: string;
  /** WHICH layer of that config, when the mark drew more than one — a band's
   *  `lower` / `middle` / `upper`, a candle's `open` / `high` / `low` /
   *  `close`, a split bar's `down` half. Absent for a single-layer mark, which
   *  is most of them. */
  readonly part?: string;
}

/**
 * Resolve a raw `CursorSnap` to the series it belongs to.
 *
 * **Why this is not `snap.label`.** A tracker sample's label is the layer's
 * `as` — which is the config id for a plain line, and is not for anything that
 * draws more than one layer: a band's edges and a candle's four quotes arrive
 * as `"<as> <role>"` composites, and a split bar's falling half draws under
 * `<id>__down`. A host keying on `label === config.id` therefore matches
 * nothing at all on exactly the marks where knowing which layer you are on
 * matters most (PR #15 review). The chart mints every one of those `as` values,
 * so undoing them is the chart's job and not each host's — the same fold every
 * consumer already writes for the tracker path.
 *
 * `null` when the label belongs to no known config: a layer drawn by something
 * else, or a stale snap arriving after the row changed. A host that cannot
 * place a snap should ignore it rather than guess.
 */
export function seriesSnap(snap: CursorSnap, ids: readonly string[]): SeriesSnap | null {
  // LONGEST first: one config id can be a prefix of another, and the shorter
  // would claim the longer's layers.
  let best: string | undefined;
  for (const id of ids) {
    if (!matches(snap.label, id)) continue;
    if (best === undefined || id.length > best.length) best = id;
  }
  if (best === undefined) return null;
  return { ...snap, id: best, ...(part(snap.label, best) ?? {}) };
}

const matches = (label: string, id: string): boolean =>
  label === id || label === `${id}__down` || label.startsWith(`${id} `);

const part = (label: string, id: string): { part: string } | null => {
  if (label === `${id}__down`) return { part: 'down' };
  if (label.length > id.length + 1) return { part: label.slice(id.length + 1) };
  return null;
};
