import { describe, expect, it } from 'vitest';
import { airfoilCatalogDefinition } from '@/lib/domain/airfoilCatalog';
import { createBaselineDesign, createDefaultProject } from '@/lib/domain/defaults';
import type { AirfoilDefinition, WingDesign } from '@/lib/domain/types';
import { solveFixedAngleAerodynamics } from '@/lib/solver/aero';
import { localAirfoilSection } from '@/lib/solver/airfoilSections';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { solveAirfoilSectionPotentialFlow } from '@/lib/solver/panel2d';

function designWithUniformAirfoil(airfoil: AirfoilDefinition): WingDesign {
  const design = createBaselineDesign();
  design.geometry.tipTwistDeg = 0;
  design.geometry.airfoilStations = [
    { id: 'afs_root', eta: 0, airfoil, blendToNext: 'LINEAR_CAMBER_THICKNESS' },
    { id: 'afs_tip', eta: 1, airfoil: structuredClone(airfoil), blendToNext: 'HOLD' },
  ];
  if (airfoil.kind === 'NACA4') design.geometry.nacaCode = airfoil.code;
  return design;
}

function fixedWing(design: WingDesign, alphaDeg: number) {
  return solveFixedAngleAerodynamics(
    design.geometry,
    createDefaultProject().flightCase,
    { eta: [0, 1], twistRad: [0, 0] },
    32,
    alphaDeg,
  );
}

describe('AoA sweep and 2D airfoil validation matrix', () => {
  it('recovers symmetry, a plausible finite-wing lift slope, and positive drag for NACA 0012', () => {
    const design = designWithUniformAirfoil({ kind: 'NACA4', code: '0012' });
    const negative = fixedWing(design, -4);
    const zero = fixedWing(design, 0);
    const positive = fixedWing(design, 4);
    const slopePerRad = (positive.liftCoefficient - negative.liftCoefficient) / (8 * Math.PI / 180);
    const aspectRatio = design.geometry.spanM ** 2 / (design.geometry.spanM * (design.geometry.rootChordM + design.geometry.tipChordM) / 2);
    const finiteWingReference = 2 * Math.PI / (1 + 2 / aspectRatio);

    expect(Math.abs(zero.liftCoefficient)).toBeLessThan(1e-10);
    expect(positive.liftCoefficient).toBeCloseTo(-negative.liftCoefficient, 8);
    expect(Math.abs(slopePerRad - finiteWingReference) / finiteWingReference).toBeLessThan(0.25);
    expect([negative, zero, positive].every((result) => result.combinedDragCoefficient > 0 && Number.isFinite(result.estimatedLiftToDrag))).toBe(true);

    const section = localAirfoilSection(design.geometry, 0.5, 120);
    const panelZero = solveAirfoilSectionPotentialFlow(section, 0, 50, 120);
    const panelFour = solveAirfoilSectionPotentialFlow(section, 4, 50, 120);
    const thinAirfoil = 2 * Math.PI * 4 * Math.PI / 180;
    expect(Math.abs(panelZero.liftCoefficient)).toBeLessThan(1e-6);
    expect(Math.abs(panelFour.liftCoefficient - thinAirfoil) / thinAirfoil).toBeLessThan(0.18);
    expect(Math.abs(panelFour.kuttaResidualMps)).toBeLessThan(1e-8);
    expect(Math.abs(panelFour.sourceFluxResidualM2ps) / panelFour.freeStreamMps).toBeLessThan(0.005);
  });

  it('keeps thin, thick, cambered, Clark, S, SG, and SC sections finite and directionally correct', () => {
    const definitions: Array<[string, AirfoilDefinition]> = [
      ['NACA 0008', { kind: 'NACA4', code: '0008' }],
      ['NACA 0024', { kind: 'NACA4', code: '0024' }],
      ['NACA 2412', { kind: 'NACA4', code: '2412' }],
      ['Clark Y', airfoilCatalogDefinition('clark-y')!],
      ['S1223', airfoilCatalogDefinition('s1223')!],
      ['SG6043', airfoilCatalogDefinition('sg6043')!],
      ['NASA SC(2)-0412', airfoilCatalogDefinition('sc2-0412')!],
    ];

    definitions.forEach(([label, definition]) => {
      const design = designWithUniformAirfoil(definition);
      const wing = [-2, 0, 4].map((alpha) => fixedWing(design, alpha));
      expect(wing.every((result) => Number.isFinite(result.liftCoefficient) && result.combinedDragCoefficient > 0), label).toBe(true);
      expect(wing[0].liftCoefficient, label).toBeLessThan(wing[1].liftCoefficient);
      expect(wing[1].liftCoefficient, label).toBeLessThan(wing[2].liftCoefficient);

      const section = localAirfoilSection(design.geometry, 0.5, 120);
      let panels;
      try {
        panels = [-2, 0, 4].map((alpha) => solveAirfoilSectionPotentialFlow(section, alpha, 50, 120));
      } catch (error) {
        throw new Error(`${label}: ${error instanceof Error ? error.message : '2D panel solve failed'}`);
      }
      expect(panels.every((result) => result.surface.every((point) => Number.isFinite(point.cp) && Number.isFinite(point.tangentialVelocityRatio))), label).toBe(true);
      expect(panels.every((result) => Math.abs(result.kuttaResidualMps) < 1e-8), label).toBe(true);
      expect(panels.every((result) => Math.abs(result.sourceFluxResidualM2ps) / result.freeStreamMps < 0.01), label).toBe(true);
      expect(panels[0].liftCoefficient, label).toBeLessThan(panels[1].liftCoefficient);
      expect(panels[1].liftCoefficient, label).toBeLessThan(panels[2].liftCoefficient);
    });
  });

  it('completes the full supported angle envelope for representative NACA, S, SG, and SC profiles', () => {
    const definitions: Array<[string, AirfoilDefinition]> = [
      ['NACA 0012', { kind: 'NACA4', code: '0012' }],
      ['S1223', airfoilCatalogDefinition('s1223')!],
      ['SG6043', airfoilCatalogDefinition('sg6043')!],
      ['NASA SC(2)-0412', airfoilCatalogDefinition('sc2-0412')!],
    ];
    definitions.forEach(([label, definition]) => {
      const state = createDefaultProject();
      state.flightCase.sweepMinAlphaDeg = -8;
      state.flightCase.sweepMaxAlphaDeg = 12;
      state.flightCase.sweepStepAlphaDeg = 1;
      const design = designWithUniformAirfoil(definition);
      state.designs[state.activeDesignId] = design;
      let analysis;
      try {
        analysis = buildAnalysisSnapshot(state, design, 'fast');
      } catch (error) {
        throw new Error(`${label}: ${error instanceof Error ? error.message : 'coupled sweep failed'}`);
      }
      expect(analysis.angleSweep.points).toHaveLength(21);
      expect(analysis.angleSweep.points[0].alphaDeg).toBe(-8);
      expect(analysis.angleSweep.points.at(-1)!.alphaDeg).toBe(12);
      expect(analysis.angleSweep.points.every((point) => point.status === 'converged'), label).toBe(true);
      expect(analysis.angleSweep.points.every((point) => point.metrics.trimmedAlphaDeg === point.alphaDeg), label).toBe(true);
    });
  });
});
