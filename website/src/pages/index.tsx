import type { ReactNode } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import { LiveExample } from '@site/src/components/LiveExample';
import FirstChart from '@site/src/examples/first-chart';
import styles from './index.module.css';

const FEATURES: { title: string; body: ReactNode; to: string }[] = [
  {
    title: 'A study catalog you can retune',
    body: 'Every study has its own page: a live chart with editable settings, what it measures, and how traders use it.',
    to: '/docs/studies',
  },
  {
    title: 'Studies are data',
    body: 'A study is a small object: an op, its inputs, its settings. Save it, share it, recompute it; the same spec always names the same column.',
    to: '/docs/packages/core',
  },
  {
    title: 'Your look, not ours',
    body: 'The chart reads no CSS and needs no provider. Theme, colours and settings arrive as props, so it fits any design system.',
    to: '/docs/packages/chart',
  },
];

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <header className={clsx('hero hero--primary', styles.heroBanner)}>
        <div className={clsx('container', styles.heroContent)}>
          <span className={styles.heroEyebrow}>TypeScript · financial charts</span>
          <Heading as="h1" className="hero__title">
            {siteConfig.title}
          </Heading>
          <p className={styles.heroSubtitle}>
            Price, volatility and technical studies on one multi-row chart, built on pond-ts.
          </p>
          <div className={styles.buttons}>
            <Link className="button button--primary button--lg" to="/docs/getting-started">
              Get started
            </Link>
            <Link className="button button--outline button--primary button--lg" to="/docs/studies">
              Browse the studies
            </Link>
          </div>
        </div>
        <div className={clsx('container', styles.heroChart)}>
          <LiveExample component={FirstChart} height={450} />
        </div>
      </header>
      <main className="container">
        <div className={styles.features}>
          {FEATURES.map((f) => (
            <Link key={f.title} to={f.to} className={clsx('card', styles.feature)}>
              <Heading as="h3">{f.title}</Heading>
              <p>{f.body}</p>
            </Link>
          ))}
        </div>
      </main>
    </Layout>
  );
}
