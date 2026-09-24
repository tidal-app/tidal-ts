# Changelog

All packages release together on one version.

## Unreleased

- **An area can measure from a BASELINE, and draw in parts.** `SeriesConfig`
  takes `baseline?: 'view' | number`, and the difference is whether the anchor
  moves. **`'view'`** is the value of the first point in the viewport — the
  anchor a rebased axis already uses for a comparison — so the area reads as
  the move since the left edge and re-bases as you pan. **A number** is a level
  you put there: drawn as a real horizontal rule (charts' `<Baseline>`),
  labelled by the axis's own formatter, pinned to the axis edge, wearing its own
  area's ink, and **draggable** — the drag reports through
  `onBaselineChange` and the host writes it back, which is what makes the rule
  and the fill one thing rather than two that agree.

  Dragging needs **`editBaselines`**, charts' annotation-edit mode, and that is
  a mode rather than a permanent affordance for a reason worth stating: charts
  suppresses the data cursor while it is on, because the crosshair and a
  draggable mark both want the pointer. So a host turns it on for the moment
  the reader is placing a level — its style panel open on that series, say —
  and off again after. Story `FixedBaseline` has it on, which is why the
  crosshair is missing there.

  It then draws in parts: above the baseline in the rise colour, below it in
  the fall colour, flat rather than graded, with the outline switching hue at
  each crossing. Whether it splits and which colours it uses are the bar's own
  controls (`colorMode` / `riseColor` / `fallColor`), defaulted from a new
  `areas` section in `ChartSettings` — so a host that reserves green and red
  turns it off in one place. An area WITHOUT a baseline never splits: there is
  no above and below for two colours to mean, and the fill rests where the data
  says (`areaBaseline`). Stories `Chart/TimeSeriesChart / BaselinedArea` and
  `BaselinedAreaSingle`.

  **Migration:** `ChartSettings` gains `areas`, which `parseChartSettings`
  defaults for any stored blob written before it existed.

- **The pond family floors at `^0.71.0`** (`@pond-ts/process` exact `0.71.0`),
  and **the cursor is MOUNTED rather than named.** 0.71 removed
  `<ChartContainer cursor>` and the rest of the pre-0.58 cursor props in favour
  of cursor components, and a container with no cursor child now draws **no
  cursor at all** — so `cursor="crosshair"` becoming `<CrosshairCursor />` is
  not a tidy-up, it is the line that keeps the chart's crosshair. It is mounted
  at the container, so it covers every row: the reticle is how a stack is read
  against one time.

  One visible change comes with it: the reticle's **centre dot is drawn in the
  snapped series' colour** rather than the cursor ink, so the cross shows which
  line it is reading.

- **`TimeSeriesChart` takes `onSnap`** — WHICH series the crosshair is on,
  where `onTracker` says what every line reads. It fires only when the snapped
  point **changes**, so it is cheap to hold in state beside a tracker that
  fires on every move, and it is held in a ref internally so an inline callback
  will not re-render the chart under the pointer.

  The snap is **resolved to a config**, not handed over raw: `id` is the
  config's own id and `part` names the layer within it — a band's edge, one of
  a candle's four quotes, a split bar's falling half. The cursor reports those
  as `"<as> <role>"` composites and `<id>__down`, which are this chart's own
  inventions; a host keying on the raw label would match nothing on exactly the
  marks where knowing the layer matters most. `seriesSnap` does the undoing and
  is exported with `SeriesSnap` for a host that reads a raw cursor itself.

  This is the answer to a consumer's oldest open ask. A readout listing one row
  per series could show every value and could not emphasise the one being
  pointed at — the chart drew the dot on it and said nothing about which it
  was. The information never had to leave the library as geometry; it only had
  to leave as a conclusion.

- **An area's fill rests where its data says.** 0.71 made `<AreaChart baseline>`
  default to `0`, which is right for a chart of quantities and wrong for most
  of these axes: vol in percent and prices in dollars live nowhere near zero,
  and pulling zero into an auto-fit domain flattens the shape the reader came
  for. Those keep the pre-0.71 floor, so their rendering is unchanged from
  0.2.1.

  A series with a **negative** reading takes zero, because there the floor is
  actively wrong: skew is signed and the sign is the whole signal, and rested
  on the floor its fill grows as the number rises _towards_ zero — the deepest
  skew drawn as the smallest mark. `areaBaseline` reads the drawn column, so
  nothing chooses it by hand. Story `Chart/TimeSeriesChart / Areas`; the snap
  has `SnapReadout` beside it.

## 0.2.1 — 2026-09-18

The day after 0.2.0. The first embedded consumer's review found a band a bar
ahead of the line beside it, and pond 0.70.0 shipped the same morning with the
`sessionBreaks` the band had been working around. Both are in.

- **The pond family floors at `^0.70.0`** (`@pond-ts/process` exact `0.70.0`), and
  `@pond-ts/react` is named as `@tidal-ts/chart`'s peer. It always was
  `@pond-ts/charts`'s peer; with nothing in this repo naming it, the bump left
  the previously auto-installed 0.69 beside `pond-ts` 0.70 — the family split
  the README warns about. Naming it keeps the family in lockstep.
  **`<BandChart sessionBreaks>`** shipped in 0.70.0 with the line's semantics,
  so a band breaks at the session seams natively and the chart's
  one-wash-per-segment workaround from 0.2.0 is gone; `sliceBySegments` stays
  for `<AreaChart>`, which still has no such prop. One visible change from
  that: on a **continuous** axis (`collapseWeekends` off) with intraday data,
  the old workaround still split the wash while its centre line bridged; now
  both bridge, as the line always did. Pond's `specId` now judges **arity**: a
  spec with the wrong number of inputs (or none) is a broken id in lenient mode
  and an `ArityError` in strict, where 0.62–0.69 named it valid and let it die
  at `compile` with no code. `isValidSpec` therefore says `false` for such a
  spec, so a persisted no-inputs study now surfaces as a broken chip that
  refuses param edits instead of a silent skip; `DeriveSkip.code` now documents
  the `'ArityError'` literal beside the other two.
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
