# Changelog

All packages release together on one version.

## Unreleased

- **A docs site** (`website/`, Docusaurus, modelled on pond-ts.org): an
  overview, getting started with a live example, a page per package, and the
  study catalog with a live chart per study. Published to GitHub Pages with
  Storybook under `/storybook` when a release tag is pushed. No package code
  changes.

## 0.6.0 — 2026-10-02

An oscillator draws its guide levels.

- **`studyLevels(op)`** (core) names the levels a study is read against: RSI
  30/70, stochastic 20/80, Williams %R -80/-20, CCI -100/100, a zero line for
  MACD, TRIX, momentum and the other centred oscillators (37 ops in all). A
  study with no conventional levels returns `[]`.
- **The chart draws them.** Each drawn study's levels go on its own axis as a
  `<Baseline role="guide">`, once per axis and value, unlabelled and not
  selectable. A host styles them through `annotation.roles.guide` in the
  theme it passes. A level outside the data's range can fall off-screen,
  because a baseline does not take part in its axis's auto-fit: on a calm
  stretch RSI's 30 or 70 may sit beyond the auto-fitted axis. A level at or
  below zero is skipped on a log axis.

## 0.5.1 — 2026-10-02

- **Only a study of a metric opens on its own row.** A metric is a raw one, a
  derived catalog metric (realized vol) or an unsplit pair's spread. A study in
  its own units of a STUDY (an RSI of an SMA) or of a pair leg now stays on its
  target's row, on its own axis, as before 0.5.0. A chain is one pipeline the
  panel reads within a row, and a compare side is one too: split across rows,
  the panel showed a middle link as the chain's tail, and a leg's oscillator
  fell out of its pair (no pair ink, no pair eye, an unwanted mirror).
- **`row.remove` is removing each of the row's series.** It runs the same
  cascade as `series.remove`, wherever it lands, so a study of one of the row's
  studies goes too, on any row, and the selection and expansion clear if they
  pointed at one. A study of a raw metric outlives it, as with `series.remove`:
  an RSI of the price on its own row stays when the price's row goes.

## 0.5.0 — 2026-10-02

A study in its own units opens on a row of its own.

- **`series.addStudy` places a study by its unit.** A study that reads in its
  source's units (an SMA, a Bollinger band) still overlays its target. One that
  reads in its own (an RSI, a MACD, an ATR — every op whose `unit` is not
  `inherit`) now opens on a new row directly under its target's row, instead of
  drawing over the target on a second scale. Several of them stack in the
  order added. At `MAX_ROWS` it overlays as before, on its own axis. A study of
  such a study (an SMA of an RSI) shares its row and scale.
- **A cross-row move leaves an own-row study where it is.** Moving the price
  carries the studies on its row, not the RSI on the row below. Moving the RSI
  back onto the price's row removes the row it leaves.
- **Every edit that takes series off rows prunes the rows it empties** —
  `series.remove`, `group.remove` and `series.moveToRow` share one rule — and
  keeps exactly one row that absorbs slack. A row that was already empty stays.
  Fix: `group.remove` could leave the terminal with no rows at all, and a move
  that emptied the top row left no row to absorb slack.
- **Fix: duplicate row ids after a re-seed.** The row counter started at the
  number of seeded rows, so a stack restored from a preset holding `row-2`
  could mint `row-2` again. It now starts past every seeded row id.
- **Hiding a series hides the studies built on it on every row**, not only on
  its own.

## 0.4.1 — 2026-10-02

- **`useSetStudyOutput()`** — the React hook that sends `series.setStudyOutput`,
  beside `useSetStudyParam()`. Left out of 0.4.0, which shipped the event and
  `outputAllowed` without a way for a provider-based host to send it.

## 0.4.0 — 2026-10-02

The output picker: a study of a multi-output study can be told which output to read.

- **`series.setStudyOutput { id, output }`** switches the output a study reads
  (a MACD's `Line` to its `Hist`, a band's `Middle` to its `Lower`) in place.
  The study keeps its identity (ink, axis, selection), the label's output
  segment follows, and everything built on the study is carried, like a param
  retune. **`outputAllowed(scope, id, output)`** is the shared gate, so a host
  can render a refused choice disabled: it refuses an output the source does
  not declare, the one already read, a pair (its legs are its construction),
  and a switch whose unit would not fit the axis the study sits on.
- **`studyPick(spec)` / `withStudyOutput(spec, output)`** (core) read and
  rewrite which output a study reads. A study saved before 0.3.0, which nests
  its source bare, reports its first-declared output (`explicit: false`), and
  switching it writes a pick, so an old silent Donchian chain can be fixed
  from the picker.
- **Fix: a study reading high/low could not be retuned.** `open`/`high`/`low`
  had no unit (no catalog entry names them), so a re-spec of a Donchian, an
  ATR band or anything built on one computed its unit as unitless against a
  seated `$`, and the unit gate refused every period change. They now read in
  the `close`'s unit, on the add path and the re-spec path alike (an ATR was
  seated unitless and became `$` on its first retune).
- `readPart` steps through a pick of a study with no `period` param (a
  MACD), so a pair over an SMA of a MACD's Line keeps its leg rows.

## 0.3.0 — 2026-09-30

A study of a multi-output study now says which output it reads.

- **A study of a multi-output study reads ONE named output.** `DeriveInput`
  gains a third form, **`PickedDeriveOutput`** (`{ from, output }`, the
  engine's own `PickedOutput`), and `studyConfig` always writes one when its
  target has several outputs, instead of nesting the target bare. A bare
  nested multi-output spec reads its FIRST-declared output: `Middle` for
  `bollinger` by luck, but `Upper` for `donchian`, so an SMA of a Donchian
  channel silently smoothed its top edge. The default is the study's primary
  (new **`primaryOutput(op)`**: `Middle` for a band, else the unnamed line
  declared as `Value`, else the first declared), picked by the new
  **`studyInputOf(source)`**, and the label names it:
  `Price · DONCHIAN(20) · Middle · SMA(10)`.
- **A MACD (or any multi-output study) can carry a study again.**
  `canAddStudy` refused one because the bare nested spec read nothing useful;
  with a pick there is a column to read, so the refusal is gone.
- **The spec readers understand picks.** `inputNames` names a pick by its
  source's column (the parent config being walked), `substituteInput` re-points
  a pick at a retuned source and keeps its output, `specUnit` reads the picked
  output's own unit, and `usesCompare` / `hasPairOp` see through one.
  `readPart` steps through a pick (new `PartStudy.output`, printed by
  `partStudyLabel` as `BOLLINGER(20, 2) · Middle`), and `isValidSpec` refuses
  a pick of an output the op does not declare. New **`isPickedInput`** narrows
  an input.
- **A band as a pair leg reads its primary too.** `boundLeg` nested a band
  bare, so `Donchian − Price` was the top edge minus the price. It now picks
  the band's `Middle`, and an unjoined pair over a band groups the band.
- **An axis-sharing study joins its source's OWN axis.** An SMA of a study on
  its own scale (an RSI, a MACD) had no axis group, so it drew on the row's
  shared axis: a line near zero on the price's scale. It now takes its
  source's `axisGroup`.

Saved layouts are untouched: a study saved as a bare nested multi-output spec
keeps computing what it computed.

## 0.2.2 — 2026-09-29

One change, asked for by the first consumer: the user, not the library,
decides whether seating a metric twice makes sense.

- **One metric can be seated more than once.** A study, a compare leg and a
  split used to be refused when the column they would seat was already on the
  chart — in another row, or under another parent — because a derived config
  named its inputs by COLUMN, and two configs on one column made that name
  ambiguous. The consumer, not the library, decides whether two copies make
  sense: price in the top row and price in the bottom one, each with its own
  chain of studies under it, is a layout a user asks for. So the refusals are
  gone (`canAddStudy`, `canAddPair`'s joined-duplicate check, `planSplit`'s
  "taken in another row", and `propagateRespec`'s one-column-one-config check)
  and the ambiguity is resolved instead.

  `SeriesConfig` gains **`parentIds?`**, index-aligned with
  `inputNames(derive)`: at each input, the id of the config it was built from.
  A study records the config it was added from, but only at the inputs that
  read it (an ATR's high/low/close are nobody's); a spread records each leg
  that resolved to a seated config. Every walk of the graph — the removal
  cascade, the respec propagation, the eye, the row blocks, the chain tail, a
  split's leg adoption — resolves a config's sources through the new exported
  **`sourcesOf(configs, c)`** / **`readsFrom(configs, c, parent)`**:

  - a recorded parent that still publishes the input wins;
  - a recorded parent that computes something else now (a stale record) falls
    back to the column;
  - a recorded parent that is **gone** resolves to nothing — its orphan is not
    handed to whichever other copy shares the column;
  - with nothing recorded (a layout from before this release, or an input no
    config was recorded for), the first config publishing the column — a best
    guess where a column is seated twice, as it always was.

  `series.patch` cannot rewrite `parentIds`. Retuning one copy's study no
  longer touches the other copy's chain, removing one copy takes only its own,
  and a spread over one copy stays on it.

  **The same study twice on ONE parent is allowed too**, deliberately: a chain
  never branches, so that twin is the only way to run two different chains
  from one study.

  This also fixes a latent bug in 0.2.1: once any column was seated twice —
  which two plain `series.add`s of one metric already did — `propagateRespec`
  refused **every** study retune on the chart, silently.

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
