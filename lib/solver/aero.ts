import type { FlightCase, WingGeometry } from '@/lib/domain/types';
import { SOLVER_SETTINGS } from '@/lib/domain/limits';
import { requiredTargetLiftCoefficient, validateFlightCase, validateGeometry } from '@/lib/domain/validation';
import { localAirfoilSection } from './airfoilSections';
import { evaluateSectionPolar, type PolarEvaluation } from './polars';
import { chordAtY, cosineSpanNodes, geometricTwistAtY, meanAerodynamicChord, wingArea, wingAspectRatio } from './planform';
import { add3, cross3, dot3, factorDense, interpolateLinear, NumericalError, scale3, solveDense, solveFactored, sub3, type Vec3 } from './math';
import { horseshoeVelocity, wakeOnlyVelocity } from './vortex';

export interface TwistField {
  eta: readonly number[];
  twistRad: readonly number[];
}

export interface AeroStripResult {
  index: number;
  yStartM: number;
  yEndM: number;
  yMidM: number;
  etaMid: number;
  chordM: number;
  geometricTwistRad: number;
  elasticTwistRad: number;
  circulationM2s: number;
  liftN: number;
  verticalForceN: number;
  liftPerSpanNpm: number;
  inducedDragN: number;
  inducedVelocityMps: Vec3;
  inducedAngleRad: number;
  effectiveAlphaRad: number;
  airfoilLabel: string;
  zeroLiftAngleRad: number;
  reynoldsNumber: number;
  sectionalLiftCoefficient: number;
  profileDragCoefficient: number;
  profileDragN: number;
  pitchingMomentCoefficient: number;
  pitchingMomentNmPerM: number;
  polarState: PolarEvaluation['state'];
  polarProvenance: string;
}

export interface AeroResult {
  alphaRad: number;
  liftN: number;
  verticalForceN: number;
  liftCoefficient: number;
  inducedDragN: number;
  inducedDragCoefficient: number;
  profileDragN: number;
  profileDragCoefficient: number;
  combinedDragN: number;
  combinedDragCoefficient: number;
  estimatedLiftToDrag: number;
  spanEfficiencyEstimate: number | null;
  strips: AeroStripResult[];
  relativeResidual: number;
  trimIterations: number;
  targetLiftError: number;
  symmetryError: number;
  panelCount: number;
  polarIterations: number;
  polarResidual: number;
}

export class AeroError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'TARGET_LIFT_UNBRACKETED' | 'TRIM_DID_NOT_CONVERGE' | 'VLM_SINGULAR' | 'NUMERICAL_FAILURE' | 'ABORTED', message: string) {
    super(message);
    this.name = 'AeroError';
  }
}

interface LatticeStrip {
  start: Vec3;
  end: Vec3;
  control: Vec3;
  normal: Vec3;
  yMidM: number;
  etaMid: number;
  chordM: number;
  geometricTwistRad: number;
  elasticTwistRad: number;
  zeroLiftAngleRad: number;
  quarterChordMomentCoefficient: number;
  airfoilLabel: string;
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new AeroError('ABORTED', 'Aerodynamic solve was aborted.');
}

function validateInputs(geometry: WingGeometry, flightCase: FlightCase, panelCount: number) {
  if (!Number.isInteger(panelCount) || panelCount < 16 || panelCount > 64 || panelCount % 2 !== 0) throw new AeroError('INVALID_INPUT', 'Full-span panel count must be an even integer from 16 to 64.');
  const issues = [...validateGeometry(geometry), ...validateFlightCase(flightCase)];
  if (issues.length) throw new AeroError('INVALID_INPUT', `${issues[0].path}: ${issues[0].reason}`);
  const area = wingArea(geometry);
  const dynamicPressure = 0.5 * flightCase.airDensityKgM3 * flightCase.velocityMps ** 2;
  const targetCl = requiredTargetLiftCoefficient(geometry, flightCase);
  if (![area, dynamicPressure, targetCl].every(Number.isFinite) || area <= 0 || dynamicPressure <= 0) throw new AeroError('INVALID_INPUT', 'Aerodynamic inputs must be finite and positive.');
  if (targetCl < SOLVER_SETTINGS.requiredTargetCl[0] || targetCl > SOLVER_SETTINGS.requiredTargetCl[1]) throw new AeroError('INVALID_INPUT', `Target lift requires CL ${targetCl.toFixed(3)}, outside the supported ${SOLVER_SETTINGS.requiredTargetCl[0]}–${SOLVER_SETTINGS.requiredTargetCl[1].toFixed(2)} range.`);
}

function validateTwistField(twistField: TwistField) {
  if (twistField.eta.length !== twistField.twistRad.length || twistField.eta.length < 2) throw new AeroError('INVALID_INPUT', 'Elastic-twist stations must use equal arrays with at least root and tip values.');
  if (twistField.eta.some((value) => !Number.isFinite(value)) || twistField.twistRad.some((value) => !Number.isFinite(value))) throw new AeroError('INVALID_INPUT', 'Elastic-twist stations must be finite.');
  if (Math.abs(twistField.eta[0]) > 1e-12 || Math.abs(twistField.eta[twistField.eta.length - 1] - 1) > 1e-12) throw new AeroError('INVALID_INPUT', 'Elastic-twist stations must cover normalized semispan 0–1.');
  for (let index = 1; index < twistField.eta.length; index += 1) {
    if (!(twistField.eta[index] > twistField.eta[index - 1])) throw new AeroError('INVALID_INPUT', 'Elastic-twist stations must increase strictly from root to tip.');
  }
}

function buildLattice(geometry: WingGeometry, twistField: TwistField, panelCount: number, signal?: AbortSignal) {
  const nodes = cosineSpanNodes(geometry.spanM, panelCount);
  const coreM = Math.max(1e-9, SOLVER_SETTINGS.vortexCoreRatio * meanAerodynamicChord(geometry));
  const strips: LatticeStrip[] = [];
  for (let index = 0; index < panelCount; index += 1) {
    checkAbort(signal);
    const yStartM = nodes[index];
    const yEndM = nodes[index + 1];
    const yMidM = (yStartM + yEndM) / 2;
    const etaMid = 2 * Math.abs(yMidM) / geometry.spanM;
    const chordM = chordAtY(geometry, yMidM);
    const geometricTwistRad = geometricTwistAtY(geometry, yMidM);
    const elasticTwistRad = interpolateLinear(etaMid, twistField.eta, twistField.twistRad);
    const section = localAirfoilSection(geometry, etaMid, 80);
    const physicalTwist = geometricTwistRad + elasticTwistRad;
    const normalAngle = physicalTwist - section.zeroLiftAngleRad;
    strips.push({
      start: [0, yStartM, 0],
      end: [0, yEndM, 0],
      control: [0.5 * chordM * Math.cos(physicalTwist), yMidM, -0.5 * chordM * Math.sin(physicalTwist)],
      normal: [Math.sin(normalAngle), 0, Math.cos(normalAngle)],
      yMidM,
      etaMid,
      chordM,
      geometricTwistRad,
      elasticTwistRad,
      zeroLiftAngleRad: section.zeroLiftAngleRad,
      quarterChordMomentCoefficient: section.quarterChordMomentCoefficient,
      airfoilLabel: section.label,
    });
  }
  const matrix = strips.map((target) => {
    checkAbort(signal);
    return strips.map((source) => dot3(horseshoeVelocity(target.control, source.start, source.end, coreM), target.normal));
  });
  try {
    const wakeDownwashInfluence = strips.map((target) => {
      const targetPoint = scale3(add3(target.start, target.end), 0.5);
      return strips.map((source) => -wakeOnlyVelocity(targetPoint, source.start, source.end, coreM)[2]);
    });
    return { strips, factor: factorDense(matrix), coreM, wakeDownwashInfluence };
  } catch (error) {
    throw new AeroError('VLM_SINGULAR', error instanceof Error ? error.message : 'VLM influence matrix is singular.');
  }
}

function solveAerodynamics(
  geometry: WingGeometry,
  flightCase: FlightCase,
  twistField: TwistField,
  panelCount: number,
  fixedAlphaDeg: number | null,
  signal?: AbortSignal,
): AeroResult {
  validateInputs(geometry, flightCase, panelCount);
  validateTwistField(twistField);
  checkAbort(signal);
  const { strips, factor, coreM, wakeDownwashInfluence } = buildLattice(geometry, twistField, panelCount, signal);
  const density = flightCase.airDensityKgM3;
  const velocity = flightCase.velocityMps;

  const solveAtAlpha = (alphaRad: number) => {
    checkAbort(signal);
    const freeStream: Vec3 = [velocity * Math.cos(alphaRad), 0, velocity * Math.sin(alphaRad)];
    const rightHandSide = strips.map((strip) => -dot3(freeStream, strip.normal));
    let circulation: number[];
    let relativeResidual: number;
    try {
      ({ solution: circulation, relativeResidual } = solveFactored(factor, rightHandSide));
    } catch (error) {
      const code = error instanceof NumericalError && error.code === 'SINGULAR_SYSTEM' ? 'VLM_SINGULAR' : 'NUMERICAL_FAILURE';
      throw new AeroError(code, error instanceof Error ? error.message : 'VLM circulation solve failed.');
    }
    type NonlinearTarget = PolarEvaluation & {
      effectiveAlphaRad: number;
      reynoldsNumber: number;
      downwash: number;
      liftSlopePerRad: number;
      circulationM2s: number;
    };
    const evaluateTargets = (candidateCirculation: readonly number[]): NonlinearTarget[] => strips.map((strip, index) => {
      const downwash = wakeDownwashInfluence[index].reduce((sum, influence, source) => sum + influence * candidateCirculation[source], 0);
      const inducedAngleRad = Math.atan2(downwash, velocity);
      const effectiveAlphaRad = alphaRad + strip.geometricTwistRad + strip.elasticTwistRad - inducedAngleRad;
      const reynoldsNumber = density * velocity * strip.chordM / flightCase.dynamicViscosityPaS;
      const evaluated = evaluateSectionPolar(geometry, strip.etaMid, reynoldsNumber, effectiveAlphaRad * 180 / Math.PI);
      const derivativeStepRad = 0.04 * Math.PI / 180;
      const plus = evaluateSectionPolar(geometry, strip.etaMid, reynoldsNumber, (effectiveAlphaRad + derivativeStepRad) * 180 / Math.PI);
      const minus = evaluateSectionPolar(geometry, strip.etaMid, reynoldsNumber, (effectiveAlphaRad - derivativeStepRad) * 180 / Math.PI);
      return {
        ...evaluated,
        effectiveAlphaRad,
        reynoldsNumber,
        downwash,
        liftSlopePerRad: (plus.cl - minus.cl) / (2 * derivativeStepRad),
        circulationM2s: 0.5 * velocity * strip.chordM * evaluated.cl,
      };
    });
    const residualFor = (candidateCirculation: readonly number[], targets: readonly NonlinearTarget[]) => {
      const vector = targets.map((target, index) => candidateCirculation[index] - target.circulationM2s);
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
      const scale = Math.max(1, Math.sqrt(targets.reduce((sum, target) => sum + target.circulationM2s ** 2, 0)));
      return { vector, normalized: norm / scale };
    };
    const maximumSectionCirculation = strips.map((strip) => 0.95 * velocity * strip.chordM);
    circulation = circulation.map((value, index) => Math.max(-maximumSectionCirculation[index], Math.min(maximumSectionCirculation[index], value)));
    let polarIterations = 0;
    let polarResidual = Number.POSITIVE_INFINITY;
    let polar: Array<PolarEvaluation & { effectiveAlphaRad: number; reynoldsNumber: number }> = [];
    for (; polarIterations < 40; polarIterations += 1) {
      checkAbort(signal);
      const targets = evaluateTargets(circulation);
      const residual = residualFor(circulation, targets);
      const residualVector = residual.vector;
      polarResidual = residual.normalized;
      polar = targets.map((target) => ({
        cl: target.cl,
        cd: target.cd,
        cm: target.cm,
        state: target.state,
        provenance: target.provenance,
        alphaRangeDeg: target.alphaRangeDeg,
        reynoldsRange: target.reynoldsRange,
        effectiveAlphaRad: target.effectiveAlphaRad,
        reynoldsNumber: target.reynoldsNumber,
      }));
      if (polarResidual <= 2e-7) {
        circulation = targets.map((target) => target.circulationM2s);
        break;
      }
      const jacobian = strips.map((strip, row) => strips.map((_, column) => {
        const inducedDerivative = velocity / (velocity ** 2 + targets[row].downwash ** 2) * wakeDownwashInfluence[row][column];
        const polarTerm = 0.5 * velocity * strip.chordM * targets[row].liftSlopePerRad * inducedDerivative;
        return (row === column ? 1 : 0) + polarTerm;
      }));
      let correction: number[];
      try {
        correction = solveDense(jacobian, residualVector.map((value) => -value)).solution;
      } catch (error) {
        throw new AeroError('NUMERICAL_FAILURE', error instanceof Error ? `Nonlinear polar Jacobian failed: ${error.message}` : 'Nonlinear polar Jacobian failed.');
      }
      let accepted = false;
      let step = 1;
      for (let search = 0; search < 12; search += 1) {
        const candidate = circulation.map((value, index) => {
          const next = value + step * correction[index];
          return Math.max(-maximumSectionCirculation[index], Math.min(maximumSectionCirculation[index], next));
        });
        const candidateResidual = residualFor(candidate, evaluateTargets(candidate)).normalized;
        if (Number.isFinite(candidateResidual) && candidateResidual < polarResidual * (1 - 1e-4 * step)) {
          circulation = candidate;
          accepted = true;
          break;
        }
        step *= 0.5;
      }
      if (!accepted) {
        const fixedPointStep = 0.08;
        circulation = circulation.map((value, index) => value - fixedPointStep * residualVector[index]);
      }
    }
    if (polarResidual > 2e-5 || !Number.isFinite(polarResidual)) throw new AeroError('NUMERICAL_FAILURE', `Nonlinear polar coupling stopped with residual ${polarResidual.toExponential(3)}.`);
    const liftDirection: Vec3 = [-Math.sin(alphaRad), 0, Math.cos(alphaRad)];
    let liftN = 0;
    let verticalForceN = 0;
    const forces = strips.map((strip, index) => {
      const bound = sub3(strip.end, strip.start);
      const force = scale3(cross3(freeStream, bound), density * circulation[index]);
      const lift = dot3(force, liftDirection);
      liftN += lift;
      verticalForceN += force[2];
      return { force, lift };
    });
    return { alphaRad, freeStream, circulation, forces, liftN, verticalForceN, relativeResidual: Math.max(relativeResidual, polarResidual), polar, polarIterations: polarIterations + 1, polarResidual };
  };

  const alphaLow = SOLVER_SETTINGS.alphaBracketDeg[0] * Math.PI / 180;
  const alphaHigh = SOLVER_SETTINGS.alphaBracketDeg[1] * Math.PI / 180;
  if (fixedAlphaDeg !== null && (!Number.isFinite(fixedAlphaDeg) || fixedAlphaDeg < SOLVER_SETTINGS.alphaBracketDeg[0] || fixedAlphaDeg > SOLVER_SETTINGS.alphaBracketDeg[1])) {
    throw new AeroError('INVALID_INPUT', `Fixed angle of attack must remain within ${SOLVER_SETTINGS.alphaBracketDeg[0]}–${SOLVER_SETTINGS.alphaBracketDeg[1]} degrees.`);
  }
  let current = fixedAlphaDeg === null ? solveAtAlpha(alphaLow) : solveAtAlpha(fixedAlphaDeg * Math.PI / 180);
  let trimIterations = 0;
  if (fixedAlphaDeg === null) {
    let low = current;
    let high = solveAtAlpha(alphaHigh);
    if (!(high.liftN > low.liftN)) throw new AeroError('TARGET_LIFT_UNBRACKETED', 'Lift is not monotonic over the supported trim bracket.');
    if ((low.liftN - flightCase.targetLiftN) * (high.liftN - flightCase.targetLiftN) > 0) throw new AeroError('TARGET_LIFT_UNBRACKETED', `Target lift ${flightCase.targetLiftN.toFixed(0)} N is outside the supported angle-of-attack bracket.`);
    current = Math.abs(low.liftN - flightCase.targetLiftN) < Math.abs(high.liftN - flightCase.targetLiftN) ? low : high;
    for (; trimIterations < SOLVER_SETTINGS.trimMaxIterations; trimIterations += 1) {
      checkAbort(signal);
      const mid = solveAtAlpha((low.alphaRad + high.alphaRad) / 2);
      current = mid;
      const relativeError = Math.abs(mid.liftN - flightCase.targetLiftN) / flightCase.targetLiftN;
      if (relativeError <= SOLVER_SETTINGS.trimRelativeLiftTolerance || Math.abs(high.alphaRad - low.alphaRad) <= SOLVER_SETTINGS.trimAlphaToleranceRad) break;
      if (mid.liftN < flightCase.targetLiftN) low = mid; else high = mid;
    }
  }
  const targetLiftError = (current.liftN - flightCase.targetLiftN) / flightCase.targetLiftN;
  if (fixedAlphaDeg === null && Math.abs(targetLiftError) > 1e-5) throw new AeroError('TRIM_DID_NOT_CONVERGE', `Target-lift trim stopped with ${(100 * targetLiftError).toExponential(2)}% relative error.`);

  const dragDirection: Vec3 = scale3(current.freeStream, 1 / velocity);
  let inducedDragN = 0;
  const inducedPerStrip = strips.map((strip, index) => {
    checkAbort(signal);
    const boundMidpoint = scale3(add3(strip.start, strip.end), 0.5);
    let wakeVelocity: Vec3 = [0, 0, 0];
    strips.forEach((source, sourceIndex) => {
      wakeVelocity = add3(wakeVelocity, scale3(wakeOnlyVelocity(boundMidpoint, source.start, source.end, coreM), current.circulation[sourceIndex]));
    });
    const bound = sub3(strip.end, strip.start);
    const inducedForce = scale3(cross3(wakeVelocity, bound), density * current.circulation[index]);
    const drag = dot3(inducedForce, dragDirection);
    inducedDragN += drag;
    return {
      drag,
      velocity: wakeVelocity,
      /** Positive for downwash; the solver's +z axis points upward. */
      inducedAngleRad: Math.atan2(-wakeVelocity[2], velocity),
    };
  });
  const dynamicPressure = 0.5 * density * velocity ** 2;
  const area = wingArea(geometry);
  if (inducedDragN < -1e-10 * dynamicPressure * area) throw new AeroError('NUMERICAL_FAILURE', `Wake-induced drag has a nonphysical sign (${inducedDragN.toExponential(3)} N).`);
  inducedDragN = Math.max(0, inducedDragN);
  const liftCoefficient = current.liftN / (dynamicPressure * area);
  const inducedDragCoefficient = inducedDragN / (dynamicPressure * area);
  const aspectRatio = wingAspectRatio(geometry);
  const spanEfficiencyEstimate = inducedDragCoefficient > 0 ? liftCoefficient ** 2 / (Math.PI * aspectRatio * inducedDragCoefficient) : null;
  let profileDragN = 0;
  const results = strips.map((strip, index): AeroStripResult => {
    const width = strip.end[1] - strip.start[1];
    const profileDrag = dynamicPressure * strip.chordM * width * current.polar[index].cd;
    profileDragN += profileDrag;
    return {
      index,
      yStartM: strip.start[1],
      yEndM: strip.end[1],
      yMidM: strip.yMidM,
      etaMid: strip.etaMid,
      chordM: strip.chordM,
      geometricTwistRad: strip.geometricTwistRad,
      elasticTwistRad: strip.elasticTwistRad,
      circulationM2s: current.circulation[index],
      liftN: current.forces[index].lift,
      verticalForceN: current.forces[index].force[2],
      liftPerSpanNpm: current.forces[index].lift / width,
      inducedDragN: inducedPerStrip[index].drag,
      inducedVelocityMps: inducedPerStrip[index].velocity,
      inducedAngleRad: inducedPerStrip[index].inducedAngleRad,
      effectiveAlphaRad: current.polar[index].effectiveAlphaRad,
      airfoilLabel: strip.airfoilLabel,
      zeroLiftAngleRad: strip.zeroLiftAngleRad,
      reynoldsNumber: current.polar[index].reynoldsNumber,
      sectionalLiftCoefficient: current.polar[index].cl,
      profileDragCoefficient: current.polar[index].cd,
      profileDragN: profileDrag,
      pitchingMomentCoefficient: current.polar[index].cm,
      pitchingMomentNmPerM: dynamicPressure * strip.chordM ** 2 * current.polar[index].cm,
      polarState: current.polar[index].state,
      polarProvenance: current.polar[index].provenance,
    };
  });
  const profileDragCoefficient = profileDragN / (dynamicPressure * area);
  const combinedDragN = inducedDragN + profileDragN;
  const combinedDragCoefficient = combinedDragN / (dynamicPressure * area);
  const estimatedLiftToDrag = combinedDragN > 0 ? current.liftN / combinedDragN : 0;
  let symmetryError = 0;
  const circulationScale = Math.max(...current.circulation.map(Math.abs), 1e-12);
  for (let index = 0; index < panelCount / 2; index += 1) {
    const opposite = panelCount - 1 - index;
    symmetryError = Math.max(symmetryError, Math.abs(current.circulation[index] - current.circulation[opposite]) / circulationScale);
  }
  if (symmetryError > 1e-8) throw new AeroError('NUMERICAL_FAILURE', `Full-wing symmetry error ${symmetryError} exceeds tolerance.`);
  return {
    alphaRad: current.alphaRad,
    liftN: current.liftN,
    verticalForceN: current.verticalForceN,
    liftCoefficient,
    inducedDragN,
    inducedDragCoefficient,
    profileDragN,
    profileDragCoefficient,
    combinedDragN,
    combinedDragCoefficient,
    estimatedLiftToDrag,
    spanEfficiencyEstimate,
    strips: results,
    relativeResidual: current.relativeResidual,
    trimIterations: fixedAlphaDeg === null ? trimIterations + 1 : 0,
    targetLiftError,
    symmetryError,
    panelCount,
    polarIterations: current.polarIterations,
    polarResidual: current.polarResidual,
  };
}

export function solveTargetLiftAerodynamics(
  geometry: WingGeometry,
  flightCase: FlightCase,
  twistField: TwistField,
  panelCount: number,
  signal?: AbortSignal,
) {
  return solveAerodynamics(geometry, flightCase, twistField, panelCount, null, signal);
}

export function solveFixedAngleAerodynamics(
  geometry: WingGeometry,
  flightCase: FlightCase,
  twistField: TwistField,
  panelCount: number,
  alphaDeg: number,
  signal?: AbortSignal,
) {
  return solveAerodynamics(geometry, flightCase, twistField, panelCount, alphaDeg, signal);
}
