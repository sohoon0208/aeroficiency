import { describe, expect, it } from 'vitest';
import { createBaselineDesign, createDefaultProject } from '@/lib/domain/defaults';
import { solveTargetLiftAerodynamics } from '@/lib/solver/aero';
import { runAeroelasticCoupling } from '@/lib/solver/coupling';

const expectClose = (actual: number, expected: number, tolerance = 1e-9) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(expected)));
};

describe('two-way torsional aeroelastic coupling', () => {
  it('matches the exact standard baseline diagnostics and remains deterministic', () => {
    const design = createBaselineDesign();
    const flightCase = createDefaultProject().flightCase;
    const first = runAeroelasticCoupling(design, flightCase, 'standard');
    const second = runAeroelasticCoupling(design, flightCase, 'standard');
    expect(first.status).toBe('converged');
    expect(first.diagnostics.iterations).toBe(10);
    expectClose(first.diagnostics.equilibriumResidualRad, 1.1828951690750046e-5);
    expectClose(first.diagnostics.iterateChangeRad, 4.140133091762462e-6);
    expectClose(first.diagnostics.relativeLoadChange, 9.895504648609458e-6);
    expectClose(first.diagnostics.relativeLiftError, 7.040975727745084e-9);
    expectClose(first.aero.alphaRad, 0.1022096384072868);
    expectClose(first.aero.liftN, 31599.999777505167);
    expectClose(first.aero.liftCoefficient, 0.6032405735929293);
    expectClose(first.aero.inducedDragN, 856.8949375215692);
    expectClose(first.aero.inducedDragCoefficient, 0.016358031558828045);
    expectClose(first.aero.profileDragN, 550.2358639817894);
    expectClose(first.aero.combinedDragN, 1407.1308015033587);
    expectClose(first.aero.estimatedLiftToDrag, 22.457045033584777);
    expectClose(first.structure.structuralMassKg, 119.26300561034267);
    expectClose(first.structure.tipDeflectionM, 0.10896055522120082);
    expectClose(first.structure.tipElasticTwistRad, 0.0008568245094395619);
    expectClose(first.structure.minimumYieldMargin, 3.771241968135253);
    expect(first.aero.liftN).toBeCloseTo(second.aero.liftN, 10);
    expect(first.aero.inducedDragN).toBeCloseTo(second.aero.inducedDragN, 10);
    expect(first.structure.tipDeflectionM).toBeCloseTo(second.structure.tipDeflectionM, 12);
  });

  it('retains camber-moment torsion at quarter chord and removes it for a symmetric section', () => {
    const design = createBaselineDesign();
    design.structure.elasticAxisXOverC = 0.25;
    const result = runAeroelasticCoupling(design, createDefaultProject().flightCase, 'fast');
    expect(result.status).toBe('converged');
    expect(result.structure.tipElasticTwistRad).toBeLessThan(0);
    expectClose(result.structure.maxElasticTwistRad, 0.002256966182229079);

    const symmetricDesign = structuredClone(design);
    symmetricDesign.geometry.nacaCode = '0012';
    symmetricDesign.geometry.airfoilStations = [
      { id: 'afs_root', eta: 0, airfoil: { kind: 'NACA4', code: '0012' }, blendToNext: 'LINEAR_CAMBER_THICKNESS' },
      { id: 'afs_tip', eta: 1, airfoil: { kind: 'NACA4', code: '0012' }, blendToNext: 'HOLD' },
    ];
    const symmetric = runAeroelasticCoupling(symmetricDesign, createDefaultProject().flightCase, 'fast');
    expect(symmetric.structure.maxElasticTwistRad).toBeLessThan(1e-14);
    const rigid = solveTargetLiftAerodynamics(symmetricDesign.geometry, createDefaultProject().flightCase, { eta: [0, 1], twistRad: [0, 0] }, 16);
    expectClose(symmetric.aero.liftN, rigid.liftN, 1e-10);
    expectClose(symmetric.aero.inducedDragN, rigid.inducedDragN, 1e-10);
    expectClose(symmetric.aero.alphaRad, rigid.alphaRad, 1e-10);
  });

  it('reduces elastic twist with a stiffer box and reverses twist with the lift-axis offset', () => {
    const flightCase = createDefaultProject().flightCase;
    const flexible = createBaselineDesign();
    flexible.structure = { ...flexible.structure, skinThicknessMm: 1.2, frontWebThicknessMm: 1.5, rearWebThicknessMm: 1.5 };
    const stiff = createBaselineDesign();
    stiff.structure = { ...stiff.structure, skinThicknessMm: 4, frontWebThicknessMm: 5, rearWebThicknessMm: 5 };
    const flexibleResult = runAeroelasticCoupling(flexible, flightCase, 'fast');
    const stiffResult = runAeroelasticCoupling(stiff, flightCase, 'fast');
    expect(Math.abs(stiffResult.structure.tipElasticTwistRad)).toBeLessThan(Math.abs(flexibleResult.structure.tipElasticTwistRad));

    const ahead = createBaselineDesign();
    ahead.structure.elasticAxisXOverC = 0.21;
    const behind = createBaselineDesign();
    behind.structure.elasticAxisXOverC = 0.38;
    const aheadResult = runAeroelasticCoupling(ahead, flightCase, 'fast');
    const behindResult = runAeroelasticCoupling(behind, flightCase, 'fast');
    expect(aheadResult.structure.tipElasticTwistRad).toBeLessThan(0);
    expect(behindResult.structure.tipElasticTwistRad).toBeGreaterThan(0);
    expect(Math.abs(aheadResult.aero.liftN - flightCase.targetLiftN) / flightCase.targetLiftN).toBeLessThan(1e-5);
    expect(Math.abs(behindResult.aero.liftN - flightCase.targetLiftN) / flightCase.targetLiftN).toBeLessThan(1e-5);
  });
});
