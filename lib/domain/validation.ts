import { ALUMINUM_2024_T3, DESIGN_LIMITS, SOLVER_SETTINGS } from './limits';
import { inputFingerprint } from './ids';
import type {
  AnalysisFreshness,
  DomainIssue,
  FlightCase,
  ProjectState,
  WingDesign,
  WingGeometry,
  WingStructure,
} from './types';
import { nacaSurfacePoint, parseNaca4 } from '@/lib/solver/naca';

const NACA_PATTERN = /^(00(0[6-9]|1[0-9]|2[0-4])|[1-6][1-9](0[6-9]|1[0-9]|2[0-4]))$/;

function inRange(value: number, range: readonly [number, number]) {
  return Number.isFinite(value) && value >= range[0] && value <= range[1];
}

export function wingAreaM2(geometry: WingGeometry) {
  return geometry.spanM * (geometry.rootChordM + geometry.tipChordM) / 2;
}

export function aspectRatio(geometry: WingGeometry) {
  return geometry.spanM ** 2 / wingAreaM2(geometry);
}

export function validateGeometry(geometry: WingGeometry): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const fields: Array<[keyof WingGeometry, readonly [number, number]]> = [
    ['spanM', DESIGN_LIMITS.spanM],
    ['rootChordM', DESIGN_LIMITS.rootChordM],
    ['tipChordM', DESIGN_LIMITS.tipChordM],
    ['rootTwistDeg', DESIGN_LIMITS.rootTwistDeg],
    ['tipTwistDeg', DESIGN_LIMITS.tipTwistDeg],
  ];
  for (const [field, range] of fields) {
    const value = geometry[field];
    if (typeof value !== 'number' || !inRange(value, range)) {
      issues.push({ path: `geometry.${field}`, reason: `Must be finite and within ${range[0]}–${range[1]}.` });
    }
  }
  if (!NACA_PATTERN.test(geometry.nacaCode)) {
    issues.push({ path: 'geometry.nacaCode', reason: 'Use a supported four-digit NACA code with 6–24% thickness.' });
  }
  if (geometry.tipChordM > geometry.rootChordM) {
    issues.push({ path: 'geometry.tipChordM', reason: 'Tip chord cannot exceed root chord in the challenge model.' });
  }
  if (geometry.rootTwistDeg !== 0) {
    issues.push({ path: 'geometry.rootTwistDeg', reason: 'Root twist is fixed at 0 degrees in the validated challenge model.' });
  }
  const taper = geometry.tipChordM / geometry.rootChordM;
  if (!inRange(taper, DESIGN_LIMITS.taperRatio)) {
    issues.push({ path: 'geometry.tipChordM', reason: `Taper ratio must remain within ${DESIGN_LIMITS.taperRatio[0]}–${DESIGN_LIMITS.taperRatio[1]}.` });
  }
  const ratio = aspectRatio(geometry);
  if (!inRange(ratio, DESIGN_LIMITS.aspectRatio)) {
    issues.push({ path: 'geometry.spanM', reason: `Aspect ratio ${ratio.toFixed(2)} is outside the supported ${DESIGN_LIMITS.aspectRatio[0]}–${DESIGN_LIMITS.aspectRatio[1]} range.` });
  }
  return issues;
}

export function validateStructure(structure: WingStructure): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const fields: Array<[keyof WingStructure, readonly [number, number]]> = [
    ['skinThicknessMm', DESIGN_LIMITS.skinThicknessMm],
    ['frontWebThicknessMm', DESIGN_LIMITS.frontWebThicknessMm],
    ['rearWebThicknessMm', DESIGN_LIMITS.rearWebThicknessMm],
    ['frontSparXOverC', DESIGN_LIMITS.frontSparXOverC],
    ['rearSparXOverC', DESIGN_LIMITS.rearSparXOverC],
    ['elasticAxisXOverC', DESIGN_LIMITS.elasticAxisXOverC],
  ];
  for (const [field, range] of fields) {
    const value = structure[field];
    if (typeof value !== 'number' || !inRange(value, range)) {
      issues.push({ path: `structure.${field}`, reason: `Must be finite and within ${range[0]}–${range[1]}.` });
    }
  }
  if (structure.frontSparXOverC + 0.15 >= structure.rearSparXOverC) {
    issues.push({ path: 'structure.rearSparXOverC', reason: 'Rear spar must remain at least 0.15c behind the front spar.' });
  }
  if (structure.frontSparXOverC !== 0.2 || structure.rearSparXOverC !== 0.65) {
    issues.push({ path: 'structure.frontSparXOverC', reason: 'Spar positions are fixed at 0.20c and 0.65c in the validated challenge model.' });
  }
  if (structure.elasticAxisXOverC <= structure.frontSparXOverC || structure.elasticAxisXOverC >= structure.rearSparXOverC) {
    issues.push({ path: 'structure.elasticAxisXOverC', reason: 'Elastic axis must lie inside the modeled wing box.' });
  }
  if (structure.material !== 'aluminum_2024_t3') {
    issues.push({ path: 'structure.material', reason: 'Only the disclosed Aluminum 2024-T3 preset is supported.' });
  }
  return issues;
}

export function validateFlightCase(flightCase: FlightCase): DomainIssue[] {
  const issues: DomainIssue[] = [];
  if (!Number.isInteger(flightCase.revision) || flightCase.revision < 1) issues.push({ path: 'flightCase.revision', reason: 'Flight-case revision must be a positive integer.' });
  if (flightCase.mode !== 'target_lift') issues.push({ path: 'flightCase.mode', reason: 'Only the target-lift flight case is supported.' });
  if (!inRange(flightCase.targetLiftN, DESIGN_LIMITS.targetLiftN)) issues.push({ path: 'flightCase.targetLiftN', reason: `Target lift must remain within ${DESIGN_LIMITS.targetLiftN[0]}–${DESIGN_LIMITS.targetLiftN[1]} N.` });
  if (!inRange(flightCase.velocityMps, DESIGN_LIMITS.velocityMps)) issues.push({ path: 'flightCase.velocityMps', reason: `Velocity must remain within ${DESIGN_LIMITS.velocityMps[0]}–${DESIGN_LIMITS.velocityMps[1]} m/s.` });
  if (!inRange(flightCase.altitudeM, DESIGN_LIMITS.altitudeM)) issues.push({ path: 'flightCase.altitudeM', reason: `Altitude must remain within ${DESIGN_LIMITS.altitudeM[0]}–${DESIGN_LIMITS.altitudeM[1]} m.` });
  if (!inRange(flightCase.airDensityKgM3, [0.25, 1.5])) issues.push({ path: 'flightCase.airDensityKgM3', reason: 'Air density must be finite and within 0.25–1.50 kg/m³.' });
  if (!inRange(flightCase.dynamicViscosityPaS, [1e-5, 2.5e-5])) issues.push({ path: 'flightCase.dynamicViscosityPaS', reason: 'Dynamic viscosity must be finite and within the supported atmospheric range.' });
  return issues;
}

export function validateDesign(geometry: WingGeometry, structure: WingStructure): DomainIssue[] {
  const issues = [...validateGeometry(geometry), ...validateStructure(structure)];
  if (issues.length) return issues;
  try {
    const section = parseNaca4(geometry.nacaCode);
    const front = nacaSurfacePoint(structure.frontSparXOverC, section);
    const rear = nacaSurfacePoint(structure.rearSparXOverC, section);
    const chordM = geometry.tipChordM;
    const points = [
      [structure.frontSparXOverC * chordM, front.zUpper * chordM],
      [structure.rearSparXOverC * chordM, rear.zUpper * chordM],
      [structure.rearSparXOverC * chordM, rear.zLower * chordM],
      [structure.frontSparXOverC * chordM, front.zLower * chordM],
    ] as const;
    const dimensions = points.map((point, index) => {
      const next = points[(index + 1) % points.length];
      return Math.hypot(next[0] - point[0], next[1] - point[1]);
    });
    const minimumDimensionM = Math.min(...dimensions);
    const maximumGaugeM = Math.max(structure.skinThicknessMm, structure.frontWebThicknessMm, structure.rearWebThicknessMm) / 1000;
    if (!Number.isFinite(minimumDimensionM) || minimumDimensionM <= 0 || maximumGaugeM > 0.1 * minimumDimensionM) {
      issues.push({ path: 'structure', reason: `Tip-section gauges exceed the thin-wall limit for this geometry; maximum supported local gauge is ${(100 * minimumDimensionM).toFixed(3)} mm.` });
    }
  } catch (error) {
    issues.push({ path: 'geometry.nacaCode', reason: error instanceof Error ? error.message : 'Airfoil geometry could not be validated.' });
  }
  return issues;
}

export function designInputFingerprint(state: ProjectState, design: WingDesign, fidelity: string) {
  const flightCase = { ...state.flightCase };
  delete (flightCase as Partial<typeof flightCase>).revision;
  return inputFingerprint({
    geometry: design.geometry,
    structure: design.structure,
    flightCase,
    resolvedMaterial: ALUMINUM_2024_T3,
    resolvedSettings: {
      fidelity: fidelity === 'fast' ? SOLVER_SETTINGS.fast : SOLVER_SETTINGS.standard,
      vortexCoreRatio: SOLVER_SETTINGS.vortexCoreRatio,
      alphaBracketDeg: SOLVER_SETTINGS.alphaBracketDeg,
      trimMaxIterations: SOLVER_SETTINGS.trimMaxIterations,
      trimRelativeLiftTolerance: SOLVER_SETTINGS.trimRelativeLiftTolerance,
      trimAlphaToleranceRad: SOLVER_SETTINGS.trimAlphaToleranceRad,
      couplingMaxIterations: SOLVER_SETTINGS.couplingMaxIterations,
      relaxationFactor: SOLVER_SETTINGS.relaxationFactor,
      equilibriumToleranceRad: SOLVER_SETTINGS.equilibriumToleranceRad,
      iterateChangeToleranceRad: SOLVER_SETTINGS.iterateChangeToleranceRad,
      relativeLoadTolerance: SOLVER_SETTINGS.relativeLoadTolerance,
      coupledLiftTolerance: SOLVER_SETTINGS.coupledLiftTolerance,
      modelFlags: SOLVER_SETTINGS.modelFlags,
    },
    solverVersion: state.solverVersion,
    fidelity,
  });
}

export function designAnalysisFreshness(state: ProjectState, design: WingDesign): AnalysisFreshness {
  if (!design.latestAnalysisId) return 'unavailable';
  const analysis = state.analyses[design.latestAnalysisId];
  if (!analysis) return 'unavailable';
  const fingerprint = designInputFingerprint(state, design, analysis.fidelity);
  const revisionsMatch = analysis.designRevision === design.revision
    && analysis.flightCaseRevision === state.flightCase.revision
    && analysis.constraintsRevision === state.constraints.revision;
  return analysis.inputFingerprint === fingerprint && revisionsMatch && analysis.status === 'converged' ? 'current' : 'stale';
}

export function currentAnalysis(state: ProjectState, design: WingDesign) {
  if (!design.latestAnalysisId || designAnalysisFreshness(state, design) !== 'current') return null;
  return state.analyses[design.latestAnalysisId] ?? null;
}
