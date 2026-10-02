import type { ComponentType } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import { useColorMode } from '@docusaurus/theme-common';

/** A docs example drawn live. The canvas chart only draws in a browser, so the
 *  server render keeps its height and the chart joins on load. */
export function LiveExample({
  component: Example,
  height,
}: {
  component: ComponentType<{ dark?: boolean }>;
  height: number;
}) {
  const { colorMode } = useColorMode();
  return (
    <div className="tidal-example" style={{ minHeight: height }}>
      <BrowserOnly fallback={<div style={{ height }} />}>
        {() => <Example dark={colorMode === 'dark'} />}
      </BrowserOnly>
    </div>
  );
}
