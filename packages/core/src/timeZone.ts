/**
 * **The two zones**, kept apart on purpose (TradingView's split, which is the
 * one their model gets most right).
 *
 * - {@link DATA_TIME_ZONE} is what the numbers ARE. The archive stamps a daily
 *   bar at UTC midnight, `CalendarService` returns UTC-midnight open days,
 *   `EarningsService` the same, `aggregate`'s day/week/month buckets run in it,
 *   and the range picker's `YTD` starts there. It follows the DATA, and one day
 *   the instrument's own exchange, never a user preference.
 * - The **display zone** is what the axis READS in. Purely visual, exactly as
 *   TradingView documents it: "the specified time zone does **not** affect time
 *   calculations". Changing it must never re-bucket anything.
 *
 * Wiring them to one value would mean picking "New York" silently re-aggregated
 * the data, which is the bug their split exists to prevent.
 */
export const DATA_TIME_ZONE = 'UTC';

/*
 * There is deliberately NO grain rule here.
 *
 * The first draft forced daily-and-coarser to {@link DATA_TIME_ZONE}, reasoning
 * that a daily stamp is UTC midnight for its trading DATE and would read as the
 * previous day anywhere west of UTC. The arithmetic is right — that instant
 * formatted in `America/New_York` really is the day before — and the conclusion
 * was wrong, because the chart does not format the instant. It runs on a
 * trading-time scale (`discontinuities`), which places a bar by its SESSION, so
 * the date survives the zone.
 *
 * Measured rather than argued: the same 1-month daily view rendered in UTC and
 * in New York produced identical tick labels (13, 15, 17 …). Peter called it
 * ("daily data or coarser doesn't matter what timezone is displayed, it'll fit
 * that day in any zone") before the render confirmed it.
 */

/** One offered zone: the IANA id stored, and how the control says it. */
export interface TimeZoneChoice {
  id: string;
  label: string;
}

/**
 * The zones the control offers.
 *
 * Deliberately short. TradingView lists 80-odd because it serves every market;
 * this is the set the desk actually trades, plus the two that are about the
 * READER rather than the market. `Local` resolves at render time — it is a
 * preference ("wherever I am"), not a zone, which is why it is stored as the
 * literal `local` and not as whatever it resolved to when it was picked.
 */
export const LOCAL_ZONE = 'local';

export const TIME_ZONE_CHOICES: readonly TimeZoneChoice[] = [
  { id: 'UTC', label: 'UTC' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'America/Chicago', label: 'Chicago' },
  { id: 'Europe/London', label: 'London' },
  { id: 'Europe/Amsterdam', label: 'Amsterdam' },
  { id: 'Europe/Madrid', label: 'Madrid' },
  { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Australia/Sydney', label: 'Sydney' },
  { id: LOCAL_ZONE, label: 'Local' },
];

/**
 * A stored zone as an IANA id the chart can use — `local` resolved here, an
 * unknown id falling back rather than throwing, and **no zone at all meaning
 * the data zone**. Only the literal `local` asks for the viewer's zone: a host
 * that passes nothing (Storybook, a library consumer) gets the axis in the zone
 * the numbers are in, which is the bug the display zone exists to prevent —
 * and it is what {@link timeZoneLabel} already said `undefined` meant.
 *
 * The fallback is not defensive padding: `Sequence.calendar` THROWS on an
 * unknown zone since 0.69, IANA ids are renamed periodically
 * (`Europe/Kiev` → `Europe/Kyiv`), and this value is persisted — so a preset
 * written today can name a zone a later runtime has dropped. A stale preference
 * must degrade to UTC, never take the chart down.
 */
export function resolveTimeZone(stored: string | undefined): string {
  if (!stored) return DATA_TIME_ZONE;
  if (stored === LOCAL_ZONE) {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || DATA_TIME_ZONE;
    } catch {
      return DATA_TIME_ZONE;
    }
  }
  try {
    // The cheapest real validation: formatting with an unknown zone throws.
    new Intl.DateTimeFormat('en', { timeZone: stored }).format(0);
    return stored;
  } catch {
    return DATA_TIME_ZONE;
  }
}

/** How the status bar names the active zone: the choice's label when we offer
 *  it, else the bare id (a zone restored from an older build). */
export function timeZoneLabel(stored: string | undefined): string {
  const found = TIME_ZONE_CHOICES.find((c) => c.id === (stored ?? DATA_TIME_ZONE));
  if (found) return found.label;
  return stored ?? DATA_TIME_ZONE;
}
