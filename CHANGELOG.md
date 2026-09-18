# Changelog

All packages release together on one version.

## Unreleased

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
  shape, as opposed to the open-ended terminal the chart came out of.

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
