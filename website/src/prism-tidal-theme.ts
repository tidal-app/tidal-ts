import type { PrismTheme } from 'prism-react-renderer';

/**
 * Code blocks sit on one dark navy ground in both colour modes, as pond-ts.org's
 * do on theirs: lavender for keywords (the site's accent), amber for literals.
 */
export const tidalCodeTheme: PrismTheme = {
  plain: {
    color: '#e9edf6',
    backgroundColor: '#0d1322',
  },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: { color: '#6d7689', fontStyle: 'italic' },
    },
    {
      types: ['punctuation'],
      style: { color: '#a6aec4' },
    },
    {
      types: ['keyword', 'tag', 'operator', 'builtin'],
      style: { color: '#a99cf5' },
    },
    {
      types: ['function', 'class-name', 'maybe-class-name'],
      style: { color: '#c9c0ff' },
    },
    {
      types: ['string', 'attr-value', 'char'],
      style: { color: '#b9d4f5' },
    },
    {
      types: ['number', 'boolean', 'constant', 'symbol'],
      style: { color: '#f0a93f' },
    },
    {
      types: ['property', 'attr-name', 'variable'],
      style: { color: '#e9edf6' },
    },
    {
      types: ['deleted'],
      style: { color: '#e5534b' },
    },
    {
      types: ['inserted'],
      style: { color: '#3fb68b' },
    },
  ],
};
