import { describe, expect, it } from 'vitest';
import { internalActionAtY, solveCantileverBending, solveCantileverTorsion } from '@/lib/solver/beam';

describe('right-semispan cantilever beam', () => {
  it('matches analytical tip-load bending', () => {
    const result = solveCantileverBending([0, 2], () => 70e9 * 1e-5, [0], 1_000);
    expect(result.deflectionM[1]).toBeCloseTo(0.0038095238095238095, 12);
    expect(result.slopeRad[1]).toBeCloseTo(0.002857142857142857, 12);
    expect(result.relativeResidual).toBeLessThan(1e-12);
  });

  it('matches analytical uniformly distributed bending load', () => {
    const result = solveCantileverBending([0, 2], () => 70e9 * 1e-5, [500]);
    expect(result.deflectionM[1]).toBeCloseTo(0.0014285714285714286, 12);
    expect(result.slopeRad[1]).toBeCloseTo(0.0009523809523809524, 12);
  });

  it('matches analytical tip-torque twist', () => {
    const result = solveCantileverTorsion([0, 2], () => 26e9 * 2e-5, [0], 600);
    expect(result.twistRad[1]).toBeCloseTo(0.0023076923076923075, 12);
  });

  it('conserves distributed force, root moment, and torque', () => {
    const actions = internalActionAtY(0, [0, 1, 3], [100, 200], [10, 20]);
    expect(actions.shearN).toBeCloseTo(500, 12);
    expect(actions.bendingMomentNm).toBeCloseTo(850, 12);
    expect(actions.torqueNm).toBeCloseTo(50, 12);
  });

  it('includes finite tip loads in recovered internal actions', () => {
    const actions = internalActionAtY(0, [0, 2], [0], [0], 1_000, 600);
    expect(actions.shearN).toBe(1_000);
    expect(actions.bendingMomentNm).toBe(2_000);
    expect(actions.torqueNm).toBe(600);
    expect(() => internalActionAtY(-0.1, [0, 2], [0], [0])).toThrow(/station/);
    expect(() => internalActionAtY(0, [0, 2], [0], [Number.NaN])).toThrow(/finite/);
  });

  it('reduces bending deflection and torsional twist monotonically as stiffness increases', () => {
    const flexibleBending = solveCantileverBending([0, 2], () => 500_000, [500]);
    const stiffBending = solveCantileverBending([0, 2], () => 1_000_000, [500]);
    expect(stiffBending.deflectionM[1]).toBeCloseTo(flexibleBending.deflectionM[1] / 2, 12);

    const flexibleTorsion = solveCantileverTorsion([0, 2], () => 250_000, [300]);
    const stiffTorsion = solveCantileverTorsion([0, 2], () => 500_000, [300]);
    expect(stiffTorsion.twistRad[1]).toBeCloseTo(flexibleTorsion.twistRad[1] / 2, 12);
  });
});
