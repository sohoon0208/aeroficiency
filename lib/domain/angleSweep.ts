import type { AnalysisSnapshot, AngleSweepPoint, SpanStationResult } from './types';

export interface AngleSweepPresentation {
  point: AngleSweepPoint;
  analysis: AnalysisSnapshot;
  source: 'solved' | 'interpolated' | 'snapped';
  lowerAlphaDeg: number;
  upperAlphaDeg: number;
}

export function convergedSweepPoints(analysis: AnalysisSnapshot) {
  return analysis.angleSweep.points.filter((point) => point.status === 'converged');
}

export function sweepPointAtAngle(analysis: AnalysisSnapshot, requestedAlphaDeg?: number | null): AngleSweepPoint | null {
  const points = convergedSweepPoints(analysis);
  if (!points.length) return null;
  const requested = Number.isFinite(requestedAlphaDeg) ? requestedAlphaDeg as number : analysis.angleSweep.trimAlphaDeg;
  return points.reduce((nearest, point) => Math.abs(point.alphaDeg - requested) < Math.abs(nearest.alphaDeg - requested) ? point : nearest);
}

export function analysisAtSweepPoint(analysis: AnalysisSnapshot, point: AngleSweepPoint): AnalysisSnapshot {
  return {
    ...analysis,
    status: point.status,
    convergence: point.convergence,
    metrics: point.metrics,
    stations: point.stations,
    polarDiagnostics: point.polarDiagnostics,
  };
}

function interpolateNumber(lower: number, upper: number, fraction: number) {
  return lower + (upper - lower) * fraction;
}

/** Interpolates only finite numeric fields; labels and nullable states use the nearer solved point. */
function interpolateRecord<T extends object>(lower: T, upper: T, fraction: number): T {
  const nearest = fraction < 0.5 ? lower : upper;
  return Object.fromEntries(Object.entries(lower).map(([key, lowerValue]) => {
    const upperValue = upper[key as keyof T];
    if (typeof lowerValue === 'number' && typeof upperValue === 'number') {
      return [key, interpolateNumber(lowerValue, upperValue, fraction)];
    }
    return [key, nearest[key as keyof T]];
  })) as T;
}

function interpolateStations(lower: SpanStationResult[], upper: SpanStationResult[], fraction: number) {
  if (lower.length !== upper.length || lower.some((station, index) => Math.abs(station.eta - upper[index].eta) > 1e-10)) {
    return fraction < 0.5 ? lower : upper;
  }
  return lower.map((station, index) => interpolateRecord(station, upper[index], fraction));
}

/**
 * Creates a presentation-only state between adjacent converged sweep solves.
 * Exact immutable points remain untouched; failed gaps snap to the nearest
 * converged point instead of implying evidence that was never solved.
 */
export function sweepPresentationAtAngle(
  analysis: AnalysisSnapshot,
  requestedAlphaDeg?: number | null,
): AngleSweepPresentation | null {
  const allPoints = [...analysis.angleSweep.points].sort((left, right) => left.alphaDeg - right.alphaDeg);
  const converged = allPoints.filter((point) => point.status === 'converged');
  if (!converged.length) return null;
  const requested = Number.isFinite(requestedAlphaDeg) ? requestedAlphaDeg as number : analysis.angleSweep.trimAlphaDeg;
  const bounded = Math.max(converged[0].alphaDeg, Math.min(converged.at(-1)!.alphaDeg, requested));
  const exact = converged.find((point) => Math.abs(point.alphaDeg - bounded) <= 1e-10);
  if (exact) {
    return {
      point: exact,
      analysis: analysisAtSweepPoint(analysis, exact),
      source: 'solved',
      lowerAlphaDeg: exact.alphaDeg,
      upperAlphaDeg: exact.alphaDeg,
    };
  }

  const upperIndex = allPoints.findIndex((point) => point.alphaDeg > bounded);
  const lower = upperIndex > 0 ? allPoints[upperIndex - 1] : null;
  const upper = upperIndex >= 0 ? allPoints[upperIndex] : null;
  if (!lower || !upper || lower.status !== 'converged' || upper.status !== 'converged') {
    const nearest = sweepPointAtAngle(analysis, bounded)!;
    return {
      point: nearest,
      analysis: analysisAtSweepPoint(analysis, nearest),
      source: 'snapped',
      lowerAlphaDeg: nearest.alphaDeg,
      upperAlphaDeg: nearest.alphaDeg,
    };
  }

  const fraction = (bounded - lower.alphaDeg) / (upper.alphaDeg - lower.alphaDeg);
  const nearest = fraction < 0.5 ? lower : upper;
  const metrics = interpolateRecord(lower.metrics, upper.metrics, fraction);
  metrics.trimmedAlphaDeg = bounded;
  metrics.combinedWingDragEstimateN = metrics.inducedDragN + metrics.profileDragEstimateN;
  metrics.combinedDragCoefficientEstimate = (metrics.inducedDragCoefficientEstimate ?? 0) + metrics.profileDragCoefficientEstimate;
  metrics.estimatedWingLiftToDrag = metrics.combinedWingDragEstimateN > 0 ? metrics.liftN / metrics.combinedWingDragEstimateN : 0;
  const stations = interpolateStations(lower.stations, upper.stations, fraction);
  const finiteYieldMargins = stations.flatMap((station) => station.yieldMargin === null ? [] : [station.yieldMargin]);
  if (finiteYieldMargins.length) metrics.minYieldMargin = Math.min(...finiteYieldMargins);
  const point: AngleSweepPoint = {
    alphaDeg: bounded,
    status: 'converged',
    convergence: nearest.convergence,
    metrics,
    stations,
    polarDiagnostics: nearest.polarDiagnostics,
  };
  return {
    point,
    analysis: analysisAtSweepPoint(analysis, point),
    source: 'interpolated',
    lowerAlphaDeg: lower.alphaDeg,
    upperAlphaDeg: upper.alphaDeg,
  };
}
