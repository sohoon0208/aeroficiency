import {
  MAX_AIRFOIL_COORDINATE_POINTS,
  MAX_AIRFOIL_STATIONS,
  MIN_AIRFOIL_STATION_SEPARATION,
} from '@/lib/domain/limits';
import type { AirfoilDefinition, AirfoilStation, DomainIssue, WingGeometry } from '@/lib/domain/types';
import { nacaCamber, nacaThickness, parseNaca4 } from './naca';

export interface CanonicalAirfoil {
  label: string;
  x: number[];
  camber: number[];
  halfThickness: number[];
  upper: Array<readonly [number, number]>;
  lower: Array<readonly [number, number]>;
  maximumThicknessRatio: number;
  maximumCamberRatio: number;
}

export interface LocalAirfoilSection extends CanonicalAirfoil {
  eta: number;
  leftStationId: string;
  rightStationId: string;
  blendFraction: number;
  zeroLiftAngleRad: number;
  quarterChordMomentCoefficient: number;
}

const NACA_PATTERN = /^(00(0[6-9]|1[0-9]|2[0-4])|[1-6][1-9](0[6-9]|1[0-9]|2[0-4]))$/;
const EPSILON = 1e-10;
const canonicalCache = new WeakMap<AirfoilDefinition, Map<number, CanonicalAirfoil>>();
const localSectionCache = new WeakMap<WingGeometry, Map<string, LocalAirfoilSection>>();

function cosineGrid(intervals: number) {
  return Array.from({ length: intervals + 1 }, (_, index) => 0.5 * (1 - Math.cos(Math.PI * index / intervals)));
}

function removeConsecutiveDuplicates(points: readonly (readonly [number, number])[]) {
  const result: Array<[number, number]> = [];
  points.forEach(([x, z]) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('Airfoil coordinates must be finite.');
    const previous = result.at(-1);
    if (!previous || Math.hypot(x - previous[0], z - previous[1]) > 1e-10) result.push([x, z]);
  });
  if (result.length > 1 && Math.hypot(result[0][0] - result.at(-1)![0], result[0][1] - result.at(-1)![1]) <= 1e-10) result.pop();
  return result;
}

function orientation(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number]) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function contourSelfIntersects(points: readonly (readonly [number, number])[]) {
  const count = points.length;
  for (let left = 0; left < count; left += 1) {
    const leftNext = (left + 1) % count;
    for (let right = left + 1; right < count; right += 1) {
      const rightNext = (right + 1) % count;
      if (left === right || leftNext === right || rightNext === left) continue;
      if (left === 0 && rightNext === 0) continue;
      const a = points[left];
      const b = points[leftNext];
      const c = points[right];
      const d = points[rightNext];
      const o1 = orientation(a, b, c);
      const o2 = orientation(a, b, d);
      const o3 = orientation(c, d, a);
      const o4 = orientation(c, d, b);
      if (o1 * o2 < -EPSILON && o3 * o4 < -EPSILON) return true;
    }
  }
  return false;
}

function compactCurve(points: readonly (readonly [number, number])[]) {
  const sorted = [...points].sort((left, right) => left[0] - right[0]);
  const compact: Array<[number, number]> = [];
  sorted.forEach(([x, z]) => {
    const previous = compact.at(-1);
    if (previous && Math.abs(previous[0] - x) <= 1e-8) previous[1] = (previous[1] + z) / 2;
    else compact.push([x, z]);
  });
  return compact;
}

function interpolateCurve(curve: readonly (readonly [number, number])[], x: number) {
  if (x <= curve[0][0]) return curve[0][1];
  if (x >= curve.at(-1)![0]) return curve.at(-1)![1];
  let high = 1;
  while (curve[high][0] < x) high += 1;
  const low = high - 1;
  const fraction = (x - curve[low][0]) / (curve[high][0] - curve[low][0]);
  return curve[low][1] + fraction * (curve[high][1] - curve[low][1]);
}

function reconstructSurfaces(x: readonly number[], camber: readonly number[], halfThickness: readonly number[]) {
  const upper: Array<readonly [number, number]> = [];
  const lower: Array<readonly [number, number]> = [];
  x.forEach((value, index) => {
    const low = Math.max(0, index - 1);
    const high = Math.min(x.length - 1, index + 1);
    const slope = high === low ? 0 : (camber[high] - camber[low]) / Math.max(x[high] - x[low], 1e-12);
    const theta = Math.atan(slope);
    upper.push([value - halfThickness[index] * Math.sin(theta), camber[index] + halfThickness[index] * Math.cos(theta)]);
    lower.push([value + halfThickness[index] * Math.sin(theta), camber[index] - halfThickness[index] * Math.cos(theta)]);
  });
  return { upper, lower };
}

/**
 * Coordinate files occasionally let the measured upper and lower branches cross
 * inside the final fraction of a percent of chord. Clamping that crossing to zero
 * creates several coincident panels, so continue the last positive thickness
 * linearly to the physical leading/trailing-edge closure instead.
 */
function repairCollapsedEdgeThickness(x: readonly number[], values: readonly number[]) {
  const repaired = values.map((value) => Math.max(0, value));
  const positive = repaired.map((value, index) => value > 1e-10 ? index : -1).filter((index) => index >= 0);
  if (!positive.length) return repaired;
  const first = positive[0];
  const last = positive.at(-1)!;
  for (let index = 1; index < first; index += 1) repaired[index] = repaired[first] * x[index] / Math.max(x[first], 1e-12);
  for (let index = last + 1; index < repaired.length - 1; index += 1) repaired[index] = repaired[last] * (1 - x[index]) / Math.max(1 - x[last], 1e-12);
  repaired[0] = 0;
  repaired[repaired.length - 1] = 0;
  return repaired;
}

function fromCoordinates(definition: Extract<AirfoilDefinition, { kind: 'COORDINATES' }>, intervals: number): CanonicalAirfoil {
  let points = removeConsecutiveDuplicates(definition.points);
  if (points.length < 24) throw new Error('Imported airfoils require at least 24 distinct contour points.');
  if (points.length > MAX_AIRFOIL_COORDINATE_POINTS) throw new Error(`Imported airfoils support at most ${MAX_AIRFOIL_COORDINATE_POINTS} contour points.`);
  const rawMinimumX = Math.min(...points.map((point) => point[0]));
  const rawMaximumX = Math.max(...points.map((point) => point[0]));
  const rawExtent = rawMaximumX - rawMinimumX;
  if (!(rawExtent > 1e-8)) throw new Error('Imported airfoil chord must be positive.');
  const average = (candidates: readonly (readonly [number, number])[]) => candidates.reduce<[number, number]>((sum, point) => [sum[0] + point[0] / candidates.length, sum[1] + point[1] / candidates.length], [0, 0]);
  const leadingReference = average(points.filter((point) => point[0] <= rawMinimumX + 0.005 * rawExtent));
  const trailingReference = average(points.filter((point) => point[0] >= rawMaximumX - 0.005 * rawExtent));
  const chordVector = [trailingReference[0] - leadingReference[0], trailingReference[1] - leadingReference[1]] as const;
  const referenceChord = Math.hypot(...chordVector);
  if (!(referenceChord > 1e-8)) throw new Error('Imported airfoil leading and trailing edges must be distinct.');
  const chordDirection = [chordVector[0] / referenceChord, chordVector[1] / referenceChord] as const;
  const normalDirection = [-chordDirection[1], chordDirection[0]] as const;
  points = points.map(([x, z]) => {
    const relative = [x - leadingReference[0], z - leadingReference[1]] as const;
    return [
      (relative[0] * chordDirection[0] + relative[1] * chordDirection[1]) / referenceChord,
      (relative[0] * normalDirection[0] + relative[1] * normalDirection[1]) / referenceChord,
    ];
  });
  const projectedMinimumX = Math.min(...points.map((point) => point[0]));
  const projectedMaximumX = Math.max(...points.map((point) => point[0]));
  const projectedChord = projectedMaximumX - projectedMinimumX;
  if (!(projectedChord > 1e-8)) throw new Error('Imported airfoil chord normalization failed.');
  points = points.map(([x, z]) => [(x - projectedMinimumX) / projectedChord, z / projectedChord]);
  const leadingZ = average(points.filter((point) => point[0] <= 0.005))[1];
  const trailingZ = average(points.filter((point) => point[0] >= 0.995))[1];
  points = points.map(([x, z]) => [x, z - (leadingZ + x * (trailingZ - leadingZ))]);
  if (contourSelfIntersects(points)) throw new Error('Imported airfoil contour must not self-intersect.');
  const trailingCandidates = points.map((point, index) => ({ point, index })).filter(({ point }) => point[0] >= 1 - 1e-6);
  const start = (trailingCandidates.length ? trailingCandidates : points.map((point, index) => ({ point, index })))
    .reduce((best, candidate) => candidate.point[0] > best.point[0] + 1e-8 || (Math.abs(candidate.point[0] - best.point[0]) <= 1e-8 && candidate.point[1] > best.point[1]) ? candidate : best).index;
  points = [...points.slice(start), ...points.slice(0, start)];
  const leading = points.reduce((best, point, index) => point[0] < points[best][0] ? index : best, 0);
  if (leading < 3 || leading > points.length - 4) throw new Error('Imported airfoil must provide distinct upper and lower branches from trailing edge to leading edge.');
  const branchA = compactCurve(points.slice(0, leading + 1));
  const branchB = compactCurve(points.slice(leading));
  if (branchA[0][0] > 1e-5 || branchB[0][0] > 1e-5 || branchA.at(-1)![0] < 0.95 || branchB.at(-1)![0] < 0.95) {
    throw new Error('Imported airfoil branches must cover the normalized leading and trailing edges.');
  }
  const midA = interpolateCurve(branchA, 0.5);
  const midB = interpolateCurve(branchB, 0.5);
  const upperCurve = midA >= midB ? branchA : branchB;
  const lowerCurve = midA >= midB ? branchB : branchA;
  const x = cosineGrid(intervals);
  const upperZ = x.map((value) => interpolateCurve(upperCurve, value));
  const lowerZ = x.map((value) => interpolateCurve(lowerCurve, value));
  if (upperZ.some((value, index) => x[index] >= 0.005 && x[index] <= 0.995 && value - lowerZ[index] <= 1e-5)) {
    throw new Error('Imported airfoil must retain positive thickness away from the leading and trailing edges.');
  }
  const camber = upperZ.map((value, index) => (value + lowerZ[index]) / 2);
  const halfThickness = repairCollapsedEdgeThickness(x, upperZ.map((value, index) => (value - lowerZ[index]) / 2));
  const surfaces = reconstructSurfaces(x, camber, halfThickness);
  return {
    label: definition.name.trim(),
    x,
    camber,
    halfThickness,
    ...surfaces,
    maximumThicknessRatio: 2 * Math.max(...halfThickness),
    maximumCamberRatio: Math.max(...camber.map(Math.abs)),
  };
}

export function canonicalAirfoil(definition: AirfoilDefinition, intervals = 80): CanonicalAirfoil {
  if (!Number.isInteger(intervals) || intervals < 20 || intervals > 200) throw new Error('Canonical airfoil sampling requires 20–200 intervals.');
  const cached = canonicalCache.get(definition)?.get(intervals);
  if (cached) return cached;
  if (definition.kind === 'COORDINATES') {
    const result = fromCoordinates(definition, intervals);
    const byResolution = canonicalCache.get(definition) ?? new Map<number, CanonicalAirfoil>();
    byResolution.set(intervals, result);
    canonicalCache.set(definition, byResolution);
    return result;
  }
  const parsed = parseNaca4(definition.code);
  const x = cosineGrid(intervals);
  const camber = x.map((value) => nacaCamber(value, parsed).yc);
  const halfThickness = x.map((value) => nacaThickness(value, parsed.t));
  const result = {
    label: `NACA ${definition.code}`,
    x,
    camber,
    halfThickness,
    ...reconstructSurfaces(x, camber, halfThickness),
    maximumThicknessRatio: 2 * Math.max(...halfThickness),
    maximumCamberRatio: Math.max(...camber.map(Math.abs)),
  };
  const byResolution = canonicalCache.get(definition) ?? new Map<number, CanonicalAirfoil>();
  byResolution.set(intervals, result);
  canonicalCache.set(definition, byResolution);
  return result;
}

export function uniformAirfoilStations(code: string): AirfoilStation[] {
  return [
    { id: 'afs_root', eta: 0, airfoil: { kind: 'NACA4', code }, blendToNext: 'LINEAR_CAMBER_THICKNESS' },
    { id: 'afs_tip', eta: 1, airfoil: { kind: 'NACA4', code }, blendToNext: 'HOLD' },
  ];
}

export function resolvedAirfoilStations(geometry: WingGeometry) {
  return geometry.airfoilStations?.length ? geometry.airfoilStations : uniformAirfoilStations(geometry.nacaCode);
}

export function validateAirfoilStations(stations: readonly AirfoilStation[]): DomainIssue[] {
  const issues: DomainIssue[] = [];
  if (!Array.isArray(stations) || stations.length < 2 || stations.length > MAX_AIRFOIL_STATIONS) {
    return [{ path: 'geometry.airfoilStations', reason: `Provide 2–${MAX_AIRFOIL_STATIONS} stations including root and tip.` }];
  }
  const identifiers = new Set<string>();
  stations.forEach((station, index) => {
    const path = `geometry.airfoilStations.${index}`;
    if (!/^[A-Za-z][A-Za-z0-9_-]{1,23}$/.test(station.id) || identifiers.has(station.id)) issues.push({ path: `${path}.id`, reason: 'Station IDs must be unique visible identifiers of 2–24 characters.' });
    identifiers.add(station.id);
    if (!Number.isFinite(station.eta) || station.eta < 0 || station.eta > 1) issues.push({ path: `${path}.eta`, reason: 'Station eta must be finite and within 0–1.' });
    if (index > 0 && station.eta - stations[index - 1].eta < MIN_AIRFOIL_STATION_SEPARATION - 1e-12) issues.push({ path: `${path}.eta`, reason: `Stations must increase by at least ${MIN_AIRFOIL_STATION_SEPARATION.toFixed(2)} eta.` });
    if (station.blendToNext !== 'LINEAR_CAMBER_THICKNESS' && station.blendToNext !== 'HOLD') issues.push({ path: `${path}.blendToNext`, reason: 'Use linear camber/thickness blending or hold.' });
    if (!station.airfoil || (station.airfoil.kind !== 'NACA4' && station.airfoil.kind !== 'COORDINATES')) issues.push({ path: `${path}.airfoil`, reason: 'Use a NACA4 or coordinate airfoil definition.' });
    else if (station.airfoil.kind === 'NACA4' && !NACA_PATTERN.test(station.airfoil.code)) issues.push({ path: `${path}.airfoil.code`, reason: 'Use a supported four-digit NACA code with 6–24% thickness.' });
    else if (station.airfoil.kind === 'COORDINATES') {
      if (!station.airfoil.name.trim() || station.airfoil.name.length > 40 || /[\u0000-\u001f\u007f]/.test(station.airfoil.name)) issues.push({ path: `${path}.airfoil.name`, reason: 'Coordinate airfoil name must contain 1–40 visible characters.' });
      if (station.airfoil.source && (station.airfoil.source.length > 120 || /[\u0000-\u001f\u007f]/.test(station.airfoil.source))) issues.push({ path: `${path}.airfoil.source`, reason: 'Coordinate source must contain at most 120 visible characters.' });
    }
    if (issues.every((issue) => !issue.path.startsWith(path))) {
      try { canonicalAirfoil(station.airfoil, 80); } catch (error) { issues.push({ path: `${path}.airfoil`, reason: error instanceof Error ? error.message : 'Airfoil could not be normalized.' }); }
    }
  });
  if (Math.abs(stations[0]?.eta ?? 1) > 1e-12) issues.push({ path: 'geometry.airfoilStations.0.eta', reason: 'A root station at eta 0 is required.' });
  if (Math.abs((stations.at(-1)?.eta ?? 0) - 1) > 1e-12) issues.push({ path: `geometry.airfoilStations.${stations.length - 1}.eta`, reason: 'A tip station at eta 1 is required.' });
  if (stations.at(-1)?.blendToNext !== 'HOLD') issues.push({ path: `geometry.airfoilStations.${stations.length - 1}.blendToNext`, reason: 'The tip station must use HOLD because no outboard section exists.' });
  return issues;
}

function camberSlope(section: CanonicalAirfoil, x: number) {
  const delta = 2e-4;
  const low = Math.max(0, x - delta);
  const high = Math.min(1, x + delta);
  return (interpolateCurve(section.x.map((value, index) => [value, section.camber[index]] as const), high)
    - interpolateCurve(section.x.map((value, index) => [value, section.camber[index]] as const), low)) / Math.max(high - low, 1e-12);
}

function thinAirfoilCharacteristics(section: CanonicalAirfoil) {
  const intervals = 1024;
  const step = Math.PI / intervals;
  let zeroLiftIntegral = 0;
  let a1Integral = 0;
  let a2Integral = 0;
  for (let index = 0; index <= intervals; index += 1) {
    const theta = index * step;
    const x = 0.5 * (1 - Math.cos(theta));
    const slope = camberSlope(section, x);
    const weight = index === 0 || index === intervals ? 1 : index % 2 === 0 ? 2 : 4;
    zeroLiftIntegral += weight * slope * (1 - Math.cos(theta));
    a1Integral += weight * slope * Math.cos(theta);
    a2Integral += weight * slope * Math.cos(2 * theta);
  }
  const zeroLiftAngleRad = zeroLiftIntegral * step / (3 * Math.PI);
  const a1 = 2 * a1Integral * step / (3 * Math.PI);
  const a2 = 2 * a2Integral * step / (3 * Math.PI);
  return { zeroLiftAngleRad, quarterChordMomentCoefficient: Math.PI / 4 * (a2 - a1) };
}

export function localAirfoilSection(geometry: WingGeometry, requestedEta: number, intervals = 80): LocalAirfoilSection {
  const eta = Math.max(0, Math.min(1, requestedEta));
  const cacheKey = `${eta.toFixed(10)}|${intervals}`;
  const cached = localSectionCache.get(geometry)?.get(cacheKey);
  if (cached) return cached;
  const stations = resolvedAirfoilStations(geometry);
  let high = stations.findIndex((station) => station.eta >= eta - 1e-12);
  if (high <= 0) high = 0;
  if (high === -1) high = stations.length - 1;
  const low = Math.max(0, high - 1);
  const leftStation = stations[low];
  const rightStation = stations[high];
  const left = canonicalAirfoil(leftStation.airfoil, intervals);
  const right = canonicalAirfoil(rightStation.airfoil, intervals);
  const span = rightStation.eta - leftStation.eta;
  const rawFraction = span <= 1e-12 ? 0 : (eta - leftStation.eta) / span;
  const fraction = rawFraction >= 1 - 1e-10
    ? 1
    : leftStation.blendToNext === 'HOLD'
      ? 0
      : Math.max(0, Math.min(1, rawFraction));
  const x = left.x.slice();
  const camber = x.map((_, index) => left.camber[index] + fraction * (right.camber[index] - left.camber[index]));
  const halfThickness = x.map((_, index) => Math.max(0, left.halfThickness[index] + fraction * (right.halfThickness[index] - left.halfThickness[index])));
  const base: CanonicalAirfoil = {
    label: fraction <= 1e-10 || leftStation.id === rightStation.id || left.label === right.label ? left.label : fraction >= 1 - 1e-10 ? right.label : `${left.label} → ${right.label}`,
    x,
    camber,
    halfThickness,
    ...reconstructSurfaces(x, camber, halfThickness),
    maximumThicknessRatio: 2 * Math.max(...halfThickness),
    maximumCamberRatio: Math.max(...camber.map(Math.abs)),
  };
  const thinAirfoil = thinAirfoilCharacteristics(base);
  const result: LocalAirfoilSection = {
    ...base,
    eta,
    leftStationId: leftStation.id,
    rightStationId: rightStation.id,
    blendFraction: fraction,
    ...thinAirfoil,
  };
  const byStation = localSectionCache.get(geometry) ?? new Map<string, LocalAirfoilSection>();
  byStation.set(cacheKey, result);
  localSectionCache.set(geometry, byStation);
  return result;
}

export function sectionSurfaceAtX(section: CanonicalAirfoil, x: number) {
  const upper = compactCurve(section.upper);
  const lower = compactCurve(section.lower);
  return { zUpper: interpolateCurve(upper, x), zLower: interpolateCurve(lower, x) };
}

export function sectionContour(section: CanonicalAirfoil, panelCount = 80) {
  if (!Number.isInteger(panelCount) || panelCount < 40 || panelCount > 160 || panelCount % 2 !== 0) throw new Error('Section panel count must be an even integer from 40 to 160.');
  const intervals = panelCount / 2;
  const x = cosineGrid(intervals);
  const upperCurve = compactCurve(section.upper);
  const lowerCurve = compactCurve(section.lower);
  const lower = [...x].reverse().map((value) => ({ x: value, z: interpolateCurve(lowerCurve, value) }));
  const upper = x.slice(1).map((value) => ({ x: value, z: interpolateCurve(upperCurve, value) }));
  return { points: [...lower, ...upper], lowerPanelCount: intervals };
}
