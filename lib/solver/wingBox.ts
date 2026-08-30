import { ALUMINUM_2024_T3 } from '@/lib/domain/limits';
import type { MaterialDefinition, WingDesign } from '@/lib/domain/types';
import { localAirfoilSection, resolvedAirfoilStations, sectionSurfaceAtX } from './airfoilSections';
import { chordAtY } from './planform';

export interface SectionPoint { xM: number; zM: number }
export interface SectionWall {
  name: 'top_skin' | 'rear_web' | 'bottom_skin' | 'front_web' | string;
  start: SectionPoint;
  end: SectionPoint;
  thicknessM: number;
  lengthM: number;
  areaM2: number;
}

export interface ThinWallSection {
  areaM2: number;
  centroidXM: number;
  centroidZM: number;
  bendingInertiaM4: number;
  enclosedAreaM2: number;
  torsionConstantM4: number;
  massPerLengthKgM: number;
  bendingStiffnessNm2: number;
  torsionalStiffnessNm2: number;
  walls: SectionWall[];
  material: MaterialDefinition;
}

export interface WallStressResult {
  maxBendingStressPa: number;
  maxTorsionalShearPa: number;
  maxVonMisesPa: number;
  yieldMargin: number | null;
  criticalWall: string;
  criticalPoint: SectionPoint;
}

const distance = (a: SectionPoint, b: SectionPoint) => Math.hypot(b.xM - a.xM, b.zM - a.zM);

export function computeThinWallSection(
  points: readonly SectionPoint[],
  thicknessesM: readonly number[],
  material: MaterialDefinition = ALUMINUM_2024_T3,
  wallNames: readonly string[] = ['top_skin', 'rear_web', 'bottom_skin', 'front_web'],
): ThinWallSection {
  if (points.length < 3 || points.length !== thicknessesM.length) throw new Error('Closed thin-wall section needs matching point and wall-thickness arrays.');
  const walls: SectionWall[] = points.map((start, index) => {
    const end = points[(index + 1) % points.length];
    const thicknessM = thicknessesM[index];
    const lengthM = distance(start, end);
    if (![start.xM, start.zM, end.xM, end.zM, thicknessM, lengthM].every(Number.isFinite) || thicknessM <= 0 || lengthM <= 0) throw new Error('Wing-box wall geometry must be finite and non-degenerate.');
    return { name: wallNames[index] ?? `wall_${index}`, start, end, thicknessM, lengthM, areaM2: thicknessM * lengthM };
  });
  const areaM2 = walls.reduce((sum, wall) => sum + wall.areaM2, 0);
  const centroidXM = walls.reduce((sum, wall) => sum + wall.areaM2 * (wall.start.xM + wall.end.xM) / 2, 0) / areaM2;
  const centroidZM = walls.reduce((sum, wall) => sum + wall.areaM2 * (wall.start.zM + wall.end.zM) / 2, 0) / areaM2;
  const inertiaOrigin = walls.reduce((sum, wall) => sum + wall.thicknessM * wall.lengthM * (wall.start.zM ** 2 + wall.start.zM * wall.end.zM + wall.end.zM ** 2) / 3, 0);
  const bendingInertiaM4 = inertiaOrigin - areaM2 * centroidZM ** 2;
  let signedTwiceArea = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    signedTwiceArea += point.xM * next.zM - next.xM * point.zM;
  });
  const enclosedAreaM2 = Math.abs(signedTwiceArea) / 2;
  const torsionDenominator = walls.reduce((sum, wall) => sum + wall.lengthM / wall.thicknessM, 0);
  const torsionConstantM4 = 4 * enclosedAreaM2 ** 2 / torsionDenominator;
  if (![areaM2, centroidXM, centroidZM, bendingInertiaM4, enclosedAreaM2, torsionConstantM4].every(Number.isFinite) || bendingInertiaM4 <= 0 || enclosedAreaM2 <= 0 || torsionConstantM4 <= 0) throw new Error('Computed wing-box properties are nonphysical.');
  return {
    areaM2,
    centroidXM,
    centroidZM,
    bendingInertiaM4,
    enclosedAreaM2,
    torsionConstantM4,
    massPerLengthKgM: material.densityKgM3 * areaM2,
    bendingStiffnessNm2: material.youngsModulusPa * bendingInertiaM4,
    torsionalStiffnessNm2: material.shearModulusPa * torsionConstantM4,
    walls,
    material,
  };
}

export function wingBoxAtY(design: WingDesign, yM: number): ThinWallSection {
  if (design.structure.material !== ALUMINUM_2024_T3.key) throw new Error(`Unsupported material preset: ${String(design.structure.material)}.`);
  const chordM = chordAtY(design.geometry, yM);
  const eta = Math.min(1, Math.max(0, 2 * Math.abs(yM) / design.geometry.spanM));
  const section = localAirfoilSection(design.geometry, eta);
  const front = sectionSurfaceAtX(section, design.structure.frontSparXOverC);
  const rear = sectionSurfaceAtX(section, design.structure.rearSparXOverC);
  const points: SectionPoint[] = [
    { xM: design.structure.frontSparXOverC * chordM, zM: front.zUpper * chordM },
    { xM: design.structure.rearSparXOverC * chordM, zM: rear.zUpper * chordM },
    { xM: design.structure.rearSparXOverC * chordM, zM: rear.zLower * chordM },
    { xM: design.structure.frontSparXOverC * chordM, zM: front.zLower * chordM },
  ];
  const skin = design.structure.skinThicknessMm / 1000;
  const frontWeb = design.structure.frontWebThicknessMm / 1000;
  const rearWeb = design.structure.rearWebThicknessMm / 1000;
  const minimumDimension = Math.min(
    distance(points[0], points[1]),
    distance(points[1], points[2]),
    distance(points[2], points[3]),
    distance(points[3], points[0]),
  );
  if (Math.max(skin, frontWeb, rearWeb) > 0.1 * minimumDimension) throw new Error('Wall gauge exceeds 10% of a local box dimension; thin-wall assumptions are invalid.');
  return computeThinWallSection(points, [skin, rearWeb, skin, frontWeb], ALUMINUM_2024_T3);
}

/**
 * Solver-mesh-independent structural mass integration. Airfoil-station
 * boundaries are explicit integration boundaries and each interval uses
 * five-point Gauss–Legendre quadrature.
 */
export function expectedStructuralMassKg(design: WingDesign) {
  const gauss = [
    { r: 0.046910077030668, weight: 0.118463442528095 },
    { r: 0.230765344947158, weight: 0.239314335249683 },
    { r: 0.5, weight: 0.284444444444444 },
    { r: 0.769234655052842, weight: 0.239314335249683 },
    { r: 0.953089922969332, weight: 0.118463442528095 },
  ] as const;
  const stations = resolvedAirfoilStations(design.geometry);
  let etaIntegral = 0;
  for (let interval = 0; interval < stations.length - 1; interval += 1) {
    const start = stations[interval].eta;
    const length = stations[interval + 1].eta - start;
    for (const { r, weight } of gauss) {
      const eta = start + r * length;
      const yM = eta * design.geometry.spanM / 2;
      etaIntegral += wingBoxAtY(design, yM).massPerLengthKgM * length * weight;
    }
  }
  return design.geometry.spanM * etaIntegral;
}

export function recoverWallStress(section: ThinWallSection, bendingMomentNm: number, torqueNm: number): WallStressResult {
  if (!Number.isFinite(bendingMomentNm) || !Number.isFinite(torqueNm)) throw new Error('Stress-recovery actions must be finite.');
  const shearFlowNm = torqueNm / (2 * section.enclosedAreaM2);
  const result: WallStressResult = {
    maxBendingStressPa: 0,
    maxTorsionalShearPa: 0,
    maxVonMisesPa: 0,
    yieldMargin: null,
    criticalWall: section.walls[0].name,
    criticalPoint: section.walls[0].start,
  };
  for (const wall of section.walls) {
    const shearPa = shearFlowNm / wall.thicknessM;
    result.maxTorsionalShearPa = Math.max(result.maxTorsionalShearPa, Math.abs(shearPa));
    for (const point of [wall.start, wall.end]) {
      const bendingPa = -bendingMomentNm * (point.zM - section.centroidZM) / section.bendingInertiaM4;
      result.maxBendingStressPa = Math.max(result.maxBendingStressPa, Math.abs(bendingPa));
      const vonMisesPa = Math.sqrt(bendingPa ** 2 + 3 * shearPa ** 2);
      if (vonMisesPa > result.maxVonMisesPa) {
        result.maxVonMisesPa = vonMisesPa;
        result.yieldMargin = section.material.yieldStrengthPa / vonMisesPa;
        result.criticalWall = wall.name;
        result.criticalPoint = point;
      }
    }
  }
  return result;
}
