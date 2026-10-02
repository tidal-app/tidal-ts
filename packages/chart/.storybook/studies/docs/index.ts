import type { StudyDoc } from '../types.js';
import { BANDS } from './bands.js';
import { MOMENTUM } from './momentum.js';
import { MOVING_AVERAGE } from './movingAverage.js';
import { PRICE } from './price.js';
import { STATISTICAL } from './statistical.js';
import { TREND } from './trend.js';
import { VOLATILITY } from './volatility.js';
import { VOLUME } from './volume.js';

/** Every study's page prose, keyed by op name — one file per picker family. */
export const STUDY_DOCS: Readonly<Record<string, StudyDoc>> = {
  ...TREND,
  ...MOMENTUM,
  ...MOVING_AVERAGE,
  ...BANDS,
  ...VOLATILITY,
  ...VOLUME,
  ...STATISTICAL,
  ...PRICE,
};
