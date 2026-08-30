import { createEntityId } from '@/lib/domain/ids';
import { MODEL_WARNINGS } from '@/lib/domain/limits';
import { evaluateDesignConstraints } from '@/lib/domain/constraints';
import { designInputFingerprint } from '@/lib/domain/validation';
import type {
  AnalysisSnapshot,
  ProjectState,
  SolverFidelity,
  SpanStationResult,
  WingDesign,
} from '@/lib/domain/types';
import { runAeroelasticCoupling, type CouplingProgress } from './coupling';
import { degrees, interpolateLinear } from './math';
import { localAirfoilSection } from './airfoilSections';
import { geometricTwistAtY, wingArea, wingAspectRatio } from './planform';

export interface AnalysisRuntime {
  now: () => string;
  createAnalysisId: () => AnalysisSnapshot['analysisId'];
}

const defaultRuntime: AnalysisRuntime = {
  now: () => new Date().toISOString(),
  createAnalysisId: () => createEntityId('ana'),
};

export function buildAnalysisSnapshot(
  state: ProjectState,
  design: WingDesign,
  fidelity: SolverFidelity,
  signal?: AbortSignal,
  onProgress?: (progress: CouplingProgress) => void,
  runtime: AnalysisRuntime = defaultRuntime,
): AnalysisSnapshot {
  const coupled = runAeroelasticCoupling(design, state.flightCase, fidelity, signal, onProgress);
  const positiveStrips = coupled.aero.strips.filter((strip) => strip.yStartM >= -1e-12).sort((a, b) => a.etaMid - b.etaMid);
  const stripEta = positiveStrips.map((strip) => strip.etaMid);
  const liftPerSpan = positiveStrips.map((strip) => strip.liftPerSpanNpm);
  const circulation = positiveStrips.map((strip) => strip.circulationM2s);
  const downwash = positiveStrips.map((strip) => -strip.inducedVelocityMps[2]);
  const inducedDragPerSpan = positiveStrips.map((strip) => strip.inducedDragN / (strip.yEndM - strip.yStartM));
  const pitchingMoment = positiveStrips.map((strip) => strip.pitchingMomentCoefficient);
  const sectionalLiftCoefficient = positiveStrips.map((strip) => strip.sectionalLiftCoefficient);
  const profileDragCoefficient = positiveStrips.map((strip) => strip.profileDragCoefficient);
  const profileDragPerSpan = positiveStrips.map((strip) => strip.profileDragN / (strip.yEndM - strip.yStartM));
  const stations = coupled.structure.nodes.map((node): SpanStationResult => {
    const retainedDownwashMps = node.eta >= 1 - 1e-12 ? 0 : interpolateLinear(node.eta, stripEta, downwash);
    const nearestStrip = positiveStrips.reduce((nearest, strip) => Math.abs(strip.etaMid - node.eta) < Math.abs(nearest.etaMid - node.eta) ? strip : nearest);
    const localSection = localAirfoilSection(design.geometry, node.eta, 80);
    return {
      eta: node.eta,
      yM: node.yM,
      chordM: node.chordM,
      geometricTwistDeg: degrees(geometricTwistAtY(design.geometry, node.yM)),
      liftPerSpanNpm: node.eta >= 1 - 1e-12 ? 0 : interpolateLinear(node.eta, stripEta, liftPerSpan),
      circulationM2s: node.eta >= 1 - 1e-12 ? 0 : interpolateLinear(node.eta, stripEta, circulation),
      downwashMps: retainedDownwashMps,
      inducedAngleDeg: degrees(Math.atan2(retainedDownwashMps, state.flightCase.velocityMps)),
      inducedDragPerSpanNpm: node.eta >= 1 - 1e-12 ? 0 : interpolateLinear(node.eta, stripEta, inducedDragPerSpan),
      airfoilLabel: localSection.label,
      zeroLiftAngleDeg: degrees(localSection.zeroLiftAngleRad),
      pitchingMomentCoefficient: interpolateLinear(node.eta, stripEta, pitchingMoment),
      reynoldsNumber: state.flightCase.airDensityKgM3 * state.flightCase.velocityMps * node.chordM / state.flightCase.dynamicViscosityPaS,
      sectionalLiftCoefficient: node.eta >= 1 - 1e-12 ? 0 : interpolateLinear(node.eta, stripEta, sectionalLiftCoefficient),
      profileDragCoefficient: interpolateLinear(node.eta, stripEta, profileDragCoefficient),
      profileDragPerSpanNpm: node.eta >= 1 - 1e-12 ? 0 : interpolateLinear(node.eta, stripEta, profileDragPerSpan),
      polarState: nearestStrip.polarState,
      shearN: node.shearN,
      bendingMomentNm: node.bendingMomentNm,
      torqueNm: node.torqueNm,
      deflectionM: node.deflectionM,
      elasticTwistDeg: degrees(node.elasticTwistRad),
      bendingStiffnessNm2: node.bendingStiffnessNm2,
      torsionalStiffnessNm2: node.torsionalStiffnessNm2,
      vonMisesStressPa: node.stress.maxVonMisesPa,
      yieldMargin: node.stress.yieldMargin,
    };
  });
  const status: AnalysisSnapshot['status'] = coupled.status === 'converged' ? 'converged' : 'not_converged';
  const metrics: AnalysisSnapshot['metrics'] = {
    wingAreaM2: wingArea(design.geometry),
    aspectRatio: wingAspectRatio(design.geometry),
    structuralMassKg: coupled.structure.structuralMassKg,
    liftN: coupled.aero.liftN,
    liftCoefficient: coupled.aero.liftCoefficient,
    inducedDragN: coupled.aero.inducedDragN,
    inducedDragCoefficientEstimate: coupled.aero.inducedDragCoefficient,
    profileDragEstimateN: coupled.aero.profileDragN,
    profileDragCoefficientEstimate: coupled.aero.profileDragCoefficient,
    combinedWingDragEstimateN: coupled.aero.combinedDragN,
    combinedDragCoefficientEstimate: coupled.aero.combinedDragCoefficient,
    estimatedWingLiftToDrag: coupled.aero.estimatedLiftToDrag,
    spanEfficiencyEstimate: coupled.aero.spanEfficiencyEstimate,
    trimmedAlphaDeg: degrees(coupled.aero.alphaRad),
    tipDeflectionM: coupled.structure.tipDeflectionM,
    tipElasticTwistDeg: degrees(coupled.structure.tipElasticTwistRad),
    minYieldMargin: coupled.structure.minimumYieldMargin,
    maxBendingStressPa: coupled.structure.maxBendingStressPa,
    maxTorsionalShearPa: coupled.structure.maxTorsionalShearPa,
  };
  return {
    analysisId: runtime.createAnalysisId(),
    designId: design.designId,
    designKind: design.kind,
    status,
    designRevision: design.revision,
    flightCaseRevision: state.flightCase.revision,
    constraintsRevision: state.constraints.revision,
    fidelity,
    solverVersion: state.solverVersion,
    inputFingerprint: designInputFingerprint(state, design, fidelity),
    createdAt: runtime.now(),
    convergence: {
      iterations: coupled.diagnostics.iterations,
      equilibriumResidual: coupled.diagnostics.equilibriumResidualRad,
      twistChangeDeg: degrees(coupled.diagnostics.iterateChangeRad),
      relativeLoadChange: coupled.diagnostics.relativeLoadChange,
      targetLiftErrorPct: 100 * coupled.diagnostics.relativeLiftError,
    },
    metrics,
    stations,
    polarDiagnostics: {
      model: design.geometry.polarModel.kind === 'USER_TABLES' ? 'user_section_polars' : 'analytic_attached_polar',
      profileDragAvailable: true,
      withinRangeStations: positiveStrips.filter((strip) => strip.polarState === 'within_range').length,
      analyticEstimateStations: positiveStrips.filter((strip) => strip.polarState === 'analytic_estimate').length,
      extrapolatedAlphaStations: positiveStrips.filter((strip) => strip.polarState === 'extrapolated_alpha').length,
      outsideReynoldsStations: positiveStrips.filter((strip) => strip.polarState === 'outside_reynolds').length,
      outsideAlphaStations: positiveStrips.filter((strip) => strip.polarState === 'outside_alpha').length,
      reynoldsRange: [Math.min(...positiveStrips.map((strip) => strip.reynoldsNumber)), Math.max(...positiveStrips.map((strip) => strip.reynoldsNumber))],
      effectiveAlphaRangeDeg: [Math.min(...positiveStrips.map((strip) => degrees(strip.effectiveAlphaRad))), Math.max(...positiveStrips.map((strip) => degrees(strip.effectiveAlphaRad)))],
      provenance: [...new Set(positiveStrips.map((strip) => strip.polarProvenance))].slice(0, 6),
    },
    constraints: evaluateDesignConstraints(
      state,
      design,
      fidelity,
      status,
      metrics.structuralMassKg,
      metrics.inducedDragN,
      metrics.minYieldMargin,
      metrics.tipDeflectionM,
    ),
    warnings: [...MODEL_WARNINGS],
  };
}
