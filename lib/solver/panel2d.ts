import { solveDense } from './math';
import { sampleNaca4 } from './naca';
import { sectionContour, type CanonicalAirfoil } from './airfoilSections';

export interface Point2 { x: number; z: number }

export interface Panel2D {
  index: number;
  start: Point2;
  end: Point2;
  control: Point2;
  length: number;
  tangent: Point2;
  normal: Point2;
  surface: 'upper' | 'lower' | 'unclassified';
}

export interface SurfaceFlowPoint {
  xOverC: number;
  zOverC: number;
  cp: number;
  tangentialVelocityRatio: number;
  surface: Panel2D['surface'];
}

export interface SectionPotentialFlowSolution {
  method: 'constant_source_global_vortex_hess_smith';
  nacaCode: string | null;
  incidenceDeg: number;
  freeStreamMps: number;
  panels: Panel2D[];
  sourceStrengthMps: number[];
  vortexSheetStrengthMps: number;
  surface: SurfaceFlowPoint[];
  liftCoefficient: number;
  dragCoefficientNumerical: number;
  momentCoefficientQuarterChord: number;
  kuttaResidualMps: number;
  sourceFluxResidualM2ps: number;
  stagnation: SurfaceFlowPoint;
}

export interface SectionStreamline {
  id: string;
  /** Wind-axis coordinates: the undisturbed free stream is horizontal and +x. */
  points: Point2[];
  termination: 'bounds' | 'solid' | 'low_speed' | 'step_limit' | 'non_finite';
}

export interface SectionVelocityVector {
  point: Point2;
  velocity: Point2;
}

const TWO_PI = 2 * Math.PI;

function signedArea(points: readonly Point2[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.z - next.x * points[index].z;
  }
  return area / 2;
}

function samePoint(left: Point2, right: Point2, tolerance = 1e-12) {
  return Math.hypot(left.x - right.x, left.z - right.z) <= tolerance;
}

/** Normalizes arbitrary closed input to clockwise orientation with the trailing edge first. */
export function normalizeSectionContour(input: readonly Point2[]) {
  if (input.length < 12) throw new Error('A section contour requires at least twelve points.');
  let points = input.map((point) => ({ x: Number(point.x), z: Number(point.z) }));
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.z))) throw new Error('Section contour points must be finite.');
  if (samePoint(points[0], points.at(-1)!)) points = points.slice(0, -1);
  if (points.length < 12) throw new Error('A section contour requires at least twelve distinct points.');
  if (signedArea(points) > 0) points.reverse();
  let trailingEdgeIndex = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].x > points[trailingEdgeIndex].x + 1e-10
      || (Math.abs(points[index].x - points[trailingEdgeIndex].x) <= 1e-10 && Math.abs(points[index].z) < Math.abs(points[trailingEdgeIndex].z))) {
      trailingEdgeIndex = index;
    }
  }
  points = [...points.slice(trailingEdgeIndex), ...points.slice(0, trailingEdgeIndex)];
  points.push({ ...points[0] });
  return points;
}

export function nacaSectionContour(code: string, panelCount = 80) {
  if (!Number.isInteger(panelCount) || panelCount < 40 || panelCount > 160 || panelCount % 2 !== 0) throw new Error('Section panel count must be an even integer from 40 to 160.');
  const intervals = panelCount / 2;
  const samples = sampleNaca4(code, intervals);
  const lower = [...samples].reverse().map((point) => ({ x: point.xLower, z: point.zLower }));
  const upper = samples.slice(1).map((point) => ({ x: point.xUpper, z: point.zUpper }));
  const points = normalizeSectionContour([...lower, ...upper]);
  return { points, lowerPanelCount: intervals };
}

function buildPanels(points: readonly Point2[], lowerPanelCount: number | null): Panel2D[] {
  return points.slice(0, -1).map((start, index) => {
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    if (!(length > 1e-8)) throw new Error('Section contour contains a degenerate panel.');
    const tangent = { x: dx / length, z: dz / length };
    return {
      index,
      start,
      end,
      control: { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 },
      length,
      tangent,
      /** Clockwise contours keep the exterior on the tangent's left. */
      normal: { x: -tangent.z, z: tangent.x },
      surface: lowerPanelCount === null ? 'unclassified' : index < lowerPanelCount ? 'lower' : 'upper',
    };
  });
}

function unwrapAngle(value: number) {
  let angle = value;
  while (angle > Math.PI) angle -= TWO_PI;
  while (angle < -Math.PI) angle += TWO_PI;
  return angle;
}

function unitSourceVelocity(target: Point2, panel: Panel2D): Point2 {
  const dx = target.x - panel.start.x;
  const dz = target.z - panel.start.z;
  const localX = dx * panel.tangent.x + dz * panel.tangent.z;
  const localZ = dx * panel.normal.x + dz * panel.normal.z;
  const endpointX = localX - panel.length;
  const coreSquared = 1e-20;
  const radiusStartSquared = Math.max(coreSquared, localX ** 2 + localZ ** 2);
  const radiusEndSquared = Math.max(coreSquared, endpointX ** 2 + localZ ** 2);
  const localU = Math.log(radiusStartSquared / radiusEndSquared) / (4 * Math.PI);
  const thetaStart = Math.atan2(localZ, localX);
  const thetaEnd = Math.atan2(localZ, endpointX);
  const localW = unwrapAngle(thetaEnd - thetaStart) / TWO_PI;
  return {
    x: localU * panel.tangent.x + localW * panel.normal.x,
    z: localU * panel.tangent.z + localW * panel.normal.z,
  };
}

function unitVortexVelocity(target: Point2, panel: Panel2D): Point2 {
  const source = unitSourceVelocity(target, panel);
  return { x: -source.z, z: source.x };
}

function dot(left: Point2, right: Point2) {
  return left.x * right.x + left.z * right.z;
}

const QUARTER_CHORD = { x: 0.25, z: 0 } as const;

/**
 * Rotates an airfoil-fixed point into wind axes about quarter chord. Positive
 * incidence therefore raises the leading edge and keeps the undisturbed flow
 * horizontal from left to right.
 */
export function sectionPointToWindAxes(point: Point2, incidenceDeg: number): Point2 {
  const angle = incidenceDeg * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const dx = point.x - QUARTER_CHORD.x;
  const dz = point.z - QUARTER_CHORD.z;
  return {
    x: QUARTER_CHORD.x + cosine * dx + sine * dz,
    z: QUARTER_CHORD.z - sine * dx + cosine * dz,
  };
}

export function windPointToSectionAxes(point: Point2, incidenceDeg: number): Point2 {
  const angle = incidenceDeg * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const dx = point.x - QUARTER_CHORD.x;
  const dz = point.z - QUARTER_CHORD.z;
  return {
    x: QUARTER_CHORD.x + cosine * dx - sine * dz,
    z: QUARTER_CHORD.z + sine * dx + cosine * dz,
  };
}

export function sectionVectorToWindAxes(vector: Point2, incidenceDeg: number): Point2 {
  const angle = incidenceDeg * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: cosine * vector.x + sine * vector.z,
    z: -sine * vector.x + cosine * vector.z,
  };
}

function selfSourceVelocity(panel: Panel2D) {
  return { x: 0.5 * panel.normal.x, z: 0.5 * panel.normal.z };
}

function sourceInfluence(target: Panel2D, source: Panel2D) {
  return target.index === source.index ? selfSourceVelocity(source) : unitSourceVelocity(target.control, source);
}

function vortexInfluence(target: Panel2D, source: Panel2D) {
  const sourceVelocity = sourceInfluence(target, source);
  return { x: -sourceVelocity.z, z: sourceVelocity.x };
}

function solveContour(pointsInput: readonly Point2[], incidenceDeg: number, freeStreamMps: number, lowerPanelCount: number | null, nacaCode: string | null): SectionPotentialFlowSolution {
  if (!Number.isFinite(incidenceDeg) || Math.abs(incidenceDeg) > 20) throw new Error('Section incidence must be finite and within ±20 degrees.');
  if (!Number.isFinite(freeStreamMps) || freeStreamMps <= 0) throw new Error('Section free-stream speed must be positive and finite.');
  const points = normalizeSectionContour(pointsInput);
  const panels = buildPanels(points, lowerPanelCount);
  const incidenceRad = incidenceDeg * Math.PI / 180;
  const freeStream = { x: freeStreamMps * Math.cos(incidenceRad), z: freeStreamMps * Math.sin(incidenceRad) };
  const size = panels.length;
  const matrix = Array.from({ length: size + 1 }, () => Array(size + 1).fill(0));
  const rightHandSide = Array(size + 1).fill(0);
  const normalSource = panels.map((target) => panels.map((source) => dot(sourceInfluence(target, source), target.normal)));
  const tangentSource = panels.map((target) => panels.map((source) => dot(sourceInfluence(target, source), target.tangent)));
  const normalVortex = panels.map((target) => panels.map((source) => dot(vortexInfluence(target, source), target.normal)));
  const tangentVortex = panels.map((target) => panels.map((source) => dot(vortexInfluence(target, source), target.tangent)));

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) matrix[row][column] = normalSource[row][column];
    matrix[row][size] = normalVortex[row].reduce((sum, value) => sum + value, 0);
    rightHandSide[row] = -dot(freeStream, panels[row].normal);
  }
  const trailingLower = 0;
  const trailingUpper = size - 1;
  for (let column = 0; column < size; column += 1) {
    matrix[size][column] = tangentSource[trailingLower][column] + tangentSource[trailingUpper][column];
  }
  matrix[size][size] = tangentVortex[trailingLower].reduce((sum, value) => sum + value, 0)
    + tangentVortex[trailingUpper].reduce((sum, value) => sum + value, 0);
  rightHandSide[size] = -dot(freeStream, panels[trailingLower].tangent) - dot(freeStream, panels[trailingUpper].tangent);

  const solved = solveDense(matrix, rightHandSide).solution;
  const sourceStrengthMps = solved.slice(0, size);
  const vortexSheetStrengthMps = solved[size];
  const tangentialVelocity = panels.map((panel, row) => {
    let velocity = dot(freeStream, panel.tangent);
    for (let column = 0; column < size; column += 1) {
      velocity += sourceStrengthMps[column] * tangentSource[row][column]
        + vortexSheetStrengthMps * tangentVortex[row][column];
    }
    return velocity;
  });
  const surface = panels.map((panel, index): SurfaceFlowPoint => ({
    xOverC: panel.control.x,
    zOverC: panel.control.z,
    cp: 1 - (tangentialVelocity[index] / freeStreamMps) ** 2,
    tangentialVelocityRatio: tangentialVelocity[index] / freeStreamMps,
    surface: panel.surface,
  }));
  let forceX = 0;
  let forceZ = 0;
  let momentQuarterChord = 0;
  panels.forEach((panel, index) => {
    const dForceX = -surface[index].cp * panel.normal.x * panel.length;
    const dForceZ = -surface[index].cp * panel.normal.z * panel.length;
    forceX += dForceX;
    forceZ += dForceZ;
    /** Conventional section coefficient: positive is nose-up. */
    momentQuarterChord += panel.control.z * dForceX - (panel.control.x - 0.25) * dForceZ;
  });
  const liftDirection = { x: -Math.sin(incidenceRad), z: Math.cos(incidenceRad) };
  const dragDirection = { x: Math.cos(incidenceRad), z: Math.sin(incidenceRad) };
  const liftCoefficient = forceX * liftDirection.x + forceZ * liftDirection.z;
  const dragCoefficientNumerical = forceX * dragDirection.x + forceZ * dragDirection.z;
  const kuttaResidualMps = tangentialVelocity[trailingLower] + tangentialVelocity[trailingUpper];
  const sourceFluxResidualM2ps = sourceStrengthMps.reduce((sum, strength, index) => sum + strength * panels[index].length, 0);
  const stagnation = surface.reduce((closest, point) => Math.abs(point.tangentialVelocityRatio) < Math.abs(closest.tangentialVelocityRatio) ? point : closest, surface[0]);
  return {
    method: 'constant_source_global_vortex_hess_smith',
    nacaCode,
    incidenceDeg,
    freeStreamMps,
    panels,
    sourceStrengthMps,
    vortexSheetStrengthMps,
    surface,
    liftCoefficient,
    dragCoefficientNumerical,
    momentCoefficientQuarterChord: momentQuarterChord,
    kuttaResidualMps,
    sourceFluxResidualM2ps,
    stagnation,
  };
}

export function solveSectionPotentialFlow(nacaCode: string, incidenceDeg: number, freeStreamMps: number, panelCount = 80) {
  const contour = nacaSectionContour(nacaCode, panelCount);
  return solveContour(contour.points, incidenceDeg, freeStreamMps, contour.lowerPanelCount, nacaCode);
}

export function solveAirfoilSectionPotentialFlow(section: CanonicalAirfoil, incidenceDeg: number, freeStreamMps: number, panelCount = 80) {
  const contour = sectionContour(section, panelCount);
  return solveContour(contour.points, incidenceDeg, freeStreamMps, contour.lowerPanelCount, null);
}

export function solvePotentialFlowContour(points: readonly Point2[], incidenceDeg: number, freeStreamMps: number) {
  return solveContour(points, incidenceDeg, freeStreamMps, null, null);
}

export function sectionVelocityAt(point: Point2, solution: SectionPotentialFlowSolution): Point2 {
  const incidenceRad = solution.incidenceDeg * Math.PI / 180;
  let velocity = {
    x: solution.freeStreamMps * Math.cos(incidenceRad),
    z: solution.freeStreamMps * Math.sin(incidenceRad),
  };
  solution.panels.forEach((panel, index) => {
    const source = unitSourceVelocity(point, panel);
    const vortex = unitVortexVelocity(point, panel);
    velocity = {
      x: velocity.x + solution.sourceStrengthMps[index] * source.x + solution.vortexSheetStrengthMps * vortex.x,
      z: velocity.z + solution.sourceStrengthMps[index] * source.z + solution.vortexSheetStrengthMps * vortex.z,
    };
  });
  return velocity;
}

function pointInsideContour(point: Point2, panels: readonly Panel2D[]) {
  let inside = false;
  for (const panel of panels) {
    const a = panel.start;
    const b = panel.end;
    const intersects = (a.z > point.z) !== (b.z > point.z)
      && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointSegmentDistance(point: Point2, start: Point2, end: Point2) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (!(lengthSquared > 0)) return Math.hypot(point.x - start.x, point.z - start.z);
  const fraction = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared));
  return Math.hypot(point.x - (start.x + fraction * dx), point.z - (start.z + fraction * dz));
}

function distanceToContour(point: Point2, panels: readonly Panel2D[]) {
  return panels.reduce((minimum, panel) => Math.min(minimum, pointSegmentDistance(point, panel.start, panel.end)), Number.POSITIVE_INFINITY);
}

function sectionDirection(point: Point2, solution: SectionPotentialFlowSolution) {
  if (pointInsideContour(point, solution.panels)) return null;
  const velocity = sectionVelocityAt(point, solution);
  const speed = Math.hypot(velocity.x, velocity.z);
  return speed > solution.freeStreamMps * 1e-4 && Number.isFinite(speed) ? { x: velocity.x / speed, z: velocity.z / speed } : null;
}

function sectionRk4(point: Point2, step: number, solution: SectionPotentialFlowSolution): Point2 | null {
  const k1 = sectionDirection(point, solution);
  if (!k1) return null;
  const k2 = sectionDirection({ x: point.x + step * k1.x / 2, z: point.z + step * k1.z / 2 }, solution);
  if (!k2) return null;
  const k3 = sectionDirection({ x: point.x + step * k2.x / 2, z: point.z + step * k2.z / 2 }, solution);
  if (!k3) return null;
  const k4 = sectionDirection({ x: point.x + step * k3.x, z: point.z + step * k3.z }, solution);
  if (!k4) return null;
  return {
    x: point.x + step * (k1.x + 2 * k2.x + 2 * k3.x + k4.x) / 6,
    z: point.z + step * (k1.z + 2 * k2.z + 2 * k3.z + k4.z) / 6,
  };
}

export function traceSectionStreamlines(solution: SectionPotentialFlowSolution, lineCount = 17): SectionStreamline[] {
  if (!Number.isInteger(lineCount) || lineCount < 3 || lineCount > 41) throw new Error('Section streamline count must be an integer from 3 to 41.');
  const windSeeds = Array.from({ length: lineCount }, (_, index) => ({ x: -0.55, z: -0.52 + 1.04 * index / (lineCount - 1) }));
  return windSeeds.map((windSeed, index) => {
    const points: Point2[] = [];
    let point = windPointToSectionAxes(windSeed, solution.incidenceDeg);
    let termination: SectionStreamline['termination'] = 'step_limit';
    for (let stepIndex = 0; stepIndex < 420; stepIndex += 1) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) { termination = 'non_finite'; break; }
      const windPoint = sectionPointToWindAxes(point, solution.incidenceDeg);
      if (windPoint.x < -0.58 || windPoint.x > 1.72 || windPoint.z < -0.68 || windPoint.z > 0.68) { termination = 'bounds'; break; }
      const clearance = distanceToContour(point, solution.panels);
      if (pointInsideContour(point, solution.panels) || clearance < 6e-4) { termination = 'solid'; break; }
      points.push(windPoint);
      /** The step shrinks near the contour so an integration segment cannot tunnel through a thin section. */
      const integrationStep = Math.min(0.012, Math.max(0.0004, clearance * 0.32));
      const next = sectionRk4(point, integrationStep, solution);
      if (!next) { termination = 'low_speed'; break; }
      point = next;
    }
    return { id: `section-line-${index}`, points, termination };
  }).filter((line) => line.points.length >= 2);
}

export function sampleSectionVelocityVectors(solution: SectionPotentialFlowSolution): SectionVelocityVector[] {
  const vectors: SectionVelocityVector[] = [];
  for (const z of [-0.36, -0.18, 0, 0.18, 0.36]) {
    for (const x of [-0.28, 0.12, 0.5, 0.88, 1.28]) {
      const point = { x, z };
      const sectionPoint = windPointToSectionAxes(point, solution.incidenceDeg);
      if (pointInsideContour(sectionPoint, solution.panels)) continue;
      const velocity = sectionVectorToWindAxes(sectionVelocityAt(sectionPoint, solution), solution.incidenceDeg);
      if (Number.isFinite(velocity.x) && Number.isFinite(velocity.z)) vectors.push({ point, velocity });
    }
  }
  return vectors;
}
