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
    expect(first.diagnostics.iterations).toBe(13);
    expectClose(first.diagnostics.equilibriumResidualRad, 1.1652301165688758e-5);
    expectClose(first.diagnostics.iterateChangeRad, 4.078305407990805e-6);
    expectClose(first.diagnostics.relativeLoadChange, 7.425463115764916e-6);
    expectClose(first.diagnostics.relativeLiftError, 2.374448809813991e-8);
    expectClose(first.aero.alphaRad, 0.10835180334263425);
    expectClose(first.aero.liftN, 31600.000750325824);
    expectClose(first.aero.liftCoefficient, 0.6032405921639703);
    expectClose(first.aero.inducedDragN, 851.3509614438959);
    expectClose(first.aero.inducedDragCoefficient, 0.01625219765589676);
    expectClose(first.structure.structuralMassKg, 119.22495731625663);
    expectClose(first.structure.tipDeflectionM, 0.10880987630466586);
    expectClose(first.structure.tipElasticTwistRad, 0.0030947134846146616);
    expectClose(first.structure.minimumYieldMargin, 3.7559009483521697);
    expect(first.aero.liftN).toBeCloseTo(second.aero.liftN, 10);
    expect(first.aero.inducedDragN).toBeCloseTo(second.aero.inducedDragN, 10);
    expect(first.structure.tipDeflectionM).toBeCloseTo(second.structure.tipDeflectionM, 12);
  });

  it('produces no elastic twist when the elastic axis is at quarter chord', () => {
    const design = createBaselineDesign();
    design.structure.elasticAxisXOverC = 0.25;
    const result = runAeroelasticCoupling(design, createDefaultProject().flightCase, 'fast');
    expect(result.status).toBe('converged');
    expect(result.structure.maxElasticTwistRad).toBeLessThan(1e-14);
    const rigid = solveTargetLiftAerodynamics(design.geometry, createDefaultProject().flightCase, { eta: [0, 1], twistRad: [0, 0] }, 16);
    expectClose(result.aero.liftN, rigid.liftN, 1e-10);
    expectClose(result.aero.inducedDragN, rigid.inducedDragN, 1e-10);
    expectClose(result.aero.alphaRad, rigid.alphaRad, 1e-10);
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
