import type { CSSProperties, ReactNode } from 'react';

/**
 * The control atoms a consumer pane is assembled from — a label, a pill, a
 * bordered group, a segmented toggle, a coloured checkbox.
 *
 * They are **deliberately not part of the package**. A host that embeds this
 * chart has its own design system and its own atoms; the library owns the
 * drawing, not the chrome. They live here so the workshop can show a realistic
 * pane rather than a bare canvas — and so that "can the chart be driven by a
 * simplified, fixed UI?" is answered by something you can look at.
 *
 * Tokens are the workshop's own (`--pane-*`), set by the preview decorator.
 * Nothing here reads a token the chart knows about.
 */
const font = "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace";

export const paneStyles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    padding: 12,
    minHeight: 0,
    minWidth: 0,
    height: '100%',
    background: 'var(--pane-surface)',
    color: 'var(--pane-ink)',
    fontFamily: font,
    fontSize: 11,
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 24,
    marginBottom: 6,
    position: 'relative',
  },
  title: {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    margin: 0,
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--pane-ink-strong)',
  },
  symbol: { fontSize: 12, fontWeight: 600, color: 'var(--pane-ink-strong)' },
  spacer: { flex: 1 },
  controlRow: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6, alignItems: 'center' },
  seriesRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
    alignItems: 'center',
  },
  divider: { width: 1, height: 18, background: 'var(--pane-surface-active)' },
  groupLabel: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    color: 'var(--pane-ink-muted)',
  },
  cap: { fontSize: 10, color: 'var(--pane-ink-faint)', fontVariantNumeric: 'tabular-nums' },
  /** The same counter once the pane is AT its cap. A colour change, not a new
   *  line of text: the row is already dense, and the inert checkboxes beside it
   *  tell the rest of the story. */
  capFull: { fontSize: 10, color: 'var(--pane-caution)', fontVariantNumeric: 'tabular-nums' },
  plotRow: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 },
  subtitle: {
    alignSelf: 'flex-end',
    fontSize: 10,
    color: 'var(--pane-ink-muted)',
    marginBottom: 2,
  },
};

export function SelectLabel({ children, colon = true }: { children: ReactNode; colon?: boolean }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.2px',
        color: 'var(--pane-ink-muted)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
      {colon ? ':' : ''}
    </span>
  );
}

export function SelectorGroup({
  label,
  children,
  wrap,
}: {
  label?: string;
  children: ReactNode;
  wrap?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        rowGap: 4,
        flexWrap: wrap ? 'wrap' : 'nowrap',
        padding: '5px 8px',
        border: '1px solid var(--pane-border)',
        borderRadius: 3,
      }}
    >
      {label ? <SelectLabel>{label}</SelectLabel> : null}
      {children}
    </div>
  );
}

export function SelectPill({
  label,
  active,
  onClick,
  tone = 'var(--pane-border-strong)',
}: {
  label: ReactNode;
  active: boolean;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        font: 'inherit',
        fontSize: 11,
        lineHeight: '16px',
        fontWeight: active ? 600 : 400,
        padding: '1px 8px',
        borderRadius: 10,
        cursor: 'pointer',
        color: active ? 'var(--pane-ink-strong)' : 'var(--pane-ink-muted)',
        border: `1px solid ${active ? tone : 'var(--pane-border)'}`,
        background: active ? `color-mix(in srgb, ${tone} 24%, transparent)` : 'transparent',
      }}
    >
      {label}
    </button>
  );
}

export function ToggleGroup<T extends string>({
  label,
  items,
  active,
  onChange,
}: {
  label?: string;
  items: readonly { value: T; label: string }[];
  active: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {label ? <SelectLabel>{label}</SelectLabel> : null}
      <div style={{ display: 'inline-flex' }} role="group" aria-label={label}>
        {items.map((item, i) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            aria-pressed={item.value === active}
            style={{
              font: 'inherit',
              fontSize: 11,
              height: 20,
              padding: '0 10px',
              cursor: 'pointer',
              border: 0,
              marginLeft: i === 0 ? 0 : 1,
              borderRadius:
                i === 0 ? '2px 0 0 2px' : i === items.length - 1 ? '0 2px 2px 0' : undefined,
              fontWeight: item.value === active ? 600 : 400,
              color: item.value === active ? 'var(--pane-surface)' : 'var(--pane-ink)',
              background:
                item.value === active ? 'var(--pane-ink-muted)' : 'var(--pane-surface-hover)',
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A curve toggle that wears its curve's colour — the pane's series vocabulary
 *  is fixed, so a checkbox per curve replaces an add-a-series menu entirely. */
export function SeriesCheckbox({
  label,
  color,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  color: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onToggle}
      aria-pressed={checked}
      aria-disabled={disabled}
      title={disabled ? 'Curve limit reached — turn one off first' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        font: 'inherit',
        fontSize: 11,
        fontWeight: checked ? 600 : 400,
        border: 0,
        background: 'transparent',
        padding: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        color: checked ? color : 'var(--pane-ink-muted)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 11,
          height: 11,
          borderRadius: 2,
          border: `1.5px solid ${checked ? color : 'var(--pane-border-strong)'}`,
          background: checked ? color : 'transparent',
          color: 'var(--pane-surface)',
          fontSize: 9,
          fontWeight: 700,
          lineHeight: '9px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? '✓' : ''}
      </span>
      {label}
    </button>
  );
}

/** Six slots: click loads, shift-click saves. Inert here — the workshop is about
 *  the chart, and a preset is the host's state to keep. */
export function PresetSlots({ active }: { active: number }) {
  return (
    <div style={{ display: 'flex', gap: 3 }} role="group" aria-label="Presets">
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <span
          key={n}
          style={{
            width: 20,
            height: 20,
            borderRadius: 3,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            background: n === active ? 'var(--pane-ink)' : 'var(--pane-surface-raised)',
            color: n === active ? 'var(--pane-surface)' : 'var(--pane-ink-muted)',
            border: '1px solid transparent',
          }}
        >
          {n}
        </span>
      ))}
    </div>
  );
}
