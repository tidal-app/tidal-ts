import type { CSSProperties } from 'react';
import { STUDIES } from '@pond-ts/financial/catalog';
import { studyCatalog } from '@tidal-ts/core';
import { STUDY_DOCS } from './docs/index.js';
import { FAMILIES, storyId } from './families.js';

/**
 * The catalog's front page: every study Tidal offers, grouped as its study
 * menu groups them, each linking to its own page — then the studies the
 * underlying library has that Tidal does not offer yet, and why.
 *
 * Both lists are computed (the registry, and the library's catalog minus it),
 * so a study adopted later moves from the second list to the first without an
 * edit here.
 */

type Descriptor = (typeof STUDIES)[number];

/** Why a library study is not in Tidal's menu, in a reader's words. The order
 *  matters only when several apply; the first is the one that names the gap
 *  most directly. */
function whyNot(d: Descriptor): string {
  if (d.inputs.some((i) => i.default === undefined))
    return 'Needs a second instrument to compare against';
  if (d.anchor != null) return 'Needs session times or a start date';
  if (d.outputs.some((o) => o.unit === 'signal'))
    return 'Outputs an on/off signal rather than a line';
  if (Object.values(d.params ?? {}).some((p) => (p as { kind: string }).kind === 'enum'))
    return 'Has a choose-from-a-list setting the controls cannot show yet';
  return 'Not adopted yet';
}

const S = {
  page: {
    maxWidth: 1080,
    margin: '0 auto',
    padding: '12px 8px 48px',
    fontFamily: "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontSize: 14,
    lineHeight: 1.55,
    color: 'var(--pane-ink)',
  },
  h1: { margin: '4px 0 6px', fontSize: 26, fontWeight: 600, color: 'var(--pane-ink-strong)' },
  h2: { margin: '32px 0 2px', fontSize: 18, fontWeight: 600, color: 'var(--pane-ink-strong)' },
  blurb: { margin: '0 0 10px', color: 'var(--pane-ink-muted)' },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 280px) 1fr',
    gap: 16,
    padding: '6px 0',
    borderBottom: '1px solid var(--pane-surface-active)',
  },
  link: { color: 'var(--pane-ink-strong)', textDecoration: 'none', fontWeight: 500 },
  muted: { color: 'var(--pane-ink-muted)' },
  mono: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 12 },
} satisfies Record<string, CSSProperties>;

/** The first sentence of a study's "what it measures" — the overview's one-liner. */
const firstSentence = (text: string): string => {
  const m = /^.*?[.!?](?=\s|$)/.exec(text);
  return m ? m[0] : text;
};

export function StudyOverview() {
  const offered = studyCatalog();
  const offeredNames = new Set(offered.map((s) => s.op));
  const missing = STUDIES.filter((d) => !offeredNames.has(d.name));
  return (
    <article style={S.page}>
      <h1 style={S.h1}>Studies</h1>
      <p style={{ margin: 0 }}>
        Every study Tidal can add to a chart — {offered.length} of them — grouped the way the study
        menu groups them. Each page has a live chart you can retune, what the study measures, how
        traders use it, and what every setting does.
      </p>
      <p style={{ ...S.muted, margin: '8px 0 0', fontSize: 13 }}>
        The charts run on a seeded random walk, not real market data, so they show the shape of each
        study rather than a trading signal.
      </p>

      {FAMILIES.map((f) => {
        const ops = offered
          .filter((s) => s.family === f.family)
          .sort((a, b) =>
            (STUDY_DOCS[a.op]?.name ?? a.op).localeCompare(STUDY_DOCS[b.op]?.name ?? b.op),
          );
        return (
          <section key={f.family}>
            <h2 style={S.h2}>{f.label}</h2>
            <p style={S.blurb}>{f.blurb}</p>
            {ops.map((s) => {
              const doc = STUDY_DOCS[s.op];
              return (
                <div key={s.op} style={S.row}>
                  <a style={S.link} href={`./?path=/story/${storyId(f.title, s.op)}`} target="_top">
                    {doc?.name ?? s.op}
                  </a>
                  <span style={S.muted}>{doc ? firstSentence(doc.what) : s.summary}</span>
                </div>
              );
            })}
          </section>
        );
      })}

      <section>
        <h2 style={S.h2}>Not in Tidal yet</h2>
        <p style={S.blurb}>
          The study library underneath has {missing.length} more. They are left out until Tidal can
          supply what they need, rather than offered and drawn wrong.
        </p>
        {missing.map((d) => (
          <div key={d.name} style={S.row}>
            <span>
              <span style={{ color: 'var(--pane-ink-strong)' }}>{d.summary.split(' — ')[0]}</span>{' '}
              <span style={{ ...S.mono, color: 'var(--pane-ink-faint)' }}>{d.name}</span>
            </span>
            <span style={S.muted}>{whyNot(d)}</span>
          </div>
        ))}
      </section>
    </article>
  );
}
