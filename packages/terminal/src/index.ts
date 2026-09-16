/**
 * The terminal module barrel — the extraction candidate's public API. Exports
 * the **provider** + **hooks** (read selectors + narrow command senders), the
 * public **types** (rows / preset / catalog-entry / storage), and the event
 * union — the pre-paid bus contract. The actor context + machine internals stay
 * private to the module.
 */
export {
  TerminalProvider,
  useRows,
  useSelectedSeries,
  useExpandedSeries,
  useControlsOpen,
  usePresetSaved,
  useActiveSlot,
  useAddSeries,
  useAddPair,
  useCompareAll,
  useAddStudy,
  useSetStudyParam,
  useOrderSeries,
  useReindexSeries,
  useMoveSeriesToRow,
  useMoveToAxis,
  useRemoveSeries,
  usePatchSeries,
  useToggleVisible,
  useToggleGroupVisible,
  useRemoveGroup,
  useSelectSeries,
  useExpandSeries,
  useSetControlsOpen,
  useSelectPreset,
  useSavePreset,
  useSetRowHeights,
  useAddRow,
  useRemoveRow,
  useAxisRanges,
  useToggleAxisLink,
  useSwapAxisSide,
  useSetAxisRange,
  useSetAxisAuto,
  useSetAxisLocks,
  useSetAxisAutoOpts,
  useSetAxisFormat,
  useTerminalHotkeys,
  type TerminalProviderProps,
} from './context.js';
export {
  PRESET_SLOTS,
  MAX_ROWS,
  activeSlot,
  canonRows,
  columnLabel,
  columnUnits,
  entryColumn,
  groupMembers,
  mintId,
  axisMoveAllowed,
  linkToggleAllowed,
  respecAllowed,
  studyChainTail,
  studyOfferable,
  SOURCE_COLUMNS,
  swapAllowed,
  type EditScope,
  type RowState,
  type TerminalPreset,
  type MetricEntry,
  type PairLegInput,
  type PresetStorage,
  type TerminalEvent,
  type TerminalInput,
} from './terminalMachine.js';
// The axis policy a host's MENUS gate on — the same predicates the machine's
// guards enforce, exported so the two cannot disagree (0.1.0 left them internal;
// a host had to keep its own copy).
export {
  axisBindings,
  allowedAxes,
  canAddUnit,
  axisForAdd,
  type AxisMember,
} from './axisPolicy.js';
