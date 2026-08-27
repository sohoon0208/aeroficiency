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
  const stations = coupled.structure.nodes.map((node): SpanStationResult => ({
    eta: node.eta,
    yM: node.yM,
    chordM: node.chordM,
    geometricTwistDeg: degrees(geometricTwistAtY(design.geometry, node.yM)),
    liftPerSpanNpm: node.eta >= 1 - 1e-12 ? 0 : interpolateLinear(node.eta, stripEta, liftPerSpan),
    circulationM2s: node.eta >= 1 - 1e-12 ? 0 : interpolateLinear(node.eta, stripEta, circulation),
    shearN: node.shearN,
    bendingMomentNm: node.bendingMomentNm,
    torqueNm: node.torqueNm,
    deflectionM: node.deflectionM,
    elasticTwistDeg: degrees(node.elasticTwistRad),
    bendingStiffnessNm2: node.bendingStiffnessNm2,
    torsionalStiffnessNm2: node.torsionalStiffnessNm2,
    vonMisesStressPa: node.stress.maxVonMisesPa,
    yieldMargin: node.stress.yieldMargin,
  }));
  const status: AnalysisSnapshot['status'] = coupled.status === 'converged' ? 'converged' : 'not_converged';
  const metrics: AnalysisSnapshot['metrics'] = {
    wingAreaM2: wingArea(design.geometry),
    aspectRatio: wingAspectRatio(design.geometry),
    structuralMassKg: coupled.structure.structuralMassKg,
    liftN: coupled.aero.liftN,
    liftCoefficient: coupled.aero.liftCoefficient,
    inducedDragN: coupled.aero.inducedDragN,
    inducedDragCoefficientEstimate: coupled.aero.inducedDragCoefficient,
    spanEfficiencyEstimate: null,
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
