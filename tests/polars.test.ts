import { describe, expect, it } from 'vitest';
import { createBaselineDesign, createDefaultProject } from '@/lib/domain/defaults';
import type { SectionPolar, WingGeometry } from '@/lib/domain/types';
import { solveTargetLiftAerodynamics } from '@/lib/solver/aero';
import { evaluateSectionPolar, validatePolarModel } from '@/lib/solver/polars';

const alphaRows = [-6, -4, -2, 0, 2, 4, 6];

function table(
  polarId: string,
  airfoilStationId: string,
  reynolds: number,
  clOffset: number,
  cd0: number,
  cm: number,
): SectionPolar {
  return {
    polarId,
    airfoilStationId,
    reynolds,
    mach: 0,
    transitionModel: 'fixed transition test fixture',
    rows: alphaRows.map((alphaDeg) => ({
      alphaDeg,
      cl: clOffset + 0.1 * alphaDeg,
      cd: cd0 + 0.0002 * alphaDeg ** 2,
      cm,
    })),
    provenance: { source: 'USER_IMPORT', label: `${airfoilStationId} ${reynolds}` },
  };
}

function userPolarGeometry(): WingGeometry {
  const geometry = structuredClone(createBaselineDesign().geometry);
  geometry.polarModel = {
    kind: 'USER_TABLES',
    tables: [
      table('root_low', 'afs_root', 1e6, 0, 0.012, -0.04),
      table('root_high', 'afs_root', 2e6, 0.1, 0.010, -0.05),
      table('tip_low', 'afs_tip', 1e6, -0.2, 0.016, 0.01),
      table('tip_high', 'afs_tip', 2e6, -0.1, 0.014, 0),
    ],
  };
  return geometry;
}

describe('V5 Reynolds-aware section polars', () => {
  it('generates a disclosed attached-flow estimate whose profile drag decreases with Reynolds number', () => {
    const geometry = createBaselineDesign().geometry;
    const low = evaluateSectionPolar(geometry, 0.5, 3e5, 2);
    const high = evaluateSectionPolar(geometry, 0.5, 3e6, 2);

    expect(low.state).toBe('analytic_estimate');
    expect(low.provenance).toContain('analytic estimate');
    expect(high.cd).toBeLessThan(low.cd);
    expect(Math.abs(high.cl - low.cl)).toBeLessThan(1e-4);
    expect(high.cm).toBeCloseTo(low.cm, 12);
    expect(low.alphaRangeDeg).toEqual([-12, 16]);
  });

  it('interpolates alpha, Reynolds number, and span station independently', () => {
    const evaluated = evaluateSectionPolar(userPolarGeometry(), 0.5, 1.5e6, 1);

    expect(evaluated.state).toBe('within_range');
    expect(evaluated.cl).toBeCloseTo(0.05, 12);
    expect(evaluated.cd).toBeCloseTo(0.0134, 12);
    expect(evaluated.cm).toBeCloseTo(-0.02, 12);
    expect(evaluated.alphaRangeDeg).toEqual([-6, 6]);
    expect(evaluated.reynoldsRange).toEqual([1e6, 2e6]);
    expect(evaluated.provenance).toContain('afs_root');
    expect(evaluated.provenance).toContain('afs_tip');
  });

  it('honours HOLD station semantics and reports alpha/Reynolds range states', () => {
    const geometry = userPolarGeometry();
    geometry.airfoilStations[0].blendToNext = 'HOLD';
    const held = evaluateSectionPolar(geometry, 0.999, 1.5e6, 1);
    const tip = evaluateSectionPolar(geometry, 1, 1.5e6, 1);
    expect(held.cl).toBeCloseTo(0.15, 12);
    expect(tip.cl).toBeCloseTo(-0.05, 12);

    expect(evaluateSectionPolar(geometry, 0, 1.5e6, 7).state).toBe('extrapolated_alpha');
    expect(evaluateSectionPolar(geometry, 0, 1.5e6, 10).state).toBe('outside_alpha');
    expect(evaluateSectionPolar(geometry, 0, 5e5, 0).state).toBe('outside_reynolds');
  });

  it('rejects incomplete, duplicate, and untraceable table contracts', () => {
    const geometry = userPolarGeometry();
    geometry.polarModel.tables = [
      geometry.polarModel.tables[0],
      { ...structuredClone(geometry.polarModel.tables[0]), polarId: 'duplicate_re' },
    ];
    geometry.polarModel.tables[1].provenance = { source: 'ANALYTIC_ESTIMATE', label: '' };
    const issues = validatePolarModel(geometry);
    expect(issues.some((issue) => issue.reason.includes('only one table'))).toBe(true);
    expect(issues.some((issue) => issue.reason.includes('provenance'))).toBe(true);
    expect(issues.some((issue) => issue.reason.includes('station afs_tip'))).toBe(true);
  });

  it('couples local Reynolds/polars into deterministic profile and combined wing drag', () => {
    const design = createBaselineDesign();
    const project = createDefaultProject();
    const twist = { eta: [0, 1], twistRad: [0, 0] } as const;
    const first = solveTargetLiftAerodynamics(design.geometry, project.flightCase, twist, 32);
    const second = solveTargetLiftAerodynamics(design.geometry, project.flightCase, twist, 32);

    expect(first.profileDragN).toBeGreaterThan(0);
    expect(first.combinedDragN).toBeCloseTo(first.inducedDragN + first.profileDragN, 10);
    expect(first.combinedDragCoefficient).toBeCloseTo(first.inducedDragCoefficient + first.profileDragCoefficient, 12);
    expect(first.estimatedLiftToDrag).toBeCloseTo(first.liftN / first.combinedDragN, 12);
    expect(first.strips.every((strip) => strip.reynoldsNumber > 0 && strip.profileDragCoefficient > 0)).toBe(true);
    expect(first.strips.some((strip) => strip.pitchingMomentCoefficient < 0)).toBe(true);
    expect(first.combinedDragN).toBeCloseTo(second.combinedDragN, 12);
    expect(first.polarResidual).toBeLessThanOrEqual(2e-5);
  });

  it('runs a complete target-lift solve from imported root/tip tables across Reynolds number', () => {
    const geometry = structuredClone(createBaselineDesign().geometry);
    const solverAlphaRows = [-8, -4, 0, 4, 8, 12, 16];
    const solverTable = (polarId: string, stationId: string, reynolds: number, offset: number, cd0: number, cm: number): SectionPolar => ({
      polarId,
      airfoilStationId: stationId,
      reynolds,
      mach: 0.12,
      transitionModel: 'user supplied transition metadata',
      rows: solverAlphaRows.map((alphaDeg) => ({
        alphaDeg,
        cl: offset + 0.09 * alphaDeg,
        cd: cd0 + 0.00025 * alphaDeg ** 2,
        cm,
      })),
      provenance: { source: 'XFOIL', label: `${stationId} Re ${reynolds}`, licence: 'User supplied' },
    });
    geometry.polarModel = {
      kind: 'USER_TABLES',
      tables: [
        solverTable('root_re3m', 'afs_root', 3e6, 0.18, 0.011, -0.045),
        solverTable('root_re15m', 'afs_root', 15e6, 0.2, 0.009, -0.05),
        solverTable('tip_re3m', 'afs_tip', 3e6, 0.08, 0.015, -0.015),
        solverTable('tip_re15m', 'afs_tip', 15e6, 0.1, 0.012, -0.02),
      ],
    };

    expect(validatePolarModel(geometry)).toEqual([]);
    const result = solveTargetLiftAerodynamics(
      geometry,
      createDefaultProject().flightCase,
      { eta: [0, 1], twistRad: [0, 0] },
      32,
    );

    expect(result.targetLiftError).toBeLessThanOrEqual(2e-6);
    expect(result.polarResidual).toBeLessThanOrEqual(2e-5);
    expect(result.strips.every((strip) => strip.polarState === 'within_range')).toBe(true);
    expect(result.strips.every((strip) => strip.polarProvenance.includes('Re'))).toBe(true);
    expect(result.profileDragN).toBeGreaterThan(0);
    expect(result.combinedDragN).toBeCloseTo(result.inducedDragN + result.profileDragN, 10);
  });
});
