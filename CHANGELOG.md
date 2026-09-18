# Changelog

All packages release together on one version.

## Unreleased

- **The pond family floors at `^0.70.0`** (`@pond-ts/process` exact `0.70.0`), and
  `@pond-ts/react` is named as `@tidal-ts/chart`'s peer — charts 0.70 peers on
  it and a consumer that did not install it got the family split across two
  versions. **`<BandChart sessionBreaks>`** shipped in 0.70.0 with the line's
  semantics, so a band breaks at the session seams natively and the chart's
  one-wash-per-segment workaround from 0.2.0 is gone; `sliceBySegments` stays
  for `<AreaChart>`, which still has no such prop. Pond's `specId` now judges
  **arity**: a spec with the wrong number of inputs (or none) is a broken id in
  lenient mode and an `ArityError` in strict, where 0.62–0.69 named it valid and
  let it die at `compile` with no code — `isValidSpec` now says `false` for it,
  which is what the terminal's picker wanted all along.
- `@tidal-ts/chart`: **a band's wash and centre line, and a study's line
  outputs, now sit where a plain line does — at the bar's end.** A `line`
  config was drawn on the key-shifted series (a close belongs at its bar's
  end) while `band` and `lines` configs were drawn on the raw one, so a banded
  curve led the plain line beside it by a bar, visibly at every seam. Found by
  the first embedded consumer's review the day after 0.2.0. A study's
  histogram rides on the same series as its lines (a point-keyed bar is
  centred on its key; left behind, a MACD's zero-cross landed a bar left of
  the line-cross), and a `candle` config that has no OHLC to draw falls back
  to a line at the bar's end like any other. Per-segment slices are cut from
  the raw series, shifted after, and cached beside the raw ones.

## 0.2.0 — 2026-09-18

What the second consumer needed. An embedded pane adopting the chart found
three things it already did on raw pond that `TimeSeriesChart` could not
express; they are in the library now, for every consumer.

- `@tidal-ts/chart`: **a fill breaks at the session seams.** `<BandChart>` and
  `<AreaChart>` have no `sessionBreaks` (the prop is `<LineChart>`'s alone), so
  on a collapsing intraday axis a confidence envelope bridged the overnight gap
  its own centre line honoured. The chart now draws one wash per live segment,
  over that segment's slice — `sliceBySegments` in `@tidal-ts/core`, pond's own
  `bisect` + `slice`, nothing materialised — when the axis actually collapses,
  and one layer otherwise. A fill drawn at the bar's END is cut first and shifted
  after: shifted, a session's last close sits exactly on its segment's half-open
  end and would be dropped at every seam. The first embedded consumer had this
  as a per-pane workaround; it belongs in the chart.
- `@tidal-ts/chart`: **`axisOptions` grows three fields a pane needs and a
  terminal does not.** `label` titles the gutter (the curve's name atop its own
  column, with headroom so the top tick clears it); `ticks` pins that many
  ticks at equal fractions of a pinned `[min, max]`, so stacked own-axes put
  their tick rows at the same heights and the one grid reads as everyone's
  (`fractionTicks`); `width` budgets the gutter. One titled axis pads every axis
  on its side, since pond pads both ends and an unequal pad would slide the rows
  apart again; pinned ticks apply to linear scales only. All three absent ⇒
  exactly the 0.1.x rendering.
- `@tidal-ts/chart` has a **workshop**: Storybook on `:6009`, hosting the chart
  from a literal `ChartTheme` with no provider and no stylesheet. Not published
  (the packages ship `dist` only) — it is where a consumer can see what the
  chart needs from a host. It includes a **consumer pane** story: a closed
  eight-curve vocabulary capped at six, one coloured y-axis column per active
  curve, expiry and range controls, and two derived curves — the embedded-pane
  shape, as opposed to the open-ended terminal the chart came out of. The pane
  since grew a confidence envelope under two curves (`style: 'band'` sharing its
  curve's axis), a second row for the relatives with every axis centred on
  zero and a draggable split, and a chart well one step off the pane's ground.
- `@tidal-ts/core` exports **`sliceBySegments`** — a series cut into one
  sub-series per live segment, `[start, end)` on the key, via pond's `bisect`
  and `slice`. Cut before you shift: a key moved to its bar's end sits on the
  segment's half-open end and is dropped.
- `@tidal-ts/terminal`: version bump only (one version across the family).

## 0.1.2 — 2026-09-16

- `@tidal-ts/terminal` takes **`spreadColor`** (`TerminalInput` /
  `TerminalProviderProps`): what a new spread draws in. 0.1.1 gave a spread the
  first free palette key, which in a palette whose hues MEAN something lands on
  a reserved one — the first consumer's amber is its comparison colour. A
  spread is a different kind of line from its legs and only the host knows what
  its palette reserves, so the host names it; absent, the 0.1.1 behaviour
  stands.
- `@tidal-ts/core`, `@tidal-ts/chart`: version bump only.

## 0.1.1 — 2026-09-16

First release through npm trusted publishing (OIDC, no stored token).

- `@tidal-ts/terminal` exports its **axis policy** (`canAddUnit` and friends):
  the predicates a host's menus gate on, the same ones the machine's guards
  enforce. 0.1.0 left them internal, so the first host had to keep its own
  copy to grey out an incompatible metric before the guard refused it.
- `@tidal-ts/chart` exports `hasBarOutput` — whether a config's study draws a
  bar output (a MACD's histogram), which a host's style controls gate on.
- `@tidal-ts/core`: version bump only (one version across the family).

## 0.1.0 — 2026-09-16

First publish, cut out of the Tidal application (`tidal-app/tidal`). **Pre-1.0:
pin an exact version.** The API is expected to move as the second consumer's
needs land.

- `@tidal-ts/core` — the derive/study seam on `@pond-ts/process` (specs,
  content-addressed ids, the fold, the study catalog adoption), the vol schema
  and fixtures, bar windows and auto-window, the columnar wire adapter, session
  and calendar helpers, the display/data time-zone split.
- `@tidal-ts/chart` — `TimeSeriesChart` (multi-row, shared time axis, on
  `@pond-ts/charts`), the series vocabulary (`SeriesConfig`, axis identity and
  ranges), the chart-settings vocabulary, and the prepare step (`foldSources`,
  `sourceFacts`, `assembleRows`, `prepareChart`). Theme, colour resolution and
  settings arrive as props; the package reads no CSS token and carries no CSS.
- `@tidal-ts/terminal` — the terminal statechart (XState v5): rows, series,
  studies, pairs, axis membership and ranges, presets. Config only, never data.
  The host injects its colour palette and, if it wants one, an inspector.
