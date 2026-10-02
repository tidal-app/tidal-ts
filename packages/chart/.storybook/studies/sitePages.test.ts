import { describe, expect, it } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { sitePages } from './sitePages.js';

/**
 * The docs site carries exactly the study pages the registry implies: a study
 * adopted later fails here until its page is generated, and a page for a study
 * that left the menu fails until it is removed.
 */
const ROOT = join(__dirname, '../../../../website/docs/studies');
const expected = sitePages();

const onDisk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? onDisk(join(dir, e.name)) : [relative(ROOT, join(dir, e.name))],
  );

if (process.env.WRITE_SITE_PAGES) {
  rmSync(ROOT, { recursive: true, force: true });
  for (const [path, text] of Object.entries(expected)) {
    mkdirSync(dirname(join(ROOT, path)), { recursive: true });
    writeFileSync(join(ROOT, path), text);
  }
}

describe('the docs site study pages', () => {
  it('cover every study (the test is not vacuous)', () => {
    expect(Object.keys(expected).filter((p) => p.endsWith('.mdx')).length).toBeGreaterThan(50);
  });

  it('are exactly the generated set', () => {
    expect(onDisk(ROOT).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.keys(expected))('%s is up to date', (path) => {
    expect(readFileSync(join(ROOT, path), 'utf8')).toBe(expected[path]);
  });
});
