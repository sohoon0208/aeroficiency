import { describe, expect, it } from 'vitest';
import { createBaselineDesign } from '@/lib/domain/defaults';
import type { AirfoilDefinition, WingGeometry } from '@/lib/domain/types';
import { canonicalAirfoil, localAirfoilSection, validateAirfoilStations } from '@/lib/solver/airfoilSections';
import { sampleNaca4 } from '@/lib/solver/naca';
import { expectedStructuralMassKg, wingBoxAtY } from '@/lib/solver/wingBox';

const geometry = (stations: WingGeometry['airfoilStations']): WingGeometry => ({
  spanM: 8,
  rootChordM: 1.4,
  tipChordM: 0.8,
  rootTwistDeg: 0,
  tipTwistDeg: -2,
  nacaCode: stations[0].airfoil.kind === 'NACA4' ? stations[0].airfoil.code : '2412',
  airfoilStations: stations,
  polarModel: { kind: 'ANALYTIC_ATTACHED', tables: [] },
});

function nacaContour(code: string) {
  const points = sampleNaca4(code, 60);
  return [
    ...[...points].reverse().map((point) => [point.xLower, point.zLower] as const),
    ...points.slice(1).map((point) => [point.xUpper, point.zUpper] as const),
  ];
}

describe('V4 spanwise airfoil sections', () => {
  it('honours exact station endpoints and interpolates camber and half-thickness independently', () => {
    const wing = geometry([
      { id: 'root', eta: 0, airfoil: { kind: 'NACA4', code: '0012' }, blendToNext: 'LINEAR_CAMBER_THICKNESS' },
      { id: 'mid', eta: 0.5, airfoil: { kind: 'NACA4', code: '2412' }, blendToNext: 'LINEAR_CAMBER_THICKNESS' },
      { id: 'tip', eta: 1, airfoil: { kind: 'NACA4', code: '4415' }, blendToNext: 'HOLD' },
    ]);
    const root = canonicalAirfoil(wing.airfoilStations[0].airfoil, 80);
    const mid = canonicalAirfoil(wing.airfoilStations[1].airfoil, 80);
    const quarter = localAirfoilSection(wing, 0.25, 80);
    const atRoot = localAirfoilSection(wing, 0, 80);
    const atMid = localAirfoilSection(wing, 0.5, 80);
    expect(atRoot.camber).toEqual(root.camber);
    expect(atMid.camber).toEqual(mid.camber);
    for (const index of [0, 8, 24, 40, 64, 80]) {
      expect(quarter.camber[index]).toBeCloseTo((root.camber[index] + mid.camber[index]) / 2, 12);
      expect(quarter.halfThickness[index]).toBeCloseTo((root.halfThickness[index] + mid.halfThickness[index]) / 2, 12);
    }
    expect(quarter.leftStationId).toBe('root');
    expect(quarter.rightStationId).toBe('mid');
    expect(quarter.blendFraction).toBeCloseTo(0.5, 14);
  });

  it('holds a section between stations without overriding the exact outboard endpoint', () => {
    const wing = geometry([
      { id: 'root', eta: 0, airfoil: { kind: 'NACA4', code: '0012' }, blendToNext: 'HOLD' },
      { id: 'tip', eta: 1, airfoil: { kind: 'NACA4', code: '2412' }, blendToNext: 'HOLD' },
    ]);
    expect(localAirfoilSection(wing, 0.999, 80).label).toBe('NACA 0012');
    expect(localAirfoilSection(wing, 1, 80).label).toBe('NACA 2412');
  });

  it('normalizes translated, scaled, rotated, and reversed coordinate contours', () => {
    const angle = 17 * Math.PI / 180;
    const transform = ([x, z]: readonly [number, number]) => {
      const scaledX = 2.7 * x;
      const scaledZ = 2.7 * z;
      return [3.4 + scaledX * Math.cos(angle) - scaledZ * Math.sin(angle), -1.8 + scaledX * Math.sin(angle) + scaledZ * Math.cos(angle)] as const;
    };
    const transformed = nacaContour('2412').map(transform);
    const forward: AirfoilDefinition = { kind: 'COORDINATES', name: 'Rotated 2412', points: transformed };
    const reversed: AirfoilDefinition = { kind: 'COORDINATES', name: 'Reversed 2412', points: [...transformed].reverse() };
    const reference = canonicalAirfoil({ kind: 'NACA4', code: '2412' }, 80);
    const imported = canonicalAirfoil(forward, 80);
    const reversedImported = canonicalAirfoil(reversed, 80);
    expect(imported.maximumThicknessRatio).toBeCloseTo(reference.maximumThicknessRatio, 2);
    expect(imported.maximumCamberRatio).toBeCloseTo(reference.maximumCamberRatio, 2);
    expect(reversedImported.maximumThicknessRatio).toBeCloseTo(imported.maximumThicknessRatio, 10);
    expect(reversedImported.maximumCamberRatio).toBeCloseTo(imported.maximumCamberRatio, 10);
    expect(imported.halfThickness.every((value) => value >= 0)).toBe(true);
  });

  it('rejects invalid station topology and self-intersecting coordinate contours', () => {
    const validContour = nacaContour('0012');
    const crossing = [...validContour];
    [crossing[15], crossing[75]] = [crossing[75], crossing[15]];
    const issues = validateAirfoilStations([
      { id: 'root', eta: 0, airfoil: { kind: 'COORDINATES', name: 'Crossing', points: crossing }, blendToNext: 'LINEAR_CAMBER_THICKNESS' },
      { id: 'near', eta: 0.02, airfoil: { kind: 'NACA4', code: '0012' }, blendToNext: 'LINEAR_CAMBER_THICKNESS' },
      { id: 'tip', eta: 1, airfoil: { kind: 'NACA4', code: '0012' }, blendToNext: 'LINEAR_CAMBER_THICKNESS' },
    ]);
    expect(issues.some((issue) => /self-intersect/i.test(issue.reason))).toBe(true);
    expect(issues.some((issue) => /at least 0.05/.test(issue.reason))).toBe(true);
    expect(issues.some((issue) => /tip station must use HOLD/i.test(issue.reason))).toBe(true);
  });

  it('couples local thickness into wing-box stiffness and mesh-independent wall mass', () => {
    const uniform = createBaselineDesign();
    uniform.geometry.airfoilStations = [
      { id: 'root', eta: 0, airfoil: { kind: 'NACA4', code: '0012' }, blendToNext: 'LINEAR_CAMBER_THICKNESS' },
      { id: 'tip', eta: 1, airfoil: { kind: 'NACA4', code: '0012' }, blendToNext: 'HOLD' },
    ];
    uniform.geometry.nacaCode = '0012';
    const thickTip = structuredClone(uniform);
    thickTip.geometry.airfoilStations[1].airfoil = { kind: 'NACA4', code: '0020' };
    const y = thickTip.geometry.spanM / 2;
    expect(wingBoxAtY(thickTip, y).bendingStiffnessNm2).toBeGreaterThan(wingBoxAtY(uniform, y).bendingStiffnessNm2);
    expect(wingBoxAtY(thickTip, y).torsionalStiffnessNm2).toBeGreaterThan(wingBoxAtY(uniform, y).torsionalStiffnessNm2);
    expect(expectedStructuralMassKg(thickTip)).toBeGreaterThan(expectedStructuralMassKg(uniform));
    expect(expectedStructuralMassKg(thickTip)).toBe(expectedStructuralMassKg(structuredClone(thickTip)));
  });

  it('derives symmetric and cambered thin-airfoil reference characteristics with the expected signs', () => {
    const symmetric = localAirfoilSection(geometry([
      { id: 'root', eta: 0, airfoil: { kind: 'NACA4', code: '0012' }, blendToNext: 'LINEAR_CAMBER_THICKNESS' },
      { id: 'tip', eta: 1, airfoil: { kind: 'NACA4', code: '0012' }, blendToNext: 'HOLD' },
    ]), 0.5);
    const cambered = localAirfoilSection(geometry([
      { id: 'root', eta: 0, airfoil: { kind: 'NACA4', code: '2412' }, blendToNext: 'LINEAR_CAMBER_THICKNESS' },
      { id: 'tip', eta: 1, airfoil: { kind: 'NACA4', code: '2412' }, blendToNext: 'HOLD' },
    ]), 0.5);
    expect(Math.abs(symmetric.zeroLiftAngleRad)).toBeLessThan(1e-10);
    expect(Math.abs(symmetric.quarterChordMomentCoefficient)).toBeLessThan(1e-10);
    expect(cambered.zeroLiftAngleRad).toBeLessThan(0);
    expect(cambered.quarterChordMomentCoefficient).toBeLessThan(0);
  });
});
