import type { AnalysisSnapshot, FlightCase, WingDesign } from '@/lib/domain/types';
import { interpolateStationValue } from '@/lib/domain/stations';
import { chordAtY } from '@/lib/solver/planform';

export interface SectionCondition {
  analysisId: AnalysisSnapshot['analysisId'];
  eta: number;
  yM: number;
  chordM: number;
  geometricTwistDeg: number;
  elasticTwistDeg: number;
  trimIncidenceDeg: number;
  inducedAngleDeg: number;
  localIncidenceDeg: number;
  reynoldsNumber: number;
}

export function deriveSectionCondition(
  design: WingDesign,
  analysis: AnalysisSnapshot,
  flightCase: FlightCase,
  requestedEta: number,
): SectionCondition {
  if (analysis.designId !== design.designId) throw new Error('The selected analysis does not belong to the selected design.');
  if (analysis.status !== 'converged') throw new Error('A converged analysis is required for the section diagnostic.');
  const eta = Math.max(0, Math.min(1, requestedEta));
  const yM = eta * design.geometry.spanM / 2;
  const chordM = chordAtY(design.geometry, yM);
  const geometricTwistDeg = design.geometry.rootTwistDeg + (design.geometry.tipTwistDeg - design.geometry.rootTwistDeg) * eta;
  const elasticTwistDeg = Number(interpolateStationValue(analysis, eta, 'elasticTwistDeg'));
  const inducedAngleDeg = Number(interpolateStationValue(analysis, eta, 'inducedAngleDeg'));
  const trimIncidenceDeg = analysis.metrics.trimmedAlphaDeg;
  const localIncidenceDeg = trimIncidenceDeg + geometricTwistDeg + elasticTwistDeg - inducedAngleDeg;
  const reynoldsNumber = flightCase.airDensityKgM3 * flightCase.velocityMps * chordM / flightCase.dynamicViscosityPaS;
  if (![chordM, geometricTwistDeg, elasticTwistDeg, inducedAngleDeg, trimIncidenceDeg, localIncidenceDeg, reynoldsNumber].every(Number.isFinite)) {
    throw new Error('The immutable analysis does not contain a finite local section condition.');
  }
  return {
    analysisId: analysis.analysisId,
    eta,
    yM,
    chordM,
    geometricTwistDeg,
    elasticTwistDeg,
    trimIncidenceDeg,
    inducedAngleDeg,
    localIncidenceDeg,
    reynoldsNumber,
  };
}
