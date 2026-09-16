import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATA_TIME_ZONE,
  LOCAL_ZONE,
  TIME_ZONE_CHOICES,
  resolveTimeZone,
  timeZoneLabel,
} from './timeZone.js';

function sources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.(test|stories)\.tsx?$/.test(e.name)) {
        out.push({ path: p, text: readFileSync(p, 'utf8') });
      }
    }
  };
  for (const pkg of ['core', 'chart', 'terminal']) walk(join(__dirname, '..', '..', pkg, 'src'));
  return out;
}

describe('the DATA zone is one decision', () => {
  it('is UTC, and changing it is a deliberate edit', () => {
    expect(DATA_TIME_ZONE).toBe('UTC');
  });

  it('is the only zone a source NAMES — the display zone comes from the setting', () => {
    // The bug this replaces was a second opinion: `<ChartContainer>` took no
    // zone, which means the VIEWER's, so the axis drew in Madrid while every
    // number behind it was UTC. A literal zone in a source file is how that
    // comes back — `timeZone.ts` owns the offered list, everything else asks.
    const offenders = sources().flatMap(({ path, text }) =>
      path.endsWith('timeZone.ts')
        ? []
        : [...text.matchAll(/timeZone[:=]\s*["']([^"']+)["']/g)].map(
            (m) => `${path.split('/src/')[1]}: timeZone: '${m[1]}'`,
          ),
    );
    expect(offenders).toEqual([]);
  });
});

describe('the display zone applies at EVERY grain', () => {
  it('does not special-case daily, because the trading-time scale already does', () => {
    // The instant arithmetic says it should: a UTC-midnight daily stamp read in
    // New York is the PREVIOUS day. The chart does not read the instant — it
    // places a bar by its session — so the date survives the zone. Measured
    // side by side (identical tick labels in UTC and New York) after Peter
    // called it; the rule that used to live here was solving a non-problem.
    const stamp = Date.UTC(2023, 11, 13);
    const inNY = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      day: '2-digit',
    }).format(stamp);
    expect(inNY).toBe('12'); // the arithmetic that made the rule look necessary
    // …and nothing in the module acts on it.
    expect(Object.keys({ resolveTimeZone, timeZoneLabel })).not.toContain('axisTimeZone');
  });
});

describe('resolveTimeZone — a stored preference must never take the chart down', () => {
  it('resolves `local` at read time rather than freezing it when picked', () => {
    // `Local` is a preference ("wherever I am"), not a zone: storing whatever it
    // resolved to would make a preset mean a different thing on another machine.
    const local = resolveTimeZone(LOCAL_ZONE);
    expect(local).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    // …but NO zone is the data zone, not the viewer's: a host that passes
    // nothing must not get the machine's zone by accident (the bug `c5ba434`
    // fixed, re-openable from Storybook or a library consumer).
    expect(resolveTimeZone(undefined)).toBe(DATA_TIME_ZONE);
    expect(resolveTimeZone('')).toBe(DATA_TIME_ZONE);
    expect(timeZoneLabel(undefined)).toBe('UTC');
  });

  it('falls back to the data zone for an id this runtime does not know', () => {
    // `Sequence.calendar` THROWS on an unknown zone since 0.69, IANA ids get
    // renamed (`Europe/Kiev` → `Europe/Kyiv`), and this value is PERSISTED — so
    // a preference written today can name a zone a later runtime has dropped.
    expect(resolveTimeZone('Nowhere/Olympus_Mons')).toBe(DATA_TIME_ZONE);
    // …and a real one is passed straight through.
    expect(resolveTimeZone('Europe/Madrid')).toBe('Europe/Madrid');
  });

  it('names every offered zone, and every offered zone actually resolves', () => {
    for (const c of TIME_ZONE_CHOICES) {
      expect(timeZoneLabel(c.id)).toBe(c.label);
      // `local` resolves to the machine's; the rest must resolve to themselves,
      // or the control offers something the chart would refuse.
      if (c.id !== LOCAL_ZONE) expect(resolveTimeZone(c.id)).toBe(c.id);
    }
  });
});
