import type { AnalysisSnapshot, SpanStationResult } from './types';

export type InterpolatedStationField =
  | 'deflectionM'
  | 'elasticTwistDeg'
  | 'liftPerSpanNpm'
  | 'yieldMargin';

/** Linear interpolation shared by the visual field and numeric readout. */
export function interpolateStationValue(
  analysis: AnalysisSnapshot,
  eta: number,
  field: InterpolatedStationField,
): number | null {
  const stations = analysis.stations;
  if (stations.length === 0) return field === 'yieldMargin' ? null : 0;
  const boundedEta = Math.min(1, Math.max(0, eta));
  const upperIndex = stations.findIndex((station) => station.eta >= boundedEta);
  if (upperIndex <= 0) return stations[0][field];
  if (upperIndex === -1) return stations[stations.length - 1][field];

  const lower: SpanStationResult = stations[upperIndex - 1];
  const upper: SpanStationResult = stations[upperIndex];
  const lowerValue = lower[field];
  const upperValue = upper[field];
  if (lowerValue === null || upperValue === null) return null;
  const fraction = (boundedEta - lower.eta) / (upper.eta - lower.eta);
  return lowerValue + (upperValue - lowerValue) * fraction;
}
