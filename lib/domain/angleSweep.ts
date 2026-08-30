import type { AnalysisSnapshot, AngleSweepPoint } from './types';

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
