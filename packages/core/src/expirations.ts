/**
 * **Standard monthly option expirations**, derived from the trading calendar.
 *
 * The rule is two clauses: the **third Friday** of the calendar month, and if the
 * market is closed that day, the **previous trading day**. Nothing else — no
 * dataset, no per-instrument lookup. A monthly expiration is a fact about the
 * calendar, and `TDL-CALAXIS` already put the calendar in the terminal's hands,
 * so this is free where a data load would not be.
 *
 * An early design proposed sourcing expirations from a per-row listed-expiry
 * count instead. That is a **count of listed
 * expiries per row**, not a date: it rises when a new expiry gets listed and
 * falls when one rolls off, so recovering the expiration dates from it means
 * inferring events from a noisy difference — and the column is not in our load
 * anyway. The calendar answers the question exactly.
 *
 * ## Why the naive version is wrong
 *
 * "The third Friday that is a trading day" is **not** the rule, and the
 * difference is not hypothetical — measured against an exchange trading calendar, it
 * misfires whenever an *earlier* Friday in the month was a holiday, because
 * dropping that Friday shifts the count forward:
 *
 * | month   | third *trading* Friday | actual expiration            |
 * | ------- | ---------------------- | ---------------------------- |
 * | 2025-04 | 2025-04-25 ✗           | 2025-04-17 — the 18th was Good Friday |
 * | 2025-07 | 2025-07-25 ✗           | 2025-07-18 — Jul 4 fell on a Friday   |
 *
 * So the third Friday is counted on the **calendar**, and only then adjusted. And
 * when it *is* the closed day, expiration moves **back** to the Thursday, never
 * forward to the next Friday — the contract cannot outlive its own expiry.
 *
 * Over 2015–2026 that back-step fires exactly **four** times in 144 months:
 * Good Friday in 2019, 2022 and 2025, plus **2026-06-19, Juneteenth** — which is
 * the reason this reads the calendar instead of hard-coding Easter. A holiday
 * list is not static; the market's own calendar is the only thing that keeps up.
 *
 * ## What this is and is not
 *
 * These are the **regular monthly** expirations and nothing else — exactly 12 a
 * year over 2012–2026, verified. Deliberately absent: **weeklies** (the other
 * Fridays, plus Monday/Wednesday series), **end-of-month**, and anything
 * product-specific. The quarterly "triple witching" months are *not* missing —
 * March / June / September / December land on third Fridays, so they come through
 * as a subset of these.
 *
 * **The pre-2015 nuance, and it covers a third of our span.** Until the OCC moved
 * it (effective with the early-2015 cycle), an equity option's formal expiration
 * *date* was the **Saturday following** the third Friday; the Friday was the last
 * *trading* day. Our archive starts 2012-03, so roughly the first three years
 * predate the change.
 *
 * This returns the **Friday** throughout, which is the right answer for a chart
 * and the wrong one for a settlement calendar. A trading axis has no x-position
 * for a Saturday — it is not a session — so marking one would be marking a point
 * the plot cannot show. What the marker means is therefore "the last session on
 * which the expiring series traded", which is the same date as expiration from
 * 2015 on and one day before it prior to that. Anything reconciling an actual
 * pre-2015 expiration must not read these as settlement dates.
 *
 * **Not cross-checked against the feed.** No expiry-bearing dataset is loaded, so
 * these dates are derived from the rule and validated against the trading
 * calendar, not reconciled against the exchange's own expiry list.
 */

/** Friday, in `Date#getUTCDay()` terms (0 = Sunday). */
const FRIDAY = 5;

/**
 * The third Friday of `year`/`month` (0-based month) as a UTC-midnight instant —
 * pure date arithmetic, deliberately independent of any calendar. The first
 * Friday falls on day `1 + ((5 - dow(1st) + 7) % 7)`; the third is 14 days later,
 * which is always inside the month.
 */
export function thirdFriday(year: number, month: number): number {
  const first = Date.UTC(year, month, 1);
  const shift = (FRIDAY - new Date(first).getUTCDay() + 7) % 7;
  return Date.UTC(year, month, 1 + shift + 14);
}

/**
 * Standard monthly expirations within `[from, to]`, ascending.
 *
 * `tradingDays` is the market's sessions as UTC-midnight instants — the same
 * array the axis takes (`Repository.calendar`), **ascending**. A month whose
 * third Friday is closed resolves to the previous session; a month with no
 * session before it at all (the calendar's leading edge) is skipped rather than
 * guessed at.
 *
 * Returns `[]` for an empty calendar — an expiration we cannot place is not an
 * expiration we should draw, and inventing one from bare date arithmetic would
 * put a marker on a day the market was shut.
 */
export function monthlyExpirations(
  tradingDays: readonly number[],
  from: number,
  to: number,
): number[] {
  if (tradingDays.length === 0 || to < from) return [];

  const open = new Set(tradingDays);
  const out: number[] = [];

  // Walk whole months from `from`'s month through `to`'s. The third Friday can
  // fall outside [from, to] at either end, so each candidate is range-checked
  // after resolution, not before — a back-stepped expiration can cross out of the
  // window that its own Friday sat inside.
  const start = new Date(from);
  const end = new Date(to);
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  const lastYear = end.getUTCFullYear();
  const lastMonth = end.getUTCMonth();

  // The calendar's last session. `previousSession` cannot tell "the market was
  // shut that Friday" from "the calendar stops before that Friday", so without
  // this a partial trailing month back-steps onto the final session and emits it
  // as an expiration. Reproduced with a calendar ending 2025-03-10: March's third
  // Friday is 03-21, which the calendar never reaches, and 03-10 came out as
  // "March's expiration". Latent with today's data only because the loaded
  // calendar runs to 2029.
  const lastSession = tradingDays[tradingDays.length - 1]!;

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const friday = thirdFriday(year, month);
    const expiry =
      friday > lastSession
        ? null
        : open.has(friday)
          ? friday
          : previousSession(tradingDays, friday);
    if (expiry !== null && expiry >= from && expiry <= to) out.push(expiry);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return out;
}

/**
 * The latest session strictly before `t`, or `null` if the calendar starts later.
 * Binary search — this runs once per month over a calendar of ~4,000 sessions,
 * and a linear scan per month is quadratic in the range.
 */
function previousSession(days: readonly number[], t: number): number | null {
  let lo = 0;
  let hi = days.length - 1;
  let found: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid]! < t) {
      found = days[mid]!;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
