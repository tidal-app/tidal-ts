export {
  BAR_INTERVAL_MS,
  type Instrument,
  type InstrumentKind,
  type BarInterval,
} from './types.js';
export {
  generatePriceSeries,
  buildPriceSeries,
  DEMO_INSTRUMENTS,
  PRICE_SCHEMA,
  type PriceSeriesOptions,
  type PriceSeries,
  type PriceRow,
} from './fixture.js';
export {
  generateVolSeries,
  buildVolSeries,
  VOL_SCHEMA,
  VOL_TENORS,
  DEFAULT_VOL_TENOR,
  impliedCol,
  hvCol,
  rvCol,
  rvCenCol,
  skewCol,
  type VolSeries,
  type VolColumns,
  type VolTenor,
  type VolSeriesOptions,
} from './vol.js';
export {
  aggregateColumn,
  floorToWindow,
  liveWindowMs,
  ohlcWindow,
  sessionGrid,
  WINDOW_MS,
  WINDOW_LADDER,
  MIN_BAR_PX,
  autoBarWindow,
  type BarReducer,
  type SeriesWindow,
} from './aggregate.js';
export {
  applyDerived,
  applyDerivedReport,
  COMPARE_PREFIX,
  deriveId,
  deriveLineage,
  inputNames,
  substituteInput,
  hasPairOp,
  isBrokenId,
  isPairOp,
  isValidSpec,
  opHasPeriod,
  PERIOD_BOUNDS,
  readNumericColumn,
  partStudyLabel,
  readPart,
  readPairParts,
  specUnit,
  studyCatalog,
  TIDAL_OPS,
  BAND_OUTPUTS,
  opParams,
  studyTag,
  opIsBand,
  opInputs,
  opIsMulti,
  opOutputs,
  opNeedsColumns,
  TARGET_ROLES,
  opSharesSourceAxis,
  type OpParam,
  usesCompare,
  type DeriveSkip,
  type PairPart,
  type PartStudy,
  type StudyOption,
  type NumericColumnReader,
  DEFAULT_PERIOD,
  type DeriveInput,
  type DeriveSpec,
  type DeriveOp,
  type TidalOp,
  type PairOp,
} from './derive.js';
export { joinUnderPrefix } from './join.js';
export { columnExtent } from './extent.js';
export {
  snapshotToTimeSeries,
  appendToRows,
  type PondSnapshot,
  type PondAppend,
  type PondValue,
  type WireColumnSpec,
} from './columnar.js';
export {
  exactSessionSegments,
  inferBarMs,
  sessionOpenLine,
  sessionSegments,
  shiftKeys,
  type Segment,
  type SessionSegmentOptions,
} from './sessions.js';
export { monthlyExpirations, thirdFriday } from './expirations.js';
export { holdVolAcrossGrid } from './regrid.js';

// The corpus adoption (TDL-STUDYCAT). `ADOPTED_STUDIES` is exported so the
// count is assertable and a widening of `adoptable` is a visible edit.
export {
  ADOPTED_STUDIES,
  adoptable,
  isBandShape,
  outputMark,
  studyNeedsColumns,
} from './studyCatalog.js';

// The two zones: what the data IS, and what the axis reads in (TDL-TZAXIS).
export {
  DATA_TIME_ZONE,
  LOCAL_ZONE,
  TIME_ZONE_CHOICES,
  resolveTimeZone,
  timeZoneLabel,
  type TimeZoneChoice,
} from './timeZone.js';
