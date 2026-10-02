import path from 'node:path';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import { tidalCodeTheme } from './src/prism-tidal-theme';

/**
 * The tidal-ts docs site, modelled on pond-ts.org's: Docusaurus, local search,
 * Storybook served beside it under /storybook, published on release tags so the
 * site always describes the version on npm.
 *
 * Where it is served is set at build time, so moving hosts (or adding a custom
 * domain) is an environment change, not an edit: `DOCS_URL` is the origin and
 * `DOCS_BASE_URL` the path the site lives under.
 */
const REPO = 'https://github.com/tidal-app/tidal-ts/tree/main';
/** The prose file each catalog family's pages are written in. */
const PROSE_FILE: Record<string, string> = {
  trend: 'trend',
  momentum: 'momentum',
  'moving-average': 'movingAverage',
  bands: 'bands',
  volatility: 'volatility',
  volume: 'volume',
  statistical: 'statistical',
  price: 'price',
};

const url = process.env.DOCS_URL ?? 'https://tidal-app.github.io';
const baseUrl = process.env.DOCS_BASE_URL ?? '/tidal-ts/';

const config: Config = {
  title: 'tidal-ts',
  tagline: 'Financial time-series charts and studies on pond-ts',
  favicon: 'img/tidal-mark.svg',
  future: {
    v4: true,
  },
  url,
  baseUrl,
  organizationName: 'tidal-app',
  projectName: 'tidal-ts',
  // GitHub Pages serves a folder's index.html; every route is a folder.
  trailingSlash: true,
  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // A study page's file only routes to its component; the prose a
          // reader would want to fix lives with the workshop's catalog.
          editUrl: ({ docPath }) => {
            const study = /^studies\/([^/]+)\/[^/]+\.mdx$/.exec(docPath);
            return study
              ? `${REPO}/packages/chart/.storybook/studies/docs/${PROSE_FILE[study[1]!] ?? 'index'}.ts`
              : `${REPO}/website/docs/${docPath}`;
          },
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  themes: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        indexBlog: false,
        docsRouteBasePath: '/docs',
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],
  plugins: [
    // The study pages render the workshop's own `StudyPage`
    // (packages/chart/.storybook/studies), which imports the chart's TypeScript
    // source the way the package does: with `.js` specifiers that name the
    // emitted file. Webpack has to be told that `./x.js` may be `./x.ts(x)`.
    // The site's own `node_modules` is added to the loader search so pnpm's
    // strict layout still finds `raw-loader` (the example sources on the page).
    () => ({
      name: 'tidal-ts-source-imports',
      configureWebpack: () => ({
        resolve: { extensionAlias: { '.js': ['.ts', '.tsx', '.js'] } },
        resolveLoader: { modules: ['node_modules', path.join(__dirname, 'node_modules')] },
      }),
    }),
  ],
  themeConfig: {
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'tidal-ts',
      logo: {
        alt: 'tidal-ts',
        src: 'img/tidal-mark.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/docs/studies',
          label: 'Studies',
          position: 'left',
        },
        {
          // Storybook is a separate static build copied in beside the site,
          // so it is a plain link (`pathname://`), not a route Docusaurus checks.
          href: 'pathname:///storybook/',
          label: 'Storybook',
          position: 'left',
          target: '_self',
        },
        {
          href: 'https://www.npmjs.com/package/@tidal-ts/chart',
          label: 'npm',
          position: 'right',
        },
        {
          href: 'https://github.com/tidal-app/tidal-ts',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting started', to: '/docs/getting-started' },
            { label: 'Study catalog', to: '/docs/studies' },
          ],
        },
        {
          title: 'Project',
          items: [
            { label: 'npm', href: 'https://www.npmjs.com/package/@tidal-ts/chart' },
            { label: 'GitHub', href: 'https://github.com/tidal-app/tidal-ts' },
            { label: 'pond-ts', href: 'https://pond-ts.org' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Peter Murphy. MIT licensed. Built with Docusaurus.`,
    },
    prism: {
      theme: tidalCodeTheme,
      darkTheme: tidalCodeTheme,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
