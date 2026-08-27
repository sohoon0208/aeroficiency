import type { FlightCase, WingGeometry } from '@/lib/domain/types';
import { SOLVER_SETTINGS } from '@/lib/domain/limits';
import { validateFlightCase, validateGeometry } from '@/lib/domain/validation';
import { parseNaca4, zeroLiftAngleRad } from './naca';
import { chordAtY, cosineSpanNodes, geometricTwistAtY, meanAerodynamicChord, wingArea, wingAspectRatio } from './planform';
import { add3, cross3, dot3, factorDense, interpolateLinear, NumericalError, scale3, solveFactored, sub3, type Vec3 } from './math';
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
}

export interface AeroResult {
  alphaRad: number;
  liftN: number;
  verticalForceN: number;
  liftCoefficient: number;
  inducedDragN: number;
  inducedDragCoefficient: number;
  spanEfficiencyEstimate: number | null;
  strips: AeroStripResult[];
  relativeResidual: number;
  trimIterations: number;
  targetLiftError: number;
  symmetryError: number;
  vortexCoreM: number;
  panelCount: number;
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
  const targetCl = flightCase.targetLiftN / (dynamicPressure * area);
  if (![area, dynamicPressure, targetCl].every(Number.isFinite) || area <= 0 || dynamicPressure <= 0) throw new AeroError('INVALID_INPUT', 'Aerodynamic inputs must be finite and positive.');
  if (targetCl < 0.15 || targetCl > 1) throw new AeroError('INVALID_INPUT', `Target lift requires CL ${targetCl.toFixed(3)}, outside the supported 0.15–1.00 range.`);
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
  const definition = parseNaca4(geometry.nacaCode);
  const alphaZeroLift = zeroLiftAngleRad(definition);
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
    const physicalTwist = geometricTwistRad + elasticTwistRad;
    const normalAngle = physicalTwist - alphaZeroLift;
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
    });
  }
  const matrix = strips.map((target) => {
    checkAbort(signal);
    return strips.map((source) => dot3(horseshoeVelocity(target.control, source.start, source.end, coreM), target.normal));
  });
  try {
    return { strips, factor: factorDense(matrix), coreM };
  } catch (error) {
    throw new AeroError('VLM_SINGULAR', error instanceof Error ? error.message : 'VLM influence matrix is singular.');
  }
}

export function solveTargetLiftAerodynamics(
  geometry: WingGeometry,
  flightCase: FlightCase,
  twistField: TwistField,
  panelCount: number,
  signal?: AbortSignal,
): AeroResult {
  validateInputs(geometry, flightCase, panelCount);
  validateTwistField(twistField);
  checkAbort(signal);
  const { strips, factor, coreM } = buildLattice(geometry, twistField, panelCount, signal);
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
    return { alphaRad, freeStream, circulation, forces, liftN, verticalForceN, relativeResidual };
  };

  const alphaLow = SOLVER_SETTINGS.alphaBracketDeg[0] * Math.PI / 180;
  const alphaHigh = SOLVER_SETTINGS.alphaBracketDeg[1] * Math.PI / 180;
  let low = solveAtAlpha(alphaLow);
  let high = solveAtAlpha(alphaHigh);
  if (!(high.liftN > low.liftN)) throw new AeroError('TARGET_LIFT_UNBRACKETED', 'Lift is not monotonic over the supported trim bracket.');
  if ((low.liftN - flightCase.targetLiftN) * (high.liftN - flightCase.targetLiftN) > 0) throw new AeroError('TARGET_LIFT_UNBRACKETED', `Target lift ${flightCase.targetLiftN.toFixed(0)} N is outside the supported angle-of-attack bracket.`);
  let current = Math.abs(low.liftN - flightCase.targetLiftN) < Math.abs(high.liftN - flightCase.targetLiftN) ? low : high;
  let trimIterations = 0;
  for (; trimIterations < SOLVER_SETTINGS.trimMaxIterations; trimIterations += 1) {
    checkAbort(signal);
    const mid = solveAtAlpha((low.alphaRad + high.alphaRad) / 2);
    current = mid;
    const relativeError = Math.abs(mid.liftN - flightCase.targetLiftN) / flightCase.targetLiftN;
    if (relativeError <= SOLVER_SETTINGS.trimRelativeLiftTolerance || Math.abs(high.alphaRad - low.alphaRad) <= SOLVER_SETTINGS.trimAlphaToleranceRad) break;
    if (mid.liftN < flightCase.targetLiftN) low = mid; else high = mid;
  }
  const targetLiftError = (current.liftN - flightCase.targetLiftN) / flightCase.targetLiftN;
  if (Math.abs(targetLiftError) > 1e-5) throw new AeroError('TRIM_DID_NOT_CONVERGE', `Target-lift trim stopped with ${(100 * targetLiftError).toExponential(2)}% relative error.`);

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
    return drag;
  });
  const dynamicPressure = 0.5 * density * velocity ** 2;
  const area = wingArea(geometry);
  if (inducedDragN < -1e-10 * dynamicPressure * area) throw new AeroError('NUMERICAL_FAILURE', `Wake-induced drag has a nonphysical sign (${inducedDragN.toExponential(3)} N).`);
  inducedDragN = Math.max(0, inducedDragN);
  const liftCoefficient = current.liftN / (dynamicPressure * area);
  const inducedDragCoefficient = inducedDragN / (dynamicPressure * area);
  const aspectRatio = wingAspectRatio(geometry);
  const spanEfficiencyEstimate = inducedDragCoefficient > 0 ? liftCoefficient ** 2 / (Math.PI * aspectRatio * inducedDragCoefficient) : null;
  const results = strips.map((strip, index): AeroStripResult => {
    const width = strip.end[1] - strip.start[1];
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
      inducedDragN: inducedPerStrip[index],
    };
  });
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
    spanEfficiencyEstimate,
    strips: results,
    relativeResidual: current.relativeResidual,
    trimIterations: trimIterations + 1,
    targetLiftError,
    symmetryError,
    vortexCoreM: coreM,
    panelCount,
  };
}
