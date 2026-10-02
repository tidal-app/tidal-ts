import type { CSSProperties } from 'react';
import { useColorMode } from '@docusaurus/theme-common';
import useBaseUrl from '@docusaurus/useBaseUrl';
// The workshop's own catalog components, rendered here unchanged: one source
// for the Storybook pages and the site's, so the two cannot disagree.
import { StudyPage } from '../../../packages/chart/.storybook/studies/StudyPage';
import { StudyOverview } from '../../../packages/chart/.storybook/studies/Overview';
import { FAMILIES } from '../../../packages/chart/.storybook/studies/families';
import { PANE_DARK, PANE_LIGHT } from '../../../packages/chart/.storybook/preview';

/** The panel colours the catalog paints with, for the site's current mode.
 *  The chart itself takes its theme as a prop inside `StudyPage`. */
function Panes({ dark, children }: { dark: boolean; children: React.ReactNode }) {
  return (
    <div className="tidal-study" style={(dark ? PANE_DARK : PANE_LIGHT) as CSSProperties}>
      {children}
    </div>
  );
}

/** One study's page: live chart, settings, what it measures, how it is used. */
export function Study({ op }: { op: string }) {
  const { colorMode } = useColorMode();
  return (
    <Panes dark={colorMode === 'dark'}>
      <StudyPage op={op} scheme={colorMode} />
    </Panes>
  );
}

/** The catalog's front page, linking each study to its page on this site. */
export function StudyCatalog() {
  const { colorMode } = useColorMode();
  const base = useBaseUrl('/docs/studies/');
  const folder = new Map<string, string>(FAMILIES.map((f) => [f.title, f.family]));
  return (
    <Panes dark={colorMode === 'dark'}>
      <StudyOverview hrefFor={(title, op) => `${base}${folder.get(title)}/${op}/`} />
    </Panes>
  );
}
